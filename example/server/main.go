package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/helios57/NgGoRPC/wsgrpc"
	pb "github.com/helios57/NgGoRPC/wsgrpc/generated"
	"google.golang.org/grpc/metadata"
)

// demoSubprotocol is the constant half of the pair the demo app offers. The
// other half is a per-attempt id, which this server never selects — the client
// offers ['demo.v1', 'demo.sid.<n>'] and only 'demo.v1' comes back.
const demoSubprotocol = "demo.v1"

// negotiationAudit records what each connection offered, so the e2e suite can
// assert what the SERVER received rather than what the browser believes it sent.
//
// THIS IS A TEST SURFACE AND IT BELONGS ONLY IN THIS DEMO. It deliberately
// stores the offered subprotocol tokens, and in the real pattern one of those
// tokens IS the session credential — a production server must never keep them,
// log them, or expose them on an endpoint. The demo's ids are fabricated
// counters, so nothing here is a secret.
type negotiationAudit struct {
	mu     sync.Mutex
	seq    int
	events []negotiationEvent
}

// negotiationEvent is one observation. Source distinguishes the two moments a
// server can see the negotiation, and they answer different questions:
//
//	"handshake" — recorded per accepted upgrade, BEFORE any RPC. This is the only
//	              one that exists when a client refuses the connection, so it is
//	              what proves an offer reached the server and how MANY attempts
//	              were made (a retry storm shows up as repeated events).
//	"rpc"       — recorded when an RPC arrives, read back out of the connection
//	              context. This is the only one that carries Selected, i.e. what
//	              the library actually negotiated.
type negotiationEvent struct {
	Seq      int      `json:"seq"`
	Source   string   `json:"source"`
	Offered  []string `json:"offered"`
	Selected string   `json:"selected"`
}

func (a *negotiationAudit) record(source string, offered []string, selected string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.seq++
	if offered == nil {
		offered = []string{}
	}
	a.events = append(a.events, negotiationEvent{
		Seq:      a.seq,
		Source:   source,
		Offered:  offered,
		Selected: selected,
	})
}

func (a *negotiationAudit) snapshot() []negotiationEvent {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]negotiationEvent, len(a.events))
	copy(out, a.events)
	return out
}

func (a *negotiationAudit) reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.seq = 0
	a.events = nil
}

var audit = &negotiationAudit{}

// greeterServer implements the GreeterServer interface
type greeterServer struct {
	pb.UnimplementedGreeterServer
}

// knownSessions is the demo's stand-in for a real session store. It is a TABLE,
// deliberately, and that is the whole point of it existing at all:
//
// A server that decided "authenticated" from the SHAPE of the offered id would
// answer the same for any well-formed value, so a test asserting "the socket
// opened and demo.v1 was negotiated" would pass with 43 characters of garbage —
// a control that has evaluated nothing. Only a lookup can separate "the offer
// was accepted by the transport" from "the credential is valid".
//
// This mirrors the real gateway: an id that is well formed but not in the store
// yields an OPEN socket with the constant echoed back and NO session, so the
// connection succeeds while the credential does not. Nothing about the handshake
// distinguishes the two — only the answer to an RPC does.
var knownSessions = func() map[string]struct{} {
	m := make(map[string]struct{}, 24)
	for i := 1; i <= 24; i++ {
		m[fmt.Sprintf("demo.sid.s%d", i)] = struct{}{}
	}
	return m
}()

// Session states reported back to the caller. They never contain the id itself.
const (
	sessionAnonymous = ""        // no demo.sid.* token was offered at all
	sessionOK        = "ok"      // a token was offered and IS in knownSessions
	sessionUnknown   = "unknown" // a token was offered and is NOT in knownSessions
)

// sessionState classifies a connection's offer against knownSessions.
func sessionState(offered []string) string {
	for _, token := range offered {
		if !strings.HasPrefix(token, "demo.sid.") {
			continue
		}
		if _, found := knownSessions[token]; found {
			return sessionOK
		}
		return sessionUnknown
	}
	return sessionAnonymous
}

// SayHello implements the SayHello RPC method
func (s *greeterServer) SayHello(ctx context.Context, req *pb.HelloRequest) (*pb.HelloResponse, error) {
	log.Printf("[Greeter] Received SayHello request: name=%s", truncateForLog(req.Name))

	// Extract metadata to check for authorization header
	md, ok := metadata.FromIncomingContext(ctx)
	if ok {
		authHeaders := md.Get("authorization")
		if len(authHeaders) > 0 {
			log.Printf("[Greeter] Authorization header received: %s", truncateForLog(authHeaders[0]))

			// For testing purposes, verify the token format
			// In production, you would validate the JWT token here
			expectedToken := "Bearer test-token"
			if authHeaders[0] == expectedToken {
				log.Printf("[Greeter] ✓ Valid test token received")
			} else {
				log.Printf("[Greeter] ⚠ Token mismatch: got '%s', expected '%s'", truncateForLog(authHeaders[0]), truncateForLog(expectedToken))
			}
		} else {
			log.Printf("[Greeter] No authorization header found")
		}
	} else {
		log.Printf("[Greeter] No metadata found in context")
	}

	// Read the connection's subprotocol negotiation back out of the context. The
	// OFFER is where the bearer-token-over-WebSocket pattern puts its credential,
	// so a real server would authenticate from it here; the demo only records it
	// for the e2e suite and never logs the tokens themselves.
	session := sessionAnonymous
	if negotiation, ok := wsgrpc.SubprotocolNegotiationFromContext(ctx); ok {
		audit.record("rpc", negotiation.Offered, negotiation.Selected)
		session = sessionState(negotiation.Offered)
		// The STATE, never the id, and a count rather than the values.
		log.Printf("[Greeter] Connection negotiated subprotocol %q (client offered %d, session %q)",
			negotiation.Selected, len(negotiation.Offered), session)
	}

	// The reply carries the session STATE so a caller — and the e2e suite — can
	// tell an authenticated connection from one that merely connected. A socket
	// that is open with demo.v1 negotiated proves only the transport; this is the
	// only thing in the demo that proves the credential was read and looked up.
	// An anonymous connection is answered exactly as it always was, so every
	// other spec in this repo is untouched.
	message := "Hello, " + req.Name + "!"
	if session != sessionAnonymous {
		message += " [session " + session + "]"
	}

	response := &pb.HelloResponse{
		Message: message,
	}

	log.Printf("[Greeter] Sending response: %s", truncateForLog(response.Message))
	return response, nil
}

// InfiniteTicker implements the InfiniteTicker RPC method
func (s *greeterServer) InfiniteTicker(_ *pb.Empty, stream pb.Greeter_InfiniteTickerServer) error {
	log.Printf("[Greeter] InfiniteTicker started")

	var count int64 = 0
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-stream.Context().Done():
			log.Printf("[Greeter] InfiniteTicker context cancelled (count: %d)", count)
			return stream.Context().Err()
		case <-ticker.C:
			count++
			tick := &pb.Tick{
				Count:     count,
				Timestamp: time.Now().Unix(),
			}
			if err := stream.Send(tick); err != nil {
				log.Printf("[Greeter] InfiniteTicker send error: %v", err)
				return err
			}
		}
	}
}

// truncateForLog truncates a string for logging if it's longer than 20 characters
// Returns first 20 characters followed by size info
func truncateForLog(s string) string {
	if len(s) <= 20 {
		return s
	}
	return fmt.Sprintf("%s... (size: %d)", s[:20], len(s))
}

func main() {
	// Create wsgrpc server with options
	server := wsgrpc.NewServer(wsgrpc.ServerOption{
		AllowedOrigins:    []string{"http://localhost:4200", "http://localhost:8352"}, // Allow dev and e2e origins
		MaxPayloadSize:    4 * 1024 * 1024,                                            // 4MB
		IdleTimeout:       5 * time.Minute,                                            // 5 minute idle timeout
		IdleCheckInterval: 1 * time.Minute,                                            // 1 minute check interval
		EnableLogging:     true,                                                       // Enable debug logging for demo
		// Select 'demo.v1' when the client offers it, and NOTHING when it does
		// not — including when the client offers some other version. This server
		// still ACCEPTS that upgrade (RFC 6455 allows selecting nothing); the
		// browser is what refuses it, before onopen, which is what the lab's
		// "offer unsupported" button demonstrates.
		Subprotocols: []string{demoSubprotocol},
	})

	// Register the Greeter service
	greeterImpl := &greeterServer{}
	pb.RegisterGreeterServer(server, greeterImpl)

	// The audit endpoints, and the /ws wrapper that feeds them, exist for the e2e
	// suite (e2e-tests/tests/subprotocol.spec.ts). ListenAndServe registers the
	// WebSocket handler on "/", and a more specific pattern wins in
	// http.ServeMux, so both /ws and /negotiations route here rather than into
	// the upgrade path.
	//
	// DO NOT COPY /negotiations INTO A REAL SERVER. It publishes the offers
	// verbatim, and an offer is where this pattern puts its credential — this is
	// an unauthenticated endpoint handing out session ids. It is acceptable here
	// only because this process is a throwaway demo whose "credentials" are
	// `demo.sid.<counter>`, and because the e2e suite has to read what actually
	// crossed the wire from somewhere other than the client under test.
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// Recorded BEFORE the upgrade, so a connection the client goes on to
		// refuse still leaves a trace. Without this, "the client refused" and
		// "the offer never reached the server" look identical from the outside.
		audit.record("handshake", wsgrpc.OfferedSubprotocols(r.Header), "")
		server.HandleWebSocket(w, r)
	})
	http.HandleFunc("/negotiations", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			audit.reset()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(audit.snapshot()); err != nil {
			log.Printf("[Example Server] Failed to encode negotiations: %v", err)
		}
	})

	// Start the server
	log.Println("[Example Server] Starting NgGoRPC server on :8080")
	if err := server.ListenAndServe(":8080"); err != nil {
		log.Fatalf("[Example Server] Failed to start server: %v", err)
	}
}
