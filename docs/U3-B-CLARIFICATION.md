# U3-B: one bounded clarification continuation

Offline-only extension of U3-A `c9484ab6feeca1bfa16d0bc5a2701f045a232a41`
(tree `839635ab29aa31c85f5058853818bb92d3901230`). No production startup
registration, default activation, permissions, dependencies or UI changes.
Historical UNKNOWN / NOT PASS and Option B installation blockers remain unchanged.

## Existing components and contract

The U1 Task Store, lock, atomic writer, Task/Goal/Attempt IDs and Browser Read
Execution Reference remain authoritative. The ordinary V1 `continue` still
requires the exact original objective. A separate closed V1
`clarification_response` accepts only version, operation, clientSubmissionId,
conversationId, taskRef, expectedRevision, clarificationId and response.
Only the existing authenticated Main router can dispatch it. Native bearer
credentials confer no Main session or clarification authority.

The existing selection task runner has an explicit host-only
`clarificationEnabled` opt-in, default false. It reuses U2 selection, U3-A typed
discovery/get dependencies, server argument validators, existing Context services,
Tool Gateway and source leases, and U2-B synthesis plus its semantic reviewer.
There is no new store, planner, registry, permission system or scheduler.

## Durable bounded transitions

1. A completed ambiguous discovery receipt is saved first. The Task Store then
   records WAITING_CLARIFICATION, originating attempt/execution reference,
   original evidence hash, discovery arguments, fixed typed dependency,
   authorization/scope hashes and ordered candidates. At most five candidates;
   exact source identifiers at most 200 characters. Titles are bounded untrusted
   labels, not instructions. Task metadata does not duplicate source bodies.
2. A response claims that generation and reserves one ordinary U1 Attempt in the
   same locked revision/CAS transaction. The original Task, Goal and objective
   are unchanged. A duplicate resolves the existing receipt; a stale or concurrent
   different submission cannot claim another attempt or execute more reads.
3. A subscription model maps explicit Chinese/English language to an ordinal or
   null, never an ID, scope or permission. Null reissues a new waiting generation
   without reading. A changed selection is valid only before execution is claimed;
   a later reply cannot silently replace or erase an already performed read.
4. A fixed host entry reconstructs only the stored typed dependency. Current
   Owner context, provider sharing, authorization revision, fresh disclosed
   capabilities, source leases, evidence and cancellation are checked repeatedly.
   The new Browser Read attempt has its own prepare/consumed-consent receipt.
   Owner clarification itself is not approval or a source grant.
5. Exactly one new discovery checks complete coverage and the ordered candidate
   identities/fingerprints against the original receipt. Fingerprints exclude
   retrieval timestamps but include record contents, fields, title, link, original
   date and supplied source-update identity. Any change, missing/duplicate row or
   unverifiable evidence stops without detail. A fresh explicit discovery attempt
   is required; this consumed workflow cannot retry verification.
6. Only the validated stored ordinal's actual returned sourceId supplies the
   server-validated detail argument. A single detail read then feeds the existing
   grounded synthesis. Discovery labels are not evidence of detail contents.
   Source reads are durably reserved before dispatch, maximum three in the whole
   clarification workflow: original discovery, verification discovery, detail.
7. Task metadata distinguishes WAITING, PROCESSING, COMPLETED, FAILED, CANCELLED,
   INTERRUPTED and RECONCILIATION_REQUIRED clarification states. These are attempt
   lifecycle states, never overall Owner Goal completion. Old completed read
   receipts are retained as historical evidence.

## Failure, restart and evidence

Task truth, Browser Read receipts and conversation transcripts are separate existing
stores; no distributed atomic commit is claimed. Missing or altered origin/last
receipt blocks execution. An incomplete link/receipt/final-state write stays
interrupted or reconciliation-required with retained attempts and before/after
evidence. Restoring receipt bytes cannot reopen a terminal reconciliation state.
Startup never executes a waiting clarification, repeats a read, or resumes a
claimed attempt. An interrupted workflow requires a new explicit Owner action
for a new discovery attempt under the same Task/Goal; the original reply cannot
be replayed as recovery authority. No automatic retries, loops or fallback reads.

Main transcripts retain actual reply text and unifiedTask linkage. The existing
ownerGoalReference check is unchanged; this router does not attach a replacement
Owner Goal from reply prose. A transcript failure is reported as historySaved=false;
durable Task/attempt evidence still prevents redispatch.

Tests use disposable persistence and actual existing gateways with synthetic
transports. `scripts/u2/clarification-demo.cjs` separately uses GPT-6 Astra / High
through the existing ChatGPT-subscription client, tools disabled and API credits
disallowed. It records exact dialogue, source packs, Task snapshots, read attempts,
model responses and replay results. Deterministic contract tests are not semantic
model acceptance. Actual answers require independent evidence review.

## Limits before any further phase

No production or installed containment is attested. Only Main-authenticated,
bounded read clarification is supported; no cross-surface permission transfer,
writes, autonomous continuation, generalized replanning or migration/backfill of
old U3-A receipts. A source mutation after the verification snapshot is not
prevented by a database transaction: leases and returned detail identity are
checked, and the answer cites the actual read snapshot. Model interpretation and
semantic review are fallible. Missing freshness/version information is never
inferred from a hash alone; the fresh discovery is an actual authorized read.
Oversized/incomplete discovery cannot establish an executable clarification.
