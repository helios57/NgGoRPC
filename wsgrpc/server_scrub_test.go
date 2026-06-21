package wsgrpc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
)

// sensitiveConnDetail is an internal error string that must never reach the browser
// via a WebSocket close-reason frame.
const sensitiveConnDetail = "SECRET-internal-db-dsn=postgres://user:pw@10.0.0.5:5432/learning?sslmode=disable"

// sensitivePanicDetail is an internal panic detail that must never reach the browser.
const sensitivePanicDetail = "SECRET-panic: nil pointer at internal/handler/path /etc/secret"

// sensitiveMarshalDetail is a substring of a marshal failure that must never reach the browser.
const sensitiveMarshalDetail = "proto:"

// parseTrailers extracts grpc-status / grpc-message from a TRAILERS frame payload.
func parseTrailers(payload string) (status string, message string) {
	for _, line := range strings.Split(payload, "\n") {
		if strings.HasPrefix(line, "grpc-status:") {
			status = strings.TrimSpace(strings.TrimPrefix(line, "grpc-status:"))
		}
		if strings.HasPrefix(line, "grpc-message:") {
			message = strings.TrimSpace(strings.TrimPrefix(line, "grpc-message:"))
		}
	}
	return status, message
}

// readUntilTrailers reads frames until a TRAILERS frame is seen, returning its parsed
// grpc-status and grpc-message.
func readUntilTrailers(t *testing.T, ctx context.Context, conn *websocket.Conn) (status string, message string, ok bool) {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for {
		msgType, frameData, err := conn.Read(readCtx)
		if err != nil {
			return "", "", false
		}
		if msgType != websocket.MessageBinary {
			continue
		}
		frame, err := decodeFrame(frameData, 4*1024*1024)
		if err != nil {
			continue
		}
		if frame.Flags&FlagTRAILERS != 0 {
			s, m := parseTrailers(string(frame.Payload))
			return s, m, true
		}
	}
}

// Vector 1: connection-level close-reason must not leak the internal error string.
// We force a read error path that previously did conn.Close(StatusInternalError, err.Error()).
// The most reliable way to exercise the connection-error close path is to make
// handleConnection return an error whose message contains the sensitive detail.
// We do that via a tiny test seam: a per-server read-error hook used only in tests.
func TestConnCloseReasonDoesNotLeakInternalError(t *testing.T) {
	server := NewServer(ServerOption{InsecureSkipVerify: true})

	// Inject a connection-handling error that carries the sensitive detail.
	server.testConnErrHook = func() error {
		return errors.New(sensitiveConnDetail)
	}

	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	wsURL := "ws" + httpServer.URL[4:]
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusInternalError, "test cleanup") }()

	// Read until the server closes the connection; capture the close error.
	readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var closeErr websocket.CloseError
	for {
		_, _, rerr := conn.Read(readCtx)
		if rerr != nil {
			if errors.As(rerr, &closeErr) {
				break
			}
			t.Fatalf("expected a websocket CloseError, got: %v", rerr)
		}
	}

	if closeErr.Code != websocket.StatusInternalError {
		t.Errorf("expected close code StatusInternalError (%d), got %d", websocket.StatusInternalError, closeErr.Code)
	}
	if strings.Contains(closeErr.Reason, "SECRET") || strings.Contains(closeErr.Reason, sensitiveConnDetail) {
		t.Errorf("close-reason leaked internal error detail to browser: %q", closeErr.Reason)
	}
	if closeErr.Reason == "" {
		t.Errorf("expected a generic non-empty close reason, got empty")
	}
}

// Vector 2: a panicking handler must not crash the stream/connection and must yield a
// clean Internal status without leaking the panic detail.
func TestHandlerPanicYieldsCleanInternalAndRecovers(t *testing.T) {
	server := NewServer(ServerOption{InsecureSkipVerify: true})

	desc := &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods: []grpc.MethodDesc{
			{
				MethodName: "SayHello",
				Handler: func(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
					req := &pb.HelloRequest{}
					_ = dec(req)
					panic(sensitivePanicDetail)
				},
			},
		},
		Streams: []grpc.StreamDesc{},
	}
	server.RegisterService(desc, nil)

	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	wsURL := "ws" + httpServer.URL[4:]
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "done") }()

	streamID := uint32(1)
	headersFrame := encodeFrame(streamID, FlagHEADERS, []byte("path: /greeter.Greeter/SayHello\n"))
	if err := conn.Write(ctx, websocket.MessageBinary, headersFrame); err != nil {
		t.Fatalf("write headers: %v", err)
	}
	req := &pb.HelloRequest{Name: "World"}
	reqData, _ := proto.Marshal(req)
	dataFrame := encodeFrame(streamID, FlagDATA|FlagEOS, reqData)
	if err := conn.Write(ctx, websocket.MessageBinary, dataFrame); err != nil {
		t.Fatalf("write data: %v", err)
	}

	status, message, ok := readUntilTrailers(t, ctx, conn)
	if !ok {
		t.Fatalf("did not receive TRAILERS frame after panicking handler (stream crashed / connection died)")
	}

	wantStatus := int(codes.Internal) // 13
	if status != intToStr(wantStatus) {
		t.Errorf("expected grpc-status %d (Internal) for recovered panic, got %q", wantStatus, status)
	}
	if strings.Contains(message, "SECRET") || strings.Contains(message, sensitivePanicDetail) || strings.Contains(message, "panic") {
		t.Errorf("trailer grpc-message leaked panic detail to browser: %q", message)
	}
	if message == "" {
		t.Errorf("expected a generic non-empty grpc-message, got empty")
	}

	// Connection must remain usable: a second stream should still get a clean reply.
	streamID2 := uint32(3)
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID2, FlagHEADERS, []byte("path: /greeter.Greeter/SayHello\n"))); err != nil {
		t.Fatalf("write headers (2nd stream): %v", err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID2, FlagDATA|FlagEOS, reqData)); err != nil {
		t.Fatalf("write data (2nd stream): %v", err)
	}
	// The 2nd stream also panics, but the server must remain alive and return trailers again.
	if _, _, ok := readUntilTrailers(t, ctx, conn); !ok {
		t.Fatalf("connection did not survive a recovered panic (no trailers for 2nd stream)")
	}
}

// Vector 3: a post-interceptor SendMsg marshal error must be scrubbed: the browser-facing
// grpc-message must not contain the raw marshal error, the code must be Internal.
func TestSendMsgMarshalErrorIsScrubbed(t *testing.T) {
	server := NewServer(ServerOption{InsecureSkipVerify: true})

	// Handler returns a response that fails to marshal. A *pb.HelloResponse with an
	// invalid UTF-8 string field triggers a proto marshal validation error.
	desc := &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods: []grpc.MethodDesc{
			{
				MethodName: "SayHello",
				Handler: func(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
					req := &pb.HelloRequest{}
					_ = dec(req)
					// Invalid UTF-8 in a proto3 string field => marshal returns an error
					// under proto's UTF-8 validation.
					return &pb.HelloResponse{Message: string([]byte{0xff, 0xfe, 0xfd})}, nil
				},
			},
		},
		Streams: []grpc.StreamDesc{},
	}
	server.RegisterService(desc, nil)

	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	wsURL := "ws" + httpServer.URL[4:]
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "done") }()

	streamID := uint32(1)
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID, FlagHEADERS, []byte("path: /greeter.Greeter/SayHello\n"))); err != nil {
		t.Fatalf("write headers: %v", err)
	}
	req := &pb.HelloRequest{Name: "World"}
	reqData, _ := proto.Marshal(req)
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID, FlagDATA|FlagEOS, reqData)); err != nil {
		t.Fatalf("write data: %v", err)
	}

	status, message, ok := readUntilTrailers(t, ctx, conn)
	if !ok {
		t.Fatalf("did not receive TRAILERS frame for marshal-error path")
	}

	wantStatus := int(codes.Internal) // 13
	if status != intToStr(wantStatus) {
		t.Errorf("expected grpc-status %d (Internal) for marshal error, got %q", wantStatus, status)
	}
	if strings.Contains(message, "marshal") || strings.Contains(message, sensitiveMarshalDetail) || strings.Contains(message, "utf-8") || strings.Contains(message, "UTF-8") {
		t.Errorf("trailer grpc-message leaked raw marshal error to browser: %q", message)
	}
	if message == "" {
		t.Errorf("expected a generic non-empty grpc-message, got empty")
	}

	// Sanity: confirm such a response really does fail to marshal (guards against the
	// test silently passing because marshal succeeded).
	if _, merr := proto.Marshal(&pb.HelloResponse{Message: string([]byte{0xff, 0xfe, 0xfd})}); merr == nil {
		t.Fatalf("test precondition failed: expected proto.Marshal to error on invalid UTF-8")
	}
	_ = grpcstatus.New(codes.Internal, "")
}

// intToStr is a tiny helper to compare numeric grpc-status strings without importing strconv
// into the test's top-level (kept local to avoid clutter).
func intToStr(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		b[pos] = '-'
	}
	return string(b[pos:])
}
