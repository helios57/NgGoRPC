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

  decode(input: Uint8Array | ArrayBuffer, length?: number): T;

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
    data: Uint8Array
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
   * @returns An Observable that emits the decoded response
   */
  request<TRequest, TResponse>(
    service: ServiceDefinition,
    method: MethodDescriptor<TRequest, TResponse>,
    data?: TRequest
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
    return this.client.request(serviceDef.fullName, methodDesc.name, encodedData).pipe(
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
    options?: ToSignalOptions<TResponse>
  ): Signal<TResponse | undefined> {
    const observable = this.request(service, method, data);
    if (options) {
      return toSignal(observable, options);
    } else {
      return toSignal(observable);
    }
  }
}
