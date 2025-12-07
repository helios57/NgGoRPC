/**
 * Unit tests for NgGoRpcClient (client.ts)
 */
import { fakeAsync, tick } from '@angular/core/testing';
import { NgGoRpcClient } from './client';
import { FrameFlags, decodeFrame, encodeFrame } from './frame';

// Mock NgZone for testing
class MockNgZone {
  runOutsideAngular<T>(fn: () => T): T {
    return fn();
  }

  run<T>(fn: () => T): T {
    return fn();
  }
}

describe('NgGoRpcClient', () => {
  let client: NgGoRpcClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSocket: any;
  let sentMessages: Uint8Array[];

  beforeEach(() => {
    sentMessages = [];

    // Create a mock WebSocket
    mockSocket = {
      readyState: 1, // WebSocket.OPEN
      send: jasmine.createSpy('send').and.callFake((data: Uint8Array) => {
        sentMessages.push(new Uint8Array(data));
      }),
      close: jasmine.createSpy('close'),
      addEventListener: jasmine.createSpy('addEventListener'),
      removeEventListener: jasmine.createSpy('removeEventListener'),
    };

    // Mock WebSocket constructor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = jasmine.createSpy('WebSocket').and.returnValue(mockSocket);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket.OPEN = 1;

    const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
    client = new NgGoRpcClient(mockNgZone);
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('Connection', () => {
    it('should not connect if URL is not provided', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).attemptConnection();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).not.toHaveBeenCalled();
    });

    it('should not reconnect if reconnection is disabled', fakeAsync(() => {
      client.connect('ws://localhost:8080', false);
      mockSocket.onopen(new Event('open')); // Simulate connection
      mockSocket.onclose(new CloseEvent('close'));
      tick(5000);
      // The initial call is expected, but no subsequent calls for reconnection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(1);
    }));
  });

  describe('ConnectionState Observable', () => {
    it('should emit Disconnected initially', (done) => {
      client.connectionState$.subscribe(state => {
        expect(state).toBe('Disconnected');
        done();
      });
    });

    it('should emit Connected when connection opens', (done) => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
        if (states.length === 2) {
          expect(states[0]).toBe('Disconnected');
          expect(states[1]).toBe('Connected');
          done();
        }
      });

      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
    });

    it('should emit Reconnecting then Disconnected when reconnection enabled and connection closes', fakeAsync(() => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
      });

      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      tick();
      mockSocket.onclose(new CloseEvent('close'));
      tick();

      expect(states).toContain('Disconnected');
      expect(states).toContain('Connected');
      expect(states).toContain('Reconnecting');
    }));

    it('should emit Disconnected without Reconnecting when reconnection disabled', fakeAsync(() => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
      });

      client.connect('ws://localhost:8080', false);
      mockSocket.onopen(new Event('open'));
      tick();
      mockSocket.onclose(new CloseEvent('close'));
      tick();

      expect(states).toContain('Disconnected');
      expect(states).toContain('Connected');
      expect(states).not.toContain('Reconnecting');
    }));
  });

  describe('Auto-Reconnection', () => {
    it('should attempt reconnection with exponential backoff', fakeAsync(() => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const testClient = new NgGoRpcClient(mockNgZone, {
        baseReconnectDelay: 1000,
        maxReconnectDelay: 5000
      });

      testClient.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      mockSocket.onclose(new CloseEvent('close'));

      // First reconnection after 1s (2^0 * 1000ms)
      tick(999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(1);
      tick(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);

      // Simulate second failure
      mockSocket.onclose(new CloseEvent('close'));

      // Second reconnection after 2s (2^1 * 1000ms)
      tick(1999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);
      tick(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(3);

      testClient.disconnect();
    }));

    it('should cap reconnection delay at maxReconnectDelay', fakeAsync(() => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const testClient = new NgGoRpcClient(mockNgZone, {
        baseReconnectDelay: 1000,
        maxReconnectDelay: 3000
      });

      testClient.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      // Trigger multiple failures to reach cap
      for (let i = 0; i < 5; i++) {
        mockSocket.onclose(new CloseEvent('close'));
        tick(3000); // Wait max delay
      }

      // After 5 attempts, delay should be capped at 3000ms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callCount = (window as any).WebSocket.calls.count();
      expect(callCount).toBeGreaterThan(1);

      testClient.disconnect();
    }));

    it('should reset reconnection attempt counter on successful connection', fakeAsync(() => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const testClient = new NgGoRpcClient(mockNgZone, {
        baseReconnectDelay: 1000
      });

      testClient.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(0);

      mockSocket.onclose(new CloseEvent('close'));
      tick(1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(1);

      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(0);

      testClient.disconnect();
    }));

    it('should error out active streams with UNAVAILABLE when disconnected', fakeAsync(() => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      let errorReceived: unknown = null;
      const obs = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
      obs.subscribe({
        error: (err) => {
          errorReceived = err;
        }
      });

      mockSocket.onclose(new CloseEvent('close'));
      tick();

      expect(errorReceived).toBeDefined();
      // Check if it's a GrpcError with UNAVAILABLE status
      expect(errorReceived).toEqual(jasmine.objectContaining({
        code: 14, // GrpcStatus.UNAVAILABLE
        message: 'Connection lost'
      }));
    }));
  });

  describe('Message Handling', () => {
    beforeEach(() => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
    });

    it('should respond to PING with PONG', () => {
      const pingFrame = encodeFrame(0, FrameFlags.PING, new Uint8Array(0));
      mockSocket.onmessage(new MessageEvent('message', { data: pingFrame.buffer }));
      expect(sentMessages.length).toBe(1);
      const sentFrame = decodeFrame(sentMessages[0].buffer);
      expect(sentFrame.flags & FrameFlags.PONG).toBeTruthy();
    });

    it('should handle TRAILERS with non-zero status', () => {
      const trailersPayload = new TextEncoder().encode('grpc-status: 1\ngrpc-message: test error');
      const trailersFrame = encodeFrame(1, FrameFlags.TRAILERS, trailersPayload);
      const subject = { error: jasmine.createSpy('error'), complete: jasmine.createSpy('complete') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).streamMap.set(1, subject);

      mockSocket.onmessage(new MessageEvent('message', { data: trailersFrame.buffer }));

      expect(subject.error).toHaveBeenCalledWith(new Error('test error'));
      expect(subject.complete).not.toHaveBeenCalled();
    });

    it('should handle RST_STREAM from server', () => {
      const rstFrame = encodeFrame(1, FrameFlags.RST_STREAM, new Uint8Array(0));
      const subject = { error: jasmine.createSpy('error') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).streamMap.set(1, subject);

      mockSocket.onmessage(new MessageEvent('message', { data: rstFrame.buffer }));

      expect(subject.error).toHaveBeenCalledWith(new Error('Stream reset by server'));
    });

    it('should handle decoding errors gracefully', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      const invalidFrame = new ArrayBuffer(2); // Invalid frame that will cause decodeFrame to throw
      mockSocket.onmessage(new MessageEvent('message', { data: invalidFrame }));
      expect(consoleErrorSpy).toHaveBeenCalledWith('[NgGoRpcClient] Frame decoding error:', jasmine.any(Error));
    });
  });

  describe('Error and Close Handling', () => {
    beforeEach(() => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
    });

    it('should log WebSocket errors', () => {
      const consoleErrorSpy = spyOn(console, 'error');
      mockSocket.onerror(new Event('error'));
      expect(consoleErrorSpy).toHaveBeenCalledWith('[NgGoRpcClient] WebSocket error:', jasmine.any(Event));
    });

    it('should error out active streams on close', () => {
      const subject = { error: jasmine.createSpy('error') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).streamMap.set(1, subject);
      mockSocket.onclose(new CloseEvent('close'));
      expect(subject.error).toHaveBeenCalledWith(jasmine.objectContaining({
        code: 14, // GrpcStatus.UNAVAILABLE
        message: 'Connection lost'
      }));
    });
  });

  describe('Authentication', () => {
    it('should include auth token in headers', () => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      const token = 'test-auth-token';
      client.setAuthToken(token);

      client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3])).subscribe();

      const headersFrame = decodeFrame(sentMessages[0].buffer);
      const headersText = new TextDecoder().decode(headersFrame.payload);
      expect(headersText).toContain(`authorization: Bearer ${token}`);
    });
  });

  describe('PONG Watchdog', () => {
    it('should close socket when PONG timeout occurs', fakeAsync(() => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sendPing();
      expect(mockSocket.close).not.toHaveBeenCalled();
      tick(5000);
      expect(mockSocket.close).toHaveBeenCalledWith(4000, 'PONG timeout');
    }));

    it('should cancel watchdog timeout when PONG is received', fakeAsync(() => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sendPing();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).pongTimeoutId).not.toBeNull();

      const pongFrame = encodeFrame(0, FrameFlags.PONG, new Uint8Array(0));
      mockSocket.onmessage(new MessageEvent('message', { data: pongFrame.buffer }));

      tick(5000);
      expect(mockSocket.close).not.toHaveBeenCalled();
    }));
  });

  describe('Teardown Trigger', () => {
    it('should send RST_STREAM frame when Observable is unsubscribed', () => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).nextStreamId = 1;

      const observable = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
      const subscription = observable.subscribe();
      sentMessages.length = 0;
      subscription.unsubscribe();

      expect(sentMessages.length).toBeGreaterThanOrEqual(1);
      const rstFrame = sentMessages.find(msg => (decodeFrame(msg.buffer).flags & FrameFlags.RST_STREAM));
      expect(rstFrame).toBeDefined();
      if (rstFrame) {
        const frame = decodeFrame(rstFrame.buffer);
        expect(frame.streamId).toBe(1);
      }
    });
  });

  it('should not send RST_STREAM if WebSocket is already closed', () => {
    client.connect('ws://localhost:8080');
    mockSocket.onopen(new Event('open'));
    Object.defineProperty(mockSocket, 'readyState', { value: 3, writable: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).nextStreamId = 1;

    const observable = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    const subscription = observable.subscribe();
    sentMessages.length = 0;
    subscription.unsubscribe();

    const hasRstStream = sentMessages.some(msg => (decodeFrame(msg.buffer).flags & FrameFlags.RST_STREAM) !== 0);
    expect(hasRstStream).toBe(false);
  });

it('should send RST_STREAM with correct stream ID for multiple streams', () => {
    client.connect('ws://localhost:8080');
    mockSocket.onopen(new Event('open'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).nextStreamId = 1;

    const obs1 = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    const obs2 = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    const sub1 = obs1.subscribe();
    const sub2 = obs2.subscribe();
    sentMessages.length = 0;
    sub2.unsubscribe();

    const rstFrames = sentMessages.map(msg => decodeFrame(msg.buffer)).filter(frame => (frame.flags & FrameFlags.RST_STREAM) !== 0);
    expect(rstFrames.length).toBe(1);
    expect(rstFrames[0].streamId).toBe(3);
    sub1.unsubscribe();
  });

  it('should remove stream from map when unsubscribed', () => {
    client.connect('ws://localhost:8080');
    mockSocket.onopen(new Event('open'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).nextStreamId = 1;

    const observable = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    const subscription = observable.subscribe();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).streamMap.has(1)).toBe(true);
    subscription.unsubscribe();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any).streamMap.has(1)).toBe(false);
  });

  it('should throw error when stream ID is exhausted', () => {
    client.connect('ws://localhost:8080');
    mockSocket.onopen(new Event('open'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).nextStreamId = 4294967295;

    client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    expect(() => {
      client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
    }).toThrow(new Error('Stream ID exhaustion'));
    expect(mockSocket.close).toHaveBeenCalledWith(4000, jasmine.stringMatching('Stream ID exhaustion'));
  });

  describe('SSR Safety', () => {
    it('should skip connection when WebSocket is undefined (SSR)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).WebSocket = undefined;
      const consoleWarnSpy = spyOn(console, 'warn');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ssrClient = new NgGoRpcClient(new MockNgZone() as any, { enableLogging: true });
      ssrClient.connect('ws://localhost:8080');
      expect(consoleWarnSpy).toHaveBeenCalledWith(jasmine.stringMatching('WebSocket not available'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((ssrClient as any).socket).toBeNull();
    });
  });
});
