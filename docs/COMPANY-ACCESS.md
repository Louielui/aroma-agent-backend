# Company access foundation

Local rollout: set XIANGXIANG_COMPANY_ACCESS=1 and restart. The switch enables
the member workspace and a default Owner gate over legacy and future routes.
Only the health endpoint and state/cookie-protected Google callbacks bypass that
gate. Owner login already has its own authentication routes. Member routes are
handled before the boundary, with separate sessions; service tokens and Owner
cookies do not establish a member identity. The listener remains loopback-only.

## Current surfaces

- /company-access: Owner-only registry, grant/revoke, suspension, source probes,
  and the most recent 500 access changes. Probes use the existing Owner Google
  credential, verify the account and root metadata, and never claim member access.
- /member: independent Google sign-in and a metadata-only Drive browser. Twenty-five
  entries per listing, explicit truncation, no recursive ingestion or shortcut following.
- /api/v1/member/files: source grant, current Google access and parent ancestry
  checks for both listings and direct file IDs. A request finishing after a registry
  revision changes is rejected. Responses are not cached.

Registered sources are Aroma Base (0AJApVuax7MarUk9PVA) and its Admin folder
(1iYHY8Muo3K3HSPON5Uu0C8cNgOITei8C), discovered read-only on 2026-09-29.
The administrative mailbox is adm@aromabistro741.com. Separate consent and inbox
metadata preview passed live acceptance on 2026-09-29: the Owner completed Google
consent and the UI read ten inbox message summaries from the verified mailbox.
Louie may read both Drive sources; Ivy may read Admin Drive. Both are granted the
administrative mailbox once its independent source authorization is completed.
No other members are inferred from Drive sharing. Folder shortcuts are excluded.
The app grant restricts Xiangxiang; it does not remove existing Google permissions.
Opening a Google Drive link leaves Xiangxiang and Google applies its own permissions.

## Identity and credentials

Only the two registered emails can bind a verified Google subject. Google verifies
the ID token signature, issuer, audience and expiry; the flow verifies nonce, state,
browser cookie, PKCE, Workspace domain and verified email. A bound subject cannot
be replaced by another subject claiming the same email. Subject IDs, not display
names or request-supplied roles, identify sessions.

The existing OAuth application configuration is reused, but the Owner refresh token
is never read by the member flow. Web clients must register this exact callback:
http://127.0.0.1:8090/company/oauth/callback
Installed clients must support Google's loopback redirect. Configuration failure
leaves the flow unavailable; no credential or provider error is echoed.
Starting member sign-in revokes the current browser's Owner session to avoid carrying
Owner authority into a member session. Member consent requests openid, email and
drive.readonly only. Tokens stay in memory
for at most one hour and are lost on logout, expiry or restart. There is no durable
member token vault, remote sign-in or Gmail delegation. Mailbox source consent is
independent of human member sessions.

Source of identity verification guidance:
https://developers.google.com/identity/openid-connect/openid-connect
https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## Memory boundary and remaining acceptance

Existing chat, memory, briefing and operator endpoints remain Owner-only.
The member gateway has an all-source reference checker; empty, denied, missing or
revoked references fail closed. It is tested for future derived-record consumers.
It is NOT connected to Hindsight or member chat. No shared memory bank is created.
Connecting those consumers requires retaining every source reference and rechecking
each source on every retrieval, including direct IDs, search, citations and summaries.

Automated acceptance uses injected Google clients and temporary stores. Owner login
and Aroma Base listings have screenshot evidence. Administrative mailbox consent
and a ten-message inbox preview passed live acceptance on 2026-09-29. Ivy login,
Google-side revocation and remote-device operation remain pending.
The registry is a single-process atomic JSON store in resolveDataDir(), not the
restaurant database. Multi-process hosting needs transactional storage and session
coordination before rollout.

Rollback: revert the delivery commit and restart the local service; remove the rollout
environment setting only as part of that rollback. Retain the access registry for audit.
Do not disable the Owner boundary while continuing to expose member routes.

## Administrative mailbox

The Owner starts consent at /company-access. The callback is
http://127.0.0.1:8090/company/mail/callback. Only openid, email and gmail.readonly
are requested. Nonce, PKCE, cookie-bound state, verified Workspace identity and
Gmail getProfile must all match the registered mailbox before a grant is saved.
The refresh token has a dedicated file, separate from the Owner Google token and
from the operational registry. Prepare its directory with the elevated
scripts/service/prepareAdminMailboxStore.ps1 script. The fixed directory under
C:\ProgramData\AromaXiangXiang\admin-mail-secrets grants access only to SYSTEM,
LOCAL SERVICE and Administrators. Consent startup probes service write access
before sending the user to Google.

The source credential authorizes the shared mailbox. Human access additionally
requires an authenticated Owner or a verified member session with the admin-mail
grant. Suspending a member or revoking that grant blocks subsequent reads.
Every preview verifies the current Gmail profile, then reads at most ten INBOX
messages as metadata and snippets. Members remain limited to this preview.
The Owner can additionally search and read inline message bodies on demand.
Attachments, sends, deletes and read-state changes are not exposed. Responses use
no-store and render content as text. Source-bound PostgreSQL ingestion is available;
Hindsight semantic indexing for email content remains unconnected.

## Owner mail workflow

Owner-only endpoints are GET /api/v1/company-access/mail/search?q=... and
GET /api/v1/company-access/mail/:id. Queries are capped at 400 characters and ten
results. Every read verifies the dedicated Gmail profile, and permission or
disconnect changes during a read discard its result. A shared registry/mailbox
instance serves consent, source reads, chat and briefing; personal Gmail is never
used as a fallback.

Inline plain text is preferred within MIME alternatives. HTML is reduced to inert
text, attached parts are excluded, unsupported decoding is reported, and the body
limit is 48,000 characters. Gmail links select the administrative account. The UI
provides search, original-message links and per-message full-text buttons.

Explicit administrative-mail chat requests bypass ordinary intake and general memory
capture. Body reads and summaries capture source-bound mail memory separately.
Search returns up to ten metadata results; summary requests read up to
four bodies, supply at most 6,000 characters each to the existing subscription
adapter, and validate returned message IDs and verbatim supporting quotes.
Suggested follow-ups are not approved tasks or executed actions. Model failures
show original excerpts with a visible warning. Permission is checked again after
generation. Full-text commands name the message ID explicitly. Only a neutral
receipt, not the mail response, is stored in conversation history.

Daily briefing adds an administrative-mail knowledge section using the Owner's
configured local midnight through the run's read time. It shows at most ten
matching summaries with source links, limits and actual read time. Briefing
snapshots remain local Owner-only records; automatic memory capture keeps only
workflow status and counts, not mail excerpts. No new model is called for the
fixed briefing. Ivy full-text/chat acceptance is deferred.

## Source-bound administrative mail memory

`src/company/mailMemory.js` uses the existing canonical PostgreSQL transport and
transactional version checks. It stores a message snapshot per account/message ID
and a review item per account/thread ID. Changed snapshots and Owner decisions are
retained in the store's audit chain. New replies flag the same item for review;
they never overwrite an Owner's prior text, assignee, deadline or task state.
Missing assignees and deadlines remain null. Every thread begins as a candidate,
not a claim that a task exists. Validated model suggestions retain their exact
source quote; Owner confirmation is required before an item becomes active.
Approval records memory only and does not dispatch, send or modify Google data.

Owner body reads and summary results capture observed content, reporting failures
separately from read success. Automatic ingestion runs every five minutes while
the backend and global memory capture are enabled. Each batch reads at most ten
messages. Initial scope is a fixed 30-day window; durable page tokens resume after
restart, and later scans overlap the prior watermark by one day. A failed batch
does not advance its checkpoint. Content exclusions and unavailable bodies are
counted; attachments remain excluded. Each thread has a 100-message bound. This
is bounded synchronization, not an assertion of complete mailbox history. A
large mailbox may take many batches to catch up; manual sync advances one batch.

`/api/v1/company-access/mail-memory` supports Owner-only keyword search, detail,
exact-version confirmation/correction/rejection and synchronization. The company
access page exposes the review workflow. Explicit mail-memory chat commands use
this same source gate without a model. General memory get/list/recall/audit and
index/consolidation paths reject or exclude these source-bound rows, including
attempts to reuse their IDs. They are not sent to shared Hindsight banks. Member
memory access remains disabled until independent member acceptance is completed.

Search verifies the live Gmail identity and local permission lease. Detail and
approval also verify access to the latest recorded message. Disconnect or provider
authorization loss prevents memory retrieval. Stored snapshots remain historical;
Google-side deletion is not automatic local erasure. Existing briefing mail sections
are revalidated before their stored excerpts are returned. Browser mail replies
are replaced by neutral receipts before ordinary model history is used. Mail
memory is available via explicit administrative-memory commands and its source
page; generic semantic recall and automatic task execution remain unconnected.

Unit and HTTP tests cover deduplication, reply review, missing facts, exact-version
approval, source loss, general-memory isolation, member denial and briefing redaction.

## Mail triage and daily follow-up briefing

`mailAnalysis.js` uses the existing GPT subscription adapter, with no paid-API
fallback or tools. Each synchronization batch analyzes at most two pending threads;
the source page also offers batch analysis and individual failure retries. Analysis
uses the latest three recorded messages, at most 6,000 characters each. Partial
coverage is explicit. It generates one suggested category (Owner decision,
follow-up, notification, promotion or unknown), a summary, at most one task draft,
and a possible reply/correction/cancellation marker. Quotes must be exact matches
in supplied bodies. Assignees must occur in the task quote; deadlines require an
explicit, valid ISO date in that quote. Other dates stay null, without inference.
These checks prove citation provenance, not semantic correctness: the Owner must
review the source before confirming a decision.

The source page defaults to attention items: open Owner tasks, new evidence on
previously approved items, actionable suggestions and unclassified candidates.
Notification and promotion suggestions remain available under category/all filters.
Classification never approves, rejects, completes or cancels an Owner item.
New source evidence invalidates old analysis. A changed record version, source
revocation or memory pause during inference prevents the pending result from being
saved. Failed analysis remains visible and has a durable 30-minute automatic retry
delay; explicit per-thread retry is immediate. Model timeout is 65 seconds, with
no overlapping calls even while an underlying timed-out request is still finishing.
Completed unchanged analyses are not repeated, including after restart.

`gmail.followups` adds a read-only section to the fixed daily briefing. It reads
recorded mail attention items without starting a model, prioritizes changes to
Owner-confirmed items, shows up to ten and reports unclassified-thread counts.
It preserves the distinction between an Owner decision and a model suggestion,
missing assignees/deadlines, original citations, and review flags. Stored briefing
sections require current mailbox access before display. This is not a complete
mailbox scan, a separate reminder scheduler, or an automatic task dispatcher.

Tests additionally cover classification outcomes, unsupported citations/people/dates,
timeout recovery, deduplication, optimistic races with replies and Owner edits,
memory pause, source revocation, batches beyond the first page, category filtering,
same-origin analysis requests and historical follow-up briefing redaction.

Source status is a last-verification result, not continuous health monitoring.
Provider errors mark the source failed. Disconnect invalidates pending callbacks,
marks the source disconnected and deletes only its local credential. Google-side
consent can be revoked separately through the user's Google account.

Google documentation:
https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
https://developers.google.com/workspace/gmail/api/auth/web-server
