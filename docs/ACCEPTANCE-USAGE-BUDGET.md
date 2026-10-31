# Acceptance usage budget — integrated PR111 candidate

## Release boundary

This extends the existing Bridge, Action Gateway, Action Store, worker invocation
context and provider egress boundaries. It does not install another planner,
dispatcher, memory system, credential, paid channel or service. PR111 includes the
existing reviewed dispatch/latency change; that older review is not acceptance of
this complete candidate. Hold remains in force. No automatic production activation.

The single existing Owner approval is fixed to run
`a57b0b98-3638-42b2-8e65-d5f220261031`, identity
`owner-context-understanding-acceptance-20261031`: nine submitted turns, 40 host
helper inference attempts, two existing website-tool attempts. Helper model is
`claude-opus-5-5`, effort `medium`. There is no client-selected grant, root ID,
limit, expiry extension, purchase, API fallback, new credential or P02-C change.
Host attempts and CLI-reported vendor usage are separate measurements. These
counters do not claim account-wide billing or visibility into vendor-internal work.

## Allocation and durability

The same existing operational data resolver is used by both the LocalService
backend and Owner bridge. The live canonical path is
`C:/Aroma/aroma-agent-backend/data/scheduler-action-runs/usage-budget/`.
Using USERPROFILE here would create different ledgers for the two identities.
The existing data-directory ACL already grants the required access; no ACL edit
is part of this change. Normal node:test uses the existing data redirection.

A UUID root is atomically saved using the existing flushed Action Store and an
exclusive per-run cross-process hard-link lock. Every reservation is durable
before starting a model process or issuing `turn/start`. Failures to acquire the
lock or persist evidence refuse dispatch. Contention is visible `usage_busy`,
never an implicit unmetered retry. A failed or uncertain reservation remains spent;
retries reserve a new attempt. No automatic refund or stale-lock deletion.

Counters distinguish reserved, host-dispatched, failed, succeeded, unresolved,
reserved-not-dispatched and available. Native dispatch basis is CLI process start
or provider `turn/start`, not a billing assertion. An RPC acknowledgement is not
success: the surrounding operation must complete. Crash uncertainty stays visible
and blocks close/pause. Owner reconciliation requires idle services and dead
recorded host/dispatch processes, records `interrupted_unknown`, and refunds
nothing. A live/unknown PID or stale lock requires inspection, never reset.
Existing run JSON, event timeline, failed attempts and evidence remain retained.

The fixed profile survives service restart and candidate replacement in the same
runtime directory. Re-activation is idempotent. Closed roots cannot re-open.
Children inherit the registered root, turn and remaining allowance. Re-created
workers do not mint capacity. Unbound requests are refused during the active
exclusive acceptance window. Interactive legacy coding workers, whose internal
turns cannot be metered, and API model alternatives are refused in this window.
Outside an active run, existing ordinary model behavior is retained.
Child membership is durable in the root audit, linked to the existing worker-run
trace. The scope used for a particular worker invocation is local to that call;
it is not persisted as a reusable authorization on the worker record. A later
ordinary run after acceptance cannot accidentally reuse a finished child scope.
Every native Claude command is checked, including unpinned and alternate print
syntax. Only the exact existing authentication-status argv and exact model-list
control argv/input packet are metadata exemptions; neither can contain a task.

## Owner front door and evidence

The existing authenticated, same-origin `POST /api/v1/scheduler-actions` and
existing authenticated bridge `/scheduler-action` accept the exact whitelisted
operations `usage_status`, `usage_activate`, `usage_bind_turn`, `usage_pause`,
`usage_close`, `usage_reconcile`. Activation requires an idle witness from the
bridge and existing workers. Activation does not release Hold, approve promotion,
merge, deploy, write business data or change general authorization.

A bound turn carries `x-xiangxiang-usage-turn` at the actual intake front door.
The host assigns the request ID and signs cross-service scope metadata with the
existing bridge secret; the token is never included in prompts or evidence.
Unsigned, modified, replayed, cross-conversation and finished scopes are refused.
The intake wrapper captures actual input and final response; existing evidence,
recall and work-offer guards capture input/result without bypassing protection.
Provider/native captures retain raw output where available. Files are bounded,
written exclusively, and referenced by exact-byte SHA256 in the run timeline.
Headers, environment and credentials are excluded. Evidence is private operational
data with existing directory ACLs, not PR content or public check output.
A refusal persists a turn-level code and is shown as a precise final error even
when an intermediate stage catches errors and attempts a generic fallback.

## Measured offline boundary coverage

`src/actions/usageBudget.test.js` and
`src/subscription/usageBudget.integration.test.js` use injected providers,
disposable stores and loopback HTTP only. They cover allocation 40/41, websites
2/3, nine/ten turns, concurrent promises, independent Node host contention,
reload/restart persistence, children, retries, audit failure, wrong model/effort,
unsigned scope, turn replay, final HTTP presentation and exact evidence hashes.
A transport survey covers the existing API/CLI/native RPC boundaries. Offline
receipts are not real model invocations, production hard-stop proof or live recall.
The full isolated suite and a new independent review must bind the final commit.

## One shared deployment window, after exact-version approval

1. Revalidate PR111 exact head, tested tree, current base, full-suite and fresh
   independent review receipts. Keep the superseded PR111 approval helper blocked;
   never resume or relabel its old needs_attention run. PR109 is not deployed.
2. Prepare the existing Owner-entry material bound to the complete new SHA, exact
   security-scope paths, operation list, backup/restore and memory baseline proofs.
   Scope exception, this-commit Hold release and deployment authority remain three
   separate ten-minute sealed decisions; no approval is minted by this document.
3. Use one agreed service window. All other acceptance/model work remains paused.
   Capture running SHA/PIDs, ownership, listener health, workflow idle and byte hash
   of the existing launcher overlay. Run full existing gates and publish only real
   measured host checks. Merge only after they pass; verify merged tree equality.
4. Update only the existing runtime/service, owned bridge and approved existing
   managed client/HKCU entries through the unchanged promotion protocol. Preserve
   launcher bytes. Expected interruption remains approximately 30–90 seconds,
   subject to the actual reviewed package and idle checks. No new service or ACL.
5. Verify deployed source/boot/bridge SHA, authentication refusal, existing memory
   health, the two original version-4 memory records and backup schedule/state.
   Inspect the deployed usage module hash and exact canonical ledger path; both
   identities must observe the same root. Do not spend live calls to fill a quota.
   Never make 41 real helper calls or three real website calls for a cap test.
   Re-run offline boundary tests against exact deployed source with isolated data
   and fake transports; production status and source identity remain separate proof.
6. Only after these checks, activate the same original profile once. Bind each of
   the original nine UI turns through Action Gateway before sending it. A browser
   acceptance transport may attach the bound turn header to the existing real
   /demo request; it must not stub UI responses, alter prompt/history or replace
   memory/tool/model dependencies. Capture model input, raw result, guards and
   visible UI for each case. Check budget after every turn; stop at any failure or
   exhausted reservation. Do not add calls to exhaust the allowance.
7. The original cases remain: self URL plus browser clarification (2), missing
   prior arrangement (1), unresolved three-person reference (2), topic change and
   a normal official website (2), both existing positive memory baselines (2).
   No business action is authorized. No new outage test against production.

Stop before effects on changed SHA, stale/expired approval, failed gate, foreign
service, busy workflow, contradictory runtime, unavailable ledger/evidence or
unexpected memory integrity. Before merge there is no runtime rollback to do.
After deployment failure, use the existing conditional exact-source forward-history
rollback to the captured prior runtime, retained launcher and approved client/HKCU
state. Do not restore over production memory or erase budget/failure records.
If rollback restores a version without this protection, live acceptance stays
stopped; the same run and counters must be retained for a later reviewed repair.

## Remaining acceptance

Until the exact candidate has been approved, deployed and checked, production still
has the old recording-only bridge. Original acceptance consumption remains zero.
An isolated green test count, model review verdict or architecture row is not
production enablement. Automatic next backup firing and true model recall remain
separate observed checks. The final delivery report provides exact SHA, actual
checks, independent-review usage, remaining gates and one concrete approval entry.
