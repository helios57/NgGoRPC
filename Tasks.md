### 3.2. Automated End-to-End (E2E) Test Implementation

This section outlines the creation of a fully automated E2E test suite using Docker and Playwright.

**Task 3.2.1: Environment Setup (Docker)**

*   [ ] **Dockerize Go Backend**:
    *   Create a `Dockerfile` in the `example/` directory for the Go server.
    *   Use a multi-stage build: a `golang` image to build the binary, and a minimal `scratch` or `alpine` image to run it.
*   [ ] **Dockerize Angular Frontend**:
    *   Create a `Dockerfile` in the `nggorpc-client/` directory.
    *   Use a multi-stage build: a `node` image for `npm install` and `ng build`, and an `nginx` image to serve the compiled static assets from the `dist/` folder.
*   [ ] **Orchestrate with Docker Compose**:
    *   Create a `docker-compose.yml` file in the project root.
    *   Define two services: `backend` (Go) and `frontend` (Angular/Nginx).
    *   Configure networking so the frontend container can proxy WebSocket requests to the backend container (e.g., `backend:8080`).
    *   Map ports so the host machine can access the frontend (e.g., `80:80`).

**Task 3.2.2: Playwright Test Implementation**

*   [ ] **Install Playwright**:
    *   Add Playwright as a `devDependency` to the `nggorpc-client` project.
    *   Initialize Playwright to create `playwright.config.ts` and an `e2e` test directory.
*   [ ] **Create Test Runner Script**:
    *   In `nggorpc-client/package.json`, add a script: `"test:e2e": "docker-compose up -d --build && playwright test && docker-compose down"`. This command will manage the entire test lifecycle.
*   [ ] **Implement "The Long Stream" Scenario**:
    *   **Goal**: Verify stream cancellation propagates correctly from client to server.
    *   **Setup**: Create an `rpc InfiniteTicker(Empty) returns (stream Tick)` on the Go example server that sends a message every 100ms.
    *   **Test Steps**:
        1.  `page.goto('/')` to load the Angular app.
        2.  Click a "Start Ticker" button.
        3.  Assert that a counter on the page increments, verifying receipt of stream data.
        4.  Click a "Stop Ticker" button (which unsubscribes the client).
        5.  Assert the counter stops incrementing.
        6.  **Crucially**: Add a mechanism to check the `backend` container's logs for the `"[wsgrpc] Stream <ID> context cancelled"` message to confirm the server stopped processing. This can be done via a helper script that runs `docker-compose logs backend`.
*   [ ] **Implement "Network Resilience" Scenario**:
    *   **Goal**: Verify the client's `retryWhen` logic handles connection loss and recovery.
    *   **Test Steps**:
        1.  Start a stream and verify data is flowing.
        2.  Execute `docker-compose stop backend` from the test script to simulate a server crash.
        3.  Assert that the client UI displays a "Reconnecting..." or "UNAVAILABLE" state.
        4.  Execute `docker-compose start backend`.
        5.  Assert that the client automatically reconnects and a new stream can be successfully initiated.
