/**
 * Unit tests for Angular providers (providers.ts)
 *
 * Note: These tests verify that NgGoRpcClient can be instantiated with various configurations.
 * Full Angular DI testing requires an Angular test environment.
 */

import { NgGoRpcClient, NgGoRpcConfig } from './client';

// Mock NgZone for testing
class MockNgZone {
  runOutsideAngular<T>(fn: () => T): T {
    return fn();
  }

  run<T>(fn: () => T): T {
    return fn();
  }
}

describe('NgGoRPC Providers', () => {

  describe('NgGoRpcClient instantiation', () => {
    it('should create a working client with default config', () => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const client = new NgGoRpcClient(mockNgZone);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(NgGoRpcClient);
      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.request).toBe('function');
    });

    it('should create a working client with all config options', () => {
      const config: NgGoRpcConfig = {
        pingInterval: 25000,
        baseReconnectDelay: 500,
        maxReconnectDelay: 20000,
        maxFrameSize: 2 * 1024 * 1024,
        enableLogging: true
      };

      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const client = new NgGoRpcClient(mockNgZone, config);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(NgGoRpcClient);
    });

    it('should create client with partial config', () => {
      const config: NgGoRpcConfig = {
        pingInterval: 15000,
        enableLogging: false
      };

      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const client = new NgGoRpcClient(mockNgZone, config);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(NgGoRpcClient);
    });

    it('should create client with maxFrameSize config', () => {
      const config: NgGoRpcConfig = {
        maxFrameSize: 8 * 1024 * 1024
      };

      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const client = new NgGoRpcClient(mockNgZone, config);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(NgGoRpcClient);
    });

    it('should create client with reconnect config', () => {
      const config: NgGoRpcConfig = {
        baseReconnectDelay: 500,
        maxReconnectDelay: 10000
      };

      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const client = new NgGoRpcClient(mockNgZone, config);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(NgGoRpcClient);
    });
  });
});
