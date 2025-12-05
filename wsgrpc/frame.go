package wsgrpc

import (
	"encoding/binary"
	"fmt"
)

// Frame flag constants matching the protocol specification
const (
	FlagHEADERS    = 0x01 // Frame contains RPC metadata
	FlagDATA       = 0x02 // Frame contains serialized Protobuf message
	FlagTRAILERS   = 0x04 // Frame contains final RPC status
	FlagRST_STREAM = 0x08 // Control signal to terminate stream abnormally
	FlagEOS        = 0x10 // End of Stream - no further frames on this stream
	FlagPING       = 0x20 // Keep-alive ping frame
	FlagPONG       = 0x40 // Keep-alive pong response frame
)

// Frame represents a decoded NgGoRPC protocol frame
type Frame struct {
	Flags    uint8
	StreamID uint32
	Payload  []byte
}

// encodeFrame encodes a frame into binary format according to NgGoRPC protocol.
//
// Frame Layout (9-byte header + payload):
// - Byte 0: Flags (uint8)
// - Bytes 1-4: Stream ID (uint32, Big Endian)
// - Bytes 5-8: Length (uint32, Big Endian)
// - Bytes 9+: Payload (byte array)
func encodeFrame(streamID uint32, flags uint8, payload []byte) []byte {
	const headerSize = 9
	payloadLength := uint32(len(payload))
	frame := make([]byte, headerSize+payloadLength)

	// Byte 0: Flags (uint8)
	frame[0] = flags

	// Bytes 1-4: Stream ID (uint32, Big Endian)
	binary.BigEndian.PutUint32(frame[1:5], streamID)

	// Bytes 5-8: Length (uint32, Big Endian)
	binary.BigEndian.PutUint32(frame[5:9], payloadLength)

	// Bytes 9+: Payload
	copy(frame[headerSize:], payload)

	return frame
}

// decodeFrame decodes a binary frame into its components.
//
// Returns a Frame struct with parsed Flags, StreamID, and Payload.
// Returns an error if the buffer is too small or malformed.
func decodeFrame(data []byte, maxPayloadSize uint32) (*Frame, error) {
	const headerSize = 9

	if len(data) < headerSize {
		return nil, fmt.Errorf("frame too small: expected at least %d bytes, got %d", headerSize, len(data))
	}

	// Byte 0: Flags (uint8)
	flags := data[0]

	// Bytes 1-4: Stream ID (uint32, Big Endian)
	streamID := binary.BigEndian.Uint32(data[1:5])

	// Bytes 5-8: Length (uint32, Big Endian)
	length := binary.BigEndian.Uint32(data[5:9])

	// Enforce maximum payload size per server configuration
	if length > maxPayloadSize {
		return nil, fmt.Errorf(
			"payload too large: %d bytes exceeds maximum of %d bytes",
			length,
			maxPayloadSize,
		)
	}

	// Validate payload length
	expectedSize := headerSize + int(length)
	if len(data) < expectedSize {
		return nil, fmt.Errorf(
			"incomplete frame: header specifies %d bytes payload, but only %d bytes available",
			length,
			len(data)-headerSize,
		)
	}

	// Bytes 9+: Payload
	payload := data[headerSize:expectedSize]

	return &Frame{
		Flags:    flags,
		StreamID: streamID,
		Payload:  payload,
	}, nil
}
