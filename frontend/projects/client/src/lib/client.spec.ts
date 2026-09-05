/**
 * Unit tests for NgGoRpcClient (client.ts)
 */

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
    jasmine.clock().install();
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
    jasmine.clock().uninstall();
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

    it('should not reconnect if reconnection is disabled', () => {
      client.connect('ws://localhost:8080', false);
      mockSocket.onopen(new Event('open')); // Simulate connection
      mockSocket.onclose(new CloseEvent('close'));
      jasmine.clock().tick(5000);
      // The initial call is expected, but no subsequent calls for reconnection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(1);
    });
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

    it('should emit Reconnecting then Disconnected when reconnection enabled and connection closes', () => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
      });

      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      jasmine.clock().tick(0);
      mockSocket.onclose(new CloseEvent('close'));
      jasmine.clock().tick(0);

      expect(states).toContain('Disconnected');
      expect(states).toContain('Connected');
      expect(states).toContain('Reconnecting');
    });

    it('should emit Disconnected without Reconnecting when reconnection disabled', () => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
      });

      client.connect('ws://localhost:8080', false);
      mockSocket.onopen(new Event('open'));
      jasmine.clock().tick(0);
      mockSocket.onclose(new CloseEvent('close'));
      jasmine.clock().tick(0);

      expect(states).toContain('Disconnected');
      expect(states).toContain('Connected');
      expect(states).not.toContain('Reconnecting');
    });
  });

  describe('Auto-Reconnection', () => {
    it('should attempt reconnection with exponential backoff', () => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const testClient = new NgGoRpcClient(mockNgZone, {
        baseReconnectDelay: 1000,
        maxReconnectDelay: 5000
      });

      testClient.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      mockSocket.onclose(new CloseEvent('close'));

      // First reconnection after 1s (2^0 * 1000ms)
      jasmine.clock().tick(999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(1);
      jasmine.clock().tick(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);

      // Simulate second failure
      mockSocket.onclose(new CloseEvent('close'));

      // Second reconnection after 2s (2^1 * 1000ms)
      jasmine.clock().tick(1999);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);
      jasmine.clock().tick(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(3);

      testClient.disconnect();
    });

    it('should cap reconnection delay at maxReconnectDelay', () => {
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
        jasmine.clock().tick(3000); // Wait max delay
      }

      // After 5 attempts, delay should be capped at 3000ms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callCount = (window as any).WebSocket.calls.count();
      expect(callCount).toBeGreaterThan(1);

      testClient.disconnect();
    });

    it('should reset reconnection attempt counter on successful connection', () => {
      const mockNgZone = new MockNgZone() as unknown as import('@angular/core').NgZone;
      const testClient = new NgGoRpcClient(mockNgZone, {
        baseReconnectDelay: 1000
      });

      testClient.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(0);

      mockSocket.onclose(new CloseEvent('close'));
      jasmine.clock().tick(1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(1);

      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((testClient as any).reconnectAttempt).toBe(0);

      testClient.disconnect();
    });

    it('should error out active streams with UNAVAILABLE when disconnected', () => {
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
      jasmine.clock().tick(0);

      expect(errorReceived).toBeDefined();
      // Check if it's a GrpcError with UNAVAILABLE status
      expect(errorReceived).toEqual(jasmine.objectContaining({
        code: 14, // GrpcStatus.UNAVAILABLE
        message: 'Connection lost'
      }));
    });
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

  describe('Client streaming (PROTOCOL.md 6.3)', () => {
    beforeEach(() => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      sentMessages.length = 0;
    });

    it('sends one DATA frame per message, EOS on the LAST one only', () => {
      const messages = [
        new Uint8Array([1]),
        new Uint8Array([2, 2]),
        new Uint8Array([3, 3, 3]),
      ];

      client.requestClientStream('test.Service', 'Upload', messages).subscribe();

      const frames = sentMessages.map((m) => decodeFrame(m.buffer));
      expect(frames.length).toBe(4); // HEADERS + 3 DATA
      expect(frames[0].flags & FrameFlags.HEADERS).toBeTruthy();
      expect(frames[0].flags & FrameFlags.EOS).toBeFalsy();

      const dataFrames = frames.slice(1);
      dataFrames.forEach((f, i) => {
        expect(f.flags & FrameFlags.DATA).withContext(`frame ${i} is DATA`).toBeTruthy();
        expect(Array.from(f.payload)).toEqual(Array.from(messages[i]));
        expect(f.streamId).toBe(frames[0].streamId);
      });

      // The half-close is the whole point: without EOS on the last frame the
      // server's RecvMsg loop never returns io.EOF and the upload hangs; with
      // EOS on an earlier frame the remaining chunks arrive after half-close.
      expect(dataFrames[0].flags & FrameFlags.EOS).toBeFalsy();
      expect(dataFrames[1].flags & FrameFlags.EOS).toBeFalsy();
      expect(dataFrames[2].flags & FrameFlags.EOS).toBeTruthy();
    });

    it('rejects an empty message list instead of sending a frameless stream', (done) => {
      client.requestClientStream('test.Service', 'Upload', []).subscribe({
        next: () => done.fail('expected an error, got a response'),
        error: (err: Error) => {
          expect(err.message).toContain('at least one message');
          expect(sentMessages.length).toBe(0);
          done();
        },
      });
    });

    it('NEGATIVE CONTROL: request() still emits exactly one DATA|EOS frame', () => {
      // If this ever reads as several frames, the unary path has been dragged
      // into the streaming one and every existing caller changed behaviour.
      client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3])).subscribe();

      const frames = sentMessages.map((m) => decodeFrame(m.buffer));
      expect(frames.length).toBe(2);
      expect(frames[0].flags & FrameFlags.HEADERS).toBeTruthy();
      expect(frames[1].flags & FrameFlags.DATA).toBeTruthy();
      expect(frames[1].flags & FrameFlags.EOS).toBeTruthy();
    });
  });

  describe('PONG Watchdog', () => {
    it('should close socket when PONG timeout occurs', () => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sendPing();
      expect(mockSocket.close).not.toHaveBeenCalled();
      jasmine.clock().tick(5000);
      expect(mockSocket.close).toHaveBeenCalledWith(4000, 'PONG timeout');
    });

    it('should cancel watchdog timeout when PONG is received', () => {
      client.connect('ws://localhost:8080');
      mockSocket.onopen(new Event('open'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).sendPing();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).pongTimeoutId).not.toBeNull();

      const pongFrame = encodeFrame(0, FrameFlags.PONG, new Uint8Array(0));
      mockSocket.onmessage(new MessageEvent('message', { data: pongFrame.buffer }));

      jasmine.clock().tick(5000);
      expect(mockSocket.close).not.toHaveBeenCalled();
    });
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

  describe('Logging', () => {
    it('should log messages and truncate long strings when logging is enabled', () => {
      const consoleLogSpy = spyOn(console, 'log');
      // Re-create client with logging enabled
      const loggingClient = new NgGoRpcClient(new MockNgZone() as unknown as import('@angular/core').NgZone, { enableLogging: true });

      // Mock socket for loggingClient
      const mockSock = {
        readyState: 1,
        send: jasmine.createSpy('send'),
        close: jasmine.createSpy('close'),
        addEventListener: jasmine.createSpy('addEventListener'),
        removeEventListener: jasmine.createSpy('removeEventListener'),
        onopen: null as ((ev: Event) => void) | null,
        onclose: null as ((ev: CloseEvent) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
        onmessage: null as ((ev: MessageEvent) => void) | null,
      };

      // Override WebSocket on window
      (window as unknown as { WebSocket: unknown }).WebSocket = jasmine.createSpy('WebSocket').and.returnValue(mockSock);
      (window as unknown as { WebSocket: { OPEN: number } }).WebSocket.OPEN = 1;

      loggingClient.connect('ws://localhost:8080');
      mockSock.onopen!(new Event('open'));

      const longMethodName = 'VeryLongMethodNameThatExceedsTwentyCharacters';
      loggingClient.request('test.Service', longMethodName, new Uint8Array([1])).subscribe();

      expect(consoleLogSpy).toHaveBeenCalled();
      const calls = consoleLogSpy.calls.allArgs().flat();
      // Check if any log contains truncated string
      // The log format is: [NgGoRpcClient] Sending HEADERS for stream 1: /test.Service/VeryLongMethodName... (size: ...)
      const expectedTruncated = '... (size:';
      const found = calls.some((arg: unknown) => typeof arg === 'string' && arg.includes(expectedTruncated));
      expect(found).toBe(true);
    });
  });

  describe('Reconnect', () => {
    it('should gracefully reconnect when reconnect() is called', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      expect(client.isConnected()).toBe(true);

      client.reconnect();

      // Should have closed the old socket cleanly
      expect(mockSocket.close).toHaveBeenCalledWith(1000, 'Reconnecting with new credentials');

      // Should have attempted a new connection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('should reset reconnect attempt counter on reconnect()', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      // Simulate a few failures to bump the counter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).reconnectAttempt = 5;

      client.reconnect();

      // Should be reset to 0 (intentional reconnect, not failure)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).reconnectAttempt).toBe(0);
    });

    it('should emit Reconnecting state during reconnect', () => {
      const states: string[] = [];
      client.connectionState$.subscribe(state => {
        states.push(state);
      });

      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));
      states.length = 0; // Reset to only capture reconnect states

      client.reconnect();

      expect(states).toContain('Reconnecting');
    });

    it('should error out active streams on reconnect()', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      let errorReceived: unknown = null;
      const obs = client.request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]));
      obs.subscribe({
        error: (err) => {
          errorReceived = err;
        }
      });

      client.reconnect();

      expect(errorReceived).toBeDefined();
      expect(errorReceived).toEqual(jasmine.objectContaining({
        code: 14, // GrpcStatus.UNAVAILABLE
        message: 'Connection lost'
      }));
    });

    it('should be a no-op when not connected (no URL)', () => {
      // Client has no URL set, reconnect should not throw
      client.reconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).not.toHaveBeenCalled();
    });

    it('should preserve reconnection-enabled flag after reconnect', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      client.reconnect();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).reconnectionEnabled).toBe(true);
    });
  });

  describe('setAuthToken with reconnect option', () => {
    it('should trigger reconnect when token changes and reconnect is true', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      client.setAuthToken('old-token');
      client.setAuthToken('new-token', { reconnect: true });

      // Should have closed and reconnected
      expect(mockSocket.close).toHaveBeenCalledWith(1000, 'Reconnecting with new credentials');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('should NOT reconnect when token is the same even with reconnect: true', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      client.setAuthToken('same-token');
      client.setAuthToken('same-token', { reconnect: true });

      // Should NOT have closed or reconnected
      expect(mockSocket.close).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).toHaveBeenCalledTimes(1);
    });

    it('should NOT reconnect when reconnect option is false', () => {
      client.connect('ws://localhost:8080', true);
      mockSocket.onopen(new Event('open'));

      client.setAuthToken('old-token');
      client.setAuthToken('new-token', { reconnect: false });

      // Should NOT have closed or reconnected
      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should NOT reconnect when not connected', () => {
      // Not connecting first
      client.setAuthToken('token1');
      client.setAuthToken('token2', { reconnect: true });

      // No reconnect because not connected
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((window as any).WebSocket).not.toHaveBeenCalled();
    });

    it('should still update the token even without reconnect', () => {
      client.setAuthToken('new-token');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any).authToken).toBe('new-token');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LERNJ-759 — outbound requests must be gated on the LIVE socket.readyState and
  // QUEUED (then flushed on open) instead of calling socket.send() into a socket
  // that is CONNECTING / reconnecting / stale-CLOSING. Calling send() on a
  // non-OPEN socket throws a synchronous DOMException ("request cannot be
  // completed in the current state"), which silently dropped the first write on a
  // freshly-loaded / hard-refreshed page.
  // ───────────────────────────────────────────────────────────────────────────
  describe('LERNJ-759 — queue outbound requests until the socket is OPEN', () => {
    let qClient: NgGoRpcClient;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let createdSockets: any[];

    function installSocketFactory(): void {
      createdSockets = [];
      // A plain constructor function (NOT a spy) so `new WebSocket(url)` yields a
      // fresh, distinct mock socket each time (the reconnect test needs two).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function FakeWebSocket(this: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s: any = {
          readyState: 0, // CONNECTING — like a real freshly-constructed socket
          sentFrames: [] as Uint8Array[],
          onopen: null as ((e: Event) => void) | null,
          onclose: null as ((e: CloseEvent) => void) | null,
          onerror: null as ((e: Event) => void) | null,
          onmessage: null as ((e: MessageEvent) => void) | null,
          close: jasmine.createSpy('close'),
          send: jasmine.createSpy('send'),
        };
        s.send.and.callFake((d: Uint8Array) => {
          // Faithful to the browser contract: send() on a non-OPEN socket throws.
          if (s.readyState !== 1) {
            throw new DOMException(
              'request cannot be completed in the current state',
              'InvalidStateError',
            );
          }
          s.sentFrames.push(new Uint8Array(d));
        });
        createdSockets.push(s);
        return s; // returning an object from a constructor makes `new` yield it
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (FakeWebSocket as any).OPEN = 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).WebSocket = FakeWebSocket;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function openSocket(s: any): void {
      s.readyState = 1; // OPEN
      s.onopen(new Event('open'));
    }

    beforeEach(() => {
      installSocketFactory();
      qClient = new NgGoRpcClient(new MockNgZone() as unknown as import('@angular/core').NgZone);
    });

    afterEach(() => {
      qClient.disconnect();
    });

    it('queues a request issued before the socket opens and flushes it on open', () => {
      qClient.connect('ws://localhost:8080', true);
      const sock = createdSockets[0];
      expect(sock.readyState).toBe(0); // CONNECTING

      const sub = qClient
        .request('test.Service', 'TestMethod', new Uint8Array([1, 2, 3]))
        .subscribe();

      // Nothing sent yet; the request sits in the queue, NOT the active stream map.
      expect(sock.send).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).streamMap.size).toBe(0);

      // Socket opens → queued request flushes (HEADERS + DATA).
      openSocket(sock);
      expect(sock.send).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).streamMap.size).toBe(1);

      sub.unsubscribe();
    });

    it('does NOT throw when a request is issued while the socket is stale (CLOSING before onclose)', () => {
      qClient.connect('ws://localhost:8080', true);
      const sock = createdSockets[0];
      openSocket(sock);
      expect(qClient.isConnected()).toBe(true);

      // The socket silently moves to CLOSING (server close / pong timeout / drop)
      // but onclose has NOT fired yet — `connected` still reports true. A write here
      // used to call send() on a non-OPEN socket and throw the DOMException.
      sock.readyState = 2; // CLOSING

      let errored: unknown = null;
      expect(() => {
        qClient
          .request('test.Service', 'TestMethod', new Uint8Array([9]))
          .subscribe({ error: (e) => (errored = e) });
      }).not.toThrow();

      // Buffered, not sent, not errored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(1);
      expect(errored).toBeNull();
    });

    it('flushes a request buffered during a reconnect once the new socket opens', () => {
      qClient.connect('ws://localhost:8080', true);
      const first = createdSockets[0];
      openSocket(first);

      // Connection drops → onclose nulls the socket and schedules a reconnect.
      first.readyState = 3; // CLOSED
      first.onclose(new CloseEvent('close'));

      // A write issued during the Reconnecting window must NOT throw — it queues.
      let errored: unknown = null;
      expect(() => {
        qClient
          .request('test.Service', 'AfterDrop', new Uint8Array([7]))
          .subscribe({ error: (e) => (errored = e) });
      }).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(1);

      // Reconnect timer fires → a fresh socket is created.
      jasmine.clock().tick(5000);
      expect(createdSockets.length).toBe(2);
      const second = createdSockets[1];

      // New socket opens → the buffered request flushes onto it (HEADERS + DATA).
      openSocket(second);
      expect(second.send).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(0);
      expect(errored).toBeNull();
    });

    it('fails still-queued requests with UNAVAILABLE on disconnect()', () => {
      qClient.connect('ws://localhost:8080', true);
      // Socket stays CONNECTING (never opens).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let errored: any = null;
      qClient
        .request('test.Service', 'NeverOpens', new Uint8Array([1]))
        .subscribe({ error: (e) => (errored = e) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(1);

      qClient.disconnect();

      expect(errored).toEqual(jasmine.objectContaining({ code: 14 })); // UNAVAILABLE
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((qClient as any).pendingRequests.length).toBe(0);
    });
  });

  /**
   * config.subprotocols — the WebSocket subprotocol seam.
   *
   * The consumer that needs this offers ['lernja.v1', 'lernja.sid.<session-id>']:
   * a constant the server selects back, plus a short-lived credential the server
   * reads out of the OFFER. So the two properties under test are (a) the offer is
   * recomputed on every attempt, because the session id rotates and a reconnect
   * must not replay a stale one, and (b) the values never reach a log.
   */
  describe('WebSocket subprotocols (config.subprotocols)', () => {
    const CONSTANT = 'lernja.v1';
    const sidFor = (n: number) => `lernja.sid.session-${n}`;

    interface FakeSocket {
      readyState: number;
      protocol: string;
      onopen: ((e: Event) => void) | null;
      onclose: ((e: CloseEvent) => void) | null;
      onerror: ((e: Event) => void) | null;
      onmessage: ((e: MessageEvent) => void) | null;
      close: jasmine.Spy;
      send: jasmine.Spy;
    }

    /** Every socket the client constructed, with the ARGUMENTS it was given. */
    let created: { socket: FakeSocket; args: unknown[] }[];
    let spClient: NgGoRpcClient | null;

    function zone(): import('@angular/core').NgZone {
      return new MockNgZone() as unknown as import('@angular/core').NgZone;
    }

    beforeEach(() => {
      created = [];
      spClient = null;
      // A plain constructor function (NOT a spy) so each `new WebSocket(...)`
      // yields a distinct mock, and so the ARGUMENT LIST is captured verbatim —
      // arity is the thing under test for the anonymous path.
      function FakeWebSocket(...args: unknown[]) {
        const s: FakeSocket = {
          readyState: 0, // CONNECTING, like a real freshly-constructed socket
          protocol: '', // what a socket reports until the server selects one
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          close: jasmine.createSpy('close'),
          send: jasmine.createSpy('send'),
        };
        // Faithful to the browser: close() DOES deliver a close event to whatever
        // handler is still attached. Without this the "no retry storm" assertion
        // below would pass on a mock that can never schedule a retry in the first
        // place — a control that evaluates nothing.
        s.close.and.callFake(() => {
          s.readyState = 3; // CLOSED
          if (s.onclose) {
            s.onclose(new CloseEvent('close'));
          }
        });
        s.send.and.callFake(() => {
          if (s.readyState !== 1) {
            throw new DOMException('request cannot be completed in the current state', 'InvalidStateError');
          }
        });
        created.push({ socket: s, args });
        return s; // returning an object from a constructor makes `new` yield it
      }
      (FakeWebSocket as unknown as { OPEN: number }).OPEN = 1;
      (window as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    });

    afterEach(() => {
      if (spClient) {
        spClient.disconnect();
      }
    });

    /** Completes the handshake, with `selected` as the server's chosen subprotocol. */
    function openSocket(s: FakeSocket, selected: string): void {
      s.readyState = 1; // OPEN
      s.protocol = selected;
      s.onopen!(new Event('open'));
    }

    function loggedText(...spies: jasmine.Spy[]): string {
      return spies
        .flatMap((spy) => spy.calls.allArgs().flat())
        .map((arg) => {
          if (typeof arg === 'string') {
            return arg;
          }
          try {
            return JSON.stringify(arg) ?? String(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');
    }

    it('offers the callback result as the WebSocket subprotocols', () => {
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [CONSTANT, sidFor(1)] });
      spClient.connect('ws://localhost:8080', true);

      expect(created.length).toBe(1);
      expect(created[0].args).toEqual(['ws://localhost:8080', [CONSTANT, sidFor(1)]]);
    });

    it('re-evaluates the callback on EVERY attempt, so a reconnect offers the CURRENT session id', () => {
      let calls = 0;
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [CONSTANT, sidFor(++calls)] });
      spClient.connect('ws://localhost:8080', true);
      openSocket(created[0].socket, CONSTANT);
      expect(created[0].args[1]).toEqual([CONSTANT, sidFor(1)]);

      // The session rotates and the connection drops.
      created[0].socket.readyState = 3; // CLOSED
      created[0].socket.onclose!(new CloseEvent('close'));
      jasmine.clock().tick(5000);

      // The reconnect must offer sidFor(2). Hoisting the evaluation into connect()
      // — the tempting "compute it once" refactor — leaves sidFor(1) here, which is
      // a credential the server has already retired.
      expect(created.length).toBe(2);
      expect(created[1].args[1]).toEqual([CONSTANT, sidFor(2)]);
      expect(calls).toBe(2);
    });

    it('passes NO protocols argument when the option is absent (legacy call, unchanged)', () => {
      spClient = new NgGoRpcClient(zone());
      spClient.connect('ws://localhost:8080', true);

      expect(created[0].args.length).toBe(1);
      expect(created[0].args).toEqual(['ws://localhost:8080']);
    });

    it('passes NO protocols argument when the callback returns null', () => {
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => null });
      spClient.connect('ws://localhost:8080', true);

      expect(created[0].args.length).toBe(1);
    });

    it('passes NO protocols argument when the callback returns an empty array', () => {
      // `new WebSocket(url, [])` is not universally the same call as
      // `new WebSocket(url)`, so [] must be normalised away, not forwarded.
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [] });
      spClient.connect('ws://localhost:8080', true);

      expect(created[0].args.length).toBe(1);
    });

    it('never logs the offered values, even with enableLogging on', () => {
      const sid = sidFor(42);
      const logSpy = spyOn(console, 'log');
      const warnSpy = spyOn(console, 'warn');
      const errorSpy = spyOn(console, 'error');

      spClient = new NgGoRpcClient(zone(), { enableLogging: true, subprotocols: () => [CONSTANT, sid] });
      spClient.connect('ws://localhost:8080', true);
      openSocket(created[0].socket, CONSTANT);
      spClient.request('test.Service', 'TestMethod', new Uint8Array([1])).subscribe();

      // Calibration, both halves: the credential really WAS offered on this
      // connection (so the search string is not a straw man), and logging really
      // did run (so an empty haystack cannot pass this test).
      expect(created[0].args[1]).toEqual([CONSTANT, sid]);
      const text = loggedText(logSpy, warnSpy, errorSpy);
      expect(text).toContain('[NgGoRpcClient]');
      expect(text).not.toContain(sid);
      expect(text).not.toContain('lernja.sid.');
    });

    it('treats a server that selected NO subprotocol as a fatal connection failure', () => {
      const errorSpy = spyOn(console, 'error');
      const sid = sidFor(7);
      const states: string[] = [];

      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [CONSTANT, sid] });
      spClient.connectionState$.subscribe((state) => states.push(state));
      spClient.connect('ws://localhost:8080', true);

      // A request issued before the socket opened is queued; it must be failed,
      // not left waiting for a socket that will now never open.
      let errored: unknown = null;
      spClient.request('test.Service', 'Blocked', new Uint8Array([1])).subscribe({
        error: (e) => (errored = e),
      });

      // The handshake SUCCEEDS while the server selects nothing.
      openSocket(created[0].socket, '');

      expect(spClient.isConnected()).toBe(false);
      expect(states).not.toContain('Connected');
      expect(states[states.length - 1]).toBe('Disconnected');
      expect(states).not.toContain('Reconnecting');
      expect(created[0].socket.close).toHaveBeenCalledWith(4001, 'subprotocol not selected');
      expect(errored).toEqual(jasmine.objectContaining({ code: 14 })); // UNAVAILABLE

      // Fatal, not a retry storm: no further socket, ever. The mock's close()
      // really does deliver the close event, so a client that still wanted to
      // reconnect would have scheduled one here.
      jasmine.clock().tick(300000);
      expect(created.length).toBe(1);

      // Both mechanisms that produce that, asserted directly — each alone is
      // enough, so neither is observable by outcome while the other stands.
      expect(created[0].socket.onclose).toBeNull(); // detached before close()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((spClient as any).reconnectionEnabled).toBe(false);

      // The diagnosis names the condition and carries no credential.
      const text = loggedText(errorSpy);
      expect(text).toContain('server selected no subprotocol');
      expect(text).not.toContain(sid);
    });

    it('fails the connection when the server selects a subprotocol that was not offered', () => {
      const errorSpy = spyOn(console, 'error');
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [CONSTANT, sidFor(8)] });
      spClient.connect('ws://localhost:8080', true);

      // A real browser fails this handshake itself, so this can only come from a
      // non-conforming stack — it must still never look Connected.
      openSocket(created[0].socket, 'something.else');

      expect(spClient.isConnected()).toBe(false);
      expect(created[0].socket.close).toHaveBeenCalledWith(4001, 'subprotocol not selected');
      const text = loggedText(errorSpy);
      expect(text).toContain('not offered');
      expect(text).not.toContain('something.else'); // the selection is not echoed either
    });

    it('connects normally when the server selects one of the offered subprotocols', () => {
      spClient = new NgGoRpcClient(zone(), { subprotocols: () => [CONSTANT, sidFor(3)] });
      spClient.connect('ws://localhost:8080', true);
      openSocket(created[0].socket, CONSTANT);

      expect(spClient.isConnected()).toBe(true);
      expect(created[0].socket.close).not.toHaveBeenCalled();
    });

    it('does NOT check socket.protocol when nothing was offered', () => {
      // Negative control for the new check: protocol '' is exactly the value that
      // is fatal when offering, and it must be inert on the anonymous path — which
      // is what nearly every consumer of this library uses.
      spClient = new NgGoRpcClient(zone());
      spClient.connect('ws://localhost:8080', true);
      openSocket(created[0].socket, '');

      expect(spClient.isConnected()).toBe(true);
      expect(created[0].socket.close).not.toHaveBeenCalled();
    });

    it('fails the connection instead of wedging when the callback throws', () => {
      const errorSpy = spyOn(console, 'error');
      const states: string[] = [];
      spClient = new NgGoRpcClient(zone(), {
        subprotocols: () => {
          throw new Error('session store unavailable');
        },
      });
      spClient.connectionState$.subscribe((state) => states.push(state));

      // Queued BEFORE the attempt, so the failure has something to fail: after a
      // fatal failure there is no socket, and a later request would simply queue.
      let errored: unknown = null;
      spClient.request('test.Service', 'Blocked', new Uint8Array([1])).subscribe({
        error: (e) => (errored = e),
      });
      expect(() => spClient!.connect('ws://localhost:8080', true)).not.toThrow();

      expect(created.length).toBe(0); // no socket was constructed
      jasmine.clock().tick(300000);
      expect(created.length).toBe(0); // and none ever is
      expect(states).not.toContain('Reconnecting');
      expect(errored).toEqual(jasmine.objectContaining({ code: 14 })); // UNAVAILABLE

      const text = loggedText(errorSpy);
      expect(text).toContain('subprotocols callback threw');
      // The thrown value is consumer data and may quote the credential.
      expect(text).not.toContain('session store unavailable');
    });
  });
});
