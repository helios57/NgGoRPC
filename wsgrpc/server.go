package wsgrpc

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"nhooyr.io/websocket"
)

// methodInfo stores the handler and service implementation for a method
type methodInfo struct {
	unaryHandler  *grpc.MethodDesc
	streamHandler *grpc.StreamDesc
	srv           interface{}
}

// ServerOption configures server behavior
type ServerOption struct {
	// InsecureSkipVerify disables origin checking (development only)
	InsecureSkipVerify bool
	// MaxPayloadSize sets the maximum frame payload size (default 4MB)
	MaxPayloadSize uint32
	// IdleTimeout sets the duration after which idle streams are closed (default 5 minutes)
	IdleTimeout time.Duration
	// IdleCheckInterval sets how often to check for idle streams (default 1 minute)
	IdleCheckInterval time.Duration
}

// Server represents a WebSocket-based gRPC server
type Server struct {
	mu          sync.RWMutex
	methods     map[string]*methodInfo // method path -> method info
	options     ServerOption
	connections map[*wsConnection]struct{} // Track active connections for graceful shutdown
	shutdown    bool                       // Flag to indicate server is shutting down
}

// wsConnection manages a single WebSocket connection and its streams
type wsConnection struct {
	conn         *websocket.Conn
	ctx          context.Context
	cancel       context.CancelFunc
	sendChan     chan []byte
	mu           sync.Mutex
	streamMap    map[uint32]*WebSocketServerStream
	nextStreamID uint32
	server       *Server // Reference to server for accessing options
}

// WebSocketServerStream implements grpc.ServerStream for WebSocket transport
type WebSocketServerStream struct {
	ctx          context.Context
	cancel       context.CancelFunc // Stream-specific cancel function for RST_STREAM handling
	conn         *wsConnection
	streamID     uint32
	recvChan     chan []byte
	method       string
	headerMu     sync.Mutex
	header       metadata.MD
	headerSent   bool
	trailer      metadata.MD
	lastActivity time.Time // Last time this stream had activity (for idle timeout)
	activityMu   sync.Mutex
}

// updateActivity updates the last activity timestamp for idle timeout tracking
func (s *WebSocketServerStream) updateActivity() {
	s.activityMu.Lock()
	s.lastActivity = time.Now()
	s.activityMu.Unlock()
}

// SetHeader implements grpc.ServerStream
// Sets the header metadata. Must be called before SendHeader or the first SendMsg.
func (s *WebSocketServerStream) SetHeader(md metadata.MD) error {
	s.headerMu.Lock()
	defer s.headerMu.Unlock()

	if s.headerSent {
		return fmt.Errorf("headers already sent")
	}

	if s.header == nil {
		s.header = metadata.MD{}
	}

	// Merge metadata
	for k, v := range md {
		s.header[k] = append(s.header[k], v...)
	}

	return nil
}

// SendHeader implements grpc.ServerStream
// Sends the header metadata immediately. Cannot be called after the first SendMsg.
func (s *WebSocketServerStream) SendHeader(md metadata.MD) error {
	s.headerMu.Lock()
	defer s.headerMu.Unlock()

	if s.headerSent {
		return fmt.Errorf("headers already sent")
	}

	// Merge with any previously set headers
	if s.header == nil {
		s.header = metadata.MD{}
	}

	for k, v := range md {
		s.header[k] = append(s.header[k], v...)
	}

	// Serialize headers to frame payload
	var headerLines []string
	for k, values := range s.header {
		for _, v := range values {
			headerLines = append(headerLines, fmt.Sprintf("%s: %s", k, v))
		}
	}

	headersPayload := []byte(strings.Join(headerLines, "\n"))
	headersFrame := encodeFrame(s.streamID, FlagHEADERS, headersPayload)

	err := s.conn.send(headersFrame)
	if err != nil {
		return fmt.Errorf("failed to send headers: %w", err)
	}

	s.headerSent = true
	log.Printf("[wsgrpc] Sent HEADERS frame for stream %d", s.streamID)
	return nil
}

// SetTrailer implements grpc.ServerStream
// Sets the trailer metadata. This will be sent with the final TRAILERS frame.
func (s *WebSocketServerStream) SetTrailer(md metadata.MD) {
	s.headerMu.Lock()
	defer s.headerMu.Unlock()

	if s.trailer == nil {
		s.trailer = metadata.MD{}
	}

	// Merge metadata
	for k, v := range md {
		s.trailer[k] = append(s.trailer[k], v...)
	}
}

// Context implements grpc.ServerStream
func (s *WebSocketServerStream) Context() context.Context {
	return s.ctx
}

// SendMsg implements grpc.ServerStream - sends a message to the client
func (s *WebSocketServerStream) SendMsg(m interface{}) error {
	// Update activity timestamp
	s.updateActivity()

	// Marshal the protobuf message
	msg, ok := m.(proto.Message)
	if !ok {
		return fmt.Errorf("message does not implement proto.Message")
	}

	data, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	// Encode and send DATA frame
	frame := encodeFrame(s.streamID, FlagDATA, data)

	err = s.conn.send(frame)
	if err != nil {
		return fmt.Errorf("failed to send frame: %w", err)
	}

	log.Printf("[wsgrpc] Sent DATA frame for stream %d, size: %d bytes", s.streamID, len(data))
	return nil
}

// RecvMsg implements grpc.ServerStream - receives a message from the client
func (s *WebSocketServerStream) RecvMsg(m interface{}) error {
	// Wait for data from the read loop
	select {
	case data, ok := <-s.recvChan:
		if !ok {
			return io.EOF
		}

		// Update activity timestamp
		s.updateActivity()

		// Unmarshal into the provided message
		msg, ok := m.(proto.Message)
		if !ok {
			return fmt.Errorf("message does not implement proto.Message")
		}

		if err := proto.Unmarshal(data, msg); err != nil {
			return fmt.Errorf("failed to unmarshal message: %w", err)
		}

		log.Printf("[wsgrpc] Received message for stream %d, size: %d bytes", s.streamID, len(data))
		return nil

	case <-s.ctx.Done():
		return s.ctx.Err()
	}
}

// send sends a frame to the connection using the actor pattern (channel-based writes)
func (c *wsConnection) send(frame []byte) error {
	select {
	case c.sendChan <- frame:
		return nil
	case <-c.ctx.Done():
		return c.ctx.Err()
	}
}

// writerLoop is the actor goroutine that serializes all writes to the WebSocket
func (c *wsConnection) writerLoop() {
	for {
		select {
		case frame, ok := <-c.sendChan:
			if !ok {
				// Channel closed, cancel connection context to unblock read loop
				log.Printf("[wsgrpc] Send channel closed, cancelling connection")
				c.cancel()
				return
			}
			// Write to WebSocket without mutex contention
			if err := c.conn.Write(c.ctx, websocket.MessageBinary, frame); err != nil {
				log.Printf("[wsgrpc] Write error in writer loop: %v, cancelling connection", err)
				c.cancel()
				return
			}
		case <-c.ctx.Done():
			return
		}
	}
}

// idleTimeoutMonitor periodically checks for idle streams and closes them
// Per PROTOCOL.md Section 10.3: "Streams with no activity for 5 minutes SHOULD be closed by the server"
func (c *wsConnection) idleTimeoutMonitor() {
	checkInterval := c.server.options.IdleCheckInterval
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.checkIdleStreams()
		case <-c.ctx.Done():
			return
		}
	}
}

// checkIdleStreams checks all streams and closes those idle for more than the configured timeout
func (c *wsConnection) checkIdleStreams() {
	idleTimeout := c.server.options.IdleTimeout
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()

	for streamID, stream := range c.streamMap {
		stream.activityMu.Lock()
		idleDuration := now.Sub(stream.lastActivity)
		stream.activityMu.Unlock()

		if idleDuration > idleTimeout {
			log.Printf("[wsgrpc] Stream %d idle for %v, closing due to timeout", streamID, idleDuration)

			// Cancel the stream's context
			if stream.cancel != nil {
				stream.cancel()
			}

			// Close the receive channel to unblock any pending RecvMsg
			close(stream.recvChan)

			// Remove from stream map
			delete(c.streamMap, streamID)
		}
	}
}

// Close closes the connection and cleans up resources
func (c *wsConnection) Close() {
	if c.cancel != nil {
		c.cancel()
	}
	close(c.sendChan)
}

// NewServer creates a new wsgrpc server with optional configuration
func NewServer(opts ...ServerOption) *Server {
	// Default options
	options := ServerOption{
		InsecureSkipVerify: false,           // Secure by default
		MaxPayloadSize:     4 * 1024 * 1024, // 4MB default
		IdleTimeout:        5 * time.Minute, // 5 minute default idle timeout
		IdleCheckInterval:  1 * time.Minute, // 1 minute default check interval
	}

	// Apply provided options
	if len(opts) > 0 {
		options = opts[0]
	}

	return &Server{
		methods:     make(map[string]*methodInfo),
		options:     options,
		connections: make(map[*wsConnection]struct{}),
	}
}

// RegisterService registers a gRPC service with its handlers
func (s *Server) RegisterService(sd *grpc.ServiceDesc, ss interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Register unary methods
	for i := range sd.Methods {
		method := sd.Methods[i]
		methodPath := "/" + sd.ServiceName + "/" + method.MethodName
		s.methods[methodPath] = &methodInfo{
			unaryHandler: &method,
			srv:          ss,
		}
		log.Printf("[wsgrpc] Registered unary method: %s", methodPath)
	}

	// Register streaming methods
	for i := range sd.Streams {
		stream := sd.Streams[i]
		methodPath := "/" + sd.ServiceName + "/" + stream.StreamName
		s.methods[methodPath] = &methodInfo{
			streamHandler: &stream,
			srv:           ss,
		}
		log.Printf("[wsgrpc] Registered streaming method: %s", methodPath)
	}
}

// HandleWebSocket handles incoming WebSocket connections for gRPC communication.
// This is an HTTP handler that upgrades the connection to WebSocket and starts
// processing NgGoRPC frames.
func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Accept the WebSocket connection
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: s.options.InsecureSkipVerify,
	})
	if err != nil {
		log.Printf("[wsgrpc] Failed to accept WebSocket connection: %v", err)
		return
	}
	defer conn.Close(websocket.StatusInternalError, "internal error")

	log.Printf("[wsgrpc] WebSocket connection established from %s", r.RemoteAddr)

	// Start processing frames in a goroutine
	if err := s.handleConnection(r.Context(), conn); err != nil {
		log.Printf("[wsgrpc] Connection error: %v", err)
		conn.Close(websocket.StatusInternalError, err.Error())
		return
	}

	conn.Close(websocket.StatusNormalClosure, "goodbye")
}

// handleConnection manages the lifecycle of a single WebSocket connection.
// It runs a read loop that decodes incoming frames and processes them.
func (s *Server) handleConnection(ctx context.Context, conn *websocket.Conn) error {
	// Check if server is shutting down
	s.mu.RLock()
	if s.shutdown {
		s.mu.RUnlock()
		return fmt.Errorf("server is shutting down")
	}
	s.mu.RUnlock()

	// Create cancellable context for the connection
	connCtx, cancel := context.WithCancel(ctx)

	// Create connection state with actor pattern
	wsConn := &wsConnection{
		conn:      conn,
		ctx:       connCtx,
		cancel:    cancel,
		sendChan:  make(chan []byte, 100), // Buffered channel to reduce blocking
		streamMap: make(map[uint32]*WebSocketServerStream),
		server:    s, // Reference to server for accessing options
	}

	// Register the connection
	s.mu.Lock()
	s.connections[wsConn] = struct{}{}
	s.mu.Unlock()

	// Ensure cleanup on exit
	defer func() {
		wsConn.Close()
		// Unregister the connection
		s.mu.Lock()
		delete(s.connections, wsConn)
		s.mu.Unlock()
	}()

	// Start the writer goroutine (actor pattern)
	go wsConn.writerLoop()

	// Start the idle timeout monitor goroutine
	go wsConn.idleTimeoutMonitor()

	for {
		// Read a message from the WebSocket
		msgType, data, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("read error: %w", err)
		}

		// Ensure we received a binary message
		if msgType != websocket.MessageBinary {
			log.Printf("[wsgrpc] Warning: received non-binary message type: %v", msgType)
			continue
		}

		// Decode the frame
		frame, err := decodeFrame(data, s.options.MaxPayloadSize)
		if err != nil {
			log.Printf("[wsgrpc] Frame decoding error: %v", err)
			continue
		}

		// Log the decoded frame details for validation
		log.Printf("[wsgrpc] Received frame: StreamID=%d, Flags=0x%02x, PayloadSize=%d",
			frame.StreamID, frame.Flags, len(frame.Payload))

		// Handle PING frames - respond with PONG
		if frame.Flags&FlagPING != 0 {
			log.Printf("[wsgrpc] Received PING, sending PONG")
			pongFrame := encodeFrame(0, FlagPONG, []byte{})
			wsConn.send(pongFrame)
			continue
		}

		// Handle PONG frames - just log
		if frame.Flags&FlagPONG != 0 {
			log.Printf("[wsgrpc] Received PONG from client")
			continue
		}

		// Process frame based on type
		if frame.Flags&FlagHEADERS != 0 {
			// New stream - parse headers (method path and metadata)
			headersText := string(frame.Payload)

			// Parse headers to extract method path and metadata
			md := metadata.New(nil)
			var methodPath string

			// Split by newlines and parse each line
			for _, line := range splitLines(headersText) {
				if len(line) == 0 {
					continue
				}

				// Split on first colon
				idx := findFirstColon(line)
				if idx == -1 {
					continue
				}

				key := trimSpace(line[:idx])
				value := trimSpace(line[idx+1:])

				if key == "path" {
					methodPath = value
				} else {
					// Add to metadata
					md.Append(key, value)
				}
			}

			log.Printf("[wsgrpc] New stream %d for method: %s", frame.StreamID, methodPath)

			// Look up the method handler
			s.mu.RLock()
			methodInfo, ok := s.methods[methodPath]
			s.mu.RUnlock()

			if !ok {
				log.Printf("[wsgrpc] Method not found: %s", methodPath)
				// Send RST_STREAM
				rstFrame := encodeFrame(frame.StreamID, FlagRST_STREAM, []byte("method not found"))
				wsConn.send(rstFrame)
				continue
			}

			// Create context with metadata derived from connection context
			// This ensures cancellation propagates when connection closes
			streamCtx := metadata.NewIncomingContext(wsConn.ctx, md)

			// Create cancellable context for this specific stream
			// This allows individual stream cancellation via RST_STREAM
			streamCtx, streamCancel := context.WithCancel(streamCtx)

			// Create stream
			stream := &WebSocketServerStream{
				ctx:          streamCtx,
				cancel:       streamCancel,
				conn:         wsConn,
				streamID:     frame.StreamID,
				recvChan:     make(chan []byte, 10),
				method:       methodPath,
				lastActivity: time.Now(),
			}

			wsConn.streamMap[frame.StreamID] = stream

			// Spawn handler goroutine
			go s.handleStream(stream, methodInfo)

		} else if frame.Flags&FlagDATA != 0 {
			// Data frame - route to existing stream
			stream, ok := wsConn.streamMap[frame.StreamID]
			if !ok {
				log.Printf("[wsgrpc] Stream %d not found for DATA frame", frame.StreamID)
				continue
			}

			// Send data to stream's channel
			stream.recvChan <- frame.Payload

			// If EOS flag is set, close the receive channel
			if frame.Flags&FlagEOS != 0 {
				close(stream.recvChan)
			}
		} else if frame.Flags&FlagRST_STREAM != 0 {
			// RST_STREAM frame - client is cancelling the stream
			wsConn.mu.Lock()
			stream, ok := wsConn.streamMap[frame.StreamID]
			if ok {
				log.Printf("[wsgrpc] Stream %d context cancelled by RST_STREAM", frame.StreamID)
				// Cancel the stream's context to stop the handler
				if stream.cancel != nil {
					stream.cancel()
				}
				// Close the receive channel to unblock any pending RecvMsg
				close(stream.recvChan)
				// Remove from stream map
				delete(wsConn.streamMap, frame.StreamID)
			} else {
				log.Printf("[wsgrpc] Stream %d not found for RST_STREAM frame", frame.StreamID)
			}
			wsConn.mu.Unlock()
		}
	}
}

// handleStream invokes the gRPC method handler
func (s *Server) handleStream(stream *WebSocketServerStream, methodInfo *methodInfo) {
	var err error

	// Invoke the appropriate handler based on method type
	if methodInfo.unaryHandler != nil {
		// Unary method handler
		dec := func(m interface{}) error {
			return stream.RecvMsg(m)
		}
		_, err = methodInfo.unaryHandler.Handler(methodInfo.srv, stream.ctx, dec, nil)
	} else if methodInfo.streamHandler != nil {
		// Streaming method handler
		err = methodInfo.streamHandler.Handler(methodInfo.srv, stream)
	} else {
		err = fmt.Errorf("no handler found for method")
	}

	// Default status OK
	statusCode := 0
	statusMsg := "OK"

	if err != nil {
		log.Printf("[wsgrpc] Handler error for stream %d: %v", stream.streamID, err)
		// Extract gRPC status code from error
		if st, ok := status.FromError(err); ok {
			statusCode = int(st.Code())
			statusMsg = st.Message()
		} else {
			// Fallback to Unknown status
			statusCode = 2 // Unknown
			statusMsg = err.Error()
		}
	}

	// Build trailers payload with grpc-status and grpc-message
	var trailerLines []string
	trailerLines = append(trailerLines, fmt.Sprintf("grpc-status:%d", statusCode))
	trailerLines = append(trailerLines, fmt.Sprintf("grpc-message:%s", statusMsg))

	// Add any custom trailer metadata set by the handler
	stream.headerMu.Lock()
	if stream.trailer != nil {
		for k, values := range stream.trailer {
			for _, v := range values {
				trailerLines = append(trailerLines, fmt.Sprintf("%s: %s", k, v))
			}
		}
	}
	stream.headerMu.Unlock()

	trailersPayload := []byte(strings.Join(trailerLines, "\n"))
	trailersFrame := encodeFrame(stream.streamID, FlagTRAILERS, trailersPayload)

	stream.conn.send(trailersFrame)

	log.Printf("[wsgrpc] Stream %d completed with status %d: %s", stream.streamID, statusCode, statusMsg)

	// Clean up stream from map
	delete(stream.conn.streamMap, stream.streamID)
}

// ListenAndServe starts an HTTP server that handles WebSocket connections
func (s *Server) ListenAndServe(addr string) error {
	http.HandleFunc("/", s.HandleWebSocket)
	log.Printf("[wsgrpc] Server listening on %s", addr)
	return http.ListenAndServe(addr, nil)
}

// Shutdown gracefully shuts down the server by signaling all active streams with RST_STREAM
// and waiting for connections to close. It respects the provided context's deadline.
func (s *Server) Shutdown(ctx context.Context) error {
	log.Printf("[wsgrpc] Server shutdown initiated")

	// Set shutdown flag to reject new connections
	s.mu.Lock()
	s.shutdown = true
	connectionsCopy := make([]*wsConnection, 0, len(s.connections))
	for conn := range s.connections {
		connectionsCopy = append(connectionsCopy, conn)
	}
	s.mu.Unlock()

	// Send RST_STREAM to all active streams on all connections
	for _, conn := range connectionsCopy {
		conn.mu.Lock()
		for streamID, stream := range conn.streamMap {
			log.Printf("[wsgrpc] Sending RST_STREAM to stream %d during shutdown", streamID)

			// Build RST_STREAM frame with error code 0 (graceful shutdown)
			rstPayload := make([]byte, 4)
			// Error code 0 indicates graceful shutdown
			rstPayload[0] = 0
			rstPayload[1] = 0
			rstPayload[2] = 0
			rstPayload[3] = 0

			rstFrame := encodeFrame(streamID, FlagRST_STREAM, rstPayload)

			// Send RST_STREAM frame (non-blocking attempt)
			select {
			case conn.sendChan <- rstFrame:
				// Frame queued successfully
			case <-time.After(100 * time.Millisecond):
				log.Printf("[wsgrpc] Timeout sending RST_STREAM for stream %d", streamID)
			}

			// Cancel the stream's context
			if stream.cancel != nil {
				stream.cancel()
			}
		}
		conn.mu.Unlock()

		// Give the writer loop time to send queued RST_STREAM frames
		time.Sleep(200 * time.Millisecond)

		// Cancel the connection context to trigger cleanup
		conn.cancel()
	}

	// Wait for all connections to clean up or context to expire
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		s.mu.RLock()
		remaining := len(s.connections)
		s.mu.RUnlock()

		if remaining == 0 {
			log.Printf("[wsgrpc] All connections closed, shutdown complete")
			return nil
		}

		select {
		case <-ctx.Done():
			log.Printf("[wsgrpc] Shutdown context expired with %d connections remaining", remaining)
			return ctx.Err()
		case <-ticker.C:
			// Continue waiting
		}
	}
}

// Helper functions for parsing headers

// splitLines splits a string by newline characters
func splitLines(s string) []string {
	return strings.Split(s, "\n")
}

// findFirstColon finds the index of the first colon in a string
func findFirstColon(s string) int {
	return strings.Index(s, ":")
}

// trimSpace removes leading and trailing whitespace from a string
func trimSpace(s string) string {
	return strings.TrimSpace(s)
}
