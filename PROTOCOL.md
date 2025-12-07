# NgGoRPC Protocol Specification

## Version 1.0

This document defines the wire protocol for NgGoRPC, a WebSocket-based transport layer for gRPC communication between Angular frontends and Go backends.

---

## 1. Overview

NgGoRPC tunnels gRPC semantics over WebSocket connections using a lightweight binary framing protocol. The protocol enables multiplexed, bidirectional streaming while preserving gRPC's metadata, status codes, and cancellation semantics.

---

## 2. Binary Frame Format

Every WebSocket message transmitted by NgGoRPC constitutes a **Frame** with the following structure:

### 2.1 Frame Layout

| Offset (Bytes) | Field         | Type      | Size    | Description                                              |
|:---------------|:--------------|:----------|:--------|:---------------------------------------------------------|
| `0`            | **Flags**     | `uint8`   | 1 byte  | Control bits indicating frame type and state             |
| `1-4`          | **Stream ID** | `uint32`  | 4 bytes | Unique identifier for the logical gRPC stream (Big Endian) |
| `5-8`          | **Length**    | `uint32`  | 4 bytes | The length of the payload in bytes (Big Endian)          |
| `9...N`        | **Payload**   | `byte[]`  | N bytes | The Protobuf message, header block, or trailer block     |

**Total Header Size**: 9 bytes

### 2.2 Byte Order

All multi-byte fields (`Stream ID` and `Length`) are encoded in **Big Endian** (network byte order).

---

## 3. Flag Definitions

The `Flags` field (byte 0) uses a bitmask to indicate the frame type and state. Multiple flags can be combined using bitwise OR.

| Flag Name       | Bit Position | Hex Value | Description                                                      |
|:----------------|:-------------|:----------|:-----------------------------------------------------------------|
| `HEADERS`       | 0            | `0x01`    | Frame contains RPC metadata (method path, auth tokens, etc.)     |
| `DATA`          | 1            | `0x02`    | Frame contains a serialized Protobuf message                     |
| `TRAILERS`      | 2            | `0x04`    | Frame contains final RPC status (`grpc-status`, `grpc-message`)  |
| `RST_STREAM`    | 3            | `0x08`    | Control signal to terminate stream abnormally                    |
| `EOS`           | 4            | `0x10`    | End of Stream - no further frames will be sent on this stream    |

### 3.1 Flag Combinations

- `DATA | EOS (0x12)`: Final data frame in a unary or streaming call
- `TRAILERS | EOS (0x14)`: Standard completion signal with status

---

## 4. Stream Identifier Semantics

The `Stream ID` field enables multiplexing multiple concurrent RPC calls over a single WebSocket connection.

### 4.1 Stream ID Assignment

- **Client-Initiated Streams**: Use **odd-numbered** IDs (1, 3, 5, 7, ...)
- **Server-Initiated Streams**: Reserved for future use (e.g., server push), use **even-numbered** IDs (2, 4, 6, 8, ...)
- **Reserved Stream ID**: Stream ID `0` is reserved for connection-level control frames (e.g., keep-alive pings)

### 4.2 Stream ID Lifecycle

- Stream IDs **MUST NOT** be reused within the lifespan of a single WebSocket connection
- Stream IDs **MUST** be monotonically increasing for client-initiated streams
- The maximum Stream ID is `2^32 - 1` (`4,294,967,295`)

---

## 5. Error Codes

When a stream is terminated abnormally using `RST_STREAM`, the payload contains a single `uint32` error code (Big Endian).

### 5.1 Standard Error Codes

| Code | Name                  | Description                                                    |
|:-----|:----------------------|:---------------------------------------------------------------|
| `0`  | `NO_ERROR`            | Graceful shutdown (not an error)                               |
| `1`  | `PROTOCOL_ERROR`      | Malformed frame or invalid protocol usage                      |
| `2`  | `INTERNAL_ERROR`      | Internal server error                                          |
| `3`  | `FLOW_CONTROL_ERROR`  | Flow control protocol violated                                 |
| `4`  | `STREAM_CLOSED`       | Frame received for a closed stream                             |
| `5`  | `FRAME_SIZE_ERROR`    | Frame size exceeds allowed maximum                             |
| `6`  | `REFUSED_STREAM`      | Stream rejected before processing                              |
| `7`  | `CANCEL`              | Stream cancelled by client                                     |
| `8`  | `RESOURCE_EXHAUSTED`  | Maximum concurrent streams exceeded                            |
| `9`  | `UNAVAILABLE`         | Service temporarily unavailable                                |

### 5.2 gRPC Status Mapping

The `TRAILERS` frame payload contains gRPC status information encoded as key-value pairs (implementation-defined format, typically JSON or custom binary encoding):

- `grpc-status`: Integer status code (0 = OK, 1 = CANCELLED, 2 = UNKNOWN, etc.)
- `grpc-message`: Optional human-readable error message (UTF-8 string)

Standard gRPC status codes follow the canonical gRPC specification.

---

## 6. RPC Lifecycle

### 6.1 Unary RPC (Request-Response)

**Client → Server:**
1. `HEADERS` frame: Contains method path (e.g., `/mypackage.Greeter/SayHello`) and metadata
2. `DATA | EOS` frame: Contains serialized request message

**Server → Client:**
1. `HEADERS` frame (optional): Contains initial response headers
2. `DATA` frame: Contains serialized response message
3. `TRAILERS | EOS` frame: Contains final status (`grpc-status: 0` for success)

### 6.2 Server-Streaming RPC

**Client → Server:**
1. `HEADERS` frame: Method path and metadata
2. `DATA | EOS` frame: Request message

**Server → Client:**
1. `HEADERS` frame (optional): Initial headers
2. `DATA` frame: First response message
3. `DATA` frame: Second response message
4. ... (more DATA frames)
5. `TRAILERS | EOS` frame: Final status

### 6.3 Client-Streaming RPC

**Client → Server:**
1. `HEADERS` frame: Method path and metadata
2. `DATA` frame: First request message
3. `DATA` frame: Second request message
4. ... (more DATA frames)
5. `DATA | EOS` frame: Final request message

**Server → Client:**
1. `HEADERS` frame (optional): Initial headers
2. `DATA` frame: Single response message
3. `TRAILERS | EOS` frame: Final status

### 6.4 Bidirectional Streaming RPC

**Client → Server:**
1. `HEADERS` frame: Method path and metadata
2. `DATA` frame(s): Request messages (interleaved with server responses)
3. `DATA | EOS` frame: Final request message

**Server → Client:**
1. `HEADERS` frame (optional): Initial headers
2. `DATA` frame(s): Response messages (interleaved with client requests)
3. `TRAILERS | EOS` frame: Final status

---

## 7. Flow Control and Backpressure

NgGoRPC v1.0 relies on **TCP-level backpressure** for flow control:

- If the receiver cannot process frames fast enough, the TCP receive window fills
- This causes the sender's `write()` operation to block
- All streams on the connection are throttled uniformly

**Future Versions**: May implement application-level `WINDOW_UPDATE` frames similar to HTTP/2 for per-stream flow control.

---

## 8. Keep-Alive Mechanism

To prevent idle connections from being terminated by intermediate proxies or load balancers:

- **Ping Frame**: Client sends a frame with Stream ID `0`, `HEADERS` flag, and empty payload every 30 seconds
- **Pong Frame**: Server responds with Stream ID `0`, `DATA` flag, and empty payload

---

## 9. Security Considerations

### 9.1 TLS/SSL

Production deployments **MUST** use `wss://` (WebSocket Secure) connections with valid TLS certificates.

### 9.2 Authentication

Two authentication strategies are supported:

1. **Query Parameter Handshake**: Include token in WebSocket URL (`wss://api.host/rpc?token=xyz`)
   - Simple but risks token exposure in server logs
   
2. **Protocol-Level Authentication (Recommended)**: Include auth metadata in the `HEADERS` frame of each RPC
   - Allows per-call authentication
   - Compatible with standard gRPC metadata patterns

---

## 10. Implementation Guidelines

### 10.1 Frame Size Limits

- **Maximum Frame Size**: 4 MB (4,194,304 bytes) payload
- **Maximum Header Size**: 16 KB for HEADERS frame payload
- Implementations **MUST** reject frames exceeding these limits with `FRAME_SIZE_ERROR`

### 10.2 Concurrent Stream Limits

- **Default Maximum**: 100 concurrent streams per WebSocket connection
- Implementations **SHOULD** send `RST_STREAM` with `RESOURCE_EXHAUSTED` when limit is exceeded

### 10.3 Idle Timeouts

- Streams with no activity for 5 minutes **SHOULD** be closed by the server
- The WebSocket connection itself **SHOULD NOT** have an idle timeout if keep-alive frames are active

---

## 11. Compatibility

This protocol is designed to be compatible with:

- **Frontend**: Code generated by `ts-proto` with `outputServices=generic-definitions`
- **Backend**: Code generated by `protoc-gen-go` and `protoc-gen-go-grpc`

The protocol layer is transparent to generated code, allowing standard gRPC service definitions to work without modification.

---

## 12. Version History

- **v1.0** (2025-12-05): Initial specification
