package wsgrpc

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"nhooyr.io/websocket"
)

// methodInfo stores the handler and service implementation for a method
type methodInfo struct {
	handler grpc.MethodDesc
	srv     interface{}
}

// Server represents a WebSocket-based gRPC server
type Server struct {
	mu      sync.RWMutex
	methods map[string]*methodInfo // method path -> method info
}

// wsConnection manages a single WebSocket connection and its streams
type wsConnection struct {
	conn         *websocket.Conn
	ctx          context.Context
	mu           sync.Mutex
	streamMap    map[uint32]*WebSocketServerStream
	nextStreamID uint32
}

// WebSocketServerStream implements grpc.ServerStream for WebSocket transport
type WebSocketServerStream struct {
	ctx      context.Context
	conn     *wsConnection
	streamID uint32
	recvChan chan []byte
	method   string
}

// SetHeader implements grpc.ServerStream
func (s *WebSocketServerStream) SetHeader(metadata.MD) error {
	// TODO: Implement header sending
	return nil
}

// SendHeader implements grpc.ServerStream
func (s *WebSocketServerStream) SendHeader(metadata.MD) error {
	// TODO: Implement header sending
	return nil
}

// SetTrailer implements grpc.ServerStream
func (s *WebSocketServerStream) SetTrailer(metadata.MD) {
	// TODO: Implement trailer setting
}

// Context implements grpc.ServerStream
func (s *WebSocketServerStream) Context() context.Context {
	return s.ctx
}

// SendMsg implements grpc.ServerStream - sends a message to the client
func (s *WebSocketServerStream) SendMsg(m interface{}) error {
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
	
	s.conn.mu.Lock()
	defer s.conn.mu.Unlock()

	err = s.conn.conn.Write(s.ctx, websocket.MessageBinary, frame)
	if err != nil {
		return fmt.Errorf("failed to write frame: %w", err)
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

// NewServer creates a new wsgrpc server
func NewServer() *Server {
	return &Server{
		methods: make(map[string]*methodInfo),
	}
}

// RegisterService registers a gRPC service with its handlers
func (s *Server) RegisterService(sd *grpc.ServiceDesc, ss interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range sd.Methods {
		method := sd.Methods[i]
		methodPath := "/" + sd.ServiceName + "/" + method.MethodName
		s.methods[methodPath] = &methodInfo{
			handler: method,
			srv:     ss,
		}
		log.Printf("[wsgrpc] Registered method: %s", methodPath)
	}
}

// HandleWebSocket handles incoming WebSocket connections for gRPC communication.
// This is an HTTP handler that upgrades the connection to WebSocket and starts
// processing NgGoRPC frames.
func (s *Server) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Accept the WebSocket connection
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // For development; configure properly in production
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
	// Create connection state
	wsConn := &wsConnection{
		conn:      conn,
		ctx:       ctx,
		streamMap: make(map[uint32]*WebSocketServerStream),
	}

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
		frame, err := decodeFrame(data)
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
			conn.Write(ctx, websocket.MessageBinary, pongFrame)
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
				conn.Write(ctx, websocket.MessageBinary, rstFrame)
				continue
			}

			// Create context with metadata
			streamCtx := metadata.NewIncomingContext(ctx, md)

			// Create stream
			stream := &WebSocketServerStream{
				ctx:      streamCtx,
				conn:     wsConn,
				streamID: frame.StreamID,
				recvChan: make(chan []byte, 10),
				method:   methodPath,
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
		}
	}
}

// handleStream invokes the gRPC method handler
func (s *Server) handleStream(stream *WebSocketServerStream, methodInfo *methodInfo) {
	defer func() {
		// Clean up stream from map
		delete(stream.conn.streamMap, stream.streamID)
		
		// Send TRAILERS frame to signal completion
		trailersPayload := []byte("grpc-status:0") // Status OK
		trailersFrame := encodeFrame(stream.streamID, FlagTRAILERS, trailersPayload)
		
		stream.conn.mu.Lock()
		stream.conn.conn.Write(stream.ctx, websocket.MessageBinary, trailersFrame)
		stream.conn.mu.Unlock()
		
		log.Printf("[wsgrpc] Stream %d completed", stream.streamID)
	}()

	// Create a decoder function that reads from the stream
	dec := func(m interface{}) error {
		return stream.RecvMsg(m)
	}

	// Invoke the handler
	_, err := methodInfo.handler.Handler(methodInfo.srv, stream.ctx, dec, nil)
	if err != nil {
		log.Printf("[wsgrpc] Handler error for stream %d: %v", stream.streamID, err)
		// TODO: Send error in trailers
	}
}

// ListenAndServe starts an HTTP server that handles WebSocket connections
func (s *Server) ListenAndServe(addr string) error {
	http.HandleFunc("/", s.HandleWebSocket)
	log.Printf("[wsgrpc] Server listening on %s", addr)
	return http.ListenAndServe(addr, nil)
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
