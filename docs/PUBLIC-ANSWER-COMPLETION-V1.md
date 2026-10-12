# Public answer completion v1

<!-- record-status: ACTIVE 2026-10-12 -->

Public answers previously retained only omission counts. A follow-up could neither
explain the withheld quotation nor reliably reconnect the original approved query.
The host now stores bounded public evidence diagnostics and a server-owned transcript
receipt. Rejected translations never become quotations, facts or long-term memory.

## Reachable flow

1. Existing A4 routing and Owner-only egress planning approve the public query.
2. The subscription reader records the exact query, evidence age/hash and up to five
   claim-check gaps. Exact quotes are saved only when present in the read source.
3. The answer view produces a validated public-only receipt, persisted with the shown
   assistant turn. Source access failures and insufficient evidence remain explicit.
4. An anchored Chinese/English gap question reads the latest receipt without a model
   call. Compound action instructions do not activate this lane.
5. A completion question can repeat only that saved public query, with fresh retrieval,
   after current READ_ACCESS, source, A4, provider and local bridge checks. No browser
   history, private content or rejected draft is sent as query material.
6. The completion slot is atomically reserved in the protected transcript before
   dispatch, and retained per receipt chain; repeated request IDs replay
   the saved response. Failures remain unknown, with no background retry. New topics
   invalidate the latest receipt. A concurrent topic change prevents publishing.

## Bounds and limitations

Each source phase retains its 110-second deadline, at most three WebSearch calls,
two initial plus two supplemental publisher reads, and at most two composition calls.
Explicit completion can consume one additional bounded source phase. There is no new
vendor, API fallback, connector permission or write capability.

Saved receipts contain at most eight gap diagnostics, each with at most 800 verified
quote characters. Numeric/language/time checks retain their existing strictness;
an empty recorded gap list does not establish full semantic completeness. The host
asks for the missing part instead of declaring the original answer complete.

Old answers without this receipt must be asked again. This v1 addresses public-source
answers only; HR/mail/business evidence retains its existing source-bound pathways.
The slot reservation survives a restart or crash before the response is stored;
resubmission does not replay the external read. An interrupted attempt without a
completed result remains unknown. Reopening the original complete question starts
a new query with its own explicitly requested budget.

## Verification

Meaningful regressions cover diagnostic retention, exact quote guards, server-only
receipt persistence, topic changes, forged history, current flag revocation, bounded
cache refresh, real HTTP routing, request conflicts and one-attempt deduplication.
Candidate paid-source and loaded UI evidence are recorded separately; code/test
success alone is not confirmation that the running Windows service has loaded it.

Candidate measured acceptance (2026-10-12): Python source retrieval took 22.4 seconds,
with three admitted claims and no remaining check gaps. MDN retrieval took 37.5 seconds;
its first composition had one exact-quote numeric translation gap, recovered by the
existing internal repair. An isolated transcript replay of that actually captured first
composition stage exercised bilingual gap inspection and one fresh completion through
the HTTP route; completion took 35.2 seconds, left no recorded gaps, and duplicate
requests triggered no second read. This is not a claim that the final production MDN
turn remained incomplete. Source phases consumed Claude subscription usage; they are
not measured billing charges or entire-conversation timings.
