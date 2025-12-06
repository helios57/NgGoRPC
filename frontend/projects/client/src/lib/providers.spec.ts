import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import {
  provideNgGoRpc,
  NG_GO_RPC_CLIENT,
  NG_GO_RPC_CONFIG,
} from './providers';
import { NgGoRpcClient, NgGoRpcConfig } from './client';

describe('NgGoRpc Providers', () => {
  it('should provide NgGoRpcClient without config', () => {
    TestBed.configureTestingModule({
      providers: [provideNgGoRpc()],
    });

    const client = TestBed.inject(NG_GO_RPC_CLIENT);
    expect(client).toBeInstanceOf(NgGoRpcClient);
  });

  it('should provide NgGoRpcClient with default config when none is provided', () => {
    TestBed.configureTestingModule({
      providers: [provideNgGoRpc()],
    });

    const client = TestBed.inject(NG_GO_RPC_CLIENT);
    // Check some default values by accessing private properties
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['pingInterval']).toBe(30000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['enableLogging']).toBe(false);
  });

  it('should provide NgGoRpcClient and NgGoRpcConfig with a config', () => {
    const config: NgGoRpcConfig = {
      pingInterval: 15000,
      enableLogging: true,
    };

    TestBed.configureTestingModule({
      providers: [provideNgGoRpc(config)],
    });

    const client = TestBed.inject(NG_GO_RPC_CLIENT);
    const injectedConfig = TestBed.inject(NG_GO_RPC_CONFIG);

    expect(client).toBeInstanceOf(NgGoRpcClient);
    expect(injectedConfig).toEqual(config);
  });

  it('should configure the client with the provided config', () => {
    const config: NgGoRpcConfig = {
      pingInterval: 15000,
      baseReconnectDelay: 2000,
      maxReconnectDelay: 60000,
      enableLogging: true,
    };

    TestBed.configureTestingModule({
      providers: [provideNgGoRpc(config)],
    });

    const client = TestBed.inject(NG_GO_RPC_CLIENT);

    // Check if the client has the configured values by accessing private properties
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['pingInterval']).toBe(config.pingInterval);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['baseReconnectDelay']).toBe(config.baseReconnectDelay);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['maxReconnectDelay']).toBe(config.maxReconnectDelay);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['enableLogging']).toBe(config.enableLogging);
  });

  it('should inject NgZone into the client', () => {
    TestBed.configureTestingModule({
      providers: [provideNgGoRpc()],
    });

    const client = TestBed.inject(NG_GO_RPC_CLIENT);
    const ngZone = TestBed.inject(NgZone);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)['ngZone']).toBe(ngZone);
  });
});
