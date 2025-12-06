package wsgrpc

import (
	"testing"
)

// FuzzDecodeFrame fuzzes the decodeFrame function to ensure it handles
// arbitrary byte inputs without panicking or causing excessive memory allocation.
func FuzzDecodeFrame(f *testing.F) {
	// Seed corpus with valid frames
	f.Add([]byte{0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00})                               // Valid empty frame
	f.Add([]byte{0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f}) // Valid frame with "Hello"
	f.Add([]byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})                               // All zeros
	f.Add([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff})                               // All 0xff
	f.Add([]byte{})                                                                                   // Empty input
	f.Add([]byte{0x01, 0x02, 0x03})                                                                   // Too short

	// Maximum allowed payload size for testing
	maxPayloadSize := uint32(4 * 1024 * 1024) // 4MB

	f.Fuzz(func(t *testing.T, data []byte) {
		// The fuzz test should ensure decodeFrame never panics
		// and handles all inputs gracefully (either successfully or with an error)

		// Catch any panic to fail the test explicitly
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("decodeFrame panicked with input length %d: %v", len(data), r)
			}
		}()

		// Call decodeFrame - it should either return a valid frame or an error
		_, err := decodeFrame(data, maxPayloadSize)

		// We don't care if it returns an error (that's expected for malformed input)
		// We only care that it doesn't panic or allocate excessive memory
		_ = err

		// Additional validation: if decoding succeeds, verify the frame is within bounds
		if err == nil && len(data) >= 9 {
			// If successful, the frame should be valid
			frame, _ := decodeFrame(data, maxPayloadSize)

			// Ensure payload size doesn't exceed declared length
			if len(frame.Payload) > int(maxPayloadSize) {
				t.Errorf("Decoded frame payload exceeds maximum allowed size: got %d, max %d",
					len(frame.Payload), maxPayloadSize)
			}
		}
	})
}
