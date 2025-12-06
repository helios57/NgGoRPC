package main

import (
	"context"
	"log"
	"time"

	"github.com/helios57/NgGoRPC/wsgrpc"
	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
	"google.golang.org/grpc/metadata"
)

// greeterServer implements the GreeterServer interface
type greeterServer struct {
	pb.UnimplementedGreeterServer
}

// SayHello implements the SayHello RPC method
func (s *greeterServer) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloResponse, error) {
	log.Printf("[Greeter] Received SayHello request: name=%s", req.Name)

	// Extract metadata to check for authorization header
	md, ok := metadata.FromIncomingContext(ctx)
	if ok {
		authHeaders := md.Get("authorization")
		if len(authHeaders) > 0 {
			log.Printf("[Greeter] Authorization header received: %s", authHeaders[0])

			// For testing purposes, verify the token format
			// In production, you would validate the JWT token here
			expectedToken := "Bearer test-token"
			if authHeaders[0] == expectedToken {
				log.Printf("[Greeter] ✓ Valid test token received")
			} else {
				log.Printf("[Greeter] ⚠ Token mismatch: got '%s', expected '%s'", authHeaders[0], expectedToken)
			}
		} else {
			log.Printf("[Greeter] No authorization header found")
		}
	} else {
		log.Printf("[Greeter] No metadata found in context")
	}

	response := &pb.HelloResponse{
		Message: "Hello, " + req.Name + "!",
	}

	log.Printf("[Greeter] Sending response: %s", response.Message)
	return response, nil
}

// InfiniteTicker implements the InfiniteTicker RPC method
func (s *greeterServer) InfiniteTicker(req *pb.Empty, stream pb.Greeter_InfiniteTickerServer) error {
	log.Printf("[Greeter] InfiniteTicker started")

	var count int64 = 0
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			log.Printf("[Greeter] InfiniteTicker context cancelled (count: %d)", count)
			return stream.Context().Err()
		case <-ticker.C:
			count++
			tick := &pb.Tick{
				Count:     count,
				Timestamp: time.Now().Unix(),
			}
			if err := stream.Send(tick); err != nil {
				log.Printf("[Greeter] InfiniteTicker send error: %v", err)
				return err
			}
		}
	}
}

func main() {
	// Create wsgrpc server with options
	server := wsgrpc.NewServer(wsgrpc.ServerOption{
		InsecureSkipVerify: true,            // Allow connections from any origin (for development)
		MaxPayloadSize:     4 * 1024 * 1024, // 4MB
		IdleTimeout:        5 * time.Minute, // 5 minute idle timeout
		IdleCheckInterval:  1 * time.Minute, // 1 minute check interval
	})

	// Register the Greeter service
	greeterImpl := &greeterServer{}
	pb.RegisterGreeterServer(server, greeterImpl)

	// Start the server
	log.Println("[Example Server] Starting NgGoRPC server on :8080")
	if err := server.ListenAndServe(":8080"); err != nil {
		log.Fatalf("[Example Server] Failed to start server: %v", err)
	}
}
