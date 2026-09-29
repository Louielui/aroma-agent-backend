# Briefing memory acceptance

The existing seven-step briefing now reads approved, unexpired decisions and
preferences plus open todo memories. These remain advisory historical context;
local tasks and business records keep their own authority. The memory step keeps
its original tool ID for persisted run compatibility and displays at most ten
records, newest approval first, with the full matched count and a limit notice.

Owner follow-ups use `POST /api/v1/manager/runs/:id/memory`, protected by the
existing owner session and same-origin check. The server resolves a finished run,
validates the selected kind, preserves the owner's text, timestamp and run link,
then proposes a candidate. Request IDs prevent duplicate submissions on retry.
No LLM is used by this form. Existing background indexing uses the configured
subscription. Approval, correction and archive use the existing memory gateway;
the form cannot activate memories or dispatch tasks. Completion of a todo is also
a candidate requiring approval. Corrections preserve the old record's subject
and scope. The correction selector covers the memories shown in that briefing;
other records remain accessible in the memory center.

Connection projection may establish that a source is disabled, lacks credentials,
or has no registered adapter. Those states are not live health checks. Only an
actual successful read establishes `connected` for a briefing section. Failures
keep unknown counts; successful empty results carry measured zero within the
reader's declared coverage. Raw provider errors are not exposed.

Tests exercise positive, empty, failed and disconnected reads; owner-only and
same-origin candidate submission; idempotent retry; approval and corrections;
expired records; completed todos; and fresh recall. Live acceptance uses labelled
fixtures, archives them afterwards, and does not approve business candidates.
The in-app architecture checklist distinguishes this fixed workflow from general
agent dispatch and broader integrations that remain pending.
