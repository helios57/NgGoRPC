import {NgZone} from '@angular/core';
import {Observable, Subject} from 'rxjs';
import {decodeFrame, encodeFrame, FrameFlags} from './frame';
import {WebSocketRpcTransport} from './transport';

/**
 * Configuration options for NgGoRpcClient
 */
export interface NgGoRpcConfig {
    /** Keep-alive ping interval in milliseconds (default: 30000) */
    pingInterval?: number;
    /** Base delay for reconnection backoff in milliseconds (default: 1000) */
    baseReconnectDelay?: number;
    /** Maximum delay for reconnection backoff in milliseconds (default: 30000) */
    maxReconnectDelay?: number;
    /** Maximum frame size in bytes (default: 4194304 = 4MB) */
    maxFrameSize?: number;
    /** Enable debug logging (default: false) */
    enableLogging?: boolean;
}

/**
 * NgGoRPC Client
 *
 * Manages WebSocket connections for gRPC over WebSocket communication.
 * Uses Angular's NgZone to optimize performance by running WebSocket operations
 * outside the Angular change detection zone.
 *
 * Note: This class is NOT a service. It must be manually instantiated with config.
 */
export class NgGoRpcClient {
    private socket: WebSocket | null = null;
    private connected = false;
    private streamMap: Map<number, Subject<Uint8Array>> = new Map();
    private nextStreamId = 1; // Client-initiated streams use odd numbers
    private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private readonly maxReconnectDelay: number;
    private readonly baseReconnectDelay: number;
    private currentUrl: string | null = null;
    private reconnectionEnabled = false;
    private pingIntervalId: ReturnType<typeof setInterval> | null = null;
    private pongTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly pingInterval: number;
    private readonly maxFrameSize: number;
    private readonly pingStreamId = 0; // Reserved stream ID for keep-alive
    private authToken: string | null = null;
    private readonly pongTimeout = 5000; // 5 seconds timeout for PONG response
    private readonly enableLogging: boolean;

    constructor(private ngZone: NgZone, config?: NgGoRpcConfig) {
        // Apply configuration with defaults
        this.pingInterval = config?.pingInterval ?? 30000;
        this.baseReconnectDelay = config?.baseReconnectDelay ?? 1000;
        this.maxReconnectDelay = config?.maxReconnectDelay ?? 30000;
        this.maxFrameSize = config?.maxFrameSize ?? 4 * 1024 * 1024; // 4MB
        this.enableLogging = config?.enableLogging ?? false;
    }

    /**
     * Establishes a WebSocket connection to the specified URL with automatic reconnection.
     *
     * The connection is established outside the Angular zone to prevent
     * high-frequency WebSocket events from triggering unnecessary change detection cycles.
     *
     * @param url - The WebSocket URL to connect to (e.g., 'ws://localhost:8080' or 'wss://example.com')
     * @param enableReconnection - Whether to enable automatic reconnection (default: true)
     */
    connect(url: string, enableReconnection: boolean = true): void {
        this.currentUrl = url;
        this.reconnectionEnabled = enableReconnection;
        this.attemptConnection();
    }

    /**
     * Internal method to attempt a WebSocket connection
     */
    private attemptConnection(): void {
        if (!this.currentUrl) {
            return;
        }

        // SSR Safety: Check if WebSocket is available (browser-only)
        if (typeof WebSocket === 'undefined') {
            if (this.enableLogging) {
                console.warn('[NgGoRpcClient] WebSocket not available (SSR environment). Connection skipped.');
            }
            return;
        }

        // Run WebSocket operations outside Angular zone for better performance
        this.ngZone.runOutsideAngular(() => {
            this.socket = new WebSocket(this.currentUrl!);

            // Set binary type to arraybuffer for efficient binary frame processing
            this.socket.binaryType = 'arraybuffer';

            this.socket.onopen = () => {
                if (this.enableLogging) {
                    console.log('[NgGoRpcClient] WebSocket connection established');
                }
                this.connected = true;
                this.reconnectAttempt = 0; // Reset reconnection counter on successful connection
                this.startPingInterval();
            };

            this.socket.onmessage = (event: MessageEvent) => {
                try {
                    // Decode the incoming frame
                    const frame = decodeFrame(event.data as ArrayBuffer);

                    // Log decoded frame for validation
                    if (this.enableLogging) {
                        console.log('[NgGoRpcClient] Received frame:', {
                            streamId: frame.streamId,
                            flags: `0x${frame.flags.toString(16).padStart(2, '0')}`,
                            payloadSize: frame.payload.length
                        });
                    }

                    // Handle PING frames - respond with PONG
                    if (frame.flags & FrameFlags.PING) {
                        this.sendPong();
                        return;
                    }

                    // Handle PONG frames - clear watchdog timeout
                    if (frame.flags & FrameFlags.PONG) {
                        if (this.enableLogging) {
                            console.log('[NgGoRpcClient] Received PONG from server');
                        }
                        if (this.pongTimeoutId !== null) {
                            clearTimeout(this.pongTimeoutId);
                            this.pongTimeoutId = null;
                        }
                        return;
                    }

                    // Dispatch frame to the appropriate stream
                    const subject = this.streamMap.get(frame.streamId);
                    if (subject) {
                        // Re-enter Angular zone only when delivering data to components
                        this.ngZone.run(() => {
                            if (frame.flags & FrameFlags.DATA) {
                                subject.next(frame.payload);
                            }

                            if (frame.flags & FrameFlags.TRAILERS) {
                                // Parse grpc-status from trailers payload
                                const trailersText = new TextDecoder().decode(frame.payload);
                                const statusMatch = trailersText.match(/grpc-status:\s*(\d+)/);
                                const messageMatch = trailersText.match(/grpc-message:\s*([^\n]+)/);

                                const grpcStatus = statusMatch ? parseInt(statusMatch[1], 10) : 0;
                                const grpcMessage = messageMatch ? messageMatch[1].trim() : '';

                                if (grpcStatus === 0) {
                                    // Status OK - complete successfully
                                    subject.complete();
                                } else {
                                    // Non-OK status - emit error
                                    const errorMsg = grpcMessage || `gRPC error with status code ${grpcStatus}`;
                                    subject.error(new Error(errorMsg));
                                }
                                this.streamMap.delete(frame.streamId);
                            }

                            if (frame.flags & FrameFlags.RST_STREAM) {
                                subject.error(new Error('Stream reset by server'));
                                this.streamMap.delete(frame.streamId);
                            }
                        });
                    }
                } catch (error) {
                    console.error('[NgGoRpcClient] Frame decoding error:', error);
                }
            };

            this.socket.onerror = (error) => {
                console.error('[NgGoRpcClient] WebSocket error:', error);
            };

            this.socket.onclose = (event) => {
                if (this.enableLogging) {
                    console.log('[NgGoRpcClient] WebSocket connection closed:', {
                        code: event.code,
                        reason: event.reason,
                        wasClean: event.wasClean
                    });
                }
                this.connected = false;
                this.socket = null;

                // Stop keep-alive ping interval
                this.stopPingInterval();

                // Error out all active streams with UNAVAILABLE status
                this.errorOutActiveStreams();

                // Attempt reconnection if enabled
                if (this.reconnectionEnabled) {
                    this.scheduleReconnection();
                }
            };
        });
    }

    /**
     * Errors out all active streams when disconnection occurs
     */
    private errorOutActiveStreams(): void {
        this.ngZone.run(() => {
            this.streamMap.forEach((subject, _streamId) => {
                subject.error(new Error('Connection lost - UNAVAILABLE'));
            });
            this.streamMap.clear();
        });
    }

    /**
     * Schedules a reconnection attempt with exponential backoff
     */
    private scheduleReconnection(): void {
        // Calculate delay with exponential backoff: min(cap, base * 2^attempt)
        const delay = Math.min(
            this.maxReconnectDelay,
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt)
        );

        if (this.enableLogging) {
            console.log(`[NgGoRpcClient] Scheduling reconnection attempt ${this.reconnectAttempt + 1} in ${delay}ms`);
        }

        this.reconnectAttempt++;

        this.reconnectTimeoutId = setTimeout(() => {
            if (this.reconnectionEnabled && this.currentUrl) {
                if (this.enableLogging) {
                    console.log('[NgGoRpcClient] Attempting reconnection...');
                }
                this.attemptConnection();
            }
        }, delay);
    }

    /**
     * Starts the keep-alive ping interval
     */
    private startPingInterval(): void {
        // Run outside Angular zone to avoid triggering change detection
        this.ngZone.runOutsideAngular(() => {
            this.pingIntervalId = setInterval(() => {
                this.sendPing();
            }, this.pingInterval);
        });
        if (this.enableLogging) {
            console.log('[NgGoRpcClient] Keep-alive ping interval started');
        }
    }

    /**
     * Stops the keep-alive ping interval
     */
    private stopPingInterval(): void {
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
            if (this.enableLogging) {
                console.log('[NgGoRpcClient] Keep-alive ping interval stopped');
            }
        }
        // Also clear any pending PONG timeout
        if (this.pongTimeoutId !== null) {
            clearTimeout(this.pongTimeoutId);
            this.pongTimeoutId = null;
        }
    }

    /**
     * Sends a PING frame to the server and starts a watchdog timeout
     */
    private sendPing(): void {
        if (this.socket && this.connected) {
            const pingFrame = encodeFrame(this.pingStreamId, FrameFlags.PING, new Uint8Array(0));
            this.socket.send(pingFrame);
            if (this.enableLogging) {
                console.log('[NgGoRpcClient] Sent PING to server');
            }

            // Clear any existing timeout
            if (this.pongTimeoutId !== null) {
                clearTimeout(this.pongTimeoutId);
            }

            // Start watchdog timeout - close socket if no PONG arrives within 5 seconds
            this.pongTimeoutId = setTimeout(() => {
                console.warn('[NgGoRpcClient] No PONG received within timeout, closing connection');
                if (this.socket) {
                    // Close with code 4000 to trigger reconnection
                    this.socket.close(4000, 'PONG timeout');
                }
            }, this.pongTimeout);
        }
    }

    /**
     * Sends a PONG frame in response to a server PING
     */
    private sendPong(): void {
        if (this.socket && this.connected) {
            const pongFrame = encodeFrame(this.pingStreamId, FrameFlags.PONG, new Uint8Array(0));
            this.socket.send(pongFrame);
            if (this.enableLogging) {
                console.log('[NgGoRpcClient] Sent PONG to server');
            }
        }
    }

    /**
     * Closes the WebSocket connection and disables reconnection.
     */
    disconnect(): void {
        this.reconnectionEnabled = false; // Disable auto-reconnection
        this.stopPingInterval();

        // Clear reconnection timer
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }

        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.connected = false;
        }
    }

    /**
     * Returns whether the client is currently connected.
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Sets the authentication token to be included in RPC headers.
     *
     * @param token - The authentication token (e.g., JWT bearer token)
     */
    setAuthToken(token: string | null): void {
        this.authToken = token;
    }

    /**
     * Creates an RPC transport that can be used with ts-proto generated clients.
     */
    createTransport(): WebSocketRpcTransport {
        return new WebSocketRpcTransport(this);
    }

    /**
     * Sends an RPC request over the WebSocket connection.
     *
     * @param service - The service name (e.g., 'mypackage.Greeter')
     * @param method - The method name (e.g., 'SayHello')
     * @param data - The serialized Protobuf request data
     * @returns An Observable that emits the response data
     */
    request(service: string, method: string, data: Uint8Array): Observable<Uint8Array> {
        if (!this.socket || !this.connected) {
            throw new Error('WebSocket is not connected');
        }

        // Generate a new odd-numbered stream ID
        if (this.nextStreamId > 0xFFFFFFFF) {
            // Stream ID exhaustion protection
            // PROTOCOL.md: "Stream IDs MUST NOT be reused within the lifespan of a single WebSocket connection"
            const errorMsg = 'Stream ID exhaustion';
            console.error(`[NgGoRpcClient] ${errorMsg}`);
            this.socket.close(4000, errorMsg);
            throw new Error(errorMsg);
        }

        const streamId = this.nextStreamId;
        this.nextStreamId += 2; // Increment by 2 to keep odd numbers

        // Create a subject for this stream
        const subject = new Subject<Uint8Array>();
        this.streamMap.set(streamId, subject);

        // Send HEADERS frame with method path and optional auth token
        const methodPath = `/${service}/${method}`;
        let headersText = `path: ${methodPath}`;

        // Include authorization header if token is set
        if (this.authToken) {
            headersText += `\nauthorization: Bearer ${this.authToken}`;
        }

        const headersPayload = new TextEncoder().encode(headersText);
        const headersFrame = encodeFrame(streamId, FrameFlags.HEADERS, headersPayload);
        this.socket.send(headersFrame);

        if (this.enableLogging) {
            console.log(`[NgGoRpcClient] Sending HEADERS for stream ${streamId}: ${methodPath}`);
        }

        // Send DATA frame with request payload (with EOS flag for unary calls)
        const dataFrame = encodeFrame(streamId, FrameFlags.DATA | FrameFlags.EOS, data);
        this.socket.send(dataFrame);

        if (this.enableLogging) {
            console.log(`[NgGoRpcClient] Sending DATA for stream ${streamId}, size: ${data.length} bytes`);
        }

        // Return an Observable with proper teardown logic for cancellation
        return new Observable<Uint8Array>(observer => {
            // Subscribe the internal Subject to the output Observer
            const subscription = subject.subscribe(observer);

            // Teardown logic - executes when the Observable is unsubscribed
            return () => {
                subscription.unsubscribe();
                // Remove from map
                this.streamMap.delete(streamId);

                // Send RST_STREAM to server if connection is still open
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    // 0x07 is CANCEL error code, 0x08 is FlagRST_STREAM
                    const cancelPayload = new Uint8Array(4);
                    new DataView(cancelPayload.buffer).setUint32(0, 7, false); // Error code 7 (CANCEL)

                    const rstFrame = encodeFrame(streamId, FrameFlags.RST_STREAM, cancelPayload);
                    this.socket.send(rstFrame);
                    if (this.enableLogging) {
                        console.log(`[NgGoRpcClient] Sent RST_STREAM (CANCEL) for stream ${streamId}`);
                    }
                }
            };
        });
    }
}
