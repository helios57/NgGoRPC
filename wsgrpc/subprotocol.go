package wsgrpc

import (
	"context"
	"net/http"
	"strings"
)

// SubprotocolNegotiation describes the WebSocket subprotocol handshake of the
// connection an RPC arrived on.
//
// WHY THIS IS EXPOSED. In the bearer-token-over-WebSocket pattern the client
// offers a constant plus a credential — ['app.v1', 'app.sid.<session-id>'] —
// and the server selects only the constant back. The credential is therefore
// never in a URL, a response header or a cookie, and the only place the server
// can read it is the OFFER. A handler that wants to authenticate the connection
// needs Offered; Selected alone tells it only which contract version won.
//
// Treat Offered as a secret. Do not log it, do not echo it into an error, and
// do not put it in a trailer: it is exactly as sensitive as an Authorization
// header, and it reaches the process the same way.
type SubprotocolNegotiation struct {
	// Offered is what the client listed in Sec-WebSocket-Protocol, in the order
	// it listed them. Empty when the client offered none — the ordinary case,
	// and the one every client of this library produced before the option
	// existed.
	Offered []string
	// Selected is what this server chose from Offered, or "" when it chose none.
	//
	// "" with a NON-EMPTY Offered means this server accepted an upgrade whose
	// offer it did not honour. RFC 6455 permits that, but no client survives it:
	// measured 2026-09-05 against this repo's demo server, Chromium 152 and
	// ws 8.21.3 both FAIL the handshake themselves rather than expose such a
	// socket. So the practical meaning of this combination is "that client is now
	// in a reconnect loop it cannot escape" — treat it as a server-side
	// configuration error (a Subprotocols option that does not list what clients
	// offer), not as an anonymous connection.
	Selected string
}

// subprotocolCtxKey is unexported so nothing outside this package can plant a
// negotiation of its own into a context and have handlers believe it.
type subprotocolCtxKey struct{}

// withSubprotocolNegotiation attaches the negotiation to a connection context.
func withSubprotocolNegotiation(ctx context.Context, n SubprotocolNegotiation) context.Context {
	return context.WithValue(ctx, subprotocolCtxKey{}, n)
}

// SubprotocolNegotiationFromContext returns the subprotocol negotiation of the
// connection this RPC arrived on.
//
// ok is false for a context that did not come from a wsgrpc connection, which is
// a different statement from "the client offered nothing" (ok is true with an
// empty Offered for that). A caller that treats the two as the same will read a
// wiring mistake as an anonymous client.
func SubprotocolNegotiationFromContext(ctx context.Context) (SubprotocolNegotiation, bool) {
	n, ok := ctx.Value(subprotocolCtxKey{}).(SubprotocolNegotiation)
	return n, ok
}

// OfferedSubprotocols parses the client's Sec-WebSocket-Protocol offer out of a
// request's headers.
//
// The header is a comma-separated token list and may legally be repeated, so
// both shapes are folded into one ordered slice. Order is preserved because it
// is the client's preference order.
//
// Exported because a server that wraps HandleWebSocket may need the offer
// BEFORE the upgrade — to authenticate the connection, or to reject it — and at
// that point there is no context to read it from. After the upgrade, prefer
// SubprotocolNegotiationFromContext: it also carries what was selected.
func OfferedSubprotocols(h http.Header) []string {
	values := h.Values("Sec-WebSocket-Protocol")
	if len(values) == 0 {
		return nil
	}
	offered := make([]string, 0, len(values))
	for _, value := range values {
		for _, token := range strings.Split(value, ",") {
			if token = strings.TrimSpace(token); token != "" {
				offered = append(offered, token)
			}
		}
	}
	if len(offered) == 0 {
		return nil
	}
	return offered
}
