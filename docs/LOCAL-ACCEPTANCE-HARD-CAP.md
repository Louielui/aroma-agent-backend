# Local acceptance hard cap

Status: isolated candidate, inactive. Installation is neither activation nor permission to restore automatic memory. The implementation uses the existing UsageBudget Action Store, writer locks, scope signatures, Action Gateway and audit evidence directory. It creates no second counter or credentials.

## Proposed window (requires separate Owner approval)

Root: `abec5422-a464-440e-898a-70d35f956478`. Profile: `owner-local-brain-acceptance-20261115`.

- Six dialogue slots: three greeting and three real recall samples, at most six local native sends each.
- One isolated learning slot: one extraction and one consolidation send, at most two in total. No reflection, candidate approval or extra indexing.
- Shared total: 38 conservative reservations, zero website calls, zero cloud calls. Failures, retries and child work consume the same limit; no refunds.
- Fifteen minutes from activation, ninety seconds from each slot entry. The same deadline is checked at reservation and immediately before native HTTP send, and bounds the transport timeout.
- Model: Qwen3.5 9B, auto effort / think:false, pinned deployment digest, 65,536 context. No provider fallback.

The existing authenticated `/scheduler-action` accepts `usage_local_acceptance_activate` with exact root ID, the hash of all nine paused predecessors and the **running merged commit**. The merged tree must first be verified against the separately approved candidate SHA. Activation rejects unknown versions, non-idle service, changed predecessors and replay. `usage_activate` cannot reopen this profile. No activation is performed by installing source or inspecting the profile.

`usage_bind_turn` accepts only the seven immutable slot IDs in `localAcceptancePolicy.js`. Dialogue ingress calls ordinary `enterTurn`; the background slot requires explicit host-side `enterTurn(..., 'background')`. A child inherits its parent's slot and allowance. An unscoped call is refused while the local window is active, and local inference remains fenced after this local root is paused. An explicit authenticated Owner usage_close can seal a resolved active/paused local root; only then can ordinary unscoped dialogue resume, without reopening the acceptance or enabling capture. Scoped reuse remains refused forever; omitting scope is not a way to bypass this window.

Each actual `LocalAdapter` POST /api/chat reserves and captures input evidence, claims native dispatch, commits dispatch evidence **before** sending, captures returned output and finalizes the attempt. GET /api/tags is metadata, not inference. Failed pre-send reservations show no dispatch. Dispatched failures remain conservatively charged, stop the entire window and retain diagnostic error codes. Memory schema/source failures also stop the window, even if the native model returned successfully. Persisted totals survive process restart; pending attempts are never silently resent or reconciled. Evidence registration/storage errors prevent sending. A killed process may leave unresolved conservative capacity, requiring the existing explicit recovery procedure.

## Background and memory conditions

Keep formal automatic capture and all nine historical acceptance ledgers paused. Run the one background batch only in a fresh, clearly marked isolated learning directory with a verbatim approved source and original provenance. The existing memory runtime timer inherits the same host scope; an unscoped timer is refused. A candidate must remain unapproved. This does not prove safe restoration of the formal backlog (65 unconfirmed index records and 20/20 pending candidates observed during planning). Disposition and a separate bounded resumption decision remain required.

## Evidence and delivery

`test/localBrain/sharedBudget.test.js` exercises actual adapter transport with offline responses, cross-process contention, slot allocations, retries, restart, version/expiry, Action Gateway authentication, background timer, no automatic preference approval, unknown send failures and evidence-write failure. These are offline boundary results, not real model quality or production acceptance. Existing guards and cloud fences remain in force. Follow the exact-commit promotion gates, then perform separate authorized live acceptance. Local-to-cloud recovery still requires separate Owner approval.
