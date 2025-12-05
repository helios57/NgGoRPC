### 3.2. Automated End-to-End (E2E) Test Implementation

This section outlines the creation of a fully automated E2E test suite using Docker and Playwright.

**Task 3.2.1: Environment Setup (Docker)**

*   [x] **Dockerize Go Backend**:
    *   Create a `Dockerfile` in the `example/` directory for the Go server.
    *   Use a multi-stage build: a `golang` image to build the binary, and a minimal `scratch` or `alpine` image to run it.
*   [x] **Dockerize Angular Frontend**:
    *   Create a `Dockerfile` in the `demo-app/` directory (simplified HTML demo).
    *   Use nginx image to serve static HTML with WebSocket proxy configuration.
*   [x] **Orchestrate with Docker Compose**:
    *   Create a `docker-compose.yml` file in the project root.
    *   Define two services: `backend` (Go) and `frontend` (demo-app/Nginx).
    *   Configure networking so the frontend container can proxy WebSocket requests to the backend container (e.g., `backend:8080`).
    *   Map ports so the host machine can access the frontend (e.g., `80:80`).

**Task 3.2.2: Playwright Test Implementation**

*   [x] **Install Playwright**:
    *   Add Playwright as a `devDependency` to the `e2e-tests` project.
    *   Initialize Playwright to create `playwright.config.ts` and a `tests` directory.
*   [x] **Create Test Runner Script**:
    *   In `e2e-tests/package.json`, add a script: `"test:e2e": "docker-compose up -d --build && playwright test && docker-compose down"`. This command will manage the entire test lifecycle.
*   [x] **Implement "The Long Stream" Scenario**:
    *   **Goal**: Verify stream cancellation propagates correctly from client to server.
    *   **Setup**: Created `rpc InfiniteTicker(Empty) returns (stream Tick)` on the Go example server that sends a message every 100ms.
    *   **Test Steps**:
        1.  `page.goto('/')` to load the demo app.
        2.  Click a "Start Ticker" button.
        3.  Assert that a counter on the page increments, verifying receipt of stream data.
        4.  Click a "Stop Ticker" button (which unsubscribes the client).
        5.  Assert the counter stops incrementing.
        6.  **Crucially**: Check the `backend` container's logs for the `"InfiniteTicker context cancelled"` message to confirm the server stopped processing via `docker-compose logs backend`.
*   [x] **Implement "Network Resilience" Scenario**:
    *   **Goal**: Verify the client's `retryWhen` logic handles connection loss and recovery.
    *   **Test Steps**:
        1.  Start a stream and verify data is flowing.
        2.  Execute `docker-compose stop backend` from the test script to simulate a server crash.
        3.  Assert that the client UI displays a "Reconnecting..." or "UNAVAILABLE" state.
        4.  Execute `docker-compose start backend`.
        5.  Assert that the client automatically reconnects and a new stream can be successfully initiated.
