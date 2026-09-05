import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * WebSocket subprotocol negotiation — end to end.
 *
 * WHY THIS SUITE EXISTS. `config.subprotocols` lets a client offer credentials
 * at handshake time (`['demo.v1', 'demo.sid.<n>']`): the server reads the id out
 * of the OFFER and selects only the constant back, so the credential never
 * reaches a URL, a response header or a cookie. Three of its properties cannot
 * be shown by a unit test with a mock socket, and they are the reason the
 * feature exists:
 *
 *  - WHAT A REAL HOST DOES WITH A MISMATCH. The unit tests drive a mock socket
 *    and can therefore only assert what they were told to produce. Measured here
 *    on 2026-09-05, a conforming host fails the handshake ITSELF when the server
 *    selects none of the offered values (WHATWG Fetch, "establish a WebSocket
 *    connection"): Chromium 152 reports "Sent non-empty 'Sec-WebSocket-Protocol'
 *    header but no response was received", ws 8.21.3 reports "Server sent no
 *    subprotocol". So the socket never opens — the feared "connected but carrying
 *    no session" state is not reachable from a browser at all, and what a caller
 *    must actually survive is a connection that never establishes.
 *  - THE OFFER REACHING THE SERVER. A mock proves what the client passed to a
 *    constructor. It cannot prove that the tokens crossed the wire, survived the
 *    nginx proxy, and were parsed on the other side.
 *  - THAT CONNECTING IS NOT THE SAME AS BEING AUTHENTICATED. An id that is well
 *    formed but unknown produces an OPEN socket with `demo.v1` echoed back, so
 *    every assertion of the form "it connected" or "the subprotocol was
 *    negotiated" is green while the credential bought nothing. The demo server
 *    therefore resolves the offered id against a TABLE and says so in the RPC
 *    answer (`[session ok]` / `[session unknown]` / nothing at all), and that
 *    answer — not the handshake — is what the authenticated case asserts on.
 *
 * So every assertion below is taken from BOTH ends: the browser (connection
 * state, `socket.protocol` via `negotiatedSubprotocol()`, and the RPC outcome)
 * and the server (`GET /negotiations` on the demo backend, which records what
 * each upgrade actually offered and what the library negotiated).
 *
 * The demo's "Subprotocol Lab" panel drives a SECOND client, independent of the
 * one the rest of the demo uses, so none of this perturbs the other suites.
 */

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

interface NegotiationEvent {
  seq: number;
  /** 'handshake' = recorded per upgrade; 'rpc' = read out of the RPC context. */
  source: string;
  offered: string[];
  /**
   * ALWAYS '' on a 'handshake' row: that row is written before the upgrade, when
   * no selection exists yet. Only an 'rpc' row carries a real selection. So
   * `expect(handshakeRow.selected).toBe('')` is an assertion that evaluates
   * nothing — it holds for every offer, honoured or not.
   */
  selected: string;
}

async function resetAudit(request: APIRequestContext): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}/negotiations`);
  expect(response.status()).toBe(204);
}

async function readAudit(request: APIRequestContext): Promise<NegotiationEvent[]> {
  const response = await request.get(`${BACKEND_URL}/negotiations`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as NegotiationEvent[];
}

/**
 * Only the lab's connections carry a `demo.sid.` token, so this separates them
 * from the demo's own anonymous client (which connects on page load and offers
 * nothing at all).
 */
function labEvents(events: NegotiationEvent[]): NegotiationEvent[] {
  return events.filter((event) => event.offered.some((token) => token.startsWith('demo.sid.')));
}

test.describe('WebSocket subprotocol negotiation', () => {
  test.beforeEach(async ({ page, request }) => {
    page.on('console', (msg) => console.log(`[BROWSER ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[BROWSER ERROR] ${err.message}`));

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('NgGoRPC Infinite Ticker Demo', { timeout: 10000 });
    // The demo's own client connects on load and offers nothing; let it settle
    // and then clear the audit so each test starts from a known-empty ledger.
    await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
    await resetAudit(request);
    expect(await readAudit(request)).toEqual([]);
  });

  test('server selects the constant, and the credential rides only in the offer', async ({ page, request }) => {
    await page.click('#spConnectMatchBtn');

    // Browser end: the handshake completed AND the server's selection is the
    // constant. `(none)` would mean it opened having negotiated nothing,
    // `(not connected)` that it never opened — the three are distinguishable on
    // purpose, which is the whole point of exposing the accessor.
    await expect(page.locator('#spStatus')).toHaveText('Connected', { timeout: 10000 });
    await expect(page.locator('#spNegotiated')).toHaveText('demo.v1', { timeout: 10000 });
    // The RPC that was queued during CONNECTING really ran on this socket AND the
    // handler resolved the offered id against its session table. `[session ok]`
    // is the only part of this test that could not also be produced by 43
    // characters of garbage — see the unknown-session test below.
    await expect(page.locator('#spRpcResult')).toHaveText('Hello, Subprotocol! [session ok]', { timeout: 10000 });

    // Server end.
    const events = labEvents(await readAudit(request));
    const handshakes = events.filter((event) => event.source === 'handshake');
    expect(handshakes.length).toBe(1);
    expect(handshakes[0].offered.length).toBe(2);
    expect(handshakes[0].offered[0]).toBe('demo.v1');
    expect(handshakes[0].offered[1]).toMatch(/^demo\.sid\.s\d+$/);

    const rpcs = events.filter((event) => event.source === 'rpc');
    expect(rpcs.length).toBeGreaterThanOrEqual(1);
    // The handler saw BOTH tokens (that is how it would authenticate) while the
    // negotiated protocol is only the constant — the credential is never echoed.
    expect(rpcs[0].selected).toBe('demo.v1');
    expect(rpcs[0].offered[0]).toBe('demo.v1');
    expect(rpcs[0].offered[1]).toMatch(/^demo\.sid\.s\d+$/);
  });

  test('a server that selects nothing never yields a socket, and the retry is backed off', async ({ page, request }) => {
    // The host's own diagnosis. Page JS cannot see it — `onerror` carries neither
    // a status nor a reason, which is exactly why a 401 refusal and a
    // nothing-selected handshake look identical from inside the page. The test
    // process CAN see it, and it is the only thing that distinguishes the two.
    const handshakeErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Sec-WebSocket-Protocol/i.test(msg.text())) {
        handshakeErrors.push(msg.text());
      }
    });

    await page.click('#spConnectMismatchBtn');

    // The browser refuses the handshake, so the client never reaches Connected —
    // this is the property that matters: an offer that is not honoured yields NO
    // usable socket rather than one without a session. `(not connected)` is the
    // accessor saying so; `(none)` here would mean the socket had opened with
    // nothing negotiated, which is the state this feature exists to prevent.
    await expect(page.locator('#spStatus')).toHaveText('Reconnecting', { timeout: 10000 });
    await expect(page.locator('#spNegotiated')).toHaveText('(not connected)');
    // Nothing ever ran on it: the queued RPC is still queued, never answered.
    await expect(page.locator('#spRpcResult')).toHaveText('-');

    // Let the backoff (500ms base, 1000ms cap on this client) run a while.
    await page.waitForTimeout(4000);

    const events = labEvents(await readAudit(request));
    const handshakes = events.filter((event) => event.source === 'handshake');
    // Retried — so the failure is NOT treated as fatal, which is right: from the
    // browser it is indistinguishable from an unreachable server.
    expect(handshakes.length).toBeGreaterThanOrEqual(2);
    // ...but backed off, not hot-looping. Unbounded retry would be dozens here.
    expect(handshakes.length).toBeLessThanOrEqual(12);
    // Every attempt really did carry the unsupported version.
    expect(handshakes.every((event) => event.offered[0] === 'demo.vX-unsupported')).toBe(true);
    // The refusal is the HOST's, not the server's: the server answered the
    // upgrade, selected none of the offered values, and the browser failed the
    // connection over it. A 401 or a dead port would produce neither this
    // message nor an audit row, so the two are told apart here and only here.
    // (Chromium wording; this project's Playwright config runs chromium only.)
    expect(handshakeErrors.length).toBeGreaterThanOrEqual(1);
    expect(handshakeErrors[0]).toMatch(/handshake/i);
    // No RPC ever reached a handler.
    expect(events.filter((event) => event.source === 'rpc').length).toBe(0);
    // And each attempt minted a FRESH id: a client that captured the offer once
    // would reconnect forever with a credential that has since rotated.
    const ids = handshakes.map((event) => event.offered[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(await page.locator('#spOfferCount').textContent()).toBe(String(handshakes.length));
  });

  test('a reconnect offers the CURRENT credential, not the one it started with', async ({ page, request }) => {
    await page.click('#spConnectMatchBtn');
    await expect(page.locator('#spStatus')).toHaveText('Connected', { timeout: 10000 });
    await expect(page.locator('#spOfferCount')).toHaveText('1');
    const firstOffer = await page.locator('#spLastOffer').textContent();

    await page.click('#spReconnectBtn');
    await expect(page.locator('#spStatus')).toHaveText('Connected', { timeout: 10000 });
    await expect(page.locator('#spOfferCount')).toHaveText('2', { timeout: 10000 });
    expect(await page.locator('#spLastOffer').textContent()).not.toBe(firstOffer);

    // The point of the whole function-not-array design: the SERVER must see the
    // second id on the second connection. An offer captured once at connect()
    // would show `demo.sid.1` twice here, and the browser would look identical.
    const handshakes = labEvents(await readAudit(request)).filter((event) => event.source === 'handshake');
    expect(handshakes.length).toBe(2);
    expect(handshakes[0].offered[1]).toBe('demo.sid.s1');
    expect(handshakes[1].offered[1]).toBe('demo.sid.s2');
    // Both still negotiated the same constant.
    await expect(page.locator('#spNegotiated')).toHaveText('demo.v1');
  });

  test('a well-formed but UNKNOWN session connects and negotiates, and is still not authenticated', async ({ page, request }) => {
    // The case that makes "the socket opened" and "the subprotocol came back"
    // worthless as evidence. The id here has the same shape as a good one and is
    // simply not in the server's table, which is how a real gateway behaves for
    // an expired session: the handshake succeeds, the constant is echoed, and
    // only the RPC answer says the credential bought nothing.
    await page.click('#spConnectUnknownBtn');

    await expect(page.locator('#spStatus')).toHaveText('Connected', { timeout: 10000 });
    await expect(page.locator('#spNegotiated')).toHaveText('demo.v1', { timeout: 10000 });
    await expect(page.locator('#spRpcResult')).toHaveText('Hello, Subprotocol! [session unknown]', { timeout: 10000 });

    // The credential did reach the handler — it was looked up and missed, which
    // is a different fact from "it never arrived".
    const rpcs = labEvents(await readAudit(request)).filter((event) => event.source === 'rpc');
    expect(rpcs.length).toBeGreaterThanOrEqual(1);
    expect(rpcs[0].offered[1]).toMatch(/^demo\.sid\.u\d+$/);
    expect(rpcs[0].selected).toBe('demo.v1');
  });

  test('offering nothing is unchanged: no header on the wire, and it connects', async ({ page, request }) => {
    await page.click('#spConnectAnonBtn');

    await expect(page.locator('#spStatus')).toHaveText('Connected', { timeout: 10000 });
    // '' — connected with nothing negotiated. This is the value that is FATAL
    // when something was offered, and it must be inert here.
    await expect(page.locator('#spNegotiated')).toHaveText('(none)', { timeout: 10000 });
    // No marker: the handler saw no session token at all. This is also the
    // control that keeps the marker itself honest — if the server appended it
    // unconditionally, this line would fail.
    await expect(page.locator('#spRpcResult')).toHaveText('Hello, Subprotocol!', { timeout: 10000 });
    await expect(page.locator('#spOfferCount')).toHaveText('0');

    const events = await readAudit(request);
    // Nothing carrying an id reached the server...
    expect(labEvents(events).length).toBe(0);
    // ...and the upgrade that did happen carried an EMPTY offer, i.e. no
    // Sec-WebSocket-Protocol header at all rather than an empty one.
    const handshakes = events.filter((event) => event.source === 'handshake');
    expect(handshakes.length).toBeGreaterThanOrEqual(1);
    expect(handshakes[handshakes.length - 1].offered).toEqual([]);
  });
});
