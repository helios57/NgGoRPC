# NgGoRPC E2E Tests

End-to-end tests for NgGoRPC using Playwright and Docker Compose.

## Prerequisites

- Node.js (v18 or later)
- Docker and Docker Compose
- npm or yarn

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers:
```bash
npx playwright install
```

## Running Tests

### Full E2E Test Suite (with Docker)

This command will start the Docker containers, run all tests, and clean up:

```bash
npm run test:e2e
```

### Manual Testing

1. Start the Docker services:
```bash
npm run docker:up
```

2. Run the tests:
```bash
npm test
```

3. Stop the Docker services:
```bash
npm run docker:down
```

### Run Tests with UI (Headed Mode)

```bash
npm run test:headed
```

### View Docker Logs

```bash
npm run docker:logs
```

## Test Scenarios

### 1. The Long Stream Scenario (`long-stream.spec.ts`)

Tests stream cancellation propagation from client to server.

**What it tests:**
- Starting the InfiniteTicker stream
- Counter increments correctly
- Stopping the stream stops the counter
- Server receives cancellation signal (verified in logs)
- Multiple start/stop cycles work correctly

### 2. Network Resilience Scenario (`network-resilience.spec.ts`)

Tests client reconnection logic when the backend becomes unavailable.

**What it tests:**
- Stream works normally before disruption
- Client detects backend failure
- Client shows appropriate disconnected/reconnecting state
- Counter stops incrementing during outage
- Client can reconnect after backend restarts
- New streams can be initiated after reconnection

### 3. Concurrent Streams Scenario (`concurrent-streams.spec.ts`)

Tests that multiple streams can run simultaneously over the same WebSocket connection.

**What it tests:**
- Multiplexing capability (key feature of the protocol)
- Two streams running concurrently and independently
- Verifies no cross-talk or interference between streams

### 4. Large Payload Scenario (`large-payload.spec.ts`)

Tests that the transport handles large payloads correctly.

**What it tests:**
- Sending and receiving large payloads (e.g., 3MB)
- Verifies fragmentation and reassembly work correctly
- Ensures no data corruption for large messages

### 5. Resource Exhaustion Scenario (`resource-exhaustion.spec.ts`)

Tests resource exhaustion scenarios and DoS protection.

**What it tests:**
- Concurrent stream limits (default: 100 streams)
- Proper error handling when limits are exceeded (RESOURCE_EXHAUSTED)
- System stability under load

### 6. Error Scenarios (`error-scenarios.spec.ts`)

Tests that the library handles error conditions gracefully.

**What it tests:**
- Invalid method calls
- Network disruptions
- Stream maintenance after errors in other streams
- Graceful error reporting to the client

## Debug Logs

Tests output debug logs prefixed with `[DEBUG_LOG]` to help diagnose issues:

```bash
npm test 2>&1 | grep DEBUG_LOG
```

## Test Architecture

- **Backend**: Go server running in Docker with wsgrpc
- **Frontend**: Static HTML demo app served by Nginx
- **Tests**: Playwright tests that control the browser and Docker containers
- **Networking**: Docker Compose network allows frontend to proxy WebSocket requests to backend

## Troubleshooting

### Tests Fail with "Cannot connect"

Ensure Docker services are running:
```bash
npm run docker:up
docker ps
```

### Tests Fail with "Timeout"

Increase timeouts in `playwright.config.ts` or wait longer in tests.

### Backend Logs Not Found

Make sure you're running from the `e2e-tests` directory and docker compose.yml is in the parent directory.

### Clean Up Docker Resources

```bash
npm run docker:down
docker compose -f ../docker compose.yml down -v
```
