# NgGoRPC Implementation Task List

This document breaks down the development of the NgGoRPC library into a series of concrete, actionable tasks. It is designed to guide the implementation process from initial setup to production readiness.

---

## Phase 1: Protocol Definition & Tooling Setup

**Goal**: Establish the foundational rules of the protocol and prepare the development environment.

-   [x] **Task 1.1: Formalize `PROTOCOL.md` Specification**
    -   **Instructions**: Create a new `PROTOCOL.md` file. Define the exact bit-layout of the 9-byte frame header (`Flags`, `Stream ID`, `Length`). Assign specific, non-overlapping bitmasks for each flag (`HEADERS`, `DATA`, `TRAILERS`, `RST_STREAM`, `EOS`). Document the Big Endian byte order for multi-byte fields. Define a small set of integer error codes for `RST_STREAM` frames (e.g., `0: NO_ERROR`, `1: PROTOCOL_ERROR`, `2: RESOURCE_EXHAUSTED`).

-   [x] **Task 1.2: Configure Frontend Build Pipeline**
    -   **Instructions**: In the Angular project, install `ts-proto`. Create a `protoc.sh` or similar script that invokes `protoc` with the `ts-proto` plugin. The script should include the `--ts_proto_opt=returnObservable=true` flag to ensure generated service methods return RxJS Observables. Add a sample `.proto` file (e.g., `greeter.proto`) and run the script to verify that the TypeScript output is generated correctly.

-   [x] **Task 1.3: Configure Backend Build Pipeline**
    -   **Instructions**: In the Go project, ensure `protoc-gen-go` and `protoc-gen-go-grpc` are installed. Create a `protoc.sh` script to generate Go code from the same sample `.proto` file. Verify that the output includes a `*Server` interface (e.g., `GreeterServer`) and a `Register*Server` function. This confirms that the standard gRPC service interfaces are being generated.

---

## Phase 2: Core Library Development

**Goal**: Build the basic components for sending and receiving frames over a WebSocket.

-   [x] **Task 2.1 (Frontend): Implement the Frame Codec**
    -   **Instructions**: Create a `frame.ts` file. Implement `encodeFrame` and `decodeFrame` functions. Use `DataView` to precisely control the binary layout. `encodeFrame` will take a stream ID, flags, and a `Uint8Array` payload, and return a `Uint8Array` representing the full 9-byte-header frame. `decodeFrame` will take an `ArrayBuffer` and return a structured object containing the parsed `streamId`, `flags`, and a `Uint8Array` view of the payload. Write unit tests to ensure a frame can be encoded and then decoded back to its original components.

-   [x] **Task 2.2 (Frontend): Develop the `NgGoRpcClient` Service**
    -   **Instructions**: Create an Angular service `NgGoRpcClient`. Implement a `connect(url: string)` method. Inside this method, use `ngZone.runOutsideAngular()` to establish the WebSocket connection. Set `socket.binaryType = 'arraybuffer'`. Assign a basic `onmessage` handler that uses the `decodeFrame` function from Task 2.1 and logs the decoded frame to the console. This validates the connection and basic parsing.

-   [x] **Task 2.3 (Backend): Implement the `wsgrpc` Server**
    -   **Instructions**: Create a `server.go` file. Use the `nhooyr.io/websocket` library to accept incoming WebSocket connections. Create a primary read-loop goroutine for each connection. This loop should read a message, use a new `decodeFrame` Go function to parse the 9-byte header, and print the decoded frame details to the console. This task mirrors the frontend client to verify basic communication from the other side.

---

## Phase 3: The Multiplexing Engine

**Goal**: Enable multiple concurrent RPC calls over the single WebSocket connection.

-   [x] **Task 3.1 (Frontend): Implement the Stream Map and `Rpc` Transport**
    -   **Instructions**: In `NgGoRpcClient`, create a `streamMap: Map<number, Subject<Uint8Array>>`. Create a class `WebSocketRpcTransport` that implements the `Rpc` interface from `ts-proto`. The `request` method should:
        1.  Generate a new, odd-numbered stream ID.
        2.  Create a new `Subject<Uint8Array>` and store it in the `streamMap` with the new ID.
        3.  Send the `HEADERS` and `DATA` frames using the `encodeFrame` function.
        4.  Return the subject's `Observable`.
        Modify the `onmessage` handler to look up the stream ID in the `streamMap` and call `.next()` on the corresponding subject with the payload.

-   [x] **Task 3.2 (Backend): Implement the Stream Registry and Adapter**
    -   **Instructions**: In `server.go`, create a `streamRegistry: map[uint32]*WebSocketServerStream`. Implement the `WebSocketServerStream` struct which satisfies the `grpc.ServerStream` interface. Its `RecvMsg` method should read from a buffered channel (`recvChan`), and its `SendMsg` method should write a `DATA` frame to the WebSocket. When a `HEADERS` frame arrives, look up the gRPC method, spawn a new goroutine for the handler, and pass it an instance of the `WebSocketServerStream`. When a `DATA` frame arrives, find the corresponding stream in the registry and send the payload to its `recvChan`.

-   [x] **Task 3.3 (Integration): Execute a "Hello World" Unary RPC**
    -   **Instructions**: Create a simple "Greeter" service. In Angular, inject the `ts-proto` generated `GreeterClient` and provide it with your `WebSocketRpcTransport`. Call the `sayHello` method and subscribe to the result. In Go, implement the `SayHello` handler. Set breakpoints or add extensive logging on both client and server to trace the entire lifecycle: `HEADERS` sent, handler invoked, `DATA` reply sent, `TRAILERS` sent, and observable completion on the client.

---

## Phase 4: Streaming & Resilience

**Goal**: Implement full streaming support and make the connection robust to network failures.

-   [x] **Task 4.1 (Frontend): Implement Full Streaming Logic**
    -   **Instructions**: Enhance the `onmessage` handler. When a `DATA` frame arrives, call `subject.next()`. When a `TRAILERS` frame arrives, check the `grpc-status`. If the status is `OK`, call `subject.complete()`. If it's not `OK`, call `subject.error()`. Test this with a server-streaming RPC method that sends multiple messages before completing.

-   [x] **Task 4.2 (Frontend): Implement Reconnection Logic**
    -   **Instructions**: Wrap the WebSocket connection logic in an RxJS `Observable`. Use the `retryWhen` operator with a custom notifier that includes `delayWhen` with an exponential backoff timer (e.g., `delay = Math.min(30000, 1000 * 2 ** attempt)`). When a disconnect is detected, immediately error out all active streams in the `streamMap` with a `UNAVAILABLE` status. This will propagate the error to the UI, allowing application logic to decide whether to retry the specific call.

-   [x] **Task 4.3 (Optimization): Profile Angular Performance**
    -   **Instructions**: Create a test RPC that streams data at a high frequency (e.g., 50 messages/sec). Open the Chrome DevTools Performance tab and record the application's behavior. Verify that the "Recalculate Style" and "Layout" events (purple and blue bars) are **not** firing for every incoming WebSocket message. They should only fire when `ngZone.run()` is called to deliver the data to the component. This confirms the `runOutsideAngular` strategy is working.

---

## Phase 5: Production Hardening

**Goal**: Add security, stability, and deployment features.

-   [x] **Task 5.1: Implement Keep-Alive Frames**
    -   **Instructions**: On the client, use an `interval()` in `runOutsideAngular` to send a custom Ping frame (e.g., a frame with a reserved stream ID `0` and no payload) every 30 seconds. The server should be configured to respond with a Pong frame. This prevents idle connections from being terminated by load balancers or proxies (like AWS ALB or Nginx).

-   [x] **Task 5.2: Add Authentication Support and Kubernetes Deployment Configuration**
    -   **Instructions**: The Go server will run in a Kubernetes environment where TLS/WSS termination is handled by an Nginx load balancer at the edge. The Go server should accept plain WebSocket (`ws://`) connections internally. Configure Nginx as an ingress controller to handle `wss://` connections from clients and forward them as `ws://` to the Go backend pods. On the Angular client, update the `connect` method to use `wss://` URLs pointing to the Nginx load balancer. Implement the "Protocol-Level Authentication" strategy: add a method to the `NgGoRpcClient` to set auth tokens, and ensure the `RpcTransport` includes them in the `HEADERS` frame of each new RPC. The Go server must parse this metadata and attach it to the `context.Context` of the stream.

-   [x] **Task 5.3: Publish Libraries**
    -   **Instructions**: Prepare `package.json` for the Angular library and `go.mod` for the Go module. Add build scripts to compile and package the code. Publish the Angular library to a private npm registry and tag the Go module in a private git repository so they can be consumed as versioned dependencies in other projects.
