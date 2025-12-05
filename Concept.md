# Architecting NgGoRPC: A Comprehensive Specification for Bidirectional gRPC over WebSockets in Angular and Go

**An Architectural Blueprint for High-Performance, Bidirectional RPC between Angular Frontends and Go Backends.**

---

## 1. Introduction and Architectural Imperatives

The convergence of rich client-side applications and high-performance microservices has necessitated protocols that support rigorous type safety, low latency, and bidirectional data flow. While the gRPC framework, backed by Protocol Buffers (Protobuf), has become the industry standard for inter-service communication, its integration into the browser environment remains fraught with complexity. The inherent limitations of browser networking APIs—specifically their inability to directly expose HTTP/2 framing and the fragmented support for HTTP trailers—have led to the development of the gRPC-Web standard. However, this standard largely functions as a compromise, necessitating intermediate proxies like Envoy and frequently degrading to HTTP/1.1 semantics that preclude true bidirectional streaming.

This report articulates the architectural specification and implementation roadmap for **NgGoRPC**, a bespoke library designed to bridge Angular frontends and Go backends. Unlike existing adaptations that rely on request downgrading or heavy proxy infrastructure, NgGoRPC proposes a **native, multiplexed tunneling strategy over WebSockets**[^1]. This approach preserves the semantic richness of gRPC—including cancellation, deadlines, and concurrent streams—while leveraging the ubiquitous, persistent nature of the WebSocket protocol to bypass browser HTTP/2 restrictions.

### 1.1 The State of RPC in the Browser

Current solutions for consuming gRPC in browsers bifurcate into two primary approaches: the official gRPC-Web client and the Improbable Engineering gRPC-Web client. Both fundamentally rely on a translation layer. The browser sends a modified HTTP request (often text-encoded) which an edge proxy (e.g., Envoy) translates into native gRPC traffic for the backend[^3].

While sufficient for unary calls and server-side streaming, this architecture falters with client-side and bidirectional streaming. The browser's `Fetch` and `XHR` APIs typically buffer upload bodies, preventing the incremental transmission required for true client streaming[^4].

Consequently, developers requiring real-time, two-way interaction (e.g., chat applications, live telemetry, collaborative editing) often abandon gRPC for raw WebSockets, sacrificing the strict contract definition and code generation benefits of Protobuf[^6]. NgGoRPC aims to resolve this dichotomy by treating WebSockets not as a replacement for gRPC, but as a **transparent transport layer** for it.

### 1.2 Architectural Objectives

The proposed system allows an Angular application to invoke gRPC methods defined in `.proto` files directly against a Go server. The design is governed by four non-negotiable requirements:

- **Full Duplex Multiplexing**: The library must support multiple concurrent gRPC calls (unary and streaming) over a single physical WebSocket connection to avoid head-of-line blocking and connection limits.
- **Angular Zone Stability**: The implementation must decouple the high-frequency WebSocket event loop from Angular's Change Detection mechanism (`NgZone`) to prevent UI performance degradation, re-entering the zone only when application state mutates.
- **Resilience**: The transport layer must handle network instability transparently, implementing automatic reconnection and message queuing without exposing these complexities to the consuming component.
- **Seamless Tooling Integration**: The solution must integrate with existing code generation pipelines (`protoc`, `ts-proto`, `protoc-gen-go`), ensuring that the developer experience remains indistinguishable from standard gRPC usage[^8].

---

## 2. Protocol Design: The NgGoRPC Wire Format

To tunnel gRPC over WebSockets effectively, we must replicate the framing and stream management capabilities of HTTP/2 at the application level. WebSockets provide a sequence of messages, but they lack the intrinsic concept of "streams" or "headers." Therefore, NgGoRPC introduces a lightweight binary framing protocol. This protocol encapsulates gRPC payloads, metadata, and control signals, allowing the receiver to demultiplex concurrent operations.

### 2.1 Binary Framing Specification

Every WebSocket message transmitted by the library constitutes a **Frame**. To maximize throughput and minimize serialization overhead, the frame uses a rigid binary layout rather than a text-based format like JSON. This aligns with the binary nature of Protobuf and allows for zero-copy forwarding where supported by the runtime[^9].

The frame structure is defined as follows:

| Offset (Bytes) | Field       | Type   | Description                                                 |
| :------------- | :---------- | :----- | :---------------------------------------------------------- |
| `0`            | **Flags**   | `uint8`  | Control bits indicating frame type and state.               |
| `1-4`          | **Stream ID** | `uint32` | Unique identifier for the logical gRPC stream (Big Endian). |
| `5-8`          | **Length**    | `uint32` | The length of the payload in bytes (Big Endian).            |
| `9...N`        | **Payload**   | `byte[]` | The Protobuf message, header block, or trailer block.       |

#### 2.1.1 Flag Definitions

The first byte (`Offset 0`) is critical for parsing efficiency. It allows the receiver to determine the nature of the payload without inspecting the body.

- `0x01` (**HEADERS**): Indicates the payload contains initial RPC metadata. For the client, this includes the service path (e.g., `/mypackage.Greeter/SayHello`). For the server, this represents initial response headers.
- `0x02` (**DATA**): Indicates the payload is a serialized Protobuf message.
- `0x04` (**TRAILERS**): Indicates the payload contains the final status of the RPC call (`grpc-status`, `grpc-message`). This frame implies the end of the stream.
- `0x08` (**RST_STREAM**): A control signal to terminate a stream abnormally (e.g., cancellation or internal error).
- `0x10` (**EOS**): End of Stream flag. Can be combined with `DATA` or `TRAILERS` to signal that no further messages will be sent on this stream.

#### 2.1.2 Stream Identifier Semantics

To support multiplexing, every RPC call is assigned a unique **Stream ID**. This mirrors HTTP/2 semantics:

- **Client-Initiated Streams**: The Angular client generates **odd-numbered** IDs (1, 3, 5...).
- **Server-Initiated Streams**: Reserved for future use (e.g., server push), utilizing **even-numbered** IDs.
- **ID Reuse**: Stream IDs **cannot** be reused within the lifespan of a single WebSocket connection to prevent race conditions where a late-arriving frame from a closed stream is misattributed to a new stream[^11].

### 2.2 The RPC Lifecycle over WebSocket

The interaction model translates the gRPC state machine into WebSocket frames.

1.  **Invocation (Client → Server)**: When an Angular component subscribes to a gRPC method, the client library allocates a new Stream ID (e.g., `101`). It constructs a `HEADERS` frame containing the method name and any authorization tokens. This is immediately followed by one or more `DATA` frames containing the request parameters. If the call is unary, the `EOS` flag is set on the data frame.

2.  **Processing (Server → Client)**: The Go server decodes the `HEADERS` frame, routes the request to the appropriate service handler, and invokes the method. As the handler produces responses (via `Send()`), the library wraps each Protobuf message in a `DATA` frame tagged with ID `101` and writes it to the WebSocket.

3.  **Termination (Server → Client)**: Upon completion of the handler, the server sends a `TRAILERS` frame. This frame contains the canonical gRPC status code (e.g., `0` for OK, `14` for Unavailable). The reception of the `TRAILERS` frame by the client triggers the completion of the RxJS `Observable`, closing the stream[^13].

### 2.3 Flow Control and Backpressure

A significant challenge in tunneling protocols is flow control. In standard gRPC (HTTP/2), window updates prevent a fast sender from overwhelming a slow receiver. WebSockets operate over TCP, which provides transport-level backpressure, but this applies to the entire connection, not individual streams.

For the initial version of NgGoRPC, we rely on the **underlying TCP backpressure mechanism**. If the Angular client cannot process frames fast enough, the TCP receive window fills, causing the Go server's `conn.Write` to block. This effectively throttles all streams. While suboptimal for scenarios with mixed high-priority and low-priority streams, this approach drastically simplifies implementation while remaining sufficient for most UI-driven applications. Future iterations may implement application-level `WINDOW_UPDATE` frames similar to HTTP/2[^12].

---

## 3. Frontend Architecture: The Angular Implementation

The frontend implementation centers on integrating the protocol with Angular's reactive paradigms. The library serves as a transport adapter for clients generated by `ts-proto`, managing the complexity of socket lifecycle, multiplexing, and zone management.

### 3.1 The `NgGoRpcClient` Service

The core of the library is the `NgGoRpcClient`, a singleton Angular service responsible for managing the WebSocket connection. It maintains a registry of active streams, mapping Stream IDs to RxJS `Subject` instances.

#### 3.1.1 Connection Management with Exponential Backoff

Robustness is paramount. Network fluctuations should not propagate errors to the UI unless the retry policy is exhausted. The client implements a reconnection loop using RxJS `retryWhen` logic.

The reconnection strategy is defined as follows:

- **Disconnect Detection**: The WebSocket `onclose` or `onerror` event fires.
- **State Transition**: The client enters a `RECONNECTING` state. Active streams are not immediately errored; they are paused.
- **Backoff Calculation**: The delay before the next attempt follows the formula `$Delay = \min(Cap, Base \times 2^{Attempt})$`. A typical configuration uses a `Base` of 1 second and a `Cap` of 30 seconds[^15].
- **Re-establishment**: Upon successful reconnection, the client cannot transparently resume streams because gRPC is stateful (the server context is lost). Therefore, the client must error out pending streams with a `UNAVAILABLE` status, prompting the application logic (or a higher-level retry operator) to re-subscribe.

### 3.2 Performance Optimization: The `NgZone` Strategy

Angular's change detection mechanism (Zone.js) patches global asynchronous events, including WebSocket messages. In high-throughput scenarios—such as a streaming price ticker receiving 50 updates per second—triggering a change detection cycle for every message can severely degrade rendering performance, leading to UI freezes[^17].

NgGoRPC mitigates this by initializing the WebSocket connection **outside the Angular zone**:

```typescript
constructor(private ngZone: NgZone) {
  this.ngZone.runOutsideAngular(() => {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onmessage = this.handleMessage.bind(this);
  });
}
```

The `handleMessage` method parses the binary frame, extracts the Stream ID, and deserializes the Protobuf payload—all without triggering Angular. The library re-enters the zone only when emitting the final data to the consumer:

```typescript
private handleMessage(event: MessageEvent) {
  const frame = decodeFrame(event.data);
  const subject = this.streamMap.get(frame.streamId);
  
  if (subject) {
    // Deserialize strictly outside the zone
    const message = this.protoRegistry.decode(frame.payload);
    
    // Re-enter zone ONLY for the notification
    this.ngZone.run(() => {
      subject.next(message);
    });
  }
}
```

This "selective re-entry" pattern ensures that parsing overhead and protocol chatter (like pings or keep-alives) remain invisible to Angular's dirty-checking mechanism, ensuring 60 FPS performance even under load[^19].

### 3.3 Integration with `ts-proto`

To ensure type safety, NgGoRPC integrates with `ts-proto`, a Protocol Buffers compiler plugin that generates idiomatic TypeScript interfaces and client classes. Crucially, it supports a generic `Rpc` interface that allows developers to inject a custom transport layer[^8].

We configure `ts-proto` with the `--ts_proto_opt=returnObservable=true` flag. This alters the generated client signatures to return `Observable<Response>` instead of `Promise<Response>`, which is essential for streaming support[^21].

The library implements the `Rpc` interface:

```typescript
export class WebSocketRpcTransport implements Rpc {
  request(service: string, method: string, data: Uint8Array): Observable<Uint8Array> {
    const streamId = this.generateStreamId();
    const subject = new Subject<Uint8Array>();
    this.streamMap.set(streamId, subject);
    
    // Send HEADERS and DATA frames
    this.sendHeaders(streamId, service, method);
    this.sendData(streamId, data);
    
    return subject.asObservable();
  }
}
```

This implementation allows the generated code (e.g., `userClient.getUser(...)`) to remain agnostic of the underlying WebSocket transport. The developer interacts with strongly-typed `Observables`, while the transport layer handles the framing and binary encoding transparently.

---

## 4. Backend Architecture: The Go Implementation

The backend library, `wsgrpc`, acts as a translation layer. It sits between the raw WebSocket connection and the standard gRPC service implementations. The goal is to allow developers to write standard gRPC handlers (`func (s *server) Method(...)`) without being aware they are serving traffic over WebSockets.

### 4.1 The `grpc.ServerStream` Adapter

The core task is to satisfy the `grpc.ServerStream` interface. This interface is what generated gRPC code uses to interact with the client. `wsgrpc` must provide a custom implementation of this interface that reads from and writes to the WebSocket frames[^22].

The adapter struct encapsulates the WebSocket connection and the specific Stream ID:

```go
type WebSocketServerStream struct {
    ctx        context.Context
    conn       *WebSocketConn
    streamID   uint32
    recvChan   chan []byte // buffered channel for incoming DATA frames
    headerSent bool
}

func (s *WebSocketServerStream) SendMsg(m interface{}) error {
    // 1. Marshal the message using protobuf
    data, err := proto.Marshal(m.(proto.Message))
    if err != nil { 
        return err 
    }
    
    // 2. Wrap in a DATA frame
    frame := NewFrame(s.streamID, FlagData, data)
    
    // 3. Write to the WebSocket (thread-safe)
    return s.conn.WriteFrame(frame)
}

func (s *WebSocketServerStream) RecvMsg(m interface{}) error {
    // 1. Wait for data from the read loop
    select {
    case data, ok := <-s.recvChan:
        if !ok { 
            return io.EOF 
        }
        // 2. Unmarshal into m
        return proto.Unmarshal(data, m.(proto.Message))
    case <-s.ctx.Done():
        return s.ctx.Err()
    }
}
```

This adapter allows the vast ecosystem of gRPC middleware (logging, auth, validation) to function correctly, as they interact with the standard `ServerStream` interface[^24].

### 4.2 Connection Handling and Multiplexing

The Go server uses the `nhooyr.io/websocket` library for its minimal API and high performance. The connection handler follows a robust concurrency pattern:

- **Read Loop**: A single goroutine reads messages from the WebSocket. It decodes the header to identify the Stream ID.
- **Dispatch**:
    - If the frame is `HEADERS` (new stream), the handler performs a registry lookup to find the corresponding gRPC method. It then spawns a new goroutine to execute the handler, passing it the `WebSocketServerStream`.
    - If the frame is `DATA`, it routes the payload to the `recvChan` of the existing stream's adapter.
- **Write Loop**: Since many WebSocket libraries do not support concurrent writes, the `WebSocketConn` wrapper must serialize all outgoing frames through a central channel or a `sync.Mutex`.

### 4.3 Service Registry Integration

Standard gRPC servers use a complex internal registration mechanism. To integrate `wsgrpc`, we must expose a method to register service descriptions. The library provides a `wsgrpc.Server` that mimics the API of `grpc.Server`:

```go
s := wsgrpc.NewServer()
pb.RegisterGreeterServer(s, &myGreeterImpl{})
```

Internally, `wsgrpc` maintains a map of `FullMethodName -> StreamHandler`. When a `HEADERS` frame arrives with `/greeter.Greeter/SayHello`, the server looks up the handler and invokes it. This ensures that the code generation workflow for the backend remains completely standard—developers use `protoc-gen-go-grpc` exactly as they would for a TCP server[^25].

---

## 5. Security Considerations and Production Readiness

Deploying a custom transport protocol requires vigilance regarding security, particularly authentication and resource exhaustion.

### 5.1 Authentication Strategy

WebSockets do not support custom headers during the handshake in standard browser JavaScript APIs (specifically the `WebSocket` constructor). This limits the ability to pass `Authorization: Bearer <token>` directly[^26].

NgGoRPC adopts a dual-strategy for authentication:

1.  **Query Parameter Handshake**: The initial connection can include the token in the URL (`ws://api.host/rpc?token=xyz`). While effective, this risks logging tokens in server access logs.
2.  **Protocol-Level Authentication (Preferred)**: The preferred strategy is to include authentication metadata in the `HEADERS` frame of every RPC call. The Angular client injects the token here. The Go backend's `StreamAdapter` extracts this and populates the `metadata.MD` in the context. This mimics standard gRPC metadata handling and allows for per-call authentication[^27].

### 5.2 Resource Exhaustion and DoS Protection

Multiplexing introduces a Denial of Service (DoS) vector. A malicious client could initiate thousands of streams without sending data, exhausting server goroutines.

- **Stream Limits**: The `wsgrpc` server enforces a hard limit on `MaxConcurrentStreams` per connection (defaulting to 100). Attempts to open new streams beyond this limit result in a `RST_STREAM` frame with a `RESOURCE_EXHAUSTED` status.
- **Idle Timeouts**: Streams that remain idle (no data exchange) beyond a configured threshold are forcibly closed by the server.

---

## 6. Implementation Roadmap

This section defines the step-by-step execution plan for the engineering team.

#### Phase 1: Protocol Definition & Tooling Setup
- **Task 1.1**: Formalize the `PROTOCOL.md` specification, defining the exact bit-layout of the 9-byte header and error codes.
- **Task 1.2**: Configure the frontend build pipeline. Install `ts-proto` and configure the `protoc` command to generate Observables (`returnObservable=true`).
- **Task 1.3**: Configure the backend build pipeline with `protoc-gen-go-grpc`. Ensure that generated code interfaces match the expected `grpc.ServiceRegistrar` interface.

#### Phase 2: Core Library Development
- **Task 2.1 (Frontend)**: Implement the `FrameCodec` class in TypeScript using `DataView` for efficient Big-Endian parsing of the header.
- **Task 2.2 (Frontend)**: Develop `NgGoRpcClient`. Implement the `connect()` method with `NgZone.runOutsideAngular`. Validate that binary frames are received correctly.
- **Task 2.3 (Backend)**: Implement `wsgrpc.Server` using `nhooyr/websocket`. Create the read-loop that decodes frames and prints them to the console for verification.

#### Phase 3: The Multiplexing Engine
- **Task 3.1 (Frontend)**: Implement the `StreamMap` logic. Create the `RpcTransport` implementation that issues Stream IDs and returns a `Subject`. Connect this to the `ts-proto` generated client.
- **Task 3.2 (Backend)**: Implement the `StreamRegistry`. Build the `StreamAdapter` that satisfies `grpc.ServerStream`. Wire up the `RecvMsg` and `SendMsg` methods to the WebSocket read/write loops.
- **Task 3.3 (Integration)**: Execute a "Hello World" unary RPC. Verify the full round-trip: Angular → Frame → WS → Go → Handler → Reply → WS → Angular.

#### Phase 4: Streaming & Resilience
- **Task 4.1 (Frontend)**: Implement the logic for Streaming RPCs. Ensure that `Subject.next()` is called multiple times for incoming `DATA` frames and `Subject.complete()` is called on `TRAILERS`.
- **Task 4.2 (Frontend)**: Implement the RxJS `retryWhen` logic. Create a comprehensive test case where the server is restarted, and the client automatically reconnects and retries the call.
- **Task 4.3 (Optimization)**: Profile the Angular application using Chrome DevTools. Verify that WebSocket traffic does not trigger Change Detection until the final `next()` emission.

#### Phase 5: Production Hardening
- **Task 5.1**: Implement KeepAlive (Ping/Pong) frames to prevent load balancers (e.g., AWS ALB, Nginx) from dropping idle connections[^28].
- **Task 5.2**: Add TLS support (`wss://`) and validate certificate handling in the Go server.
- **Task 5.3**: Publish the Angular library to a private npm registry and the Go module to a private git repository.

---

## 7. Comparison with Existing Solutions

It is crucial to justify the investment in NgGoRPC by contrasting it with available alternatives.

| Feature                    | NgGoRPC (Proposed)                | gRPC-Web (Official)       | Improbable gRPC-Web          |
| :------------------------- | :-------------------------------- | :------------------------ | :--------------------------- |
| **Transport Protocol**     | WebSocket (TCP)                   | HTTP/1.1 or HTTP/2        | HTTP/1.1 or WebSocket        |
| **Bidirectional Streaming**| **Native & Full Duplex**          | Not Supported             | Supported (Experimental)     |
| **Multiplexing**           | **Application Layer (One Socket)**| Relies on HTTP/2          | One Socket per Stream        |
| **Connection Overhead**    | Low (Single Handshake)            | High (Request per RPC)    | High (Handshake per RPC)     |
| **Angular Integration**    | **Native (NgZone Optimized)**     | Manual / None             | Manual                       |
| **Proxy Requirement**      | **None (Direct Connect)**         | Required (Envoy)          | Optional (Go Wrapper)        |
| **Reconnection Logic**     | Built-in (Stateful)               | N/A (Stateless)           | Manual Implementation        |

The comparative analysis reveals that NgGoRPC is the only solution that simultaneously solves the "Proxy Problem" and the "Bidirectional Problem" while respecting the specific performance constraints of the Angular framework. While Improbable's solution supports WebSockets, its implementation opens a new WebSocket connection for every single RPC call when multiplexing is not strictly enforced or available, leading to rapid resource exhaustion and firewall issues[^29]. NgGoRPC's strict single-socket multiplexing design avoids this pitfall.

---

## 8. Conclusion

The specification for NgGoRPC outlines a robust, high-performance transport layer that effectively modernizes RPC communication for Angular and Go applications. By accepting the complexity of implementing a custom framing protocol, the organization gains significant advantages: the elimination of operational overhead (Envoy), the unlocking of true real-time capabilities (bidirectional streaming), and the assurance of a responsive user interface (NgZone integration).

This approach moves beyond "making it work" to "making it scale." It aligns with the best practices of modern web architecture—reactive streams, persistent connections, and strict type safety—providing a solid foundation for the next generation of real-time web applications.

---

## 9. References

[^1]: [HTTP, WebSocket, gRPC or WebRTC: Which Communication Protocol is Best For Your App?](https://getstream.io/blog/communication-protocols/)
[^3]: [Can gRPC replace REST and WebSockets for Web Application Communication?](https://grpc.io/blog/postman-grpcweb/)
[^4]: [improbable-eng/grpc-web: gRPC Web implementation for Golang and TypeScript](https://github.com/improbable-eng/grpc-web)
[^6]: [gRPC vs Websockets? : r/golang - Reddit](https://www.reddit.com/r/golang/comments/1cgbm8e/grpc_vs_websockets/)
[^8]: [stephenh/ts-proto: An idiomatic protobuf generator for TypeScript](https://github.com/stephenh/ts-proto)
[^9]: [Encoding | Protocol Buffers Documentation](https://protobuf.dev/programming-guides/encoding/)
[^10]: [WebSocket Framing: Masking, Fragmentation and More](https://www.openmymind.net/WebSocket-Framing-Masking-Fragmentation-and-More/)
[^11]: [Does HTTP/2 make websockets obsolete? - Stack Overflow](https://stackoverflow.com/questions/28582935/does-http-2-make-websockets-obsolete)
[^12]: [Why gRPC Uses HTTP2 - Arpit Bhayani](https://arpitbhayani.me/blogs/grpc-http2/)
[^13]: [Why Does gRPC Insist on Trailers? : r/programming - Reddit](https://www.reddit.com/r/programming/comments/wiuf2f/why_does_grpc_insist_on_trailers/)
[^15]: [RxJS: retry with exponential backoff - DEV Community](https://dev.to/this-is-learning/rxjs-retry-with-exponential-backoff-dpe)
[^17]: [NgZone - Angular](https://angular.dev/api/core/NgZone)
[^19]: [Terrible performance issues with websocket - every message triggering Angular change detection - Stack Overflow](https://stackoverflow.com/questions/44371180/terrible-performance-issues-with-websocket-every-message-triggering-angular-ch)
[^21]: [bug: stream should force observable · Issue #59 · stephenh/ts-proto](https://github.com/stephenh/ts-proto/issues/59)
[^22]: [Golang gRPC server-stream - Stack Overflow](https://stackoverflow.com/questions/41626668/golang-grpc-server-stream)
[^24]: [grpc-ecosystem/go-grpc-middleware: Golang gRPC Middlewares](https://github.com/grpc-ecosystem/go-grpc-middleware)
[^25]: [Basics tutorial | Go - gRPC](https://grpc.io/docs/languages/go/basics/)
[^26]: [How we use gRPC to build a client/server system in Go : r/golang - Reddit](https://www.reddit.com/r/golang/comments/75ahl6/how_we_use_grpc_to_build_a_clientserver_system_in/)
[^27]: [gRPC with Bidirectional Streaming for Real-Time Updates - Medium](https://medium.com/@rahul.jindal57/grpc-with-bidirectional-streaming-for-real-time-updates-df07e44e209c)
[^28]: [stackrox/go-grpc-http1: A gRPC via HTTP/1 Enabling Library for Go](https://github.com/stackrox/go-grpc-http1)
[^29]: [Multiplexed websocket support · Issue #198 · improbable-eng/grpc-web](https://github.com/improbable-eng/grpc-web/issues/198)
