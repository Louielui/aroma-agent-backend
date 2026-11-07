# Transient recall and retention opt-out

The PR147 native acceptance request `adcb4014-756c-4e5c-b2f1-a32e6e7ca3e3`
resolved the later subject correctly but did not retrieve its canonical correction.
The existing record remained active and unchanged. Saved-input offline replay found
that `recallContext` removed the preceding Owner question because it contained a
retention opt-out. The search then contained only the current pronoun-based request.
This is a confirmed loss of search context, not proof of every semantic ranking failure.

## Boundary

Use the existing capture policy's sensitivity check independently of retention when
building transient recall context. A request not to save long-term memory still allows
the supplied conversation to explain a read request. Sensitive content remains
excluded even when the same message also contains an opt-out; the opt-out must not
mask the sensitivity check. Sensitive current queries fail closed before readers run.

The existing limits stay intact: the last two Owner questions, 450 characters per
question, 2,000 combined query characters, and at most four citation pointers from
bounded recent assistant messages or explicit references. Assistant prose never enters
the search. Pointers are not evidence: the existing Gateway re-reads authorized current
canonical records. There is no cross-request cache, additional source, model call,
dispatch capability, or persistent working-memory store.

Historical mail intent uses this same transient boundary, retaining the existing
source authorization and visible failure handling. This does not grant mail access.

`capturePolicy`, capture queue/worker, preference approval, conversation archive,
Gateway authorization and indexing are unchanged. Automatic capture enabled or not,
an opted-out turn is still skipped with empty text and zero extraction attempts;
restarting the capture worker cannot retain it. Conversation archive retention is a
separate existing behavior, not long-term learning.

## Evidence and limits

`src/memory/recallRetentionBoundary.test.js` covers saved Owner input, role and text /
content consistency, explicit redaction, sensitive-plus-opt-out cases, citation hints,
mail denial, bounds, no cross-call context, and enabled capture across restart. An
integration case uses the actual intake, Gateway and capture with an in-memory
canonical store and an offline model adapter. It asserts the retrieved source reaches
the model prompt, the reply survives, and the canonical store is unchanged.

These tests do not prove native model recall, source ranking over the production
corpus, UI behavior, or latency improvement. Both existing acceptance ledgers remain
paused and byte-identical. No new usage definition or allowance is included. Deploying
this candidate requires separate exact-SHA approval; live acceptance requires a separate
bounded authorization and must not reset or reuse the exhausted paused ledgers.
