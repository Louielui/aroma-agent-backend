# Owner-authorized ChatGPT credits

Owner authorization on 2026-10-02 permits existing credits when included quota
is exhausted. `CODEX_CHAT_ALLOW_CREDITS=true` is an opt-in on the local Owner
bridge, not a model-controlled input. It covers subscription chat, the fixed
development proposal, website discovery and Hindsight's text completion path.
Existing coding/review providers keep their separate policies.

Preflight reads a fresh `account/rateLimits/read` snapshot. The `codex` bucket
wins over legacy data, and a multi-bucket response missing `codex` fails closed.
Included quota needs no credits. Exhausted quota needs explicit opt-in,
`credits.hasCredits=true`, a valid credit snapshot, no contradictory known zero
balance and `spendControlReached=false`. A reported individual cap with no
remaining capacity, depleted workspace credits or workspace usage limit still
stops work. Unknown capacity does not authorize a turn. A null balance remains
unknown; it is not zero and is never converted into a currency estimate.

Every completion rechecks capacity before `thread/start` and `turn/start`.
`usageMode=credits_available` is eligibility telemetry, not a measured deduction.
The existing ChatGPT login, exact model, text-only tools boundary and safe error
handling remain. No credits are bought, spend limits changed, earned reset
credits consumed or OpenAI Platform key supplied. Provider refusals remain
authoritative; there is no automatic failed-turn replay.

Mail backoff deadlines and source retry counts stay intact. Existing queued
analysis/indexing resumes through its normal background deadline and fresh
preflight, not a forced reset. Historical exclusions, originals, dates, hashes
and Owner decisions remain unchanged. Full memory acceptance remains separate
from credit eligibility and requires actual Hindsight source readback.

Official references: [Codex/ChatGPT pricing](https://learn.chatgpt.com/docs/pricing),
[App Server](https://learn.chatgpt.com/docs/app-server),
[workspace usage controls](https://learn.chatgpt.com/docs/enterprise/usage-limits).
