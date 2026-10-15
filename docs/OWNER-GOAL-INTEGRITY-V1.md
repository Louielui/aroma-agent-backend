# Owner goal integrity V1 — offline candidate

The original procurement request asked for a daily schedule, complete supplier
lists and a Costco cart without checkout. A read reply was returned instead.
This candidate preserves the entire accepted Owner objective and its mandatory
clauses through the existing Goal Decomposer, intake routing, capability lookup,
task/conversation stores, Action Gateway evidence and final presentation.

`ownerGoal` is additive reporting metadata, not an agent, executor, dispatch
queue, schedule or permission grant. It contains the exact original objective,
required outcomes and steps, declared capabilities, authorization requirements,
status, completion receipt references, blockers and limitations. Scope version
and catalogue hash bind the metadata to its original request. No model can add
a capability to the registry. Exact Owner clauses remain mandatory when the
model omits a step, emits an invalid mapping or the fact plan is refused.

New Goal Decomposer output includes exact-clause outcome mappings in the existing
single call. Legacy saved plans without these fields remain valid. Only current
Owner text can supply a goal or an attributed Owner instruction. Source material,
history and model prose cannot grant authority. Ordinary informational answers
keep their existing behavior; action/recurring requests receive the host-composed
whole-goal status instead of speculative action-completion prose. A model mapping
cannot promote an untracked informational question into an action goal. Retrieved
rows and source limitations remain visible through the existing deterministic
read formatter, with the draft action narrative excluded. The canonical reply is
also the archive reply; ancillary model judgment, offer and next-step fields
cannot retain contradictory completion claims.
Host-originated clarification questions are carried separately and stay visible
beside the incomplete goal status. Arbitrary model action prose is not restored.
All existing structured proposal/clarification outcomes are rebuilt with the
existing grounded-reply formatter; source-bound host recommendations reuse their
existing decision-advice renderer. Model mode, offer and prose alone do not
establish host provenance, proposal creation or completion. Informational and
capability questions are excluded with the existing router before the bounded
imperative recurring-request admission rule.

Investigation `completed` still means that its request handler finished. Its
separate `goalStatus` is never derived from that state. `GOAL_COMPLETED` requires
host-verified, complete evidence for every mandatory outcome with matching goal,
outcome, capability and current scope hashes. A source read alone proves neither
an action nor a complete business outcome. Incomplete coverage and failed reads
remain explicit blockers.

The existing scheduler pause/resume chat gateway binds new goal metadata to the
same exact prepared proposal ID/hash and target, without changing its RPC shape,
display requirement, nonce, approval, cancellation, expiration or recovery rules.
Only its authenticated host-returned verified run plus matching definition and
desired-state readback can complete that outcome. An inverse gets a new goal
and binding and still requires the existing separate approval. Old receipts with
no goal metadata are not upgraded or granted new permissions. The generic proof
helper requires a trusted host receipt verifier; it is not exposed to clients or
models and must not be passed model-provided evidence.
Premature restore requests preserve the original binding. A new inverse goal is
created only for an actual host-created inverse whose new goal binding succeeds
and whose prior whole goal is already complete. Restoring one verified child of
a partial compound goal retains that whole goal and every unresolved outcome;
inverse execution cannot turn the remaining work into a completed goal.
Pure acknowledgements and permission questions retain the prior goal unchanged;
they supply no execution evidence. New compound business requests, even when
ambiguous, unsupported, refused, conditional or awaiting clarification, establish
their own unbound complete objective and retain all earlier independent goals. A
closed acknowledgement in the ordinary intake route likewise keeps the saved
goal, without a new model call, source read, task execution or approval. A
free-form inverse that cannot be exactly bound preserves the original goal rather
than replacing it with an unbound goal. Every prepare request, including semantic
reference wording and refused attempts, records its own full current objective;
earlier goals remain independently indexed rather than being replaced. A new
request establishes its own goal even when unbound, without
erasing other unresolved goals. Every new proposal still needs its own display
and approval; goal continuity never inherits those permissions. Completion evidence
binds only one exact supported target/effect clause or the existing closed inverse
continuation. Other mandatory clauses stay incomplete, yielding partial progress;
ambiguous free-form compound wording remains unverified even when a narrower
scheduler effect succeeds. This restricts reporting only, not
the existing gateway's execution or approval behavior.
Conversation reads made while preparing a proposal are inside the existing
try/finally lock boundary. A transient store read error releases the in-process
conversation lock and does not strand subsequent safe retries.

The existing Conversation Store keeps an additive `ownerGoals` index and an
`activeOwnerGoalId` reporting cursor. Ordinary informational turns do not erase
it. Earlier unresolved goals remain stored and visible beside the current result,
including when the current goal is complete. `hasUnresolvedOwnerGoals` is derived
across those independent records. No capabilities, approvals, execution bindings,
planning offers or action contexts are copied between independent goals. This
index is reporting persistence, not a task executor or permission grant. Corrupt
canonical records fail closed without being overwritten.
The existing button/RPC approval and readback path also consumes verified host
receipts. Its internal store refresh pins every immutable goal/scope/binding
field, changes neither the active-goal cursor nor the Owner transcript, and never
replays execution. Typed confirmations and RPC readback synchronize every exact
bound goal independently of the active reporting cursor. Tracking-write failure
is separate from the actual action result and is visibly reported to the Owner;
a later authenticated readback can recover metadata from that same receipt.
A failed intake history append likewise cannot claim durable goal tracking. No new RPC shape, source permission or approval authority is introduced.

The existing Task Store accepts optional goal metadata only from its host intake
payload. It retains legacy task state and adds a separate goal projection for
new annotated tasks. Conversation and investigation records retain the same
metadata. A same-conversation status question reads it back across intervening
ordinary messages without a new model call, source read, action dispatch or
permission renewal.
Closed acknowledgements use the no-model status shortcut only immediately after
an unresolved goal report with no planning offer/context. A persistent or completed
goal cursor cannot swallow acceptance of an unrelated assistant offer.

Answer plans have an attributed `ownerInstructions` channel for exact quotes of
the current Owner message. Dates, times, quantities and constraints in that
channel are labeled as Owner text, never business evidence or execution results.
The external-fact numeric, name, source and completeness checks remain unchanged.
Invalid page/history quotes are dropped. Old plans default to an empty channel.

Limits: no new scheduling or browser operation is enabled. Costco, checkout,
business database writes and unattended permissions remain unavailable. Clause
segmentation is conservative: ambiguous compound outcomes stay unverified rather
than being inferred complete from one successful read. New business outcome
verifiers require registered evidence contracts; arbitrary prose is insufficient.
Only whole closed no-checkout/no-payment prohibitions are excluded as constraints;
positive clauses after negation and scheduling reminders stay mandatory. The
original objective is retained byte-for-byte. Existing intent admission gates
still apply; this is not a universal new business intent recognizer.
No live source or deployment acceptance is claimed by offline tests.

Scheduler surface words alone cannot admit a new action goal: ordinary status
questions retain their existing investigation answer. Goal snapshots are re-read
after asynchronous gateway calls, immediately before synchronous render/save, so
a concurrent authenticated button receipt cannot be overwritten by an older
pending snapshot. If that refresh fails, no stale goal turn is appended and the
Owner receives the tracking-unavailable warning; execution is never replayed.

Scheduler fallback admission is bound to a scheduler/service action object or a
cart insertion effect, not an arbitrary add/create/run verb near a domain word.
Analytic objects such as summaries, reports and sums retain ordinary answer
behavior. Mixed clauses retain any real action and the complete original request.
If a goal refresh fails, the conversation turn still retains its proposal context
without stale goal metadata. The warning identifies unavailable goal tracking;
existing approval remains usable. If the transcript itself cannot be saved, the
proposal request is not marked completed or replayed as a successful preparation.

Recurring creation admission requires a schedule/task/workflow object after the
creation verb and bounded scheduling modifiers. Mentioning scheduled tasks inside
a spreadsheet or a detailed-summary request is not enough. This closes the
legacy recurring predicate as well as the scheduler fallback; both positive
business instructions and informational paraphrases have intake regressions.

Concrete cart-insertion requests also cover the Chinese object-fronted 把 form
and English could/would-you requests. This is reporting admission only, never
a browser action or permission grant. Explanations and hypothetical questions
remain informational. Standalone and follow-up cart clauses retain their exact
objective even without an attached recurring-schedule request.

Sentence-final Chinese question particles exclude status/impact questions from
action-goal admission; the imperative particle 吧 alone remains a request.
After a reply exists, strict pending-goal lookup errors preserve the canonical
answer and show the existing tracking warning, including in a subsequently saved
transcript. Corrupt history is never overwritten. A failed status-history append
also shows that warning. These fail-open replies confer no execution authority.
