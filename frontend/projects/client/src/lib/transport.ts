import { Observable } from 'rxjs';
import { NgGoRpcClient } from './client';

/**
 * Represents a message type with encoding/decoding capabilities
 */
export interface MessageFns<T> {
  encode(message: T, writer?: any): any;
  decode(input: Uint8Array | any, length?: number): T;
  fromJSON(object: any): T;
  toJSON(message: T): unknown;
  create(base?: any): T;
  fromPartial(object: any): T;
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
  options: Record<string, any>;
}

/**
 * Represents a service definition with methods
 */
export interface ServiceDefinition {
  name: string;
  fullName: string;
  methods: Record<string, MethodDescriptor<any, any>>;
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
export class WebSocketRpcTransport implements Rpc {
  constructor(private client: NgGoRpcClient) {}

  // New typed API with service definition and method descriptor
  request<TRequest, TResponse>(
    service: ServiceDefinition,
    method: MethodDescriptor<TRequest, TResponse>,
    data?: TRequest
  ): Observable<Uint8Array>;

  // Legacy string-based API
  request(
    service: string,
    method: string,
    data: Uint8Array
  ): Observable<Uint8Array>;

  request<TRequest, TResponse>(
    service: string | ServiceDefinition,
    method: string | MethodDescriptor<TRequest, TResponse>,
    data?: Uint8Array | TRequest
  ): Observable<Uint8Array> {
    // Handle new typed API
    if (typeof service === 'object' && typeof method === 'object') {
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

      return this.client.request(serviceDef.fullName, methodDesc.name, encodedData);
    }

    // Handle legacy string-based API
    return this.client.request(service as string, method as string, data as Uint8Array);
  }
}
