package wsgrpc

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"nhooyr.io/websocket"

	pb "github.com/nggorpc/wsgrpc/generated"
)

// TestStreamIsolation verifies that data sent on different stream IDs remains isolated
// and doesn't leak between streams
func TestStreamIsolation(t *testing.T) {
	// Create a test server
	server := NewServer(ServerOption{
		InsecureSkipVerify: true,
		MaxPayloadSize:     4 * 1024 * 1024,
	})

	// Register a simple echo service that streams back received messages
	desc := &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods:     []grpc.MethodDesc{},
		Streams: []grpc.StreamDesc{
			{
				StreamName: "StreamGreet",
				Handler: func(srv interface{}, stream grpc.ServerStream) error {
					for {
						var req pb.HelloRequest
						if err := stream.RecvMsg(&req); err != nil {
							if err == io.EOF {
								return nil
							}
							return err
						}

						// Echo back with modified message to identify which stream processed it
						resp := &pb.HelloResponse{
							Message: fmt.Sprintf("Stream processed: %s", req.GetName()),
						}

						if err := stream.SendMsg(resp); err != nil {
							return err
						}
					}
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
	defer conn.Close(websocket.StatusNormalClosure, "test complete")

	// Stream 1: Send HEADERS frame
	stream1ID := uint32(1)
	headers1 := "path: /greeter.Greeter/StreamGreet\n"
	headersFrame1 := encodeFrame(stream1ID, FlagHEADERS, []byte(headers1))
	if err := conn.Write(ctx, websocket.MessageBinary, headersFrame1); err != nil {
		t.Fatalf("Failed to send HEADERS for stream 1: %v", err)
	}

	// Stream 3: Send HEADERS frame (intentionally non-sequential ID)
	stream3ID := uint32(3)
	headers3 := "path: /greeter.Greeter/StreamGreet\n"
	headersFrame3 := encodeFrame(stream3ID, FlagHEADERS, []byte(headers3))
	if err := conn.Write(ctx, websocket.MessageBinary, headersFrame3); err != nil {
		t.Fatalf("Failed to send HEADERS for stream 3: %v", err)
	}

	// Give server time to set up streams
	time.Sleep(50 * time.Millisecond)

	// Send data on Stream 1
	req1 := &pb.HelloRequest{Name: "Alice"}
	data1, err := proto.Marshal(req1)
	if err != nil {
		t.Fatalf("Failed to marshal request 1: %v", err)
	}
	dataFrame1 := encodeFrame(stream1ID, FlagDATA, data1)
	if err := conn.Write(ctx, websocket.MessageBinary, dataFrame1); err != nil {
		t.Fatalf("Failed to send DATA for stream 1: %v", err)
	}

	// Send data on Stream 3
	req3 := &pb.HelloRequest{Name: "Bob"}
	data3, err := proto.Marshal(req3)
	if err != nil {
		t.Fatalf("Failed to marshal request 3: %v", err)
	}
	dataFrame3 := encodeFrame(stream3ID, FlagDATA, data3)
	if err := conn.Write(ctx, websocket.MessageBinary, dataFrame3); err != nil {
		t.Fatalf("Failed to send DATA for stream 3: %v", err)
	}

	// Read responses and verify isolation
	receivedStream1 := false
	receivedStream3 := false

	// Set a timeout for reading responses
	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	for i := 0; i < 4; i++ { // Expect 2 DATA frames (responses) for each stream
		msgType, frameData, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("Failed to read response frame %d: %v", i, err)
		}

		if msgType != websocket.MessageBinary {
			continue
		}

		frame, err := decodeFrame(frameData, 4*1024*1024)
		if err != nil {
			t.Fatalf("Failed to decode response frame: %v", err)
		}

		// Skip non-DATA frames (like HEADERS or TRAILERS)
		if frame.Flags&FlagDATA == 0 {
			continue
		}

		// Decode the response
		var resp pb.HelloResponse
		if err := proto.Unmarshal(frame.Payload, &resp); err != nil {
			t.Fatalf("Failed to unmarshal response: %v", err)
		}

		// Verify the response matches the expected stream
		switch frame.StreamID {
		case stream1ID:
			if resp.GetMessage() != "Stream processed: Alice" {
				t.Errorf("Stream 1 received wrong data: got %q, want %q",
					resp.GetMessage(), "Stream processed: Alice")
			}
			receivedStream1 = true
			t.Logf("Stream 1 correctly received: %s", resp.GetMessage())

		case stream3ID:
			if resp.GetMessage() != "Stream processed: Bob" {
				t.Errorf("Stream 3 received wrong data: got %q, want %q",
					resp.GetMessage(), "Stream processed: Bob")
			}
			receivedStream3 = true
			t.Logf("Stream 3 correctly received: %s", resp.GetMessage())

		default:
			t.Errorf("Received response on unexpected stream ID: %d", frame.StreamID)
		}

		if receivedStream1 && receivedStream3 {
			break
		}
	}

	// Verify both streams received their responses
	if !receivedStream1 {
		t.Error("Stream 1 did not receive expected response")
	}
	if !receivedStream3 {
		t.Error("Stream 3 did not receive expected response")
	}

	// Close streams properly
	finFrame1 := encodeFrame(stream1ID, FlagDATA|FlagEOS, []byte{})
	if err := conn.Write(ctx, websocket.MessageBinary, finFrame1); err != nil {
		t.Logf("Failed to send FIN for stream 1: %v", err)
	}

	finFrame3 := encodeFrame(stream3ID, FlagDATA|FlagEOS, []byte{})
	if err := conn.Write(ctx, websocket.MessageBinary, finFrame3); err != nil {
		t.Logf("Failed to send FIN for stream 3: %v", err)
	}

	t.Log("Stream isolation test passed: data on different streams remained isolated")
}
