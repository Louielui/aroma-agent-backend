# Isolated local memory learning

This candidate extends the local brain without changing production configuration,
memory, scheduled tasks, service registration, permissions or paused usage ledgers.
It does not migrate the production Hindsight database or claim semantic equivalence.

## Audited dependency paths

* `scripts/memory/startHindsight.cjs` configures Hindsight extraction/reflection as
  OpenAI-compatible `gpt-6-astra` through the subscription Bridge on 8091 (8094
  for its separate acceptance mode). Changing the chat adapter alone leaves this
  dependency. Embedding and reranking are already local MiniLM models, not cloud
  inference; a first installation may still need model-file downloads.
* `src/memory/hindsight.js` sends index/extract and reflect/consolidate requests to
  that engine. `structuredStore.js` normally uses the Bridge for canonical storage;
  its native alternative uses the production PostgreSQL role/database. Neither is
  used by this isolated learning composition.
* Existing `memory/runtime.js` journals events, drains the outbox, indexes records
  and runs `consolidationWorker.js`. `governed.js` controls scope, attribution,
  exact-version approval, source hashes, supersession and audit. These are reused.
* Background email analysis/indexing, briefings, delegated code workers and their
  subscribed provider routes are NOT migrated here. They are not started or exposed
  by this host. Production can still depend on cloud AI; it has not been changed.

## Explicit launch and persistence

After source review, the Owner may stop only the previous isolated launcher and run:

```powershell
node "C:\Aroma\worktrees\local-brain-20261114\scripts\localBrain\launch.cjs" --learning
```

The default command without `--learning` remains the read-only snapshot mode.
Learning uses the installed Qwen3.5 9B through loopback Ollama, retaining all existing
transport fences. There is no fallback to a subscription or model API. No new
runtime package is installed: the verified Node 24 host supplies SQLite.

`C:\Aroma\local-brain-runtime\learning-v1` contains an explicitly isolated SQLite
canonical copy, quote index, inference reservations, audit chains and the existing
outbox/consolidation settings. The sourced snapshot seeds an empty copy once; it
does not overwrite learned records on restart. Production PostgreSQL and Hindsight
remain untouched. This backend implements the existing structured-store injection
contract; it is never selected as a production fallback.

New Owner turns use the existing demo-router memory journal. Opt-out and sensitive
content exclusions run before queue persistence. The existing background interval
drains before attempting consolidation in this composition: starting both together
previously starved consolidation behind the active drain. Other compositions keep
their existing default sequence. Assistant statements remain attributed claims.

Extracted quotes must occur verbatim in their source. Consolidation candidates use
the existing policy validator, source/learning-context hashes and atomic commit.
Preference/decision candidates are not active preferences. Owner approval still
requires the exact current revision and evidence; model prose cannot approve it.
Reflection/summary is an explicit Owner operation over specified active evidence;
it produces a derived candidate, not a verified fact or autonomous authority.

The isolated page links to the existing memory catalogue at `/local/memory`.
Owner authentication and same-origin checks precede its limited route set.
Agent-token grants, business work, backup, rebuild and credential routes are denied.
The reused catalogue contains controls for other deployments; unsupported operations
are refused by the server, never silently executed. `/api/local/status` identifies
the local engine, background states, failure codes and persistent inference counts.

## Failure, concurrency and recovery

The durable inference reservation is committed BEFORE a local model send. A completed
result can be reused for the same scope/model/input. An interrupted or failed attempt
is not automatically resent on restart; its reason and reservation remain available.
The existing retry schedule may recheck a job, but cannot bypass that reservation.
Transient busy state is checked before starting background work. A second live
learning owner is refused. A dead-process owner lock can be recovered under an
exclusive recovery guard; live, inaccessible or unknown owners fail closed. A
crash during guard acquisition requires manual diagnosis, not a blind lock deletion.

Ctrl+C sends the child a fixed graceful-stop message through its private parent
pipe, stops new background ticks and closes storage after current work settles.
The launcher has a bounded forced-stop fallback. Any interrupted reservation stays
unconfirmed. Never delete the database or clear reservations to make a test pass.

Return to read-only mode by stopping this isolated launcher and omitting `--learning`.
Keep its private directory and failure evidence. No production restore is required.

## Acceptance and limitations

`scripts/localBrain/learningAccept.cjs` is a bounded real-local-model test, with no
HTTP service or cloud inference. It runs three fresh isolated fixtures through the
actual five-second background timer: extract, candidate, permission refusal, explicit
SIMULATED fixture approval, index, close/reopen, recall without duplicate processing,
and source-bound summary. Fixture approvals do not authorize real Owner preferences.
Raw model deltas/inputs, timing, egress receipts and failed runs remain in the private
candidate evidence directory. The exact source identity must match final review.

Retrieval is lexical over canonical records and verbatim quote documents, not a new
embedding/reranking implementation. Paraphrase-only recall can miss. Summary quotes
establish source pointers, not that every synthesized assertion is true. Candidate
review remains necessary. This is in-context/structured-memory learning, not model
weight training. Background mail, automatic general summaries and arbitrary workers
are not enabled. A local host is independent of cloud inference, not automatically
offline when external business connectors are later authorized.

Development review through the existing Claude subscription is outside the fenced
runtime and is reported separately. No deployment or paid API fallback is authorized
by local implementation or test results.
