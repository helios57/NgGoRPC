# NgGoRPC Project Plan & Roadmap

## Phase 9: Library Maturity & Strict Separation (High Priority)

Goal: Ensure `wsgrpc` (Go) and `@nggorpc/client` (Angular) are production-ready libraries, strictly isolated from their example implementations, and installable as standalone packages.

### 9.1 Go Library Isolation
- [x] **Task 9.1.1: Dependency Audit**
    - Verify `wsgrpc/go.mod` contains **only** library dependencies (`google.golang.org/grpc`, `google.golang.org/protobuf`, `nhooyr.io/websocket`).
    - Ensure NO `replace` directives exist in the library's `go.mod` (only allowed in `example/server/go.mod`).
    - Run `go mod tidy` in `wsgrpc/` to enforce a clean state.
- [x] **Task 9.1.2: Public API Verification**
    - Review `wsgrpc/server.go` exports. Ensure internal structures (like `wsConnection`) remain unexported.
    - Verify `NewServer` options are sufficient for production use (TLS config, custom loggers).

### 9.2 Angular Library Packaging & Best Practices
- [x] **Task 9.2.1: Artifact Verification**
    - Run `npm run build:lib` (builds `projects/client`).
    - Inspect `dist/client/package.json`. Verify `peerDependencies` (`@angular/core`, `rxjs`) are present and `dependencies` (`tslib`) are minimal.
    - Verify `dist/client/fesm2022/` contains the flattened ES module bundle.
- [x] **Task 9.2.2: The "Consumer Test" (Critical)**
    - *Current state uses `tsconfig.json` path mappings. We must test the actual build artifact.*
    1. Build the library: `npm run build:lib`
    2. Pack the library: `cd dist/client && npm pack` (Creates `nggorpc-client-1.0.0.tgz`).
    3. Modify `frontend/package.json`: Remove the path mapping in `tsconfig.json` temporarily.
    4. Install artifact: `npm install ./dist/client/nggorpc-client-1.0.0.tgz` in the demo app.
    5. Run `ng serve`. If it works, the library is correctly packaged and decoupled.

## Phase 10: Comprehensive Testing & Coverage

Goal: Achieve high confidence through coverage analysis and targeted edge-case testing.

### 10.1 Coverage Analysis
- [ ] **Task 10.1.1: Go Coverage**
    - Run `go test -coverprofile=coverage.out ./...` in `wsgrpc/`.
    - target > 80% coverage.
    - Identify untested error branches in `handleConnection` (e.g., websocket read errors, protocol violations).
- [ ] **Task 10.1.2: Angular Coverage**
    - Run `ng test client --code-coverage`.
    - Check coverage report in `coverage/`.
    - Target > 80% coverage. Focus on `client.ts` reconnection logic.

### 10.2 Expanded Unit Tests
- [ ] **Task 10.2.1: Angular Reconnection Backoff**
    - In `client.spec.ts`, use `fakeAsync` and `tick` to verify that reconnection attempts follow the exponential backoff formula ($1s, 2s, 4s...$).
- [ ] **Task 10.2.2: Go Frame Limits**
    - Add unit test in `server_test.go` to send a "Metadata" (HEADERS) frame larger than 16KB (if limit enforced) or a payload > MaxPayloadSize. Verify server closes connection with correct error code.

### 10.3 Expanded E2E Scenarios
- [ ] **Task 10.3.1: Large Payload Test**
    - Create `e2e-tests/tests/large-payload.spec.ts`.
    - Modify `Greeter` service to accept/return a 3MB string.
    - Verify the transport handles fragmentation or large contiguous frames correctly.
- [ ] **Task 10.3.2: Authentication Propagation**
    - Create `e2e-tests/tests/auth.spec.ts`.
    - Configure client with `client.setAuthToken('test-token')`.
    - Update `example/server` to check metadata for `authorization` header.
    - Assert that the server receives the token.
- [ ] **Task 10.3.3: Resource Exhaustion (DoS Protection)**
    - Create a test that opens 105 concurrent streams (default limit is usually 100).
    - Verify the 101st stream receives a `RST_STREAM` with `RESOURCE_EXHAUSTED` or similar error.

## Phase 11: Documentation & Release

- [ ] **Task 11.1: README Polish**
    - Update root `README.md` with the final installation instructions (npm package name, go get path).
    - Add a "Troubleshooting" section covering common CORS or WebSocket closure codes.
- [ ] **Task 11.2: CI Configuration**
    - Create `.github/workflows/ci.yml`.
    - Job 1: Build & Test Go (Lint, Unit Test).
    - Job 2: Build & Test Angular (Lint, Unit Test, Build Lib).
    - Job 3: E2E (Build Docker, Run Playwright).
