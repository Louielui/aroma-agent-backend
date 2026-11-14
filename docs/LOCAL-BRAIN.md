# Isolated local brain candidate

This is a reversible local candidate, not a production cutover. The production
launcher, memory database, existing acceptance ledgers and cloud settings are not
changed. Model output and offline tests alone are not acceptance evidence.

## Run and stop

On the verified Owner Windows host, run:

```powershell
node "C:\Aroma\worktrees\local-brain-20261114\scripts\localBrain\launch.cjs"
```

The launcher verifies the installed model digest, checks the isolated port is free,
creates a new private data directory and starts the authenticated loopback page at
`http://127.0.0.1:18092/local`. Use the existing isolated Owner password locally;
never include it in chat, logs or review packets. Keep the terminal open. Ctrl+C
stops only the child created by that invocation. Do not start a second instance
over an occupied port. Check `isolated-launch.json`, the listener PID, and the
model reported by `/api/local/status`; an old READY message is not a new launch.

The portable Ollama runtime is separate and listens on `127.0.0.1:11435`, with
`OLLAMA_NO_CLOUD=1`, `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_KEEP_ALIVE=-1`.
The candidate uses Qwen3.5 9B Q4_K_M, digest
`56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90`,
with a 65,536-token context allocation and non-thinking structured generation.
The model and runtime are downloaded from their official distributions; Qwen's
Apache-2.0 model license and Ollama's MIT license remain applicable. This is not
a change to the production Claude runtime model.

## Existing components reused

The local adapter implements the existing LLM adapter interface. The existing
intake, goal planner, read selection, answer-plan computation and final verifier
remain responsible for understanding, tool choice, exact derivations and evidence
checks. Ollama JSON grammar and the actual host schema are both supplied: grammar
alone does not communicate field meanings. Unknown, incomplete, oversized or
failed model output is an explicit local error, with no provider retry/fallback.
If the local final verifier requires evidence but the source resolver says no
read domain applies, the turn fails with `local_evidence_decision_conflict`.
It does not release the unsupported draft or guess a tool to resolve disagreement.

The existing Model Center persists the host-selected `local:` model through its
revision and audit mechanism. Owner authentication, same-origin writes and a
route allowlist protect the isolated page. No dispatch worker or business write
endpoint is exposed. The synthetic inventory connector only implements existing
read operations; its data is explicitly not restaurant inventory. The existing
answer-plan derivation engine computes PAR shortages from numeric source fields.

## Cloud dependency boundary

| Component | Isolated candidate | Production dependency left unchanged |
| --- | --- | --- |
| Chat, intent, planning, read selection, answer verification | Local adapter / Qwen | Existing subscribed providers |
| Canonical preferences and recall | Read-only snapshot by default; explicit `--learning` uses an isolated durable copy through the same Gateway | Existing canonical store |
| Semantic memory search | Not connected in this candidate | Hindsight local embedding and reranker |
| Memory extraction and reflection | In `--learning`, Qwen extracts exact quotes and proposes reviewable summaries; no Hindsight/Bridge request | Hindsight LLM points to the subscription Bridge with GPT-6 Astra |
| Embedding | No model needed for snapshot lexical recall | `paraphrase-multilingual-MiniLM-L12-v2`, local |
| Reranking | Not used by snapshot recall | `mmarco-mMiniLMv2-L12-H384-v1`, local |
| Background indexing and consolidation | In `--learning`, existing capture outbox and consolidation worker run against the isolated copy and local adapter | Existing production workers unchanged |
| Summaries / reflection | Explicit Owner request, local synthesis, derived candidate with source-version checks | Existing Hindsight reflection unchanged |
| Delegated workers | Not enabled | Existing controlled dispatch and provider routes |

This candidate does **not** establish production or general worker independence.
Local learning is explicitly opt-in; see `LOCAL-MEMORY-LEARNING.md` for persistence,
approval and recovery boundaries. External Gmail, Drive and restaurant reads are also
not connected here. A future authorized connector may need internet without
using cloud AI; these are distinct properties.

The test host installs its transport fence before application imports. It refuses
non-allowlisted TCP destinations, the subscription Bridge and child-process model
launches. The adapter factory and auxiliary model roles also enforce local-only
selection. Every allowed/denied transport is audited. This is a process-level
application boundary, not an operating-system firewall or malicious-code sandbox.
Independent development review through Claude is outside that test host and must
be reported separately from local inference acceptance.

## Measurement and acceptance

The local presenter completes a selected pair of operand fields with the matching
source-declared computed column on that exact row. This repairs a captured case
where the model put arithmetic only in prose and the guard correctly removed it.
Completion adds a field selection with a discarded placeholder, never a computed
number. The existing answer-plan validator still owns arithmetic, row identity,
numeric availability and output limits. A single operand, ambiguous row or
conflicting declaration does not select a new computed field. Cloud presentation
is unchanged. This is not a general inference of missing business formulas.

Private `turns.jsonl` contains received time, source lookup durations, complete
model inputs, model IDs, first model token, load/prompt/generation durations,
tool durations, errors and final guarded output. The browser streams a clearly
marked provisional answer draft, then replaces it with the guarded final answer.
First helper token is not first answer text; neither is final completion.

`scripts/localBrain/accept.cjs <case>` runs three isolated HTTP repetitions and
retains raw SSE events, source input, timing and GPU residency receipts. Named
cases include greeting, preference, correction, inventory, missing, toolFailure,
injection and unauthorized. `--cold` unloads only the candidate model before each
repetition. It never opens an existing cloud acceptance ledger. Every recorded
answer still needs semantic review; the script does not convert HTTP success to
a quality PASS. Technical failures stop the case without automatic retries.

Compare the same questions and settings. The Owner's prior visual estimates of
29–36 seconds on Claude and 33–47 seconds on GPT are single observations, not
averages, precise baselines or evidence of a specific bottleneck. No new cloud
comparison calls are authorized by this local implementation.

## Recovery

Stop the isolated launcher, keep its private evidence and return to the unchanged
production page. Do not restore over production memory or alter paused ledgers.
No service registration, HKCU change, production merge, ACL change or credential
creation is part of this candidate. A future production cutover requires its own
reviewed exact-version package and authorization.
