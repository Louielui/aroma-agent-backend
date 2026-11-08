# Independent AI-list retest entry

This candidate extends the existing authenticated Action Gateway, atomic Action
Store and resident Bridge selection. It creates no ledger during installation,
does not resume an old window and does not authorize deployment or model usage.
The PR151 answer and evidence guards remain unchanged.

The proposed fixed root is `71adc697-16fd-4df3-9cbd-59e94d16c5c1`, identity
`owner-ai-delegation-list-retest-20261108`: one turn, at most six helper
reservations including failures, retries and child work, zero websites, Claude
Opus 5.5 / Medium through the existing subscription only. The expected three to
four helpers are an estimate, not an entitlement to additional attempts.

The following roots must remain paused and byte-identical throughout preparation,
deployment and acceptance; they are not closed, reset, credited or reused:

1. `f1d1f674-3820-4619-85ed-3b8fdeb01e98`
2. `6181f0ad-90d7-4c89-9886-39671ce75a05`
3. `c31f97a9-f3d5-4510-a04f-ec257a843747`

Activation uses the existing Owner-only `usage_acceptance_activate` operation
with exactly `op`, `rootId` and `predecessorHash`. The binding is the existing
contract `hash()` of the ordered array of all three `{rootId, hash: hash(record)}`
objects, in the order above. This is a record binding, distinct from the raw-file
SHA256 hashes used to prove byte preservation. Every parent must retain its
original profile, be paused and have no unfinished turn, child or unresolved
attempt. Reads and writes revalidate the binding; drift fails closed. Parent
locks precede the new-root lock in historical order. Persistence failure must
prevent activation or dispatch. Existing earlier activation contracts stay
compatible.

Resident backend and Bridge keep the previous root selected while the new file
is absent. Explicit separately approved activation requires the existing idle
witness; both residents then resolve the same durable new selection on each
call. Wrong actor, root, model, effort, altered limit, missing scope, repeated
activation, ordinary resume, development profile reuse and usage extension are
refused. Restart and child creation do not refund or escape reservations. The
seventh helper and first website are refused before sending. No new provider,
credential, permission, route, dependency or accounting store is introduced.

Offline tests include the actual Bridge, Action Gateway and intake route with
local provider substitutes, independent Node hosts, parallel children, restart,
pre-send failure, persistence failure and each parent's drift/lock contention.
These establish accounting and entry behavior only. They do not establish real
answer correctness, provider availability, visible UI behavior or speed.

After exact-version deployment approval and zero-model technical checks, a
separately approved single acceptance asks exactly: “你可以派工的 AI 有哪幾個？”
Use the saved two-message greeting history unchanged, without the failed answer
or the expected result. The host pauses automatic memory only for that approved
window and restores its original setting after completion or stopping. Do not
dispatch a Worker, perform business writes or write long-term test memory.

Retain the model input, source/tool results, raw output, answer verification and
guard transformations, final payload and actual visible page. Distinguish
configured roles/model defaults from actual execution receipts, permissions and
availability. Preserve substantive limits and accessible details without
replacing a correct answer with background inventory or empty headings.

Measure browser send-to-network completion, server elapsed time, provider calls
and observed phases separately. Report actual reserved, sent, failed, unresolved
and unused counts. Exclude pre-send observation from request latency and do not
sum nested durations. If no render-completion event exists, label the first
observed complete page as an upper bound. One case proves neither average/P95
latency nor general delegation completeness. Stop new calls on the first
substantive or unknown failure, scope/model/version drift or exhaustion; settle
in-flight work before pausing. Never forge reconciliation when unresolved work
prevents pausing. All previous failed runs remain intact.
