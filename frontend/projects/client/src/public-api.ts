/*
 * Public API Surface of client
 */

export { NgGoRpcClient } from './lib/client';
export type { NgGoRpcConfig } from './lib/client';
export { WebSocketRpcTransport } from './lib/transport';
export type { Rpc, ServiceDefinition, MethodDescriptor, MessageFns } from './lib/transport';
export * from './lib/frame';
