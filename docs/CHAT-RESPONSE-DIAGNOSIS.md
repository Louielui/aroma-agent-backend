# Chat response diagnosis, preference continuity and bounded waiting candidate

## Observed baseline

The retained post-PR143 request `938aec05-1d87-4709-ba5d-a955c5c98a12`
took 49.876 seconds using four sequential Claude Opus 5.5 / Medium subscription
calls. The calls took 6.112 seconds (business intent), 14.900 seconds (goal
understanding), 15.616 seconds (answer) and 4.371 seconds (final knowledge
requirement), totaling 40.999 seconds. The remaining 8.877 seconds have not been
fully attributed. These nested provider measurements are not pure thinking time.
The preceding 49.005-second observation is not a controlled benchmark, median or
proof of a speed improvement. No Astra-versus-Sol runtime experiment occurred.

Both requested historical codes were recalled correctly. The exact approved
concise-report preference was present in the planner and answer inputs. The raw
answer nevertheless contained 500 characters, full timestamps and document IDs;
the guards and visible answer retained it. This failure does not prove memory
deletion or failure to store the preference. The test stopped on that substantive
formatting failure; other planned cases were not executed.

The source prompt also mandates document IDs and dates. This is a plausible
competing output instruction, not proof of the model's internal cause. IDs are
currently parsed from previous assistant text to resolve later source references.
Removing them without a source-reference replacement would lose follow-up context.

## Confirmed integration defect fixed in isolation

The existing social and supplied-text/general-definition fast paths returned
before memory assembly. Consequently they skipped approved communication
preferences as well as expensive topic recall. A greeting or bounded translation
could receive no approved preference even when a normal conversation did.

Both paths now use the same validated preference read and prompt block as normal
recall. They retain the chat-only, existing provider-sharing, READ_ACCESS and
XIANGXIANG_MEMORY gates. Only at most eight private Owner-approved records with
matching content hashes are admitted. No semantic memory search, mail lookup,
extraction, planner, verifier, source read or additional model call is added.
Each turn re-reads the canonical gateway; there is no cross-turn cache. Existing
unavailable/partial status and context-derived privacy markers are preserved.
This does not activate or approve a preference or grant action authority.

The original ten regression cases produced six failures before this change.
Extended integration tests exercise private scope, Owner identity, content hash,
read-disabled/sharing-disabled cases, failure redaction and fresh preference
corrections using the real gateway with an isolated store. Their answer model is
inert: they prove delivery and call count, not real-model compliance or speed.

The retained native output replay separately preserves the original final answer
and recall, route and offer guard results, including the known formatting failure.
Its two scripted intent opinions reuse one retained output; five scripted calls
must not be described as the original four native sends or live UI acceptance.

## Whole-pipeline conclusions

Two further waiting defects are fixed in the same isolated candidate:

- The per-turn final-verdict cache formerly retained only a settled result. Eight
  simultaneous requests therefore started eight verifiers. It now retains the
  pending promise too: all callers share one verdict, including unavailable or
  malformed outcomes, and no automatic retry is introduced. A new turn still
  gets an independent verifier. The verifier input, source obligations and
  release policy are unchanged. The retained native case used one final call;
  this concurrency defect is not presented as the cause of that case's delay.
- Claude completion formerly awaited authentication metadata and then model
  catalogue metadata. Both exact metadata-only CLI operations now start together
  and both must settle before completion dispatch. Login failure retains priority
  if both fail. Cancellation reaches both children; failures send no completion.
  Nothing is cached across calls, so revocation is checked on the next send. This
  overlaps preparation, not model calls. An unauthenticated attempt can now start
  catalogue metadata before auth finishes, but cannot dispatch a user prompt.

The original seven concurrency tests had five failures before the change. The
successful paths and refusal cases run with inert provider fixtures, with explicit
barriers rather than timing thresholds. They prove overlap and dispatch ordering,
not native speed. The retained case spent 4.560 seconds in total provider preflight
across four calls; this includes more than the two metadata operations and is not
a promise of 4.560 seconds saved. Model generation and other phases remain.

1. Ordinary questions can pay for several serial control decisions before and
   after generation. The business classifier, source-planning contract and final
   knowledge requirement are different gates, so they cannot simply be removed
   as duplicate reasoning. The final verifier sees Owner text and availability,
   not the draft or preference; it cannot enforce response style.
2. A fast path must preserve the communication preference and current context.
   Broadly bypassing understanding for short text would regress corrections and
   references. This candidate changes no eligibility rules or business gates.
3. Main-body concision and evidence need an explicit shared output contract.
   Preserve canonical source pointers in the existing result/archive/UI flow,
   then render concise source labels and expandable details. Do not truncate
   arbitrary text or hide material limitations. A prompt-only edit is not proof
   of compliance; another rewriting helper would add latency and usage.

The next broader latency experiment should first use the existing measured phase data
to design one understanding contract that can supply reusable, validated facts
to existing Planner/Dispatcher/Policy gates. It must retain independent business
consensus where required and fail-closed retrieval obligations. A change to
control responsibility needs saved-output differential tests and independent
review before any live experiment. The present patch does not implement that
consolidation or claim the four-call path became one call.

## Delivery boundary

Candidate only; runtime brain and reasoning effort stay unchanged. No new usage
profile, run, credential, permission, business write, merge or deployment is
included. The existing latency root remains paused with two rounds and fourteen
helper attempts remaining and no website calls. Ordinary repository review uses
its separate pre-authorized subscription workflow, not that acceptance balance.
Record exact full-suite and independent-review evidence for this candidate before
requesting any exact-version release. Do not spend acceptance calls merely to
demonstrate a lower character count, and do not call this whole objective complete.
