import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {toSignal, ToSignalOptions} from '@angular/core/rxjs-interop';
import {Signal} from '@angular/core';
import {NgGoRpcClient} from './client';

/**
 * Represents a message type with encoding/decoding capabilities
 */
export interface MessageFns<T> {
  encode(message: T, writer?: unknown): { finish(): Uint8Array };

  /**
   * Decode a wire-format message. ts-proto generates `decode(input: BinaryReader | Uint8Array, …)`,
   * which satisfies this narrower signature — the transport only ever hands it the raw bytes that
   * came off the socket, so declaring the wider union here would buy nothing and cost the type.
   */
  decode(input: Uint8Array, length?: number): T;

  fromJSON(object: unknown): T;

  toJSON(message: T): unknown;

  create(base?: Partial<T>): T;

  fromPartial(object: Partial<T>): T;
}

/**
 * Represents a method descriptor in a service definition
 */
export interface MethodDescriptor<TRequest, TResponse> {
  name: string;
  requestType: MessageFns<TRequest>;
  requestStream: boolean;
  responseType: MessageFns<TResponse>;
  responseStream: boolean;
  options: Record<string, unknown>;
}

/**
 * Represents a service definition with methods
 */
export interface ServiceDefinition {
  name: string;
  fullName: string;
  methods: Record<string, MethodDescriptor<unknown, unknown>>;
}

/**
 * Rpc interface compatible with ts-proto generated clients
 */
export interface Rpc {
  request(
    service: string,
    method: string,
    data: Uint8Array,
    metadata?: Record<string, string>
  ): Observable<Uint8Array>;
}

/**
 * WebSocket-based RPC transport implementation
 */
export class WebSocketRpcTransport {
  constructor(private client: NgGoRpcClient) {
  }

  /**
   * Makes an RPC request using the typed API with service definition and method descriptor.
   * Automatically encodes the request and decodes the response.
   *
   * @param service - The service definition
   * @param method - The method descriptor from the service definition
   * @param data - The request data (optional, will use empty message if not provided)
   * @param metadata - Optional metadata headers to send with the request (e.g., authorization, request-id)
   * @returns An Observable that emits the decoded response
   */
  request<TRequest, TResponse>(
    service: ServiceDefinition,
    method: MethodDescriptor<TRequest, TResponse>,
    data?: TRequest,
    metadata?: Record<string, string>
  ): Observable<TResponse> {
    // A client-streaming method sent through here reaches the server as a
    // single DATA|EOS frame — a syntactically valid stream carrying one message
    // and then half-close. The server rejects it at the APPLICATION layer
    // ("chunk before header", "no body"), so the mistake surfaces as a puzzling
    // per-RPC error rather than as a wiring bug, and it shipped twice that way.
    // Refuse it here, where the method descriptor still says what the method is.
    if (method.requestStream) {
      throw new Error(
        `${service.fullName}/${method.name} is client-streaming: use clientStream(), not request(). ` +
        'request() emits exactly one DATA|EOS frame, which the server sees as a one-message half-closed stream.'
      );
    }

    // Encode request data if provided, otherwise use empty message
    let encodedData: Uint8Array;
    if (data !== undefined) {
      encodedData = method.requestType.encode(data).finish();
    } else {
      // Create empty message
      const emptyMessage = method.requestType.create({});
      encodedData = method.requestType.encode(emptyMessage).finish();
    }

    // Make request and automatically decode response
    const resp$ = metadata
      ? this.client.request(service.fullName, method.name, encodedData, metadata)
      : this.client.request(service.fullName, method.name, encodedData);

    return resp$.pipe(
      map((responseData: Uint8Array) => method.responseType.decode(responseData))
    );
  }

  /**
   * Makes a CLIENT-STREAMING RPC using the typed API: every message is encoded
   * and sent as its own DATA frame, the last one carrying EOS (PROTOCOL.md 6.3).
   *
   * The messages are taken as an array rather than a stream because the whole
   * frame sequence is queued as one unit, so a call issued while the socket is
   * still connecting is flushed exactly once and in order once it opens. See
   * NgGoRpcClient.requestClientStream for the full reasoning.
   *
   * @param service - The service definition
   * @param method - The method descriptor; MUST have requestStream === true
   * @param messages - The request messages, in order. Must be non-empty.
   * @param metadata - Optional metadata headers (e.g. authorization)
   * @returns An Observable that emits the decoded response
   */
  clientStream<TRequest, TResponse>(
    service: ServiceDefinition,
    method: MethodDescriptor<TRequest, TResponse>,
    messages: readonly TRequest[],
    metadata?: Record<string, string>
  ): Observable<TResponse> {
    // The mirror of the guard in request(): fanning a unary method out over
    // several DATA frames is just as wrong, and just as invisible on the wire.
    if (!method.requestStream) {
      throw new Error(
        `${service.fullName}/${method.name} is not client-streaming: use request(), not clientStream().`
      );
    }

    const encoded = messages.map((message) => method.requestType.encode(message).finish());
    const resp$ = metadata
      ? this.client.requestClientStream(service.fullName, method.name, encoded, metadata)
      : this.client.requestClientStream(service.fullName, method.name, encoded);

    return resp$.pipe(
      map((responseData: Uint8Array) => method.responseType.decode(responseData))
    );
  }

  /**
   * Makes an RPC request and returns the response as an Angular Signal.
   * This method automatically encodes the request and decodes the response.
   *
   * @param service - The service definition
   * @param method - The method descriptor from the service definition
   * @param data - The request data (optional, will use empty message if not provided)
   * @param options - Options for toSignal conversion (optional)
   * @returns A Signal that emits the decoded response
   */
  requestSignal<TRequest, TResponse>(
    service: ServiceDefinition,
    method: MethodDescriptor<TRequest, TResponse>,
    data?: TRequest,
    // Deliberately the narrow overload: this method always returns `TResponse | undefined`, so it
    // cannot accept `requireSync`/`initialValue` — those change toSignal's return type to a
    // non-undefined `Signal<TResponse>` and the old `ToSignalOptions<unknown>` signature let a
    // caller pass them and be handed a lying type.
    options?: ToSignalOptions<TResponse | undefined> & { initialValue?: undefined; requireSync?: false }
  ): Signal<TResponse | undefined> {
    const observable = this.request(service, method, data);
    return options ? toSignal(observable, options) : toSignal(observable);
  }
}
