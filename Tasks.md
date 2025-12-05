# NgGoRPC Project Plan

## Phase 6: Structural Refactoring & Best Practices (New Priority)

**Goal**: Strictly separate the reusable library code from example applications for both Go and Angular to ensure clean dependencies and follow ecosystem standard practices.

### [ ] Task 6.1: Refactor Angular Project to Standard Workspace

**Context**: Convert the standalone `nggorpc-client` folder into a standard Angular Monorepo workspace. This allows the library to be built/published independently while serving the example app for development and E2E testing.

**Instructions**:

1.  **Create Workspace**: Rename `nggorpc-client` to `frontend`. Inside, initialize a workspace: `ng new nggorpc-workspace --create-application=false`.
2.  **Generate Library**: Run `ng generate library @nggorpc/client --project-name=client`.
3.  **Generate Demo App**: Run `ng generate application demo-app`.
4.  **Migrate Code**: Move `client.ts`, `frame.ts`, `transport.ts` and related interfaces from the old source to `projects/client/src/lib/`.
5.  **Public API**: Update `projects/client/src/public-api.ts` to export only the public symbols (`NgGoRpcClient`, `NgGoRpcConfig`, `WebSocketRpcTransport`).
6.  **Configuration**: Update `tsconfig.json` paths in the root to map `@nggorpc/client` to `dist/client` (for production simulation) or `projects/client/src/public-api.ts` (for development).
7.  **Dependencies**: Ensure `rxjs` and `@angular/core` are listed as `peerDependencies` in the library's `package.json`, not `dependencies`.

### [ ] Task 6.2: Strict Go Module Separation

**Context**: Ensure the Go library is a pure module without example-specific dependencies.

**Instructions**:

*   **Structure**: Maintain the `wsgrpc` directory as the library root. Ensure its `go.mod` defines the module `github.com/nggorpc/wsgrpc`.
*   **Clean Dependencies**: Run `go mod tidy` in `wsgrpc` to ensure it does not depend on anything in `example/`.
*   **Example Module**: Ensure `example/server` has its own isolated `go.mod` (module `github.com/nggorpc/wsgrpc/example/server`).
*   **Local Replace**: Verify `example/server/go.mod` contains `replace github.com/nggorpc/wsgrpc => ../../wsgrpc` for local development.

### [ ] Task 6.3: Update Docker Build Contexts

*   Update `example/Dockerfile` (Go server) to mount the split directories correctly.
*   Update `demo-app/Dockerfile` (Angular) to build the library first, then build the application using the local library build.

## Phase 7: Critical Reliability Fixes (From Review)

**Goal**: Fix logic gaps that cause zombie connections and stuck clients.

### [✓] Task 7.1: Server Writer Loop Error Propagation

*   **Issue**: If the `writerLoop` in `server.go` fails, the read loop remains blocked.
*   **Fix**: Update `writerLoop` to call `c.cancel()` immediately upon write error or channel closure.
*   **Status**: Completed. Writer loop now calls `c.cancel()` on errors and channel closure.

### [✓] Task 7.2: Client Dead-Peer Detection (Pong Watchdog)

*   **Issue**: Client sends PINGs but doesn't verify PONGs.
*   **Fix**: In `client.ts`, start a timeout when sending PING. If no PONG arrives within 5s, close the socket with code 4000 to trigger reconnection.
*   **Status**: Completed. Client now implements PONG watchdog with 5-second timeout.

### [✓] Task 7.3: Graceful Shutdown & Binary Metadata

**Instructions**:

*   Implement `Server.Shutdown(ctx)` in Go to signal `RST_STREAM` to all active streams before closing listeners.
*   Verify `metadata.MD` binary header safety.

**Status**: Completed. Implemented `Server.Shutdown(ctx)` that:
*   Sets shutdown flag to reject new connections
*   Sends RST_STREAM to all active streams on all connections
*   Cancels stream and connection contexts
*   Waits for all connections to close with context deadline support
*   Added `TestGracefulShutdown` test in `server_test.go`

## Phase 8: Comprehensive Testing

**Goal**: Establish automated verification using the new separated structure.

### 8.1 Unit Tests

#### [✓] Task 8.1.1: Go Unit Tests

*   **Location**: `wsgrpc/server_test.go`
*   **Idle Timeout**: Test that a stream sleeping longer than `idleTimeout` is forcibly closed by the server.
*   **Stream Isolation**: Verify data sent to Stream X is never received by Stream Y.
*   **Status**: Completed. Implemented `TestIdleTimeout` and `TestStreamIsolation` tests. Added configurable `IdleTimeout` and `IdleCheckInterval` to `ServerOption`.

#### [✓] Task 8.1.2: Angular Library Unit Tests

*   **Location**: `nggorpc-client/src/client.spec.ts`
*   **Watchdog**: Mock `setTimeout` to verify `socket.close()` is called on missing PONG.
*   **Teardown**: Verify `unsubscribe()` sends `RST_STREAM`.
*   **Status**: Completed. Added PONG watchdog tests that verify socket.close(4000) is called when PONG timeout occurs and that timeout is cancelled when PONG is received. All 21 tests pass.

### 8.2 Automated E2E Test Suite

#### [ ] Task 8.2.1: Update E2E Infrastructure

*   Update `docker-compose.yml` to build the new frontend workspace (Task 6.1).
*   Ensure the `demo-app` in the workspace is served on port 80.

#### [ ] Task 8.2.2: Playwright Integration

*   **Location**: `e2e-tests/`
*   **Scenario 1 (Long Stream)**: Start ticker, assert increments, stop ticker, assert server logs "cancelled".
*   **Scenario 2 (Resilience)**: Kill backend container, assert client "Reconnecting", restart backend, assert client recovers.
