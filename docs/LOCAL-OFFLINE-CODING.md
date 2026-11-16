# Isolated local coding candidate

This is a standalone, candidate-only host entry, not a production chat feature.
It reuses `isolatedCoding`, `WindowsSandbox`, `LocalAdapter`, the sealed Owner
approval store, Action Store and UsageBudget. No second queue or budget is added.

## Fixed initial scope

- Synthetic feature: implement `orderBoxes(current, par, packSize)` in
  `src/stock.js`; return the minimum whole boxes, preserve input validation.
- Synthetic bug: fix minute rounding in `src/duration.js`, preserving validation.
- Each package contains its immutable three-test acceptance file. No production
  repository, business data, credentials or existing work order is imported.
- The initial runner accepts only these packages. General repository exploration,
  arbitrary commands, dependency installation, other languages, production chat
  dispatch and deployment are outside this candidate.

## Execution boundary and evidence

1. Inspect the source/material hashes without activating a ledger:
   `node scripts/localBrain/code.cjs inspect`.
2. Only after separate Owner approval of this exact candidate and local call
   allowance, execute `node scripts/localBrain/code.cjs run` in its clean isolated
   `codex/` worktree. A real interactive terminal must confirm the displayed
   `LOCAL-CODE <material hash>`; do not automate this response.
3. The existing Windows Sandbox must be available. There is no host-execution
   substitute. The original tests must fail before coding starts.
4. Qwen3.5 9B, digest pinned by `deploymentProfile.json`, receives text and the
   replacement-file schema. It has no shell, file tools, network or delegation.
   The host alone validates scope, stages disposable input, runs tests and retains
   results. An assertion failure allows at most one measured correction.
5. Actual candidate execution is in Windows Sandbox with networking, vGPU,
   clipboard, audio/video and printers disabled. Existing guest boundary probes
   and source/output hashes must verify. A Sandbox or transport failure stops.
6. Passing candidates are retained in separate disposable Git repositories with
   original/candidate commits, no remotes and hooks disabled. Tests cannot change.
   A green receipt is not independent code review, deployment or permission to
   apply the result. Final status explicitly requires candidate review.

The host model transport allows only the pinned literal loopback origin, GET
`/api/tags` and POST `/api/chat`, with redirects refused. No subscription client,
API fallback or background learning is connected. This is application transport
containment plus a network-disabled execution guest; it is not evidence that the
entire Windows host has been physically disconnected. Physical offline model
availability remains an explicit acceptance check.

## Proposed allowance, not activated by development

Root `cddc36a0-9781-4f2b-8630-e34a24c50814`: two coding slots, at most two local
calls each, four total (expected two), zero websites, cloud calls or background
batches. The existing persistent reservation/native-send gate covers repairs,
children, concurrency and fresh service instances. Failed calls are retained and
do not refund capacity. Source commit, digest, phase and deadlines bind the run;
expiry or transport failure stops it. The entry refuses an existing run directory
and never resumes, resets or replenishes it automatically.

Evidence stays under the candidate artifact directory, including approved
material, local model input/output and timing, Sandbox RED/GREEN and boundary
evidence, exact patches, Git commits, final paused budget and any failure. Do not
replace old failure receipts with a subsequent result.

## Acceptance and recovery

Both real local-model tasks must produce correct source, immutable tests must
show measured RED then GREEN in the offline guest, and source/patch/Git hashes
must agree. Report actual calls and first-token/full model timing, plus Sandbox
and total task time separately. Deterministic doubles are not this acceptance.

No formal service is installed or restarted. Existing automatic memory and all
paused ledgers stay unchanged. To stop, interrupt the entry; the existing Sandbox
executor stops only its own verified job. Unconfirmed Sandbox shutdown blocks
further work. Do not delete a lease or rerun after failure: inspect the retained
job and use the existing executor's bounded recovery for its exact UUID, with
Owner authorization where required. Discarding a candidate never requires a
production rollback; never reset or overwrite the formal repository.
