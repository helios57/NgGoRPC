package wsgrpc

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
)

// EVERY TEST IN THIS FILE SETS EnableLogging: false, AND THAT IS THE POINT.
//
// Each event these counters record was, until now, observable only as a debug
// print behind EnableLogging. That made the debug switch load-bearing for
// operations: to answer "how often does this happen?" you had to run production
// with debug logging on, and the volume that produces then destroys the
// evidence — measured on lernja's dev gateway 2026-08-13, 95.2 % of the
// gateway's log lines came from behind this flag, ~21.6 MB/h, which collapsed
// container-log retention to about eight minutes.
//
// So the property under test is not "the counter counts". It is "the counter
// counts WITH THE PRINTS OFF". A counter that only moves when EnableLogging is
// true would pass a naive test and be worthless for the reason it was written.

// waitForStat polls Stats() until get returns want, and fails the test with the
// last value seen if it does not. Frame handling runs on the server's own
// goroutine, so every assertion here is necessarily a poll — reading Stats()
// once immediately after a Write races the server and would flake.
func waitForStat(t *testing.T, s *Server, name string, get func(ServerStats) uint64, want uint64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var got uint64
	for time.Now().Before(deadline) {
		got = get(s.Stats())
		if got == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("%s = %d, want %d (waited 3s); full snapshot: %+v", name, got, want, s.Stats())
}

// echoOnceService is a stream handler that receives one message, answers it, and
// returns — so it reaches its trailers, which is what StreamsCompleted counts.
func echoOnceService() *grpc.ServiceDesc {
	return &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods:     []grpc.MethodDesc{},
		Streams: []grpc.StreamDesc{
			{
				StreamName: "StreamGreet",
				Handler: func(srv interface{}, stream grpc.ServerStream) error {
					var req pb.HelloRequest
					if err := stream.RecvMsg(&req); err != nil {
						return err
					}
					return stream.SendMsg(&pb.HelloResponse{
						Message: fmt.Sprintf("Echo: %s", req.GetName()),
					})
				},
				ServerStreams: true,
				ClientStreams: true,
			},
		},
	}
}

// drainUntilTrailersOnStream drains frames until it sees TRAILERS for streamID. It skips
// everything else, because the connection legitimately carries frames for other
// streams — the RST_STREAM the server sends back for an unknown method arrives
// on this same socket.
func drainUntilTrailersOnStream(t *testing.T, ctx context.Context, conn *websocket.Conn, streamID uint32) {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for {
		msgType, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read while waiting for TRAILERS on stream %d: %v", streamID, err)
		}
		if msgType != websocket.MessageBinary {
			continue
		}
		frame, err := decodeFrame(data, 4*1024*1024)
		if err != nil {
			continue
		}
		if frame.StreamID == streamID && frame.Flags&FlagTRAILERS != 0 {
			return
		}
	}
}

// TestStatsCountersRecordEventsWithLoggingDisabled walks one connection through
// four distinct outcomes and asserts each lands in its own counter, with the
// debug prints off throughout.
//
// It also asserts the three HEADERS outcomes are DISJOINT. That is not padding:
// StreamsOpened used to be incremented before the method lookup, so a call to an
// RPC the server does not serve was counted as an opened stream *and* rejected,
// and "opened" then meant two different things depending on which branch ran.
func TestStatsCountersRecordEventsWithLoggingDisabled(t *testing.T) {
	server := NewServer(ServerOption{
		InsecureSkipVerify: true,
		EnableLogging:      false, // explicit: this is the property under test
		MaxPayloadSize:     4 * 1024 * 1024,
		IdleTimeout:        5 * time.Minute,
		IdleCheckInterval:  1 * time.Minute,
	})
	server.RegisterService(echoOnceService(), nil)

	// A fresh server has counted nothing. Without this the assertions below
	// could be satisfied by a counter that was already at its target.
	if zero := (ServerStats{}); server.Stats() != zero {
		t.Fatalf("fresh server Stats() = %+v, want all zero", server.Stats())
	}

	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, "ws"+httpServer.URL[4:], nil)
	if err != nil {
		t.Fatalf("Failed to dial WebSocket: %v", err)
	}
	defer func() {
		if err := conn.Close(websocket.StatusNormalClosure, "test complete"); err != nil {
			t.Logf("Failed to close connection: %v", err)
		}
	}()

	waitForStat(t, server, "ConnectionsAccepted",
		func(s ServerStats) uint64 { return s.ConnectionsAccepted }, 1)

	// (1) RST_STREAM for a stream this server never had. This is the shape a
	// client produces when it tears its socket down with RPCs still in flight,
	// which is what makes it the reconnect-churn signal (lernja LERNJ-1218).
	if err := conn.Write(ctx, websocket.MessageBinary,
		encodeFrame(99, FlagRST_STREAM, make([]byte, 4))); err != nil {
		t.Fatalf("Failed to send orphan RST_STREAM: %v", err)
	}
	waitForStat(t, server, "RSTStreamOrphaned",
		func(s ServerStats) uint64 { return s.RSTStreamOrphaned }, 1)

	// (2) HEADERS naming a method that is not registered.
	if err := conn.Write(ctx, websocket.MessageBinary,
		encodeFrame(5, FlagHEADERS, []byte("path: /greeter.Greeter/NoSuchMethod\n"))); err != nil {
		t.Fatalf("Failed to send unknown-method HEADERS: %v", err)
	}
	waitForStat(t, server, "StreamsRejectedUnknownMethod",
		func(s ServerStats) uint64 { return s.StreamsRejectedUnknownMethod }, 1)
	if got := server.Stats().StreamsOpened; got != 0 {
		t.Fatalf("StreamsOpened = %d after an unknown-method HEADERS, want 0: "+
			"a rejected call must not also count as an opened stream", got)
	}

	// (3) A real call, driven to its trailers.
	const streamID = uint32(1)
	if err := conn.Write(ctx, websocket.MessageBinary,
		encodeFrame(streamID, FlagHEADERS, []byte("path: /greeter.Greeter/StreamGreet\n"))); err != nil {
		t.Fatalf("Failed to send HEADERS: %v", err)
	}
	payload, err := proto.Marshal(&pb.HelloRequest{Name: "TestUser"})
	if err != nil {
		t.Fatalf("Failed to marshal request: %v", err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary,
		encodeFrame(streamID, FlagDATA|FlagEOS, payload)); err != nil {
		t.Fatalf("Failed to send DATA: %v", err)
	}
	waitForStat(t, server, "StreamsOpened",
		func(s ServerStats) uint64 { return s.StreamsOpened }, 1)

	drainUntilTrailersOnStream(t, ctx, conn, streamID)
	waitForStat(t, server, "StreamsCompleted",
		func(s ServerStats) uint64 { return s.StreamsCompleted }, 1)

	// (4) THE NEGATIVE CONTROL for step (1). Same frame, same code path, on a
	// stream that just reached its trailers instead of one that never existed —
	// and RSTStreamOrphaned must NOT move.
	//
	// This assertion is the one that was missing, and its absence is why the
	// counter shipped measuring the wrong thing. Step (1) proves the counter can
	// go UP; nothing proved it stays DOWN when nothing is wrong. Normal
	// completion also removes the ID from streamMap, so "absent from streamMap"
	// conflated a destroyed stream with a finished one, and a browser client's
	// ordinary post-trailers RST moved it once per COMPLETED RPC. Measured on a
	// live gateway before the fix: one passing 3.5 s request-response test read
	// opened=13, completed=13, orphaned=12, with no reconnect anywhere in it.
	if err := conn.Write(ctx, websocket.MessageBinary,
		encodeFrame(streamID, FlagRST_STREAM, make([]byte, 4))); err != nil {
		t.Fatalf("Failed to send post-completion RST_STREAM: %v", err)
	}
	waitForStat(t, server, "RSTStreamAfterCompletion",
		func(s ServerStats) uint64 { return s.RSTStreamAfterCompletion }, 1)
	if got := server.Stats().RSTStreamOrphaned; got != 1 {
		t.Fatalf("RSTStreamOrphaned = %d after an RST for a COMPLETED stream, want 1 "+
			"(the one from step 1 and no more): a client releasing a finished RPC is "+
			"not reconnect churn, and counting it makes the counter track RPC volume", got)
	}

	// (5) Nothing in this test exceeded MaxConcurrentStreams, so the refusal
	// counter must have stayed put. A counter that moves on unrelated traffic
	// is as useless as one that never moves.
	if got := server.Stats().StreamsRefused; got != 0 {
		t.Fatalf("StreamsRefused = %d, want 0: no stream was ever refused here", got)
	}
}

// TestStatsStreamsRefusedWithLoggingDisabled covers the one counter the walk
// above deliberately leaves at zero. It needs a handler that stays resident, so
// it is separated rather than folded in.
func TestStatsStreamsRefusedWithLoggingDisabled(t *testing.T) {
	release := make(chan struct{})
	defer close(release)

	server := NewServer(ServerOption{
		InsecureSkipVerify:   true,
		EnableLogging:        false, // explicit: this is the property under test
		MaxPayloadSize:       4 * 1024 * 1024,
		MaxConcurrentStreams: 1,
		IdleTimeout:          5 * time.Minute,
		IdleCheckInterval:    1 * time.Minute,
	})
	server.RegisterService(&grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Methods:     []grpc.MethodDesc{},
		Streams: []grpc.StreamDesc{
			{
				StreamName: "StreamGreet",
				Handler: func(srv interface{}, stream grpc.ServerStream) error {
					<-release // hold the one available slot for the whole test
					return nil
				},
				ServerStreams: true,
				ClientStreams: true,
			},
		},
	}, nil)

	httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
	defer httpServer.Close()

	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, "ws"+httpServer.URL[4:], nil)
	if err != nil {
		t.Fatalf("Failed to dial WebSocket: %v", err)
	}
	defer func() {
		if err := conn.Close(websocket.StatusNormalClosure, "test complete"); err != nil {
			t.Logf("Failed to close connection: %v", err)
		}
	}()

	headers := []byte("path: /greeter.Greeter/StreamGreet\n")
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(1, FlagHEADERS, headers)); err != nil {
		t.Fatalf("Failed to send first HEADERS: %v", err)
	}
	waitForStat(t, server, "StreamsOpened",
		func(s ServerStats) uint64 { return s.StreamsOpened }, 1)

	// The slot is taken; this one must be refused.
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(3, FlagHEADERS, headers)); err != nil {
		t.Fatalf("Failed to send second HEADERS: %v", err)
	}
	waitForStat(t, server, "StreamsRefused",
		func(s ServerStats) uint64 { return s.StreamsRefused }, 1)

	if got := server.Stats().StreamsOpened; got != 1 {
		t.Fatalf("StreamsOpened = %d, want 1: a refused stream must not count as opened", got)
	}
}
