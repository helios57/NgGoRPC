# NgGoRPC

**High-Performance, Bidirectional gRPC over WebSockets for Angular and Go**

---

## The Problem

Standard gRPC is built on HTTP/2, which is not fully available in browser environments. The common solution, gRPC-Web, is a compromise that translates gRPC into HTTP/1.1 requests. This approach has two major drawbacks:

1.  **No True Bidirectional Streaming**: Client-side and full-duplex streaming are not supported, limiting real-time applications.
2.  **Proxy Requirement**: It requires an intermediate proxy (like Envoy) to translate requests, adding operational complexity and a potential point of failure.

## The Solution: NgGoRPC

**NgGoRPC** is a bespoke RPC library that tunnels the full gRPC protocol over a single, persistent WebSocket connection. This approach bypasses browser limitations and eliminates the need for a proxy, enabling a direct, high-performance connection between an Angular frontend and a Go backend.

It is designed to provide the rich, type-safe developer experience of gRPC without compromise.

## Core Features

-   **Full Duplex Streaming**: Native support for unary, server-streaming, client-streaming, and bidirectional RPCs.
-   **Multiplexing over a Single Connection**: Run multiple concurrent RPCs over one WebSocket, avoiding connection limits and head-of-line blocking.
-   **Zero Dependencies on Proxies**: Simplifies your architecture by allowing your Angular application to connect directly to your Go service.
-   **Optimized for Angular**: Integrates seamlessly with Angular's reactive patterns and uses `NgZone` optimizations to prevent UI performance degradation from high-frequency stream updates.
-   **Seamless Tooling**: Works with the standard Protobuf toolchain (`protoc`, `ts-proto`, `protoc-gen-go-grpc`). Your `.proto` files are your single source of truth.
-   **Built-in Resilience**: Automatically handles network interruptions with a configurable exponential backoff and retry strategy.

## How It Works

NgGoRPC implements a lightweight binary framing protocol on top of WebSockets. This protocol re-implements the core concepts of HTTP/2 streams, allowing gRPC payloads, metadata, and control signals to be multiplexed and demultiplexed at the application layer.

-   **Frontend**: An Angular service manages the WebSocket, handles the binary framing, and exposes strongly-typed RxJS `Observables` for each RPC call.
-   **Backend**: A Go library wraps your standard gRPC service implementation, translating WebSocket frames into the `grpc.ServerStream` interface your handlers expect.

## Project Status

This project is currently in the development phase, as outlined in the [Concept.md](Concept.md) and [Tasks.md](Tasks.md) documents.

---

## Getting Started

### Prerequisites

**For the TypeScript Client (`nggorpc-client`):**
- Node.js 18+ and npm
- Angular 14+ (peer dependency)
- Protocol Buffers compiler (`protoc`)
- `ts-proto` plugin for TypeScript code generation

**For the Go Server (`wsgrpc`):**
- Go 1.21+
- Protocol Buffers compiler (`protoc`)
- `protoc-gen-go` and `protoc-gen-go-grpc` plugins

Install the protoc plugins:

```bash
# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Install TypeScript plugin (via npm in the nggorpc-client directory)
cd nggorpc-client
npm install
```

---

## Building the Libraries

### TypeScript Client Library

The `nggorpc-client` library provides the Angular integration for gRPC over WebSocket.

**1. Generate TypeScript code from `.proto` files:**

```bash
cd nggorpc-client
npm run protoc
```

This runs `scripts/protoc.sh` which generates TypeScript interfaces and service definitions in `src/generated/` using `ts-proto` with RxJS Observable support.

**2. Build the library:**

```bash
npm run build
```

This compiles TypeScript to JavaScript and generates type definitions in the `dist/` directory.

**3. Package for deployment:**

```bash
npm pack
```

This creates a `.tgz` file that can be installed in Angular applications or published to npm:

```bash
npm publish --access public
```

**4. Clean build artifacts:**

```bash
npm run clean
```

---

### Go Server Library

The `wsgrpc` library provides the Go server implementation for gRPC over WebSocket.

**1. Generate Go code from `.proto` files:**

```bash
cd wsgrpc
bash scripts/protoc.sh
```

This generates Go code in `generated/` directory, including protobuf message definitions and gRPC service interfaces.

**2. Build the library:**

The `wsgrpc` package is a Go module and doesn't require a separate build step. However, you can verify it compiles:

```bash
go build ./...
```

**3. Use in your Go project:**

Add the dependency to your `go.mod`:

```go
require github.com/nggorpc/wsgrpc v1.0.0
```

Then run:

```bash
go mod download
```

**4. Build the example server:**

```bash
cd example/server
go build -o server main.go
```

Or run directly:

```bash
go run main.go
```

The server will start on `localhost:8080`.

---

## Running Tests

### TypeScript Client Tests

**Unit Tests:**

```bash
cd nggorpc-client
npm test
```

Currently, the test framework needs to be configured. Based on [Tasks.md](Tasks.md), the following test types should be implemented:

- **Frame Codec Tests** (`frame.spec.ts`): Test encoding/decoding of binary frames with DataView
- **Client Lifecycle Tests** (`client.spec.ts`): Test Observable lifecycle, including unsubscribe behavior that sends RST_STREAM
- **Backoff Logic Tests**: Test reconnection with exponential backoff using RxJS TestScheduler

**Recommended test framework:** Jasmine or Jest with RxJS marble testing.

---

### Go Server Tests

**Unit Tests:**

```bash
cd wsgrpc
go test ./...
```

Run with verbose output:

```bash
go test -v ./...
```

Run with coverage:

```bash
go test -cover ./...
```

Based on [Tasks.md](Tasks.md), tests should cover:

- **Frame Encoding/Decoding** (`frame_test.go`): Verify binary frame format matches specification
- **Stream ID Management**: Test that server accepts client-initiated (odd) Stream IDs
- **Header Parsing**: Test metadata extraction from HEADERS frames
- **Concurrency**: Test multiplexed stream handling

---

## End-to-End Testing

E2E tests verify the complete integration between the Angular client and Go server.

**Setup:**

1. Start the example Go server:

```bash
cd example/server
go run main.go
```

2. Configure an Angular application to use the `nggorpc-client` library and point it to `ws://localhost:8080`

**Test Scenarios** (as defined in [Tasks.md](Tasks.md)):

- **Unary Call**: Send request, verify response, check stream closes
- **Server Streaming**: Verify client receives all messages, UI remains responsive
- **Client Cancellation**: Unsubscribe during streaming, verify server receives RST_STREAM
- **Network Interruption**: Simulate disconnect, verify automatic reconnection
- **Large Payload**: Test with 3MB+ payloads to verify frame size limits

**Recommended E2E framework:** Cypress or Playwright for browser automation.

---

## Deployment Guide

### Deploying the Go Server

**1. Build for production:**

```bash
cd example/server
CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server main.go
```

**2. Docker deployment (recommended):**

Create a `Dockerfile`:

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o server example/server/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /app/server /server
EXPOSE 8080
CMD ["/server"]
```

Build and run:

```bash
docker build -t nggorpc-server .
docker run -p 8080:8080 nggorpc-server
```

**3. TLS/WSS support:**

For production, use `wss://` (WebSocket Secure). Configure your server with TLS certificates or use a reverse proxy like Nginx or Caddy.

---

### Deploying the Angular Client

**1. Install the library in your Angular project:**

```bash
npm install @nggorpc/client
```

Or from a local build:

```bash
npm install ../path/to/nggorpc-client/nggorpc-client-1.0.0.tgz
```

**2. Configure the client:**

```typescript
import { NgGoRpcClient, NgGoRpcConfig } from '@nggorpc/client';

const config: NgGoRpcConfig = {
  pingInterval: 30000,        // 30s keep-alive
  baseReconnectDelay: 1000,   // 1s initial retry delay
  maxReconnectDelay: 30000,   // 30s max retry delay
  maxFrameSize: 4194304       // 4MB max frame size
};

// In your Angular module or component
const client = new NgGoRpcClient('wss://your-server.com/rpc', config);
```

**3. Build your Angular app:**

```bash
ng build --configuration=production
```

**4. Deploy the Angular app:**

Deploy the `dist/` directory to your web server, CDN, or hosting platform (e.g., Netlify, Vercel, AWS S3 + CloudFront).

---

## Development Workflow

**Typical development cycle:**

1. **Define your API**: Edit `.proto` files in the `proto/` directory
2. **Generate code**: Run `npm run protoc` (client) and `bash scripts/protoc.sh` (server)
3. **Implement handlers**: Write gRPC service implementations in Go
4. **Build**: Compile both libraries
5. **Test**: Run unit tests and E2E tests
6. **Deploy**: Package and deploy to your environment

---

*For detailed architectural information, see [Concept.md](Concept.md). For implementation status and roadmap, see [Tasks.md](Tasks.md).*
