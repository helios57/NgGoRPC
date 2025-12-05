/**
 * Unit tests for Frame codec (frame.ts)
 * 
 * Tests cover:
 * - Round-trip encoding/decoding
 * - Boundary checks for incomplete headers and payloads
 * - Zero-length payloads
 */

import { encodeFrame, decodeFrame, FrameFlags } from './frame';

describe('Frame Codec', () => {
  describe('Round-trip Test', () => {
    it('should encode and decode a frame without data loss', () => {
      const streamId = 42;
      const flags = FrameFlags.DATA;
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      // Encode
      const encoded = encodeFrame(streamId, flags, payload);

      // Decode
      const decoded = decodeFrame(encoded.buffer);

      // Verify
      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload).toEqual(payload);
    });

    it('should handle round-trip with zero-length payload', () => {
      const streamId = 100;
      const flags = FrameFlags.HEADERS;
      const payload = new Uint8Array(0);

      // Encode
      const encoded = encodeFrame(streamId, flags, payload);

      // Decode
      const decoded = decodeFrame(encoded.buffer);

      // Verify
      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload.length).toBe(0);
    });

    it('should handle round-trip with large payload', () => {
      const streamId = 999;
      const flags = FrameFlags.DATA | FrameFlags.EOS;
      const payload = new Uint8Array(1024);
      // Fill with test data
      for (let i = 0; i < payload.length; i++) {
        payload[i] = i % 256;
      }

      // Encode
      const encoded = encodeFrame(streamId, flags, payload);

      // Decode
      const decoded = decodeFrame(encoded.buffer);

      // Verify
      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload).toEqual(payload);
    });
  });

  describe('Boundary Check', () => {
    it('should throw error for incomplete header (< 9 bytes)', () => {
      // Create buffer with only 8 bytes (1 byte short of header)
      const incompleteHeader = new Uint8Array(8);

      expect(() => {
        decodeFrame(incompleteHeader.buffer);
      }).toThrow('Frame too small: expected at least 9 bytes, got 8');
    });

    it('should throw error for empty buffer', () => {
      const emptyBuffer = new Uint8Array(0);

      expect(() => {
        decodeFrame(emptyBuffer.buffer);
      }).toThrow('Frame too small: expected at least 9 bytes, got 0');
    });

    it('should throw error when payload length is less than specified in header', () => {
      // Create a frame that declares a 10-byte payload but only has 5 bytes
      const buffer = new Uint8Array(14); // 9 (header) + 5 (partial payload)
      const view = new DataView(buffer.buffer);

      // Set flags
      view.setUint8(0, FrameFlags.DATA);
      // Set stream ID
      view.setUint32(1, 123, false);
      // Set length to 10 (but we only provide 5)
      view.setUint32(5, 10, false);

      expect(() => {
        decodeFrame(buffer.buffer);
      }).toThrow('Incomplete frame: header specifies 10 bytes payload, but only 5 bytes available');
    });

    it('should accept valid frame with zero-length payload', () => {
      // Create a frame with 0-length payload (valid)
      const buffer = new Uint8Array(9); // Only header, no payload
      const view = new DataView(buffer.buffer);

      // Set flags
      view.setUint8(0, FrameFlags.EOS);
      // Set stream ID
      view.setUint32(1, 456, false);
      // Set length to 0
      view.setUint32(5, 0, false);

      const decoded = decodeFrame(buffer.buffer);

      expect(decoded.streamId).toBe(456);
      expect(decoded.flags).toBe(FrameFlags.EOS);
      expect(decoded.payload.length).toBe(0);
    });

    it('should accept frame with exact payload length as specified', () => {
      const streamId = 789;
      const flags = FrameFlags.DATA;
      const payload = new Uint8Array([0xAA, 0xBB, 0xCC]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload).toEqual(payload);
    });
  });

  describe('Flag Combinations', () => {
    it('should handle single flag correctly', () => {
      const streamId = 1;
      const flags = FrameFlags.DATA;
      const payload = new Uint8Array([1]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.flags).toBe(FrameFlags.DATA);
    });

    it('should handle multiple flags (DATA | EOS)', () => {
      const streamId = 2;
      const flags = FrameFlags.DATA | FrameFlags.EOS;
      const payload = new Uint8Array([2]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.flags).toBe(FrameFlags.DATA | FrameFlags.EOS);
      expect(decoded.flags & FrameFlags.DATA).toBeTruthy();
      expect(decoded.flags & FrameFlags.EOS).toBeTruthy();
    });

    it('should handle HEADERS | DATA combination', () => {
      const streamId = 3;
      const flags = FrameFlags.HEADERS | FrameFlags.DATA;
      const payload = new Uint8Array([3]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.flags).toBe(FrameFlags.HEADERS | FrameFlags.DATA);
      expect(decoded.flags & FrameFlags.HEADERS).toBeTruthy();
      expect(decoded.flags & FrameFlags.DATA).toBeTruthy();
    });
  });

  describe('Stream ID Handling', () => {
    it('should handle stream ID 0 (control frames)', () => {
      const streamId = 0;
      const flags = FrameFlags.PING;
      const payload = new Uint8Array(0);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(0);
    });

    it('should handle large stream IDs', () => {
      const streamId = 0xFFFFFFFF; // Max uint32
      const flags = FrameFlags.DATA;
      const payload = new Uint8Array([42]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(streamId);
    });

    it('should handle odd stream IDs (client-initiated)', () => {
      const streamId = 12345; // Odd
      const flags = FrameFlags.HEADERS;
      const payload = new Uint8Array(0);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(streamId);
    });
  });
});
