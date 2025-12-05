package wsgrpc

import (
	"testing"
)

// TestOversizePayload verifies that decodeFrame rejects payloads exceeding the configured maximum size
func TestOversizePayload(t *testing.T) {
	const maxPayloadSize = 4 * 1024 * 1024 // 4MB

	// Create a frame header declaring a 5MB payload
	oversizeLength := uint32(5 * 1024 * 1024)

	// Build frame header manually
	data := make([]byte, 9)
	data[0] = FlagDATA // Flags
	// StreamID = 0 (bytes 1-4, all zeros)
	// Length = 5MB (bytes 5-8)
	data[5] = byte(oversizeLength >> 24)
	data[6] = byte(oversizeLength >> 16)
	data[7] = byte(oversizeLength >> 8)
	data[8] = byte(oversizeLength)

	// Attempt to decode - should fail immediately without reading payload
	_, err := decodeFrame(data, maxPayloadSize)

	if err == nil {
		t.Fatal("Expected error for oversize payload, got nil")
	}

	// Verify error message mentions "payload too large"
	expectedMsg := "payload too large"
	if err.Error()[:len(expectedMsg)] != expectedMsg {
		t.Errorf("Expected error to start with '%s', got: %s", expectedMsg, err.Error())
	}

	t.Logf("Successfully rejected oversize payload with error: %v", err)
}

// TestBitmaskValidation verifies that multiple flags can be set and parsed correctly
func TestBitmaskValidation(t *testing.T) {
	testCases := []struct {
		name          string
		flags         uint8
		expectedFlags []uint8
	}{
		{
			name:          "Single flag DATA",
			flags:         FlagDATA,
			expectedFlags: []uint8{FlagDATA},
		},
		{
			name:          "Multiple flags DATA | EOS",
			flags:         FlagDATA | FlagEOS,
			expectedFlags: []uint8{FlagDATA, FlagEOS},
		},
		{
			name:          "Multiple flags HEADERS | DATA",
			flags:         FlagHEADERS | FlagDATA,
			expectedFlags: []uint8{FlagHEADERS, FlagDATA},
		},
		{
			name:          "All data-related flags",
			flags:         FlagDATA | FlagEOS | FlagRST_STREAM,
			expectedFlags: []uint8{FlagDATA, FlagEOS, FlagRST_STREAM},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Create a test payload
			payload := []byte("test payload")
			streamID := uint32(42)

			// Encode frame with combined flags
			encoded := encodeFrame(streamID, tc.flags, payload)

			// Decode frame
			decoded, err := decodeFrame(encoded, 4*1024*1024)
			if err != nil {
				t.Fatalf("Failed to decode frame: %v", err)
			}

			// Verify all expected flags are set
			for _, expectedFlag := range tc.expectedFlags {
				if decoded.Flags&expectedFlag == 0 {
					t.Errorf("Expected flag 0x%02x to be set in decoded flags 0x%02x",
						expectedFlag, decoded.Flags)
				}
			}

			// Verify the complete flags value matches
			if decoded.Flags != tc.flags {
				t.Errorf("Expected flags 0x%02x, got 0x%02x", tc.flags, decoded.Flags)
			}

			// Verify stream ID and payload are preserved
			if decoded.StreamID != streamID {
				t.Errorf("Expected StreamID %d, got %d", streamID, decoded.StreamID)
			}

			if string(decoded.Payload) != string(payload) {
				t.Errorf("Expected payload %q, got %q", payload, decoded.Payload)
			}
		})
	}
}

// TestRoundTrip verifies that encoding and decoding are inverse operations
func TestRoundTrip(t *testing.T) {
	testCases := []struct {
		name     string
		streamID uint32
		flags    uint8
		payload  []byte
	}{
		{
			name:     "Empty payload",
			streamID: 1,
			flags:    FlagHEADERS,
			payload:  []byte{},
		},
		{
			name:     "Small payload",
			streamID: 100,
			flags:    FlagDATA,
			payload:  []byte("Hello, NgGoRPC!"),
		},
		{
			name:     "Large payload",
			streamID: 999,
			flags:    FlagDATA | FlagEOS,
			payload:  make([]byte, 1024*1024), // 1MB
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Encode the frame
			encoded := encodeFrame(tc.streamID, tc.flags, tc.payload)

			// Decode the frame
			decoded, err := decodeFrame(encoded, 4*1024*1024)
			if err != nil {
				t.Fatalf("Failed to decode frame: %v", err)
			}

			// Verify all fields match
			if decoded.StreamID != tc.streamID {
				t.Errorf("StreamID mismatch: expected %d, got %d", tc.streamID, decoded.StreamID)
			}

			if decoded.Flags != tc.flags {
				t.Errorf("Flags mismatch: expected 0x%02x, got 0x%02x", tc.flags, decoded.Flags)
			}

			if len(decoded.Payload) != len(tc.payload) {
				t.Errorf("Payload length mismatch: expected %d, got %d",
					len(tc.payload), len(decoded.Payload))
			}

			// For non-empty payloads, verify content
			if len(tc.payload) > 0 && len(decoded.Payload) > 0 {
				for i := range tc.payload {
					if decoded.Payload[i] != tc.payload[i] {
						t.Errorf("Payload mismatch at byte %d: expected %d, got %d",
							i, tc.payload[i], decoded.Payload[i])
						break
					}
				}
			}
		})
	}
}

// TestIncompleteFrame verifies proper error handling for malformed frames
func TestIncompleteFrame(t *testing.T) {
	testCases := []struct {
		name        string
		data        []byte
		expectedErr string
	}{
		{
			name:        "Empty data",
			data:        []byte{},
			expectedErr: "frame too small",
		},
		{
			name:        "Incomplete header (8 bytes)",
			data:        make([]byte, 8),
			expectedErr: "frame too small",
		},
		{
			name: "Header declares payload but data is incomplete",
			data: func() []byte {
				// Header with 100 bytes payload length, but only provide header
				data := make([]byte, 9)
				data[0] = FlagDATA
				data[5] = 0 // Length MSB
				data[6] = 0
				data[7] = 0
				data[8] = 100 // Length = 100 bytes
				return data
			}(),
			expectedErr: "incomplete frame",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodeFrame(tc.data, 4*1024*1024)

			if err == nil {
				t.Fatal("Expected error for incomplete frame, got nil")
			}

			if len(err.Error()) < len(tc.expectedErr) ||
				err.Error()[:len(tc.expectedErr)] != tc.expectedErr {
				t.Errorf("Expected error starting with '%s', got: %s",
					tc.expectedErr, err.Error())
			}
		})
	}
}
