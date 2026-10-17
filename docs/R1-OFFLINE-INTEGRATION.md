# R1 Main Owner integration

Baseline: U3-D `1eb71f8b2cceefca0d7f68f25f7f69e47f094331`, tree
`9228585de00685b0ca09b210add6528a45942bea`. Offline development only.

`app.js` composes the accepted U1/U2/U3-D runner into the existing authenticated
`/api/v1/demo/task-intake` application route. The historical route prefix is
retained; the acceptance script uses `createApp()` and `/owner/login`, not a
standalone Express harness. Browser/native requests retain `contextTask` and E1.
The same Browser Read store and authoritative Task/Goal/Attempt store remain.

Both `UNIFIED_TASK_INTAKE=true` and `OWNER_TASK_COORDINATION=true` are required.
The latter is unset/off by default. `OWNER_TASK_GOAL_SHARING=true` and
`OWNER_TASK_CONTENT_SHARING=true` are separate host decisions. Existing per-source
provider-sharing policy also applies. None of these flags authenticate a caller
or grant source permission. Configuration is not changed by a request or UI.

`ownerIntegration` binds the current Main Owner session and conversation to each
request using AsyncLocalStorage. The existing read-only company security
projection and Context leases are rechecked. No service bearer, Browser grant,
page context or model-generated identifier supplies Main Owner authority.
The existing Origin/Host/Fetch-Site guards and typed CAS/idempotency contracts
remain. A revoked session during execution blocks use of returned evidence.

The thin subscription facade wraps `CodexSubscriptionAdapter`, pins the current
server-selected model/effort, requires verified subscription preflight and
retains completion model/billing checks. Returned effort is checked when present.
There is no API or provider fallback. Ordinary tests inject synthetic transport;
explicit acceptance alone uses the existing locked subscription client. Each
attempt persists a verified subscription identity event before selection.

The existing UI renders persisted ordered labels as text, and submits only the
typed `clarification_response` envelope. It includes server task/clarification/
revision identities, a client submission UUID and the literal reply. The same
UUID is retained for an explicit retry after uncertain transport failure. It
never submits candidate source IDs. Existing cancellation and server CAS remain.
The existing panel is extracted to `assets/taskPanel.js` and fingerprinted and
packaged as a protected UI dependency. This keeps the unchanged 245k main-script
package bound; no file-size gate is relaxed.

Long source records use at most three positional verbatim fragments of at most
280 characters, with original source ID, exact offsets and content hash. Existing
36k pack, scalar catalog, six-record-per-section, 12k evidence and six-claim bounds
remain. Omitted character counts are recomputed after catalog/budget filtering.
Fragments are partial evidence; omitted spans and oversized/hash-only receipts
cannot supply facts. This is not full-document comprehension or recursive search.

The original authoritative Goal is supplied to selection and continuation. The
investigation projection reuses `refineGoal`, `observeReads` and `applyEvidence`.
It distinguishes retrieval, grounded answer, source/answer coverage and unresolved
mandatory outcomes. Read receipts and model prose do not establish overall Goal
completion. No full-goal completion verifier has been added. The original store
Goal identity/objective and prior completion contracts are preserved.

`scripts/r1/acceptance.cjs` performs the bounded five-read cross-source dialogue
through the real application with synthetic Gateway/Context transports and actual
GPT-6 Astra/high/ChatGPT-subscription inference. Raw prompts, answers, read attempts,
source lineage, Task snapshots, persisted receipts and model identities are retained
outside the repository. Contract mocks and browser UI route fixtures are labeled
separately from actual model acceptance. Independent review is a separate Claude
Sonnet 5.5 subscription assessment of the exact candidate/evidence.

Production readiness remains **NO-GO**. No production credentials/data, live
connector acceptance, deployment, Native publication, service control, baseline
adoption or Option B change is included. Historical 549-file preservation,
UNKNOWN attribution and NOT PASS findings remain unresolved. All eight deferred
U1 criteria remain deferred. Separate Owner approval is required after R1 review.
