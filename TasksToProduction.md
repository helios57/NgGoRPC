# NgGoRPC: Review & Production Roadmap

## 1. Executive Summary

**Status:** Alpha / Pre-Beta.

**Quality:** High. The code is clean, the protocol is well-defined, and the E2E test suite is superior to many mature projects.

**Main Obstacle to Release:** Lack of standard gRPC features (Interceptors, Metadata context) and Client robustness (Reconnection).

## 2. Conceptual & Protocol Review

### The Protocol (PROTOCOL.md)

**Pros:** The 5-byte header (1 byte control + 4 byte Stream ID) is efficient. Separating Control frames (Ping/Pong/GoAway) from Data frames is the correct design choice.

**Cons/Risks:**
*   **Backpressure:** While TCP/WS handles underlying backpressure, gRPC streams often need application-level flow control. If the Angular client is slow to render, the Go server might flood memory.
*   **Keep-Alives:** The protocol mentions Ping/Pong. Ensure this is decoupled from the gRPC Keepalive config to prevent proxies (Nginx) from killing the idle WS connection.

### Architecture

*   **Go Server:** Using Reflection to map methods is flexible but incurs a slight runtime penalty. For v1, this is acceptable, but consider generating static switch-case maps in the future for performance.
*   **Angular Client:** The use of RxJS Subjects for streams is the perfect "Angular-native" approach.

## 3. Code Review Findings

### Backend (Go - wsgrpc/)

**server.go:**
*   **Issue:** The connection handling loop looks robust, but Error handling is often just logging.
*   **Missing:** Context propagation. Standard gRPC relies heavily on `context.Context` for deadlines and cancellation. Ensure the WebSocket context cancellation propagates to the actual method handler.

**frame.go:**
*   **Good:** Fuzz tests (`frame_fuzz_test.go`) are a great addition for a binary protocol parser.

**Concurrency:**
*   `race_test.go` is present. Ensure streams map locking in `server.go` is granular enough to not block new requests during high-load stream processing.

### Frontend (Angular - projects/client)

**transport.ts:**
*   **Critical:** The `connect()` method creates a WebSocket. If `socket.onerror` or `onclose` fires, the Observables error out. In a Single Page App (SPA), this is fatal.
*   **Observation:** No logic to handle the "Token Expiry" scenario mid-stream.

### E2E Tests

*   **Praise:** `z-network-resilience.spec.ts` using toxiproxy (implied or similar mechanism) to cut connections is excellent.
*   **Gap:** Tests mostly run on "Happy paths" or "Hard failures". We need a "Flaky network" test where packets are delayed, not just cut.

## 4. Prioritized Roadmap to Production

### Phase 1: P0 - Stability & Core Plumbing (Must have for v0.9)

These are functional requirements. The library cannot be used in production without them.

**Frontend: Auto-Reconnection & State Management**
*   **Task:** Implement an exponential backoff retry strategy in `transport.ts`.
*   **Details:** If the WS drops, the client should attempt to reconnect. Active streams might need to be retried (unary) or error out gracefully (streaming) with a specific error code allowing the UI to decide.
*   **Test:** Update `z-network-resilience.spec.ts` to verify the client recovers automatically after a temporary outage.

**Backend: Context & Cancellation Propagation**
*   **Task:** Ensure that when a Frontend user navigates away (unsubscribes from Observable), a `CANCEL` frame is sent to Go, and the Go `context.Context` is canceled.
*   **Reason:** Prevents goroutine leaks on the server for long-running streams.

**Backend: Keep-Alive / Heartbeat**
*   **Task:** Implement the Ping/Pong logic defined in `PROTOCOL.md` if not fully active.
*   **Details:** The server should send Pings periodically. If Client doesn't Pong, kill connection. Nginx defaults to 60s timeout; this is needed to keep the tunnel open.

### Phase 2: P1 - Feature Parity (Must have for v1.0)

These make the library a viable replacement for standard gRPC-Web.

**Backend: Interceptors (Middleware)**
*   **Task:** Add `UnaryInterceptor` and `StreamInterceptor` support to the `Server` struct.
*   **Details:** Users need this for Logging (Zap/Logrus), Auth (JWT validation per call), and Metrics (Prometheus).
*   **Signature:** Make it compatible with `grpc.UnaryServerInterceptor`.

**Metadata / Headers Support**
*   **Task:** Allow sending custom metadata headers from Angular (e.g., `x-request-id`) and receiving Trailers from Go.
*   **Impl:** Map `HEADERS` frames to the gRPC Metadata context.

**The "Code Generator" (DX)**
*   **Task:** Create a standalone CLI or `protoc-gen-nggorpc` plugin.
*   **Details:** Currently, `demo-app` has a generated file. A user needs a documented way to run `protoc --nggorpc_out=... my.proto`.
*   **Action:** Extract the generator logic into a repository or folder `protoc-gen-nggorpc`.

### Phase 3: P2 - Polish & Packaging (Ready for Public)

**Error Handling Standardization**
*   **Task:** Map gRPC Status Codes (OK, CANCELLED, DEADLINE_EXCEEDED) to a typed TypeScript error object.
*   **Details:** The frontend currently likely throws generic errors. Users need `if (err.code === GrpcStatus.NOT_FOUND)`.

**NPM & Go Publishing**
*   **Task:** Configure `package.json` for proper library building (Angular Package Format).
*   **Task:** Tag the Go repo (`v0.1.0`).

**Documentation**
*   **Task:** Write a "Getting Started" guide.
    *   Install Go lib.
    *   Install NPM lib.
    *   Run Generator.
    *   Connect.

## 5. Implementation Task List (Copy/Paste to Issue Tracker)

### Backend Tasks

- [ ] [Feat] Implement `WithUnaryInterceptor` and `WithStreamInterceptor` options in `wsgrpc.NewServer`.
- [ ] [Feat] Implement Server-side Ping/Pong ticker to keep connections alive.
- [ ] [Refactor] Ensure `context.Cancel` is called on all active streams when the WebSocket connection closes abruptly.
- [ ] [Test] Add a Load Test (using `ghz` or custom) to check memory usage with 10k concurrent idle connections.

### Frontend Tasks

- [ ] [Feat] Implement `ReconnectionSubject` logic in Transport.
- [ ] [Feat] Add typed `GrpcError` class mirroring standard gRPC codes.
- [ ] [Feat] Support sending Metadata (`Map<string, string>`) in the request initiation.

### Tooling

- [ ] [Release] Package the TypeScript Code Generator as an NPM `bin` script or Go binary.
- [ ] [CI] Add a Linting step for the Frontend code.
