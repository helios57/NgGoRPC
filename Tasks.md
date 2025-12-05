# NgGoRPC Project Plan

## Executive Summary

The implementation establishes a solid foundation for multiplexing gRPC over WebSockets. The framing protocol is efficient, and the separation of NgZone in the client is a critical performance optimization. However, there are critical gaps regarding stream cancellation, header/trailer propagation, and resource management that must be addressed before production use.

## 1. Prioritized Open Points

### Priority 1: Critical (Must Fix for Functional MVP)

**✓ Client-Side Stream Cancellation (Memory Leak & Bandwidth)** - COMPLETED

*   **Issue**: In `client.ts`, `request(...)` returns `subject.asObservable()`. There is no teardown logic attached to this Observable. If an Angular component unsubscribes (e.g., user navigates away), the client stops processing data, but the server has no idea and continues processing/streaming data.
*   **Fix**: The Observable must return a teardown function that sends a `RST_STREAM` frame (flag `0x08`) with code `CANCEL` (`0x07`) to the server.
*   **Reference**: `client.ts` [Lines 232-266] lacks `return () => { ... }` logic.
*   **Status**: ✓ Implemented in `client.ts`. The `request` method now returns an Observable with proper teardown logic that sends RST_STREAM with CANCEL error code when unsubscribed.

**✓ Server-Side Header & Trailer Implementation** - COMPLETED

*   **Issue**: In `wsgrpc/server.go`, the methods `SetHeader`, `SendHeader`, and `SetTrailer` contain only `// TODO`. gRPC relies heavily on these for metadata and status codes. Currently, if a handler sets a header, it is lost.
*   **Fix**: Implement these methods to buffer metadata. `SendHeader` should immediately flush a `HEADERS` frame. `SetTrailer` should buffer data to be sent with the final `TRAILERS` frame.
*   **Reference**: `wsgrpc/server.go` [Lines 47-62].
*   **Status**: ✓ Implemented in `server.go`. Added header/trailer fields to WebSocketServerStream struct. SetHeader and SendHeader buffer and send header metadata with proper synchronization. SetTrailer buffers metadata for inclusion in final TRAILERS frame.

**✓ Error Propagation in Server Handler** - COMPLETED

*   **Issue**: In `wsgrpc/server.go` inside `handleStream`, if the handler returns an error, the code currently logs it: `// TODO: Send error in trailers`. The client will hang or time out because it never receives the `TRAILERS` frame to close the stream.
*   **Fix**: If `methodInfo.handler.Handler` returns an error, map the Go error to a gRPC status code (using `status.FromError`) and send it in the final `TRAILERS` frame payload.
*   **Reference**: `wsgrpc/server.go` [Lines 263-264].
*   **Status**: ✓ Implemented in `server.go`. Handler errors are now properly extracted using status.FromError, and gRPC status codes and messages are sent in TRAILERS frame along with any custom trailer metadata set by handlers.

### Priority 2: High (Reliability & Robustness)

**✓ Write Concurrency Bottleneck (Go)** - COMPLETED

*   **Issue**: The `wsConnection` uses a `sync.Mutex` around `conn.Write`. If streaming 100 concurrent RPCs, every single packet fights for this lock.
*   **Fix**: Implement an "Actor" pattern. Create a `sendChan chan []byte` for the connection. A dedicated goroutine should `range` over this channel and write to the WebSocket. All streams simply push to the channel. This serializes writes without heavy mutex contention.
*   **Status**: ✓ Implemented in `server.go`. Added sendChan buffered channel and writerLoop goroutine to wsConnection. All write operations now use the send() method which pushes frames to the channel. The dedicated writer goroutine serializes all writes, eliminating mutex contention.

**✓ Missing "Context" Propagation on Disconnect** - COMPLETED

*   **Issue**: When the WebSocket connection closes (unexpectedly or clean), the `wsConnection.ctx` is cancelled. However, we need to ensure this cancellation propagates immediately to all child stream contexts so running SQL queries or upstream calls in the Go handlers are aborted.
*   **Fix**: Ensure `wsConnection` uses `context.WithCancel`. On `Close`, call the `cancel` function. (Currently looks partially implemented, verify propagation).
*   **Status**: ✓ Implemented in `server.go`. wsConnection now uses context.WithCancel to create a cancellable context. Stream contexts are derived from wsConnection.ctx ensuring proper cancellation propagation. The Close() method calls cancel() to abort all running handlers immediately.

**✓ Payload Size Safety** - COMPLETED

*   **Issue**: `decodeFrame` in Go allocates a byte slice based on the header length before reading the data: `payload := data[headerSize:expectedSize]`.
*   **Fix**: While `nhooyr/websocket` handles message limits, the protocol decoder should enforce the `PROTOCOL.md` limit of 4MB explicitly before processing to prevent logic errors or specific attack vectors.
*   **Status**: ✓ Implemented in `frame.go`. Added explicit 4MB (4194304 bytes) payload size validation in decodeFrame. Frames exceeding this limit are rejected with an error before any processing occurs.

### Priority 3: Medium (Features & Polish)

**✓ Dynamic Configuration** - COMPLETED

*   **Issue**: Keep-alive intervals (30s), max frame sizes, and reconnect backoff strategies are hardcoded in `client.ts`.
*   **Fix**: Move these to an `NgGoRpcConfig` interface injection token in Angular.
*   **Status**: ✓ Implemented in `client.ts`. Added NgGoRpcConfig interface with optional parameters for pingInterval, baseReconnectDelay, maxReconnectDelay, and maxFrameSize. Updated NgGoRpcClient constructor to accept optional config parameter with sensible defaults (30s ping, 1s base delay, 30s max delay, 4MB max frame size).

**✓ Transport File Structure** - COMPLETED

*   **Issue**: `index.ts` exports `transport`, but the `WebSocketRpcTransport` class is physically located in `client.ts`.
*   **Fix**: Extract `WebSocketRpcTransport` into its own `transport.ts` file to avoid circular dependencies and clean up the codebase.
*   **Status**: ✓ Implemented. Created new `transport.ts` file containing Rpc interface and WebSocketRpcTransport class. Removed these from `client.ts` and updated imports. The `index.ts` now properly exports the transport module.

## 2. Test Plan

### A. Unit Tests

**Go Backend (`wsgrpc_test.go`)**

*   **Frame Encoding/Decoding**:
    *   Test encoding a frame with known StreamID and Flags matches exact byte output.
    *   Test decoding a malformed frame (too short) returns error.
    *   Test decoding a frame with payload larger than stated length returns error.
*   **Stream ID Management**:
    *   Mock the connection; ensure the server accepts odd Stream IDs (client) and rejects/logs invalid ones.
*   **Header Parsing**:
    *   Feed a raw `HEADERS` frame with `key: value\nkey2: value2` payload. Assert `metadata.MD` is correctly populated.

**TypeScript Frontend (`frame.spec.ts`, `client.spec.ts`)**

*   **Frame Codec (DataView Checks)**:
    *   Encode a payload. Verify bytes 0 (flag), 1-4 (ID), 5-8 (Length) match Big Endian hex values.
    *   Decode a byte array constructed manually.
*   **Observable Lifecycle**:
    *   Mock WebSocket. Call `request()`.
    *   **Crucial**: Call `subscription.unsubscribe()`. Assert that the mock WebSocket `send()` was called with a `RST_STREAM` frame.
*   **Backoff Logic**:
    *   Mock WebSocket failures. Use RxJS `TestScheduler` (virtual time) to verify retries happen at 1s, 2s, 4s...

### B. End-to-End (E2E) Tests

Requires a running Go server and Angular integration (e.g., Cypress or Playwright).

*   **Unary Call (Happy Path)**:
    *   Send "Alice". Expect "Hello, Alice!". Verify Stream ID 1 used. Verify stream closes immediately.
*   **Server Streaming (Pressure Test)**:
    *   Call `SayHelloStream`. Server sends 1000 items.
    *   Verify client receives all 1000.
    *   **Visual Test**: Verify Angular UI does not freeze (validating `runOutsideAngular` logic).
*   **Client Cancellation (The "Stop" Button)**:
    *   Start a long server stream (e.g., infinite ticker).
    *   Client unsubscribes after 1 second.
    *   **Assertion**: Server logs "Context cancelled" or "RST received". Server stops sending data.
*   **Network Interruption (Resilience)**:
    *   Start a stream.
    *   Kill the WebSocket connection (simulated network down).
    *   Verify client enters "Reconnecting" state.
    *   Restore connection. Verify client reconnects.
    *   Verify old stream subjects error out with `UNAVAILABLE`.
*   **Large Payload**:
    *   Send a 3MB payload. Verify server receives it.
    *   Server echoes 3MB payload. Verify client receives it.

## 3. Recommended Code Changes (Immediate)

### Fix for Priority 1.1 (Client Cancellation) in `client.ts`:

```typescript
// In NgGoRpcClient.request method

return new Observable<Uint8Array>(observer => {
  // ... existing setup logic ...
  this.streamMap.set(streamId, subject);

  // Subscribe the internal Subject to the output Observer
  const subscription = subject.subscribe(observer);

  // ... existing sending HEADERS and DATA logic ...

  // Teardown logic
  return () => {
    subscription.unsubscribe();
    // Remove from map
    this.streamMap.delete(streamId);
    
    // Send RST_STREAM to server if connection is still open
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
       // 0x07 is CANCEL, 0x08 is FlagRST_STREAM
       const cancelPayload = new Uint8Array(4); 
       new DataView(cancelPayload.buffer).setUint32(0, 7, false); // Error code 7
       
       const rstFrame = encodeFrame(streamId, FrameFlags.RST_STREAM, cancelPayload);
       this.socket.send(rstFrame);
       console.log(`[NgGoRpcClient] Sent RST_STREAM (CANCEL) for stream ${streamId}`);
    }
  };
});
```

### Fix for Priority 1.3 (Server Error Handling) in `server.go`:

```go
// In handleStream method

    // Invoke the handler
    _, err := methodInfo.handler.Handler(methodInfo.srv, stream.ctx, dec, nil)
    
    // Default status OK
    statusCode := 0
    statusMsg := "OK"

    if err != nil {
        log.Printf("[wsgrpc] Handler error for stream %d: %v", stream.streamID, err)
        // Extract gRPC status code
        if s, ok := status.FromError(err); ok {
             statusCode = int(s.Code())
             statusMsg = s.Message()
        } else {
             statusCode = 2 // Unknown
             statusMsg = err.Error()
        }
    }

    // Send TRAILERS frame
    // Format: "grpc-status:<code>\ngrpc-message:<msg>"
    trailerStr := fmt.Sprintf("grpc-status:%d\ngrpc-message:%s", statusCode, statusMsg)
    trailersPayload := []byte(trailerStr)
    
    trailersFrame := encodeFrame(stream.streamID, FlagTRAILERS, trailersPayload)
    // ... send frame ...
```