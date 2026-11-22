# Owner manual local dialogue

Only a same-origin chat request from the signed-in Owner's composer can use this allocation. The composer's one-use submission ID, conversation ID, pinned local model and digest, boot commit, expiry and native call reservations bind each turn. The original conversation pipeline supplies history and verifies answers. A model call for intent classification counts exactly as an answer attempt does. Each request also consumes one turn slot. Failed reservations are retained. Dedicated acceptance headers retain their own authorization requirements.

A deployment creates no allocation. Management is local to an interactive host terminal. There is no HTTP grant action. A separate Owner decision supplies the exact deployed commit, new UUID, call ceiling and window in milliseconds. From the installed repository the management entry is `node scripts/localBrain/dailyDialogue.cjs` with one of these argument lists:

- `status` to read the current grant.
- `activate <new-uuid> <boot-commit> <calls> <window-ms>` followed by confirmation of the displayed material.
- `pause <current-uuid> <boot-commit>` followed by confirmation. This stops further reservations and dispatches. An already dispatched reply can finish. Retirement of the current grant waits for entered turns to finish. A process interrupted during a turn can require separate reconciliation; the service never reclaims uncertain capacity.

The implementation accepts positive ceilings up to 128 attempts and windows up to 24 hours. Neither ceiling supplies a default. A turn uses at most 12 calls. A paused or exhausted grant cannot be reset or extended. A fresh grant needs separate activation. Grant and receipt files live under the service data directory in `owner-local-dialogue`. The regular conversation history policy still applies. The grant receipt stores sizes and hashes of model inputs and outputs rather than another copy of the chat. Cloud transport, background learning and repository work cannot consume this allocation.

An authenticated manual chat can ask for a fictional identifier supplied in a
complete quoted declaration, then ask for the same subject's identifier in the
immediately following turn. When the saved Owner messages establish that scope
and the normal conversation router and final verifier are enabled, business
intent voting and goal planning add no source selection. Both turns still go
through answer generation, final knowledge verification and the native budget.
For this literal-only request, the answer prompt uses the saved Owner messages
and omits cross-conversation recall. The reply schema binds the exact quoted
identifier. Even when the verifier permits a final answer, a changed identifier
or additional prose cannot be released. A clarification can still withhold it.
Mixed requests, attachments, unsupported wording and missing saved provenance
use the ordinary pipeline. Two verified replies in four calls are an offline
fixture result for this narrow request shape, not a default daily allowance.

## Expiry at admission

The host checks the deadline before registering a turn. At or after the deadline, the chat receives a non-retryable 409 with the expiry message and a tracking number. The existing local request receipt links that number to the manual submission, conversation, grant, host decision time and expiry. It contains no prompt or response text. A pre-turn refusal does not change the grant ledger or reserve a model call. The same check still runs at reservation and dispatch.

A manual local wellbeing greeting and an immediate request to recall that greeting use the saved Owner messages for the answer and retain final verification. Attached context, mixed requests and unrelated history continue through ordinary routing. The same per-grant cap applies.

## Observing a two-turn test
Wait for the terminal SSE response or the Owner's visible response/error. Then run
`node scripts/localBrain/dailyDialogue.cjs after-turn <grant-id> <conversation-id> <workflow-request-id>`
once for that request. Inspect the phase receipts before sending the next question.
Use ordinary status only at idle management boundaries. Do not poll the mutable
grant JSON, pipe Get-Content over it or hold an open handle during inference.
A pre-admission refusal has no registered turn; inspect its correlation receipt.
Daily ledger I/O failures retain their operation and bounded OS code in private
store-failure evidence when storage permits. The original refusal and reservation
remain authoritative. A missing diagnostic leaves the underlying cause unknown.

## Standing authorization
A standing grant is absent until the Owner confirms a new ID using the installed
commit in the native terminal. The signed-in composer still admits only its
same-origin manual chat requests. The grant uses the pinned local model and
the existing phase, website, child, and provider fences. It has neither a grant
expiration nor a lifetime call balance. Each admitted manual message reserves
at most twelve calls in its own native receipt. A refused or failed reservation
stays in that receipt. Request IDs are single-use across the standing store.

From the installed repository, use the existing interactive script with:

- `activate-standing <new-uuid> <boot-commit>` after any current short grant has
  been paused through its original entry. The existing short ledger is preserved.
- `pause-standing <id> <boot-commit>` to stop admission, new reservations and
  unclaimed dispatches. An already committed dispatch may finish.
- `resume-standing <id> <boot-commit>` to resume the same grant. A turn admitted
  before the pause cannot use the resumed grant to resume dispatching.
- `revoke-standing <id> <boot-commit>` to retire the grant and retain its history.
- `status` for the active selection or `status-standing <id>` for a particular
  standing grant, including a revoked one. Read at idle. Its `helper` counters
  are lifetime totals, and `today` groups reservations by their Winnipeg date.
  `available: null` indicates no aggregate limit. `after-turn` accepts the same
  three arguments and returns the one message's receipts and balance.

A normal restart preserves both policy and counters. A different installed
source or model is refused and reports zero available until an Owner-approved
grant for the new source is in effect. A stale terminal confirmation cannot
change a newer grant state. A paused standing selection does not switch to the
previous short grant.

The host stores standing approvals, transition history, immutable request IDs,
native receipts and transactional counters in the private operational database
`owner-local-dialogue/standing.sqlite`. One indexed record per message keeps
the active write independent of conversation age and lifetime usage. SQL
failures refuse dispatch without refunding a prior reservation. The existing
memory backup's fixed asset list remains separate from this operational
database. Loss of the database cannot activate standing access.

## Owner statements and principles
For a manual local question asking for the immediately preceding message, the
server reads the saved Owner turn in the current conversation. For a bounded
personal or Aroma principles question it checks current Owner declarations first,
then reads eligible current, exact-content Owner-approved memory records. An
explicit correction takes precedence. Conflicting records remain visible as
ambiguity, and excerpts are labelled. The response quotes the verified material
and identifies its source. No inferred belief is promoted to a quote.

To designate an older thread, send a bounded question such as
「請查舊對話『Aroma 開店理念』，我對 Aroma 的理念是什麼？」. An exact title,
a Winnipeg date on which the conversation started (YYYY-MM-DD), or its full
conversation ID is accepted. An ambiguous title or date prompts for a tighter
selection. Only Owner statements in that specific transcript can be quoted.
Common Cantonese phrasing selects these same sources. A current identifier
uses the latest explicit Owner wording in the authenticated current transcript.
A historical question uses its explicit phrase or a short resolved topic from
that transcript. Indefinite topics ask for clarification before a memory read.
The canonical historical lookup returns directly attested Owner records with an
exact phrase match. It includes earlier retained revisions for historical
questions, labels excerpts, and does not invoke semantic search or inference.
An explicit older-thread reference limits the search to that conversation.
The Memory Gateway and historical conversation lookup remain behind read access.
Unreadable sources and a completed search with no match have separate replies.
The bounded source replies are rendered locally without model inference or
operational investigation. The normal verified greeting flow remains available.
