# Public Source Fallback v1

## Goal and integration

Reuse the existing Owner-only query planner, public search provider, source
envelopes and final provenance formatter. No new intent router or permission
grant. The runtime brain remains Claude Opus 5.5 / medium. Discovery and bounded
composition use Claude subscription, never another provider or an API fallback.

The source reader inspects JSON-LD as data without evaluating scripts or fetching
contexts. Only recognized schema entities matching the observed page subject are
projected. Embedded article publication/update dates belong to their own fields.
Names, descriptions, listed recurring intervals and their original dates remain
separate from host retrieval timestamps. Raw unknown values do not become defaults.

## Bounded source recovery

1. Read at most two observed registered publisher URLs, as before.
2. Prefer subject-bound embedded fields and explicit publisher JSON references.
3. A fixed Winnipeg library profile recognizes the two actual script references
   on an observed City branch page and binds its slug to a registered branch ID.
   It reads only that ID's JSON in the publisher-referenced data directory. No
   script, OAuth request, account access or credential is involved.
4. If evidence remains insufficient, read remaining observed registered publisher
   URLs. References and alternate pages share a two-additional-read limit.
5. Compose once more only when new evidence was actually read; otherwise retain
   the incomplete answer and failed checks. There is no recursive retry loop.

All phases share the original 110-second abort signal. Each body has a 15-second
cap, a 512 KiB limit, pinned public DNS, fixed HTTPS GET, no cookies/credentials and
at most two registered redirects. External structured URLs are exact registered
branch files under `raw.githubusercontent.com/winnipegpublibrary/
winnipeg-ca-openinghours/main/hours-schema/`; arbitrary GitHub repos, queries,
credentials, other hosts and contexts are rejected. Same-host alternate JSON has
no query or fragment. No general browser renderer is introduced: the observed
library data is available without script execution.

Observed search URLs with no usable model summary may be rescued by actual
publisher reads, only after the original tool/model/source checks succeeded.
A naked URL without those checks remains unavailable. The three-field semantic
query schema remains unchanged.

## Evidence and cost boundaries

Structured summaries carry `publisher_structured` evidence, exact quote matching
against the host's selected-field projection, raw-body hash, parent publisher
URL and extraction kind. The UI labels projections as structured fields, not
publisher prose. Matching alone does not prove every translated inference.

Recurring hours do not prove opening on a particular date. Missing weekdays are
unknown, not closed; holiday exceptions remain unknown. Invalid rows are counted
and visibly withheld. Date-bounded intervals are not promoted to recurring weekly
hours. No account permissions or external writes are added.

All observed discovery and composition receipts are summed by actual model.
Failed additional composition keeps already observed usage; unobserved usage is
partial, not zero. A fresh query usually uses discovery plus one composition;
insufficient evidence with newly read sources may use a second composition.
This uses subscription quota, not provider billing proof. Cache hits retain the
old evidence time and do not produce another dispatch receipt.

## Verification

Regression cases cover generic embedded release JSON-LD, recurring branch hours,
subject mismatch, missing days, invalid intervals, unapproved context/URL,
first-source insufficiency, two-additional-read exhaustion, cancellation and
usage preserved after a failed second composition. Candidate real Express route
and loaded Owner UI acceptance are saved separately; neither unit tests nor a
source-reader-only call establish the loaded chat path.

The initial real candidate stopped at expired CLI authentication. That is not
proof of an intent misclassification. The website intake now reports the typed
subscription login failure instead of calling it a failed website lookup.

Measured isolated real Express acceptance subsequently passed Traditional Chinese
and English regular-hours questions and an English Manitoba release-listing
question, all served by Claude Opus 5.5. The hours responses retained the fixed
publisher JSON reference, listed intervals, unknown Sunday, unknown holiday/date
status and source timing; one Chinese summary clause was withheld visibly. The
announcement establishes the observed listing only. These samples took about
90-117 seconds end-to-end; no whole-conversation latency improvement is claimed.
The generic embedded-article adapter and other library branch IDs have regression
coverage, not real-path acceptance. Loaded deployment remains a separate check.
