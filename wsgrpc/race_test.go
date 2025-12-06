package wsgrpc

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"nhooyr.io/websocket"

	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
)

// TestRaceCondition verifies that concurrent stream creation and deletion
// does not cause a data race on the stream map.
// Run with: go test -race -v -run TestRaceCondition
func TestRaceCondition(t *testing.T) {
	// Create a test server
	server := NewServer(ServerOption{
		InsecureSkipVerify: true,
		MaxPayloadSize:     4 * 1024 * 1024,
		IdleTimeout:        100 * time.Millisecond, // Short timeout to trigger idle check concurrently
		IdleCheckInterval:  10 * time.Millisecond,
	})

	// Register a simple echo service
	desc := &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods:     []grpc.MethodDesc{},
		Streams: []grpc.StreamDesc{
			{
				StreamName: "StreamGreet",
				Handler: func(srv interface{}, stream grpc.ServerStream) error {
					// Just confirm receipt and exit
					// This causes the stream to be cleaned up rapidly
					return nil
				},
				ServerStreams: true,
				ClientStreams: true,
			},
		},
	}

	server.RegisterService(desc, nil)

	// Create test HTTP server
	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	// Convert http:// to ws://
	wsURL := "ws" + httpServer.URL[4:]

	// Connect WebSocket client
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial WebSocket: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "test complete") }()

	// Number of concurrent streams to launch
	numStreams := 100
	var wg sync.WaitGroup
	wg.Add(numStreams)

	// Use a lock for writing to the websocket conn from multiple goroutines
	var connMu sync.Mutex

	// Launch streams concurrently
	for i := 0; i < numStreams; i++ {
		go func(id int) {
			defer wg.Done()
			streamID := uint32(id + 1)

			// Send HEADERS
			headers := "path: /greeter.Greeter/StreamGreet\n"
			headersFrame := encodeFrame(streamID, FlagHEADERS, []byte(headers))

			connMu.Lock()
			if err := conn.Write(ctx, websocket.MessageBinary, headersFrame); err != nil {
				t.Errorf("Failed to write headers frame: %v", err)
			}
			connMu.Unlock()

			// Send DATA
			req := &pb.HelloRequest{Name: fmt.Sprintf("User%d", id)}
			data, _ := proto.Marshal(req)
			dataFrame := encodeFrame(streamID, FlagDATA, data)

			connMu.Lock()
			if err := conn.Write(ctx, websocket.MessageBinary, dataFrame); err != nil {
				t.Errorf("Failed to write data frame: %v", err)
			}
			connMu.Unlock()

			// Sleep a tiny bit to allow some overlap
			time.Sleep(time.Duration(rand.Intn(10)) * time.Millisecond)
		}(i)
	}

	// Also launch a reader loop to consume responses so the server doesn't block on writing
	go func() {
		for {
			_, _, err := conn.Read(ctx)
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()

	// Wait a bit more for idle cleanup to possibly race
	time.Sleep(200 * time.Millisecond)
}
