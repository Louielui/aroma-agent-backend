# Procurement proposal presentation verification repair

## Observed failure and boundary

The preserved 2026-10-15 controlled acceptance stopped with a displayed proposal,
`procurement.presentFailed`, and a disabled approval button. No Windows task was
registered, no grant activated and no procurement source read occurred. The saved
proposal and canonical conversation reply matched their binding evidence; the
proposal was within its ten-minute lifetime. The old live HTTP response was not
captured, so it must not be described as an observed historical HTTP status.

The defect is the frontend integration contract, not a failing cryptographic
verification. Conversation creation uses `{id: 'cN', cid: <UUID>}`; persisted
conversation hydration uses `{id: 'h-<UUID>', cid: <UUID>}`. Intake, existing action
cards and conversation persistence use `cid`. The procurement card incorrectly
sent `conv.id` for both presentation and approval. The unchanged backend route
requires `conversationId` to be a UUID and rejects these local UI identifiers
with HTTP 400 `invalid_request`, before calling the dialogue handler or Bridge.
A missing identifier is also rejected. The UI correctly kept approval disabled
after that unsuccessful request.

The prior frontend test supplied an invented `{id: <UUID>}` shape and an
unconditional successful acknowledgment. It therefore masked the production
contract mismatch. Changing the fixture to use `cid` first produced a failing
regression. A separate full HTTP/Bridge/Gateway fixture reproduced the invalid
identifier rejection and the real browser-shape failure before the source fix.

## Minimal change

- Send `conv.cid` for presentation and approval, matching the existing intake
  and conversation contract. Do not fall back to an unrelated local UI id.
- Require the acknowledgment's `presented` field to equal boolean `true`.
  A failing-before test also proved that the old truthiness check accepted
  malformed string/number acknowledgments. This changes only UI activation;
  backend authorization remains authoritative.
- Correct the existing fixture and add integrated refusal/success regressions.

Only two executable frontend lines change. No backend, Bridge, approval store,
Windows scheduler, tool scope, source permission or configuration changes.

## Offline verification boundaries

The new tests execute the actual procurement renderer in a VM DOM fixture and
send its serialized requests through the real application HTTP/auth middleware,
procurement routes, persisted conversation/receipt stores, ephemeral Bridge HTTP
server, Action Gateway, procurement controller and Owner approval store. A
synthetic Owner cookie is obtained through the real login route. All servers
listen on OS-assigned loopback ports. The task persistence seam is synthetic;
the Windows scheduler is an in-memory fake. Source/model adapters throw if used.
No real schedule, company source, service restart or live browser is involved.

Regressions cover valid acknowledgment and button activation, exact conversation
identity after reload, duplicate clicks/requests, missing/invalid acknowledgment,
transport failure, changed tab or detached panel, altered id/hash/conversation,
canonical text and persisted proposal tampering, proposal expiry before/after
presentation, expired/restarted approval sessions, revoked Owner login, wrong
nonce, cross-origin requests, and extra command fields. Existing Action Gateway
tests run unchanged alongside these tests.

Presentation alone is not approval. No synthetic Windows effect occurs until
explicit approval is submitted. Every invalid authorization case leaves those
effect counters at zero. The successful fixture registers exactly once and
does not claim `GOAL_COMPLETED` for the Costco-containing original objective.

P1 resolved: wrong conversation field blocked the entire approval path.
The malformed acknowledgment activation defect is resolved within the explicit
invalid-acknowledgment acceptance criterion. No unrelated P0/P1 repair is added.

Existing limitation, recorded separately (P2): presentation acknowledgment alone
does not prove a still-live approval session. Backend/Gateway restart loses
in-memory tickets; the final approval remains fail-closed even when a durable
proposal was previously presented. A fresh proposal is required after restart
or expiry. This repair does not redesign session recovery or restore old nonces.

## Controlled redeployment recommendation

Stop after exact-commit offline tests and independent Claude review. Preserve
their receipts outside the repository and report their measured SHA/counts.
Owner approval is required before any PR merge, deployment or live retry.

For a separately approved deployment: recheck main/runtime/Bridge identity and
idle state, preserve the existing launcher and environment byte hashes, retain
the current runtime as a forward-history rollback point, complete CI/policy
gates and verify the merged tree equals the tested/reviewed tree. Deploy only
this repair and reload the frontend asset; reload Bridge only if independently
required. Do not replay old activation/promotion scripts or old approval tickets.

For a separately approved live retry: create a fresh fixed 08:00 Winnipeg
proposal through the existing dialogue, verify its exact task/goal/hash/expiry
and successful presentation acknowledgment, then let the Owner confirm through
the existing approval mechanism. Task registration or procurement reads remain
outside this repair's authorization. Preserve the earlier failed acceptance
evidence. Retain the first-run pause and no-Costco/no-checkout restrictions of
the original controlled acceptance; deployment alone never activates that run.
