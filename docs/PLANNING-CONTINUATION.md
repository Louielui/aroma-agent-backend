# Current discussion to bounded planning

An explicit start after a sidebar or chat-page design discussion now starts the
existing committed-source task planner. It returns a durable run ID to the existing
polling work card. Asking for advice alone does not start a worker.

The route records a host-created planning receipt on a completed current Owner
advisory turn. A narrowly scoped follow-up about a top bar can refine that receipt.
The receipt uses Owner text, never assistant suggestions, client history, imported
memory or recalled transcripts. Only the immediately preceding server-held receipt
can be confirmed. It expires after 30 minutes and is bound to the running commit;
an unrelated intervening turn retires it. Bare agreement without a start does not
confirm it. Unknown/legacy/expired scopes ask for an explicit current target.

The receipt selects only an existing interface/chat read profile. It grants no file
edits, arbitrary paths, shell commands, production writes, registration, coding or
adoption approval. The returned plan still uses separate goal, editable-file and
acceptance-criterion confirmation before a test draft and the established coding
and adoption approvals. This closes the planning handoff, not autonomous coding.

A deterministic request identity binds the receipt to the existing planner's
durable idempotence check. Retries cannot issue it twice even if appending the chat
receipt fails. A retained run is read back in the same conversation, with no new
dispatch or claim that a completed/failed run is still starting.

Regression coverage includes the three-turn UI advice flow, scope refinement,
repeat start, forged browser history and assistant approval prose, foreign origins,
extra authority fields, cross-conversation confirmation, changed topic, expiration,
changed commit and prohibited goals. Fixtures prove control flow, not universal
natural-language understanding. Live acceptance separately records actual model
and planner results.
