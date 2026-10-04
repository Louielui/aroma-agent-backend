# Discussion intent acceptance

The Owner asked for layout advice because navigation crowded the conversation history.
The stored answer asked which business problem to analyze from previous messages. The
explicit project planner accepts work commands but does not accept this advice question.
That is intentional: advice must not start project work. The ordinary conversation
contract needs to preserve the purpose of the question before considering data sources.

The revised chat guidance separates advice, historical recall, current record retrieval,
and explicit action. The original proposal/approval wording remains intact and last in
the system prompt. The final knowledge verifier recognizes design advice based on supplied
observations, and the source-intent contract explicitly describes `not_applicable` without
needing a successful goal decomposition. That outcome continues to authorize no source.
No schema, capability allowlist, read grant, worker dispatch rule or approval rule changes.
The chat model and effort selectors do not change.

Acceptance has two different kinds of evidence:

- Unit and HTTP fixtures prove prompt transport, ordinary recommendation rendering,
  rejection of unknown verifier outcomes, owner-only verifier context, zero read/dispatch/
  promotion calls, and continued recognition of explicit bounded work commands.
- Recorded real subscription calls test the Owner sentence and independent paraphrases.
  The classifier matrix also includes historical recall, current mail/calendar, mixed
  historical/current facts, unscoped costs, and current public facts as negative controls.
  Classifier measurements with GPT-6.1 Sol do not certify the role-pinned API model.

A real main-model baseline with recall and business reads disabled already answered the
Owner correctly at Low. Therefore the stored failure is not evidence that GPT-6.1 Sol
cannot understand the sentence, that Low is its cause, or that more memory would fix it.
The archived transcript has no per-gate trace, so which component authored that particular
clarification remains unconfirmed. Acceptance must report this limitation and distinguish
isolated fixture results from the running Owner route. Semantic instructions are guidance,
not a deterministic guarantee for every future paraphrase.

All acceptance questions remain advice or read-only classification. No model request grants
execution authority. Reverting this local commit restores the previous prompt contracts.
