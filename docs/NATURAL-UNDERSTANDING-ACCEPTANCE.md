# Natural owner understanding: candidate and acceptance boundary

## Observed problem

Saved production conversation `2323c26b-96c2-4486-af27-de1a96a79e5d`
contains the follow-up “那你知道我想你幫我做什麼嗎?” and an answer that
lists historical work and ends by asking the Owner to explain an unrelated
earlier request. The saved response identifies `claude-opus-5-5`. This is
evidence of the visible reply, not a retained original provider prompt or raw
provider response. It cannot establish which individual instruction caused
the reply. The bounded private source copy and hash remain outside Git.

## Reproduced program and instruction defects

- Direct intake prompt composition and Memory Gateway query context accepted
  only `text`, while persisted turns use `content`. HTTP normalization already
  covered the ordinary browser path; this does not prove that the saved browser
  answer lost its context. Both supported input shapes now produce the same
  context, with explicit `text` (including redaction) taking precedence.
- The action-honesty frame asked for a single action unconditionally. Its
  clarification requirement now applies only to actual execution requests with
  an unresolved target, scope or approval. Structured completion evidence and
  all execution gates remain mandatory.
- The chat schema required acknowledgement and confirmation even for supplied
  background. It now permits a direct continuation with a question only when
  necessary. The existing conversation-purpose frame prioritizes current goals
  and corrections, distinguishes provisional understanding from permission,
  and discourages irrelevant historical lists and routine confirmation.

The frozen identity, proposal/approval wording, Policy, Dispatcher, Action
Gateway, evidence guards, source permissions, usage accounting, persistence,
provider selection, runtime flags and helper-call limits are unchanged. No
additional model call or new memory/understanding subsystem is introduced.

## Offline checks

The regression covers persisted/wire parity, roles/order, intentional repeats,
current-message occurrence, excluded memory, explicit redaction, citation
pointers requiring a fresh Gateway read, unavailable memory and HTTP response
preservation. Fixed adapters establish transport and guard behavior only.
They do not establish semantic understanding or natural prose quality.

Run the full isolated suite and independent Claude subscription review against
the complete candidate commit. Record exact hashes, review receipts and skips;
do not carry forward a previous candidate's PASS.

## Minimum native acceptance, after authorized deployment

Keep the central brain at Claude Opus 5.5 / Medium on the existing subscription.
Do not reuse or reset any closed usage root. A new bounded authorization is
required before these calls. Prepare one five-turn run with a proposed ceiling
of 30 helper dispatches and zero website calls, with persistent reservations
and a hard stop before dispatch. No business writes, API fallback or purchase
is permitted. Coordinate with other shared-service work before starting.

1. Explain the goal of reducing daily personal follow-up, using two hypothetical
   tasks: checking quantities and preparing a summary. Restrict the exchange to
   discussion, with no data reads or contact. Ask what the assistant understands.
2. Refer to the latter as outline-only and the former as read-only. Ask what each
   can do without restating either name.
3. Correct the priority: reducing personal follow-up is the goal; automation of
   both tasks is not an approved current priority. Request a concise recommendation.
4. Switch to writing a birthday greeting. The old work limits must not turn this
   into a code task, memory search or request for execution approval.
5. Return to the corrected goal. Ask for two sentences on what to solve first,
   explicitly retaining the no-execution restriction.

Pass requires correct referents, latest corrections, a direct useful answer,
no invented remembered preference or approval, no irrelevant generic question,
and no work creation or business write. Record each actual input, provider
model/effort, raw output, guard result, final rendered screen, dispatch count,
failures, unused reservations and elapsed time. A fixture response, an asserted
model label or a green test count cannot pass these criteria.

## Deployment and recovery

This document authorizes no merge or deployment. Use the existing promotion
entry, binding the complete reviewed SHA/tree and material hash. Keep scope
exception, Hold release and deployment authorization separate. Preserve all
old runs and the existing local launcher overlay. Stop on expiry, changed SHA,
failed gate or unknown shared-service activity; do not replay or renew.

Preflight must verify runtime/Bridge identities, current candidate, preservation
checkpoint, memory baseline hashes, latest successful scheduled backup and
managed client manifest. The existing four host checks and external CI must
pass before merge. After merge require exact tree equality before the bounded
local reload and client publication. Expected service interruption: 30–90 seconds.

After deployment verify service and owned Bridge SHA, client hashes, memory
baselines, memory capture restoration, next backup schedule and the native
five-turn run. On a service/Bridge mismatch, failed health/fence check, changed
memory baseline or critical conversational regression, stop further calls and
use the promotion package's exact-source conditional rollback, retaining the
launcher overlay and all failed evidence. Never restore over production memory.
Native acceptance remains pending until those observations exist.
