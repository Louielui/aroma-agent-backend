# Planning reply contract and standalone navigation advice

The Owner's standalone top-bar question followed by an explicit start previously
had no pending receipt. The clarification response omitted `mode`, so the actual
chat renderer displayed an unknown-format error instead of the clarification.
HTTP 200 alone did not prove a usable response.

Successful planning responses now carry `mode: chat`; clarification responses
carry `mode: ask` and persist the actual current Owner turn and visible reply.
Persistence failure remains explicit through `historySaved: false`. Neither
clarification nor its saved assistant prose conveys execution authority.

A standalone feature-bar/top-bar/toolbar advice question can establish this
app's fixed sidebar source profile. Generic menu positioning does not establish
a target. Explicit toolbar targets belonging to other applications are rejected,
including attempts to refine an existing receipt into that foreign target.
The current Owner question remains in the receipt, rather than model-generated
suggestions. No browser history or long-term recall is consulted.

Current-build, same-conversation, 30-minute validity and stable request identity
remain enforced. The explicit start creates a source-verified planning job only;
registration, coding, execution and adoption require their separate approvals.
The interface profile does not gain arbitrary files or other project access.

Regression coverage includes the two-turn screenshot sequence, typed and expired
clarifications, their persisted history, repeated start readback, unrelated
targets, and the actual frontend `render` function receiving HTTP fixture replies.
The renderer's rejection of an untyped envelope is also measured, so an always
passing display stub cannot conceal the original defect. Live delivery must
verify exact boot version, the served renderer, actual job status and preserved
history. It must not claim the proposed UI redesign was coded by the planner.
