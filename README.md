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

-   **Streaming**: unary, server-streaming and client-streaming RPCs. The Go server side speaks all
    four kinds including bidirectional; the browser client sends a client-stream's messages as one
    batch (`transport.clientStream(...)`), so interleaving sends with received responses — true
    bidi from the browser — is not exposed yet.
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

Released and published to npm as [`nggorpc`](https://www.npmjs.com/package/nggorpc). CI runs Go
unit tests, Angular unit tests behind an 80% line-coverage gate, and a Playwright end-to-end suite
against the Dockerised demo stack on every push. The design rationale lives in
[CONCEPT.md](CONCEPT.md); the wire format is specified in [PROTOCOL.md](PROTOCOL.md).

## Repository Layout

| Path | What it is |
|---|---|
| `proto/` | the `.proto` contracts — the single source of truth for both sides |
| `wsgrpc/` | the Go server library (published as `github.com/helios57/NgGoRPC/wsgrpc`) |
| `frontend/projects/client/` | the Angular client library (published to npm as `nggorpc`) |
| `frontend/projects/demo-app/` | the demo application the E2E suite drives |
| `example/server/` | a runnable Go server used by the demo and the E2E suite |
| `e2e-tests/` | the Playwright suite |

> Inside this repo the client library is imported as `@nggorpc/client`. That is a **tsconfig path
> alias** (`frontend/tsconfig.json`), not the published name — external consumers install and import
> `nggorpc`.

---

## Getting Started

### Prerequisites

**For the TypeScript client (`frontend/projects/client`):**
- Node.js 18+ and npm
- Angular 14+ (peer dependency; this repo builds against Angular 22)
- Protocol Buffers compiler (`protoc`)
- `ts-proto` plugin for TypeScript code generation

**For the Go server (`wsgrpc`):**
- Go 1.26+
- Protocol Buffers compiler (`protoc`)
- `protoc-gen-go` and `protoc-gen-go-grpc` plugins

Install the protoc plugins:

```bash
# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# ts-proto is a devDependency of the frontend workspace, so installing it
# also installs the protoc-gen-ts_proto plugin binary into node_modules/.bin
cd frontend
npm install
```

---

## Installation

### Installing the Angular Client Library

To use NgGoRPC in your Angular application, install the client library from npm:

```bash
npm i nggorpc --save
```

The package is published at: https://www.npmjs.com/package/nggorpc

Or install from a local build artifact (`npm pack` in `frontend/dist/client` produces
`nggorpc-<version>.tgz`):

```bash
npm install ./path/to/nggorpc-1.1.3.tgz
```

### Installing the Go Server Library

To use NgGoRPC in your Go backend, add the library to your project:

```bash
go get github.com/helios57/NgGoRPC/wsgrpc@latest
```

Or add it to your `go.mod`:

```gomod
require github.com/helios57/NgGoRPC/wsgrpc v1.0.0
```

Then run:

```bash
go mod download
```

---

## Building the Libraries

### TypeScript Client Library

`frontend/projects/client` provides the Angular integration for gRPC over WebSocket. All commands
below run from `frontend/`.

**1. Generate TypeScript code from `.proto` files:**

```bash
npm run proto:generate
```

This runs `ts-proto` over `../proto/greeter.proto` and writes the generated messages and service
definitions to `projects/demo-app/src/app/generated/`. Only the demo needs generated code — the
client library itself is contract-agnostic and works with any `ts-proto` output.

**2. Build the library:**

```bash
npm run build:lib
```

`ng-packagr` compiles the library to `frontend/dist/client`, including type definitions.

**3. Package for deployment:**

```bash
cd dist/client
npm pack
```

This creates `nggorpc-<version>.tgz`, installable in Angular applications or publishable to npm.
Releases are published automatically by CI on a `v*` tag — see [RELEASE.md](RELEASE.md); publishing
by hand is the exception, not the workflow.

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

```gomod
require github.com/helios57/NgGoRPC/wsgrpc v1.0.0
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

**Unit Tests** (Karma + Jasmine, headless Chrome):

```bash
cd frontend
npm test                # single run, headless
npm run test:watch      # re-run on change, for the dev loop
npm run test:coverage   # single run + coverage/client/
```

Coverage is a release gate: CI fails the build if total line coverage drops below **80%** (see the
"Check coverage threshold" step in `.github/workflows/ci.yml`).

The suite covers frame encoding/decoding, client lifecycle including the RST_STREAM sent on
unsubscribe, reconnection backoff, and the typed transport layer.

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

Run with coverage, the way CI does (generated code is excluded from the coverage denominator):

```bash
go test -race -coverprofile=coverage.out -covermode=atomic $(go list ./... | grep -v '/generated')
go tool cover -func=coverage.out
```

The suite covers binary frame encoding/decoding against the format in [PROTOCOL.md](PROTOCOL.md),
client-initiated (odd) stream IDs, metadata extraction from HEADERS frames, and multiplexed
concurrent stream handling. Run it with `-race`: the server multiplexes streams across goroutines,
so a data race is the failure mode most likely to survive a non-race run.

---

## End-to-End Testing

E2E tests verify the complete integration between the Angular client and Go server, using
**Playwright** against the Dockerised demo stack.

**Run the whole thing — build the stack, test, tear it down:**

```bash
cd e2e-tests
npm install
npm run test:e2e
```

**Or drive the stack yourself:**

```bash
docker compose up -d --build     # backend on :8080, demo frontend on :8352
cd e2e-tests && npx playwright test
docker compose down
```

`BASE_URL` defaults to the compose frontend; override it to point the suite elsewhere.

**Covered scenarios**: unary calls, server streaming, concurrent multiplexed streams, client
cancellation via unsubscribe (asserting the server sees RST_STREAM), automatic reconnection after a
network interruption, large metadata, large payloads against the frame-size limit, and resource
exhaustion.

> The network-resilience specs simulate outages by shelling out to `docker stop/start
> nggorpc-backend`. The Playwright runner therefore has to sit **outside** the compose network with
> access to the Docker socket — which is why E2E is not itself a compose service.

---

## Deployment Guide

### Deploying the Go Server

**1. Build for production:**

```bash
cd example/server
CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server main.go
```

**2. Docker deployment (recommended):**

This repo already ships a multi-stage build for the example server at
[`example/Dockerfile`](example/Dockerfile) — copy it as your starting point rather than writing one
from scratch. Build and run it directly:

```bash
docker build -t nggorpc-server -f example/Dockerfile .
docker run -p 8080:8080 nggorpc-server
```

**3. TLS/WSS support:**

For production, use `wss://` (WebSocket Secure). Configure your server with TLS certificates or use a reverse proxy like Nginx or Caddy.

---

### Deploying the Angular Client

**1. Install the library in your Angular project:**

```bash
npm i nggorpc
```

Or from a local build:

```bash
npm install ../path/to/NgGoRPC/frontend/dist/client/nggorpc-1.1.3.tgz
```

**2. Configure the client:**

The idiomatic way is the provider — it registers a single client for the application injector:

```typescript
import { provideNgGoRpc } from 'nggorpc';

bootstrapApplication(AppComponent, {
  providers: [
    provideNgGoRpc({
      pingInterval: 30000,        // 30s keep-alive
      baseReconnectDelay: 1000,   // 1s initial retry delay
      maxReconnectDelay: 30000,   // 30s max retry delay
      maxFrameSize: 4194304       // 4MB max frame size
    })
  ]
});
```

Constructing one by hand works too. Note that the URL is **not** a constructor argument — the
constructor takes the `NgZone` used to keep high-frequency stream events out of change detection,
and the connection is opened separately so that reconnection can be enabled per call site:

```typescript
import { NgGoRpcClient, NgGoRpcConfig, WebSocketRpcTransport } from 'nggorpc';

const config: NgGoRpcConfig = { pingInterval: 30000 };
const client = new NgGoRpcClient(inject(NgZone), config);
client.connect('wss://your-server.com/ws', true); // true = auto-reconnect

const transport = new WebSocketRpcTransport(client);
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
2. **Generate code**: Run `npm run proto:generate` in `frontend/` and `bash scripts/protoc.sh` in `wsgrpc/`
3. **Implement handlers**: Write gRPC service implementations in Go
4. **Build**: Compile both libraries
5. **Test**: Run unit tests and E2E tests
6. **Deploy**: Package and deploy to your environment

---

## Troubleshooting

### CORS Issues

If you encounter CORS errors when connecting from your Angular app to the Go server, ensure your server is configured to allow WebSocket connections from your frontend origin.

**Common symptoms:**
- `Access to WebSocket at 'ws://...' from origin '...' has been blocked by CORS policy`
- Connection fails immediately without establishing WebSocket

**Solution:**

In your Go server, configure CORS headers properly. The `wsgrpc` library doesn't handle HTTP upgrade requests automatically—you need to set up appropriate middleware:

```text
// Add CORS middleware before upgrading to WebSocket (Go snippet)
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        origin := r.Header.Get("Origin")
        if origin != "" {
            w.Header().Set("Access-Control-Allow-Origin", origin)
            w.Header().Set("Access-Control-Allow-Credentials", "true")
            w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        }
        
        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusOK)
            return
        }
        
        next.ServeHTTP(w, r)
    })
}

// Apply to your WebSocket endpoint
http.Handle("/rpc", corsMiddleware(wsgrpcHandler))
```

For development, you can allow all origins with `Access-Control-Allow-Origin: *`, but in production, restrict this to your specific frontend domain.

### WebSocket Closure Codes

NgGoRPC uses standard WebSocket closure codes. Understanding these codes helps diagnose connection issues:

| Code | Name | Description | Typical Cause |
|------|------|-------------|---------------|
| `1000` | Normal Closure | Clean disconnection | Client called `close()` or server shut down gracefully |
| `1001` | Going Away | Endpoint is going away | Browser tab closed or server restarting |
| `1002` | Protocol Error | WebSocket protocol violation | Malformed frame or invalid upgrade handshake |
| `1003` | Unsupported Data | Received incompatible data type | Server/client version mismatch |
| `1006` | Abnormal Closure | Connection lost without close frame | Network interruption, firewall, or timeout |
| `1008` | Policy Violation | Message violates policy | Frame size exceeds `maxFrameSize` limit |
| `1009` | Message Too Big | Message too large to process | Payload exceeds server limits (default: 4MB) |
| `1011` | Internal Error | Server encountered an error | Unhandled exception in gRPC handler |
| `1012` | Service Restart | Server is restarting | Planned maintenance or deployment |
| `1013` | Try Again Later | Server overloaded | Rate limiting or resource exhaustion |

**Common scenarios:**

**Code 1006 (Abnormal Closure):**
- **Client reconnects immediately**: Normal behavior during network instability. The client's exponential backoff will handle reconnection.
- **Client cannot reconnect**: Check server availability, firewall rules, or proxy timeout settings.

**Code 1008 or 1009 (Frame/Message Too Big):**
- Increase `maxFrameSize` in the client config if you're sending large messages:
  ```typescript
  const config: NgGoRpcConfig = {
    maxFrameSize: 16 * 1024 * 1024  // 16MB
  };
  ```
- Ensure your server's `MaxPayloadSize` is also increased if needed.

**Code 1011 (Internal Error):**
- Check server logs for panics or unhandled errors in your gRPC service handlers.
- Verify that all required fields in your Protobuf messages are properly set.

### Connection Keeps Dropping

If your WebSocket connection drops repeatedly:

1. **Check keep-alive settings**: Adjust `pingInterval` in the client config:
   ```typescript
   const config: NgGoRpcConfig = {
     pingInterval: 30000  // Send ping every 30 seconds
   };
   ```

2. **Proxy/Load Balancer timeout**: Many proxies (Nginx, ALB, etc.) have default WebSocket idle timeouts (typically 60s). Either:
   - Configure your proxy to allow longer idle times
   - Decrease the client's `pingInterval` to stay below the timeout

3. **Mobile networks**: On cellular connections, NAT gateways often close idle connections aggressively. Use a shorter `pingInterval` (e.g., 15-20 seconds).

### Authentication Not Working

If `setAuthToken()` doesn't work as expected:

1. **Verify the token is sent**: Check browser DevTools → Network → your WebSocket connection → Messages. The first `HEADERS` frame should contain the authorization metadata.

2. **Server-side extraction**: Ensure your Go server extracts metadata correctly:
   ```text
func (s *greeterService) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloReply, error) {
    md, ok := metadata.FromIncomingContext(ctx)
    if !ok {
        return nil, status.Error(codes.Unauthenticated, "no metadata")
    }
    
    tokens := md.Get("authorization")
    if len(tokens) == 0 {
        return nil, status.Error(codes.Unauthenticated, "no auth token")
    }
    
    // Validate tokens[0]...
}
```

3. **Token format**: By default, the token is sent as-is. If your server expects `Bearer <token>`, prepend it:
   ```typescript
   client.setAuthToken(`Bearer ${token}`);
   ```

### High CPU Usage in Angular App

If you experience performance issues during high-frequency streaming:

1. **Zone optimization**: The library already runs WebSocket events outside Angular's zone. Ensure you're not forcing change detection manually on every message.

2. **Use OnPush strategy**: In components that display stream data:
   ```typescript
   @Component({
     changeDetection: ChangeDetectionStrategy.OnPush
   })
   ```

3. **Debounce/throttle**: For rapid updates (e.g., price tickers), use RxJS operators:
   ```typescript
   service.streamPrices(request).pipe(
     throttleTime(100)  // Max 10 updates/second
   ).subscribe(() => {
     // handle values here
   });
   ```

---

*For detailed architectural information, see [CONCEPT.md](CONCEPT.md).*
