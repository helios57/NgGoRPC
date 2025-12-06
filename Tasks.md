NgGoRPC Project Plan

Phase 9: Library Maturity & Strict Separation (Priority)

Goal: Ensure both libraries are production-ready, strictly isolated from their examples, and follow packaging best practices.

9.1 Go Library Isolation

[ ] Task 9.1.1: Dependency Audit

Verify wsgrpc/go.mod contains only library dependencies (grpc, protobuf, websocket).

Ensure no references to example/ exist in the library code.

Run go mod tidy inside wsgrpc/ to lock the cleaner state.

[ ] Task 9.1.2: Go Doc Verification

Ensure all exported functions/types in wsgrpc have comments compliant with Go doc standards.

Verify wsgrpc/doc.go (or package comment in server.go) exists for package-level documentation.

9.2 Angular Library Best Practices

[ ] Task 9.2.1: Tree Shaking Optimization

Update frontend/projects/client/package.json to include "sideEffects": false. This allows build tools to remove unused parts of the library in consumer apps.

[ ] Task 9.2.2: Export Validation

Review public-api.ts. Ensure only the public surface is exported.

Ensure no internal helper classes (like internal implementation details of framing if not needed) are exported unless required for advanced usage.

[ ] Task 9.2.3: Build Artifact Verification

Run ng build client.

Inspect the dist/client folder.

Verify package.json in dist is correct (peers vs dependencies).

Verify type definitions (.d.ts) are generated and structure matches the public API.

9.3 Strict Separation Verification (The "Consumer Test")

Currently, the demo app imports the library via TypeScript path mapping (source-to-source). To prove strict separation, we must simulate a real package install.

[ ] Task 9.3.1: Pack the Library

Create a script or manual test step:

cd frontend

ng build client

cd dist/client

npm pack (Generates nggorpc-client-1.0.0.tgz).

[ ] Task 9.3.2: Consume the Artifact

Create a temporary verify script or manual test:

Create a fresh, empty Angular app (outside the workspace) or use the existing demo-app temporarily modified.

Remove the path mapping for @nggorpc/client in tsconfig.json.

Install the tarball: npm install ../path/to/nggorpc-client-1.0.0.tgz.

Try to build the app.

Why: This catches issues where the library source works (because it can access internal files) but the built library fails (because of missing exports or bad entry points).

9.4 CI/CD Preparation

[ ] Task 9.4.1: Linting Standards

Ensure ng lint client runs with strict rules.

Add a gofmt check for the Go library.

[ ] Task 9.4.2: Version Synchronization

Create a plan or script to sync versions between package.json (Angular) and the git tags used for Go modules.