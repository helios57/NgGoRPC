# wsgrpc

Go server library for NgGoRPC - enabling gRPC over WebSocket.

## Overview

This library provides a WebSocket-based transport adapter for standard gRPC services in Go. It enables:

- Multiplexed bidirectional streaming over WebSocket
- Compatibility with standard `grpc.ServerStream` interface
- Support for all gRPC middleware and interceptors
- Seamless integration with `protoc-gen-go-grpc` generated code

## Installation

```bash
go get github.com/helios57/NgGoRPC/wsgrpc
```

## Usage

```go
package main

import (
    "github.com/helios57/NgGoRPC/wsgrpc"
    pb "yourproject/generated/greeter"
)

type greeterServer struct {
    pb.UnimplementedGreeterServer
}

func (s *greeterServer) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloResponse, error) {
    return &pb.HelloResponse{
        Message: "Hello " + req.Name,
    }, nil
}

func main() {
    srv := wsgrpc.NewServer(wsgrpc.ServerOption{})
    pb.RegisterGreeterServer(srv, &greeterServer{})
    
    if err := srv.ListenAndServe(":8080", "/rpc"); err != nil {
        log.Fatal(err)
    }
}
```

## Development

### Generate Protobuf Code

```bash
bash scripts/protoc.sh
```

## Publishing

To publish the Go module to a private git repository:

1. **Ensure go.mod is Correct**:
   - Verify the module path in `go.mod` matches your repository URL
   - Example: `module github.com/helios57/NgGoRPC/wsgrpc`

2. **Tag a Version**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **For Semantic Versioning**:
   - `v1.0.x` - Patch releases (bug fixes)
   - `v1.x.0` - Minor releases (new features, backward compatible)
   - `vx.0.0` - Major releases (breaking changes)

4. **Using in Other Projects**:
   ```bash
   go get github.com/helios57/NgGoRPC/wsgrpc@v1.0.0
   ```

5. **For Private Repositories**:
   ```bash
   # Configure Git authentication
   git config --global url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
   
   # Or use SSH
   git config --global url."git@github.com:".insteadOf "https://github.com/"
   
   # Set GOPRIVATE environment variable
   export GOPRIVATE=github.com/helios57/*
   ```

## License

MIT
