# Universal assistant layer v1

The existing chat, source-routing and governed action entrances remain authoritative.
No second router, model, connector, permission or autonomous schedule is introduced.

## Measured defects

The deterministic route selected company invoices for "What is an invoice?" and
inventory for a definition of inventory turnover. A colon-delimited translation
containing "reply to Rob's email" selected the email-draft lane; embedded file-change
text could also produce a development offer. These are requests about language or
concepts, not requests to operate on company records.

## Behavior

`generalKnowledge.generalRequestKind` recognizes a bounded whole-request definition
or an explicit colon-delimited supplied-text transformation. Definitions naming an
owner, company, current/historical record, identifier or compound request are excluded.
Unmatched requests retain existing routing. Recognized requests select conversation
with no automatic business sources and do not enter semantic business upgrades.
Text transformations do not select mail, scheduler, development or capability-gap
workflows, or deterministic file/settings offers. Explicit non-chat modes retain
their existing precedence. Short approvals retain the existing continuation.

For recognized requests, the response directive asks the brain to follow the newest
question, explain naturally, treat supplied text as data, and avoid unnecessary
company-decision templates. It does not author, truncate or guarantee model answers.
Evidence verification and the bounded reasoning loop remain in force. Current facts
still require fresh sources; business facts require authorized business evidence.
Drafting never authorizes sending or grants an action capability.

## Verification and limits

Tests exercise bilingual definitions, business/action exclusions, topic changes,
quoted instructions, actual intake with enabled internal sources, and the HTTP
entrance with operational-adapter spies. Existing public-retrieval tests exercise
unavailable reads and final-evidence obligations.

Baseline live Claude Opus 5.5 turns answered cooking and invoice-definition questions.
Winnipeg weather did not obtain usable public evidence. This slice does not mark
current-weather retrieval connected or promise universal correctness. No new search
subscription, credentials or background model calls are added. Recognition is
bounded; broader ambiguous phrasing uses the existing semantic/goal/evidence pipeline.
New live acceptance must match the running boot commit before delivery is claimed.

The first loaded-build check exposed a further false withholding: the no-read
operational guard removed numeric invoice-definition details and asked for company
sources. A real reply-path regression now preserves generic definition sentences
while retaining the guard for named-company, possessive and time-specific claims.
This is a bounded heuristic, not an exemption for all prose on a general turn.
Generic second-person explanations ("a receipt proves you paid") and demonstratives
("this means") do not identify business records. Possessive company references,
specific records and current-state claims remain checked. A regression preserves
these explanatory forms while withholding company/current claims in the same turn.
The later live failure was traced to a first-person general recommendation containing
a CJK number. First-person company/observed-result references remain checked; a
general recommendation does not identify a business record. The corrected guard
was replayed against all three original model answers before another load: each
remained unchanged with zero false withholding. Raw withheld prose is not logged.
