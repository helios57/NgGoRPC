Phase 9: Library Maturity & Strict Separation (High Priority)

Goal: Ensure wsgrpc (Go) and @nggorpc/client (Angular) are production-ready libraries, strictly isolated from their example implementations, and installable as standalone packages.

9.1 Go Library Isolation

[x] Task 9.1.2: Public API Audit

Review wsgrpc exports. Ensure implementation details (like wsConnection) remain private.

Verify frame.go exports: Frame struct is exported, but encoding functions should likely be internal or carefully documented if exposed.

Listener Flexibility: Ensure users can use HandleWebSocket with their own http.ServeMux or gin/echo routers, rather than being forced to use the library's ListenAndServe helper.

9.2 Angular Library Packaging & Best Practices

[x] Task 9.2.3: Angular Library Standards & DI

Ensure projects/client/ng-package.json is configured for proper entry points.

Idiomatic Providers: Implement provideNgGoRpc(config) using makeEnvironmentProviders to allow configuration via Angular's dependency injection system, replacing the need to manually instantiate new NgGoRpcClient(ngZone, config).

SSR Safety: Ensure the library does not crash in Server-Side Rendering environments (check for window/WebSocket existence before access).

Phase 10: Comprehensive Testing & Coverage

Goal: Achieve high confidence through coverage analysis and targeted edge-case testing.

10.1 Coverage & Quality Gates

[x] Task 10.1.1: Enforce Go Coverage in CI

Update .github/workflows/ci.yml to fail if Go test coverage drops below 80%.

Add unit tests for wsgrpc/server.go specifically targeting the handleConnection read loop error branches.

[x] Task 10.1.2: Enforce Angular Coverage in CI

Update .github/workflows/ci.yml to fail if Angular client coverage drops below 80%.

Ensure client.spec.ts covers the decodeFrame error handling logic (e.g., feed it garbage data).

10.2 Expanded Unit Tests (Edge Cases)

[x] Task 10.2.3: Malformed Frame Handling (Go)

Add a test case in server_test.go that connects a raw WebSocket client and sends:

A frame with less than 9 bytes.

A text frame instead of binary.

A frame declaring a length larger than the actual payload sent.

Assert that the server logs the warning/error and keeps the connection alive (or closes it gracefully depending on policy), but does not panic.

[x] Task 10.2.4: Go Fuzz Testing

Create wsgrpc/frame_fuzz_test.go.

Use Go's native fuzzing (testing.F) to fuzz decodeFrame with random byte slices.

Ensure no input causes a panic or excessive memory allocation.

10.3 Expanded E2E Scenarios

[x] Task 10.3.4: Connection Refusal & Recovery

Create a test e2e-tests/tests/connection-refused.spec.ts:

Ensure backend is STOPPED.

Load frontend. Verify "Disconnected" state.

Start backend.

Verify frontend automatically connects without user interaction (reconnection loop works).

Phase 11: Documentation & Release

[x] Task 11.3: Release Tagging

Draft a release procedure document:

Bump version in package.json.

Tag Git commit vX.Y.Z.

CI builds and publishes to npm (optional) or GitHub Releases.