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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decode(input: any, length?: number): T;

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
    const serviceDef = service as ServiceDefinition;
    const methodDesc = method as MethodDescriptor<TRequest, TResponse>;

    // Encode request data if provided, otherwise use empty message
    let encodedData: Uint8Array;
    if (data !== undefined) {
      encodedData = methodDesc.requestType.encode(data as TRequest).finish();
    } else {
      // Create empty message
      const emptyMessage = methodDesc.requestType.create({});
      encodedData = methodDesc.requestType.encode(emptyMessage).finish();
    }

    // Make request and automatically decode response
    const resp$ = metadata
      ? this.client.request(serviceDef.fullName, methodDesc.name, encodedData, metadata)
      : this.client.request(serviceDef.fullName, methodDesc.name, encodedData);

    return resp$.pipe(
      map((responseData: Uint8Array) => methodDesc.responseType.decode(responseData))
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
    options?: ToSignalOptions<unknown>
  ): Signal<TResponse | undefined> {
    const observable = this.request(service, method, data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return toSignal(observable, options as any);
  }
}
