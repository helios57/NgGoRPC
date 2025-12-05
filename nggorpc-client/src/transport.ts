import { Observable } from 'rxjs';
import { NgGoRpcClient } from './client';

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

  request(service: string, method: string, data: Uint8Array): Observable<Uint8Array> {
    return this.client.request(service, method, data);
  }
}
