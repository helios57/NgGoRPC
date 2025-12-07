NgGoRPC E2E Test Failure Triage
Updated: 2025-12-07 15:16

Instructions
- Work through failing tests top to bottom. After each fix/run, update the Status and Reason/Fix.
- Keep short, factual notes so this file remains a living log of progress.

Legend
- Status: Failing | Investigating | Fixed

Failing Tests (from latest run)
1. [chromium] tests/auth.spec.ts:30:7 — Authentication Propagation — should send authorization header when token is set
   - Status: Failing
   - Reason/Fix: TBD

2. [chromium] tests/auth.spec.ts:64:7 — Authentication Propagation — should work without authentication token
   - Status: Failing
   - Reason/Fix: TBD

3. [chromium] tests/auth.spec.ts:93:7 — Authentication Propagation — should allow changing auth token between calls
   - Status: Failing
   - Reason/Fix: TBD

4. [chromium] tests/auth.spec.ts:148:7 — Authentication Propagation — should propagate auth token correctly with expected test-token value
   - Status: Failing
   - Reason/Fix: TBD

5. [chromium] tests/concurrent-streams.spec.ts:73:7 — Concurrent Streams — should stop one stream while other continues
   - Status: Failing
   - Reason/Fix: TBD

6. [chromium] tests/concurrent-streams.spec.ts:162:7 — Concurrent Streams — should handle restarting stopped stream while other runs
   - Status: Failing
   - Reason/Fix: TBD

7. [chromium] tests/concurrent-streams.spec.ts:204:7 — Concurrent Streams — should handle multiple stop/start cycles on both streams
   - Status: Failing
   - Reason/Fix: TBD

8. [chromium] tests/error-scenarios.spec.ts:30:7 — Error Scenarios — should handle invalid method name gracefully
   - Status: Failing
   - Reason/Fix: TBD

9. [chromium] tests/error-scenarios.spec.ts:134:7 — Error Scenarios — should handle rapid successive calls without error
   - Status: Failing
   - Reason/Fix: TBD

10. [chromium] tests/error-scenarios.spec.ts:194:7 — Error Scenarios — should recover after attempting operation while disconnected
    - Status: Failing
    - Reason/Fix: TBD

11. [chromium] tests/error-scenarios.spec.ts:257:7 — Error Scenarios — should handle concurrent unary and streaming calls
    - Status: Failing
    - Reason/Fix: TBD

12. [chromium] tests/large-payload.spec.ts:30:7 — Large Payload Handling — should handle 3MB payload in SayHello request and response
    - Status: Failing
    - Reason/Fix: TBD

13. [chromium] tests/large-payload.spec.ts:72:7 — Large Payload Handling — should handle 1MB payload without issues
    - Status: Failing
    - Reason/Fix: TBD

14. [chromium] tests/large-payload.spec.ts:104:7 — Large Payload Handling — should handle multiple large payload calls sequentially
    - Status: Failing
    - Reason/Fix: TBD

15. [chromium] tests/long-stream.spec.ts:122:7 — The Long Stream Scenario — should handle multiple start/stop cycles
    - Status: Failing
    - Reason/Fix: TBD

16. [chromium] tests/resource-exhaustion.spec.ts:33:7 — Resource Exhaustion Protection — should handle many concurrent streams (stress test with 50 streams)
    - Status: Failing
    - Reason/Fix: TBD

17. [chromium] tests/resource-exhaustion.spec.ts:108:7 — Resource Exhaustion Protection — should handle extreme concurrent stream load (100 streams)
    - Status: Failing
    - Reason/Fix: TBD

18. [chromium] tests/resource-exhaustion.spec.ts:197:7 — Resource Exhaustion Protection — should gracefully handle exceeding stream limits (105 streams)
    - Status: Failing
    - Reason/Fix: TBD

19. [chromium] tests/resource-exhaustion.spec.ts:310:7 — Resource Exhaustion Protection — should recover after resource exhaustion
    - Status: Failing
    - Reason/Fix: TBD

20. [chromium] tests/unary-rpc.spec.ts:30:7 — Unary RPC (SayHello) — should successfully call SayHello with default name
    - Status: Failing
    - Reason/Fix: TBD

21. [chromium] tests/unary-rpc.spec.ts:50:7 — Unary RPC (SayHello) — should successfully call SayHello with custom name
    - Status: Failing
    - Reason/Fix: TBD

22. [chromium] tests/unary-rpc.spec.ts:70:7 — Unary RPC (SayHello) — should handle multiple sequential unary calls
    - Status: Failing
    - Reason/Fix: TBD

23. [chromium] tests/unary-rpc.spec.ts:101:7 — Unary RPC (SayHello) — should handle empty name gracefully
    - Status: Failing
    - Reason/Fix: TBD

24. [chromium] tests/unary-rpc.spec.ts:120:7 — Unary RPC (SayHello) — should handle special characters in name
    - Status: Failing
    - Reason/Fix: TBD

Progress Log
- 2025-12-07 15:16 — Initialized checklist with 24 failing tests. Next: reproduce and investigate Authentication Propagation failures first.
