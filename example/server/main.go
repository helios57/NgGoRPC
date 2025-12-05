package main

import (
	"context"
	"log"

	"github.com/nggorpc/wsgrpc"
	pb "github.com/nggorpc/wsgrpc/generated"
)

// greeterServer implements the GreeterServer interface
type greeterServer struct {
	pb.UnimplementedGreeterServer
}

// SayHello implements the SayHello RPC method
func (s *greeterServer) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloResponse, error) {
	log.Printf("[Greeter] Received SayHello request: name=%s", req.Name)
	
	response := &pb.HelloResponse{
		Message: "Hello, " + req.Name + "!",
	}
	
	log.Printf("[Greeter] Sending response: %s", response.Message)
	return response, nil
}

func main() {
	// Create wsgrpc server
	server := wsgrpc.NewServer()
	
	// Register the Greeter service
	greeterImpl := &greeterServer{}
	pb.RegisterGreeterServer(server, greeterImpl)
	
	// Start the server
	log.Println("[Example Server] Starting NgGoRPC server on :8080")
	if err := server.ListenAndServe(":8080"); err != nil {
		log.Fatalf("[Example Server] Failed to start server: %v", err)
	}
}
