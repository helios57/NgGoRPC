# NgGoRPC

**High-Performance, Bidirectional gRPC over WebSockets for Angular and Go**

---

## The Problem

Standard gRPC is built on HTTP/2, which is not fully available in browser environments. The common solution, gRPC-Web, is a compromise that translates gRPC into HTTP/1.1 requests. This approach has two major drawbacks:

1.  **No True Bidirectional Streaming**: Client-side and full-duplex streaming are not supported, limiting real-time applications.
2.  **Proxy Requirement**: It requires an intermediate proxy (like Envoy) to translate requests, adding operational complexity and a potential point of failure.

## The Solution: NgGoRPC

**NgGoRPC** is a bespoke RPC library that tunnels the full gRPC protocol over a single, persistent WebSocket connection. This approach bypasses browser limitations and eliminates the need for a proxy, enabling a direct, high-performance connection between an Angular frontend and a Go backend.

It is designed to provide the rich, type-safe developer experience of gRPC without compromise.

## Core Features

-   **Full Duplex Streaming**: Native support for unary, server-streaming, client-streaming, and bidirectional RPCs.
-   **Multiplexing over a Single Connection**: Run multiple concurrent RPCs over one WebSocket, avoiding connection limits and head-of-line blocking.
-   **Zero Dependencies on Proxies**: Simplifies your architecture by allowing your Angular application to connect directly to your Go service.
-   **Optimized for Angular**: Integrates seamlessly with Angular's reactive patterns and uses `NgZone` optimizations to prevent UI performance degradation from high-frequency stream updates.
-   **Seamless Tooling**: Works with the standard Protobuf toolchain (`protoc`, `ts-proto`, `protoc-gen-go-grpc`). Your `.proto` files are your single source of truth.
-   **Built-in Resilience**: Automatically handles network interruptions with a configurable exponential backoff and retry strategy.

## How It Works

NgGoRPC implements a lightweight binary framing protocol on top of WebSockets. This protocol re-implements the core concepts of HTTP/2 streams, allowing gRPC payloads, metadata, and control signals to be multiplexed and demultiplexed at the application layer.

-   **Frontend**: An Angular service manages the WebSocket, handles the binary framing, and exposes strongly-typed RxJS `Observables` for each RPC call.
-   **Backend**: A Go library wraps your standard gRPC service implementation, translating WebSocket frames into the `grpc.ServerStream` interface your handlers expect.

## Project Status

This project is currently in the development phase, as outlined in the [Concept.md](Concept.md) and [Tasks.md](Tasks.md) documents.

---
*This README was generated based on the project's architectural specification.*
