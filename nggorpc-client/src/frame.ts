/**
 * Frame Codec for NgGoRPC Protocol
 * 
 * Implements encoding and decoding of binary frames according to the NgGoRPC protocol specification.
 * 
 * Frame Layout (9-byte header + payload):
 * - Byte 0: Flags (uint8)
 * - Bytes 1-4: Stream ID (uint32, Big Endian)
 * - Bytes 5-8: Length (uint32, Big Endian)
 * - Bytes 9+: Payload (byte array)
 */

/**
 * Frame flag constants
 */
export const FrameFlags = {
  HEADERS: 0x01,      // Frame contains RPC metadata
  DATA: 0x02,         // Frame contains serialized Protobuf message
  TRAILERS: 0x04,     // Frame contains final RPC status
  RST_STREAM: 0x08,   // Control signal to terminate stream abnormally
  EOS: 0x10,          // End of Stream - no further frames on this stream
  PING: 0x20,         // Keep-alive ping frame
  PONG: 0x40,         // Keep-alive pong response frame
} as const;

/**
 * Decoded frame structure
 */
export interface Frame {
  flags: number;
  streamId: number;
  payload: Uint8Array;
}

/**
 * Encodes a frame into a binary format according to NgGoRPC protocol.
 * 
 * @param streamId - The unique stream identifier (uint32)
 * @param flags - Frame flags (uint8)
 * @param payload - The payload data
 * @returns A Uint8Array containing the complete frame (header + payload)
 */
export function encodeFrame(streamId: number, flags: number, payload: Uint8Array): Uint8Array {
  const headerSize = 9;
  const payloadLength = payload.length;
  const frame = new Uint8Array(headerSize + payloadLength);
  const view = new DataView(frame.buffer);

  // Byte 0: Flags (uint8)
  view.setUint8(0, flags);

  // Bytes 1-4: Stream ID (uint32, Big Endian)
  view.setUint32(1, streamId, false); // false = Big Endian

  // Bytes 5-8: Length (uint32, Big Endian)
  view.setUint32(5, payloadLength, false); // false = Big Endian

  // Bytes 9+: Payload
  frame.set(payload, headerSize);

  return frame;
}

/**
 * Decodes a binary frame into its components.
 * 
 * @param buffer - The ArrayBuffer or ArrayBufferLike containing the frame data
 * @returns A Frame object with parsed streamId, flags, and payload
 * @throws Error if the buffer is too small to contain a valid frame
 */
export function decodeFrame(buffer: ArrayBufferLike): Frame {
  const headerSize = 9;

  if (buffer.byteLength < headerSize) {
    throw new Error(`Frame too small: expected at least ${headerSize} bytes, got ${buffer.byteLength}`);
  }

  const view = new DataView(buffer);

  // Byte 0: Flags (uint8)
  const flags = view.getUint8(0);

  // Bytes 1-4: Stream ID (uint32, Big Endian)
  const streamId = view.getUint32(1, false); // false = Big Endian

  // Bytes 5-8: Length (uint32, Big Endian)
  const length = view.getUint32(5, false); // false = Big Endian

  // Validate payload length
  const expectedSize = headerSize + length;
  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Incomplete frame: header specifies ${length} bytes payload, but only ${buffer.byteLength - headerSize} bytes available`
    );
  }

  // Bytes 9+: Payload (create a view, not a copy)
  const payload = new Uint8Array(buffer, headerSize, length);

  return {
    flags,
    streamId,
    payload,
  };
}
