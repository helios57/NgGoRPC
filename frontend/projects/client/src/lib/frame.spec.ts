/**
 * Unit tests for Frame codec (frame.ts)
 */
import { encodeFrame, decodeFrame, FrameFlags } from './frame';

describe('Frame Codec', () => {
  describe('Round-trip Test', () => {
    it('should encode and decode a frame without data loss', () => {
      const streamId = 42;
      const flags = FrameFlags.DATA;
      const payload = new Uint8Array([1, 2, 3, 4, 5]);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload).toEqual(payload);
    });

    it('should handle round-trip with zero-length payload', () => {
      const streamId = 100;
      const flags = FrameFlags.HEADERS;
      const payload = new Uint8Array(0);

      const encoded = encodeFrame(streamId, flags, payload);
      const decoded = decodeFrame(encoded.buffer);

      expect(decoded.streamId).toBe(streamId);
      expect(decoded.flags).toBe(flags);
      expect(decoded.payload.length).toBe(0);
    });
  });

  describe('Boundary Check', () => {
    it('should throw error for incomplete header (< 9 bytes)', () => {
      const incompleteHeader = new Uint8Array(8);
      expect(() => {
        decodeFrame(incompleteHeader.buffer);
      }).toThrow(new Error('Frame too small: expected at least 9 bytes, got 8'));
    });

    it('should throw error for empty buffer', () => {
      const emptyBuffer = new Uint8Array(0);
      expect(() => {
        decodeFrame(emptyBuffer.buffer);
      }).toThrow(new Error('Frame too small: expected at least 9 bytes, got 0'));
    });

    it('should throw error when payload length is less than specified in header', () => {
      const buffer = new Uint8Array(14);
      const view = new DataView(buffer.buffer);
      view.setUint8(0, FrameFlags.DATA);
      view.setUint32(1, 123, false);
      view.setUint32(5, 10, false);

      expect(() => {
        decodeFrame(buffer.buffer);
      }).toThrow(new Error('Incomplete frame: header specifies 10 bytes payload, but only 5 bytes available'));
    });
  });
});
