package wsgrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"

	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
)

func TestOfferedSubprotocols(t *testing.T) {
	tests := []struct {
		name   string
		header http.Header
		want   []string
	}{
		{
			name:   "absent header offers nothing",
			header: http.Header{},
			want:   nil,
		},
		{
			// The shape a browser sends: one header, comma-separated.
			name:   "one header, comma separated",
			header: http.Header{"Sec-Websocket-Protocol": {"app.v1, app.sid.abc"}},
			want:   []string{"app.v1", "app.sid.abc"},
		},
		{
			// Legal too, and a naive h.Get() would see only the first line.
			name:   "repeated header lines",
			header: http.Header{"Sec-Websocket-Protocol": {"app.v1", "app.sid.abc"}},
			want:   []string{"app.v1", "app.sid.abc"},
		},
		{
			name:   "empty tokens are dropped, order is preserved",
			header: http.Header{"Sec-Websocket-Protocol": {" , app.v2 ,,app.v1 , "}},
			want:   []string{"app.v2", "app.v1"},
		},
		{
			name:   "a header of only separators is nothing, not an empty token",
			header: http.Header{"Sec-Websocket-Protocol": {" , , "}},
			want:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := OfferedSubprotocols(tc.header)
			if len(got) != len(tc.want) {
				t.Fatalf("OfferedSubprotocols() = %#v, want %#v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("OfferedSubprotocols()[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestSubprotocolNegotiationFromContext_absentIsNotEmpty(t *testing.T) {
	// A context that never went through a wsgrpc connection must be
	// distinguishable from one whose client offered nothing. Reading the two as
	// the same turns a wiring mistake into "anonymous client".
	if _, ok := SubprotocolNegotiationFromContext(context.Background()); ok {
		t.Fatal("SubprotocolNegotiationFromContext(background) reported ok, want !ok")
	}

	ctx := withSubprotocolNegotiation(context.Background(), SubprotocolNegotiation{})
	n, ok := SubprotocolNegotiationFromContext(ctx)
	if !ok {
		t.Fatal("a connection that offered nothing must still report ok")
	}
	if len(n.Offered) != 0 || n.Selected != "" {
		t.Fatalf("negotiation = %+v, want zero value", n)
	}
}

// negotiationEchoService answers with the negotiation of the connection the RPC
// arrived on, so a test can assert what the SERVER saw rather than what the
// client believes it sent.
func negotiationEchoService() *grpc.ServiceDesc {
	return &grpc.ServiceDesc{
		ServiceName: "greeter.Greeter",
		HandlerType: (*interface{})(nil),
		Streams: []grpc.StreamDesc{
			{
				StreamName: "StreamGreet",
				Handler: func(_ interface{}, stream grpc.ServerStream) error {
					var req pb.HelloRequest
					if err := stream.RecvMsg(&req); err != nil {
						return err
					}
					n, ok := SubprotocolNegotiationFromContext(stream.Context())
					if !ok {
						return stream.SendMsg(&pb.HelloResponse{Message: "no-negotiation-in-context"})
					}
					return stream.SendMsg(&pb.HelloResponse{
						Message: "selected=" + n.Selected + " offered=" + strings.Join(n.Offered, "|"),
					})
				},
				ServerStreams: true,
				ClientStreams: true,
			},
		},
	}
}

// callStreamGreet opens one stream, sends one message and returns the reply text.
func callStreamGreet(t *testing.T, ctx context.Context, conn *websocket.Conn) string {
	t.Helper()
	const streamID uint32 = 1
	headers := []byte("path: /greeter.Greeter/StreamGreet")
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID, FlagHEADERS, headers)); err != nil {
		t.Fatalf("write HEADERS: %v", err)
	}
	payload, err := proto.Marshal(&pb.HelloRequest{Name: "probe"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if err := conn.Write(ctx, websocket.MessageBinary, encodeFrame(streamID, FlagDATA|FlagEOS, payload)); err != nil {
		t.Fatalf("write DATA: %v", err)
	}

	readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for {
		msgType, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read reply: %v", err)
		}
		if msgType != websocket.MessageBinary {
			continue
		}
		frame, err := decodeFrame(data, 4*1024*1024)
		if err != nil || frame.StreamID != streamID || frame.Flags&FlagDATA == 0 {
			continue
		}
		var resp pb.HelloResponse
		if err := proto.Unmarshal(frame.Payload, &resp); err != nil {
			t.Fatalf("unmarshal reply: %v", err)
		}
		return resp.GetMessage()
	}
}

// TestSubprotocolNegotiation walks the three outcomes that matter, against a
// real handshake rather than a mock, because the middle one is the whole reason
// the client-side check exists.
func TestSubprotocolNegotiation(t *testing.T) {
	tests := []struct {
		name          string
		serverAccepts []string
		clientOffers  []string
		wantSelected  string
		wantReplyHas  string
	}{
		{
			// The pattern: the constant is selected, the credential is not.
			name:          "server selects the constant it also accepts",
			serverAccepts: []string{"app.v1"},
			clientOffers:  []string{"app.v1", "app.sid.SECRET"},
			wantSelected:  "app.v1",
			wantReplyHas:  "selected=app.v1 offered=app.v1|app.sid.SECRET",
		},
		{
			// The mismatch. This server accepts the upgrade and selects nothing,
			// and THIS client (coder/websocket's Go dialer) is happy to use the
			// resulting connection — so the RPC below really does run, and the
			// handler really does see a connection carrying a credential the
			// server never acknowledged. That is the whole argument for the
			// client-side guard in the TypeScript client: browsers and ws(8)
			// reject this combination themselves (measured 2026-09-05), but a
			// non-conforming client is not hypothetical — one is exercised right
			// here.
			name:          "server selects nothing while the client offered some",
			serverAccepts: nil,
			clientOffers:  []string{"app.v1", "app.sid.SECRET"},
			wantSelected:  "",
			wantReplyHas:  "selected= offered=app.v1|app.sid.SECRET",
		},
		{
			// The unchanged path every existing client of this library is on.
			name:          "client offers nothing",
			serverAccepts: []string{"app.v1"},
			clientOffers:  nil,
			wantSelected:  "",
			wantReplyHas:  "selected= offered=",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := NewServer(ServerOption{
				InsecureSkipVerify: true,
				EnableLogging:      false,
				Subprotocols:       tc.serverAccepts,
			})
			server.RegisterService(negotiationEchoService(), nil)

			httpServer := httptest.NewServer(http.HandlerFunc(server.HandleWebSocket))
			defer httpServer.Close()

			ctx := context.Background()
			conn, _, err := websocket.Dial(ctx, "ws"+httpServer.URL[4:], &websocket.DialOptions{
				Subprotocols: tc.clientOffers,
			})
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer func() { _ = conn.Close(websocket.StatusNormalClosure, "done") }()

			if got := conn.Subprotocol(); got != tc.wantSelected {
				t.Fatalf("client-side conn.Subprotocol() = %q, want %q", got, tc.wantSelected)
			}
			if got := callStreamGreet(t, ctx, conn); got != tc.wantReplyHas {
				t.Fatalf("handler saw %q, want %q", got, tc.wantReplyHas)
			}
		})
	}
}

// TestSubprotocolOptionMerges guards the merge in NewServer: an option left at
// its zero value must not wipe a configured one, and vice versa.
func TestSubprotocolOptionMerges(t *testing.T) {
	s := NewServer(ServerOption{Subprotocols: []string{"app.v1"}}, ServerOption{EnableLogging: true})
	if len(s.options.Subprotocols) != 1 || s.options.Subprotocols[0] != "app.v1" {
		t.Fatalf("Subprotocols = %#v, want [app.v1] preserved across a later option", s.options.Subprotocols)
	}
	if def := NewServer(); len(def.options.Subprotocols) != 0 {
		t.Fatalf("default Subprotocols = %#v, want empty (select nothing)", def.options.Subprotocols)
	}
}
