package wsgrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
)

func TestTruncateForLog(t *testing.T) {
	// ... (keep existing)
	tests := []struct {
		input    string
		expected string
	}{
		{"short", "short"},
		{"exactly20chars123456", "exactly20chars123456"},
		{"longerthan20chars123456", "longerthan20chars123... (size: 23)"},
	}

	for _, tt := range tests {
		result := truncateForLog(tt.input)
		if result != tt.expected {
			t.Errorf("truncateForLog(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestRecvMsgInvalidType(t *testing.T) {
	// Setup a mock stream
	stream := &WebSocketServerStream{
		recvChan: make(chan []byte, 1),
		ctx:      context.Background(),
		conn: &wsConnection{
			server: &Server{options: ServerOption{EnableLogging: true}},
		},
		streamID: 1,
	}

	stream.recvChan <- []byte("data")

	// Pass a string instead of proto.Message
	err := stream.RecvMsg("not a proto message")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "message does not implement proto.Message" {
		t.Errorf("expected error 'message does not implement proto.Message', got %v", err)
	}
}

func TestRecvMsgUnmarshalError(t *testing.T) {
	stream := &WebSocketServerStream{
		recvChan: make(chan []byte, 1),
		ctx:      context.Background(),
		conn: &wsConnection{
			server: &Server{options: ServerOption{EnableLogging: true}},
		},
		streamID: 1,
	}

	// Inject invalid proto data
	stream.recvChan <- []byte("invalid proto data")

	// Use a valid proto message to pass type check
	msg := &pb.HelloRequest{}

	err := stream.RecvMsg(msg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	// "failed to unmarshal message: ..."
	if len(err.Error()) < 27 || err.Error()[:27] != "failed to unmarshal message" {
		t.Errorf("expected error starting with 'failed to unmarshal message', got %v", err)
	}
}

func TestWriterLoop_SendChanClosed(t *testing.T) {
	// Create a dummy server and connection
	server := NewServer(ServerOption{EnableLogging: true})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// We need a real websocket connection or it will panic when calling Write
	// But we can test the sendChan closed path which returns BEFORE calling Write

	// Create a partially initialized connection
	conn := &wsConnection{
		server:   server,
		ctx:      ctx,
		cancel:   cancel,
		sendChan: make(chan []byte),
		// conn field is nil, but writerLoop shouldn't touch it if sendChan is closed
	}

	// Start writerLoop in a goroutine
	done := make(chan struct{})
	go func() {
		conn.writerLoop()
		close(done)
	}()

	// Close sendChan
	close(conn.sendChan)

	// Wait for writerLoop to exit
	select {
	case <-done:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("writerLoop did not exit after sendChan closed")
	}
}

func TestWriterLoop_WriteError(t *testing.T) {
	// To test write error, we need a real websocket connection
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		// Close immediately to cause write error on other side?
		// Or just accept and let the test control it.
		// If we close the connection here, the server (test subject) writing to it might get an error.
		if err := c.Close(websocket.StatusNormalClosure, ""); err != nil {
			t.Logf("server close error: %v", err)
		}
	}))
	defer s.Close()

	ctx := context.Background()
	wsConn, _, err := websocket.Dial(ctx, s.URL, nil)
	if err != nil {
		t.Fatalf("Failed to dial: %v", err)
	}
	// We are acting as the server here in terms of wsConnection structure,
	// but using a client connection as the underlying connection.
	// wsConnection struct wraps *websocket.Conn.

	server := NewServer(ServerOption{EnableLogging: true})
	connCtx, cancel := context.WithCancel(context.Background())

	c := &wsConnection{
		conn:     wsConn,
		server:   server,
		ctx:      connCtx,
		cancel:   cancel,
		sendChan: make(chan []byte, 1),
	}

	// Close the underlying connection to force write error
	if err := wsConn.Close(websocket.StatusNormalClosure, "force close"); err != nil {
		t.Logf("client close error: %v", err)
	}

	done := make(chan struct{})
	go func() {
		c.writerLoop()
		close(done)
	}()

	// Send a frame
	c.sendChan <- []byte("test")

	// writerLoop should try to write, fail, and exit
	select {
	case <-done:
		// Success
	case <-time.After(1 * time.Second):
		t.Fatal("writerLoop did not exit after write error")
	}
}
