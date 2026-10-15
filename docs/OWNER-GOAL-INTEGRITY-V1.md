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
whole-goal status instead of speculative action-completion prose.

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

The existing Task Store accepts optional goal metadata only from its host intake
payload. It retains legacy task state and adds a separate goal projection for
new annotated tasks. Conversation and investigation records retain the same
metadata. A same-conversation status question reads it back without a new model
call, source read, action dispatch or permission renewal.

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
No live source or deployment acceptance is claimed by offline tests.
