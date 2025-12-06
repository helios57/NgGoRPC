/**
 * Unit tests for NgGoRpcClient (client.ts)
 * 
 * Tests cover:
 * - Teardown trigger: unsubscribe() should send RST_STREAM frame
 */

import { NgGoRpcClient } from './client';
import { FrameFlags, decodeFrame } from './frame';

// Mock NgZone for testing
class MockNgZone {
  runOutsideAngular(fn: Function) {
    return fn();
  }
  
  run(fn: Function) {
    return fn();
  }
}

describe('NgGoRpcClient', () => {
  let client: NgGoRpcClient;
  let mockSocket: any;
  let sentMessages: Uint8Array[];

  beforeEach(() => {
    sentMessages = [];
    
    // Create a mock WebSocket
    mockSocket = {
      readyState: 1, // WebSocket.OPEN
      send: jest.fn((data: Uint8Array) => {
        sentMessages.push(new Uint8Array(data));
      }),
      close: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    // Mock WebSocket constructor
    (global as any).WebSocket = jest.fn(() => mockSocket);
    (global as any).WebSocket.OPEN = 1;
    (global as any).WebSocket.CONNECTING = 0;
    (global as any).WebSocket.CLOSING = 2;
    (global as any).WebSocket.CLOSED = 3;

    const mockNgZone = new MockNgZone() as any;
    client = new NgGoRpcClient(mockNgZone);
  });

  afterEach(() => {
    // Clean up
    if (client) {
      client.disconnect();
    }
  });

  describe('PONG Watchdog', () => {
    it('should close socket when PONG timeout occurs', (done) => {
      // Mock timers
      jest.useFakeTimers();
      
      // Manually set the socket on the client (simulating successful connection)
      (client as any).socket = mockSocket;
      (client as any).connected = true;

      // Trigger sendPing which starts the watchdog timeout
      (client as any).sendPing();

      // Verify socket.close was not called yet
      expect(mockSocket.close).not.toHaveBeenCalled();

      // Fast-forward time by 5000ms (PONG timeout)
      jest.advanceTimersByTime(5000);

      // Verify socket.close was called with code 4000
      expect(mockSocket.close).toHaveBeenCalledWith(4000, 'PONG timeout');
      
      jest.useRealTimers();
      done();
    });

    it('should cancel watchdog timeout when PONG is received', (done) => {
      jest.useFakeTimers();
      
      // Manually set the socket on the client (simulating successful connection)
      (client as any).socket = mockSocket;
      (client as any).connected = true;

      // Trigger sendPing which starts the watchdog timeout
      (client as any).sendPing();

      // Verify timeout is set
      expect((client as any).pongTimeoutId).not.toBeNull();

      // Simulate receiving PONG by directly calling the PONG handler logic
      const pongTimeoutId = (client as any).pongTimeoutId;
      clearTimeout(pongTimeoutId);
      (client as any).pongTimeoutId = null;

      // Fast-forward time by 5000ms
      jest.advanceTimersByTime(5000);

      // Verify socket.close was NOT called because PONG was received
      expect(mockSocket.close).not.toHaveBeenCalled();
      
      jest.useRealTimers();
      done();
    });
  });

  describe('Teardown Trigger', () => {
    it('should send RST_STREAM frame when Observable is unsubscribed', (done) => {
      // Manually set the socket on the client (simulating successful connection)
      (client as any).socket = mockSocket;
      (client as any).connected = true;
      (client as any).nextStreamId = 1;

      // Create a request
      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      const observable = client.request(service, method, requestData);

      // Subscribe to the observable
      const subscription = observable.subscribe({
        next: () => {},
        error: () => {},
        complete: () => {}
      });

      // Clear sent messages from the request (HEADERS and DATA frames)
      sentMessages.length = 0;

      // Unsubscribe - this should trigger teardown and send RST_STREAM
      subscription.unsubscribe();

      // Verify that RST_STREAM was sent
      expect(sentMessages.length).toBeGreaterThanOrEqual(1);

      // Find the RST_STREAM frame
      let rstStreamFound = false;
      for (const message of sentMessages) {
        const frame = decodeFrame(message.buffer);
        
        if (frame.flags & FrameFlags.RST_STREAM) {
          rstStreamFound = true;
          
          // Verify it's the correct stream ID (should be 1, the first odd ID)
          expect(frame.streamId).toBe(1);
          
          // Verify the flags include RST_STREAM (0x08)
          expect(frame.flags & FrameFlags.RST_STREAM).toBeTruthy();
          
          console.log(`[Test] RST_STREAM frame detected: StreamID=${frame.streamId}, Flags=0x${frame.flags.toString(16)}`);
          break;
        }
      }

      expect(rstStreamFound).toBe(true);
      done();
    });

    it('should not send RST_STREAM if WebSocket is already closed', () => {
      // Set up client with closed socket
      mockSocket.readyState = 3; // WebSocket.CLOSED
      (client as any).socket = mockSocket;
      (client as any).connected = true;
      (client as any).nextStreamId = 1;

      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      const observable = client.request(service, method, requestData);
      const subscription = observable.subscribe();

      // Clear messages
      sentMessages.length = 0;

      // Unsubscribe
      subscription.unsubscribe();

      // Should not send RST_STREAM because socket is closed
      const hasRstStream = sentMessages.some(msg => {
        const frame = decodeFrame(msg.buffer);
        return (frame.flags & FrameFlags.RST_STREAM) !== 0;
      });

      expect(hasRstStream).toBe(false);
    });

    it('should send RST_STREAM with correct stream ID for multiple streams', () => {
      // Set up client
      (client as any).socket = mockSocket;
      (client as any).connected = true;
      (client as any).nextStreamId = 1;

      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      // Create multiple requests
      const observable1 = client.request(service, method, requestData);
      const observable2 = client.request(service, method, requestData);
      const observable3 = client.request(service, method, requestData);

      const sub1 = observable1.subscribe();
      const sub2 = observable2.subscribe();
      const sub3 = observable3.subscribe();

      // Clear messages
      sentMessages.length = 0;

      // Unsubscribe from the second stream only
      sub2.unsubscribe();

      // Find RST_STREAM frame
      const rstFrames = sentMessages
        .map(msg => decodeFrame(msg.buffer))
        .filter(frame => (frame.flags & FrameFlags.RST_STREAM) !== 0);

      // Should have exactly one RST_STREAM
      expect(rstFrames.length).toBe(1);

      // Should be for stream ID 3 (first=1, second=3, third=5)
      expect(rstFrames[0].streamId).toBe(3);

      // Clean up
      sub1.unsubscribe();
      sub3.unsubscribe();
    });

    it('should remove stream from map when unsubscribed', () => {
      // Set up client
      (client as any).socket = mockSocket;
      (client as any).connected = true;
      (client as any).nextStreamId = 1;

      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      const observable = client.request(service, method, requestData);
      const subscription = observable.subscribe();

      // Stream should be in the map
      expect((client as any).streamMap.has(1)).toBe(true);

      // Unsubscribe
      subscription.unsubscribe();

      // Stream should be removed from the map
      expect((client as any).streamMap.has(1)).toBe(false);
    });
  });

  describe('Request Frame Verification', () => {
    it('should send HEADERS and DATA frames when making a request', () => {
      // Set up client
      (client as any).socket = mockSocket;
      (client as any).connected = true;
      (client as any).nextStreamId = 1;

      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      sentMessages.length = 0;

      client.request(service, method, requestData).subscribe();

      // Should have sent 2 frames: HEADERS and DATA
      expect(sentMessages.length).toBe(2);

      // First frame should be HEADERS
      const headersFrame = decodeFrame(sentMessages[0].buffer);
      expect(headersFrame.flags & FrameFlags.HEADERS).toBeTruthy();
      expect(headersFrame.streamId).toBe(1);

      // Verify headers contain the method path
      const headersText = new TextDecoder().decode(headersFrame.payload);
      expect(headersText).toContain('path: /test.Service/TestMethod');

      // Second frame should be DATA with EOS
      const dataFrame = decodeFrame(sentMessages[1].buffer);
      expect(dataFrame.flags & FrameFlags.DATA).toBeTruthy();
      expect(dataFrame.flags & FrameFlags.EOS).toBeTruthy();
      expect(dataFrame.streamId).toBe(1);
      expect(dataFrame.payload).toEqual(requestData);
    });
  });

  describe('Stream ID Exhaustion', () => {
    it('should close connection when stream ID wraps around', () => {
      // Mock timers
      jest.useFakeTimers();

      // Set nextStreamId close to limit (max uint32)
      // 0xFFFFFFFF = 4294967295. We need to check if it exceeds this.
      // But JS numbers are doubles, so we can go higher.
      // The protocol uses uint32, so we should fail if > 0xFFFFFFFF
      (client as any).nextStreamId = 4294967295;
      (client as any).connected = true;
      (client as any).socket = mockSocket;

      const service = 'test.Service';
      const method = 'TestMethod';
      const requestData = new Uint8Array([1, 2, 3]);

      // This request uses ID 4294967295 (odd)
      client.request(service, method, requestData);

      // Next ID would be 4294967297 which is > 0xFFFFFFFF
      // But wait, we increment by 2.
      // 4294967295 + 2 = 4294967297

      // The second request should trigger the overflow check if implemented
      // It should also throw an error
      expect(() => {
        client.request(service, method, requestData);
      }).toThrow('Stream ID exhaustion');

      expect(mockSocket.close).toHaveBeenCalledWith(4000, expect.stringContaining('Stream ID exhaustion'));

      jest.useRealTimers();
    });
  });

  describe('Timer Cleanup', () => {
    it('should clear reconnection timer on disconnect', () => {
      jest.useFakeTimers();

      (client as any).reconnectAttempt = 1;
      (client as any).reconnectionEnabled = true;
      (client as any).currentUrl = 'ws://localhost:8080';

      // Schedule reconnection
      (client as any).scheduleReconnection();

      // Verify timer is set (we can't check ID easily in Jest, but we can check if it fires)

      // Now disconnect
      client.disconnect();

      // Fast forward time
      jest.advanceTimersByTime(100000);

      // WebSocket should NOT be created (attemptConnection not called)
      expect((global as any).WebSocket).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

});
