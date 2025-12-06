10.1 Coverage & Quality Gates

[ ] Task 10.1.1: Enforce Go Coverage in CI

Update .github/workflows/ci.yml to fail if Go test coverage drops below 80%.

Add unit tests for wsgrpc/server.go specifically targeting the handleConnection read loop error branches (e.g., simulate WebSocket read errors, non-binary message types).

[ ] Task 10.1.2: Enforce Angular Coverage in CI

Update .github/workflows/ci.yml to fail if Angular client coverage drops below 80%.

Ensure client.spec.ts covers the decodeFrame error handling logic (e.g., feed it garbage data).

[ ] Task 10.2.3: Malformed Frame Handling (Go)

Add a test case in server_test.go that connects a raw WebSocket client and sends:

A frame with less than 9 bytes.

A text frame instead of binary.

A frame declaring a length larger than the actual payload sent.

Assert that the server logs the warning/error and keeps the connection alive (or closes it gracefully depending on policy), but does not panic.


[ ] Task 10.3.4: Connection Refusal & Recovery

Create a test e2e-tests/tests/connection-refused.spec.ts:

Ensure backend is STOPPED.

Load frontend. Verify "Disconnected" state.

Start backend.

Verify frontend automatically connects without user interaction (reconnection loop works).

[ ] Task 11.3: Release Tagging

Draft a release procedure document:

Bump version in package.json.

Tag Git commit vX.Y.Z.

CI builds and publishes to npm (optional) or GitHub Releases.