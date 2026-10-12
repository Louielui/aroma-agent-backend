# General Public Retrieval v1

## Delivered scope

Extends the existing Owner public-query path, not a separate chat mode. Completed
Claude subscription WebSearch receipts supply at most twenty candidate URLs. The
host prioritizes URLs cited in that receipt, then reads at most two initial bodies
and two additional sources. Cited preference is a relevance hint, not verified
official identity. Government, vendor documentation and travel enquiries share
the same architecture and language-specific evidence projection.

The original six-host catalogue remains the direct-read default. Additional
publisher URLs require an opaque per-query scope built by the host from observed
search output. The public request contract still accepts only query, freshness,
location and language; callers cannot submit URLs, scopes, cookies, headers,
credentials, methods or commands. Same-origin canonical redirects are bounded;
cross-origin redirects remain unavailable, even between registered hosts.

HTTPS GET uses a DNS lookup that rejects the whole result when any resolved address
is local or reserved, and connects to a validated result without another lookup.
Sensitive account/action paths, credential-bearing URLs, non-HTTPS URLs, ports,
local names and non-public IP literals are rejected before reading. Password forms
and recognized access-challenge pages remain unavailable. There is no browser
script execution, login or arbitrary navigation. Maximum body size remains
512 KiB, extracted text 24,000 characters, page deadline fifteen seconds, shared
source-phase deadline 110 seconds, with one existing stale-observation read-back.

Same-publisher JSON references remain observed and subject-bound. The existing
fixed Winnipeg library profile is the only cross-publisher JSON exception. No
scripts, JSON contexts or arbitrary external references are executed or fetched.

## Evidence handling

If both initial bodies fail, observed alternate publishers are attempted before
accepting summary-only evidence. When any bodies are available, composition is
given only read bodies and their structured projections, not search-model prose.
Insufficient subject/period evidence continues through the bounded alternate-read
path. Failed checks remain attached to receipts; summary-only fallback retains its
explicit page-not-verified warning outside the collapsed technical details.

Every retained claim has an exact contiguous quote, source URL, read timestamp and
content hash for a body read, requested language, access basis and final canonical
URL. Search observations never automatically confer official identity. The UI uses
generic source-page wording, with technical details collapsed. Publication,
update, observation and retrieval times remain separate; unknown age is retained.

A real government sample exposed model-added Chinese age qualifiers outside its
selected quote. The numeric guard now also checks Chinese quantities with units,
including joined age ranges. Unsupported additions use the existing visible
numeric-withholding and bounded quote-repair path. This is not a general proof of
semantic equivalence, eligibility completeness or source reliability.

Technical HTML extraction preserves inline syntax-highlighting tokens rather than
inserting spaces between every tag. Windows path separators survive the public
reply and quoted excerpt. The existing renderer builds text nodes; preserving
backslashes does not enable HTML execution or add a model-provided URL channel.

No credentials or private history enter the public worker. No account access,
write capability, new dependency, background polling or GPT API fallback is added.
Public discovery and composition use Claude subscription quota and preserve their
actual usage receipts; CLI estimates do not prove account billing.

## Verification

`src/subscription/publicGeneralization.test.js` exercises the complete observed
search-to-body-to-quotation chain across government, technical and travel sources
in Chinese and English. Separate cases cover invented URLs, forged scopes,
cross-origin redirects, local/reserved/mixed DNS answers, credential URLs, bounded
alternate reads, visible failures and access-challenge pages. The existing page,
structured, search, composition and prepared-answer suites remain in scope.

Actual subscription and loaded-runtime acceptance results are recorded below only
after measurement. Planned probes do not count as completed acceptance.

## Remaining limits

No arbitrary crawling, PDF parser, account access or script-rendered dynamic data.
Source identity/reputation, cross-source contradiction detection and complete
semantic grounding are not established by exact quote matching. A successful
sample does not guarantee every website or every turn. Unsupported sources and
subjects retain unavailable or insufficient evidence rather than fabricated facts.

## Measured candidate observations

Actual enquiries use the Express intake route, the Owner's selected Claude
subscription, real WebSearch, and real publisher HTTPS GETs in an isolated data
directory. These are not loaded-service/UI claims. Probe files are retained in the
development outputs directory, with quote, URL, content hash, language and checks.

| Domain | Language | Observed publisher | Elapsed sample |
| --- | --- | --- | --- |
| Government application guidance | Chinese | gov.hk | 84.7 seconds |
| Government application guidance | English | immd.gov.hk | 85.1 seconds |
| Travel pet restrictions | English | nps.gov | 89.5 seconds |
| Travel pet restrictions | Chinese | nps.gov | 67.0 seconds |
| Technical virtual-environment guidance | English | docs.python.org | 82.4 seconds |
| Technical virtual-environment guidance | Chinese | docs.python.org | 84.7 seconds |

Mozilla returned a Client Challenge body, not its documentation. The earlier
body-labelled insufficient sample is retained as a failing acceptance observation,
not a technical-domain success. A regression now classifies that page unavailable.
An earlier search-summary-only sample also failed body verification and prompted
the structural body-priority change. Python replaced the unavailable publisher
for technical acceptance; it does not establish that Mozilla is now accessible.

The original government draft added age qualifiers outside its quotes. The recorded
draft remains available and the focused regression rejects those additions. Later
government samples passed the bounded quotation contract, which does not certify
complete eligibility guidance or every possible translation.

The original Python probes exposed syntax-highlighting whitespace and lost path
separators. A subsequent actual GET of the previously observed tutorial URL verified
the exact `python -m venv tutorial-env` token sequence and a SHA-256 read receipt,
without a model call. Final technical composition used real WebSearch and actual
read bodies in both languages; the six selected final domain/language samples
had supported body quotations with no withheld claims. These are measured samples,
not a latency guarantee or a proof of all semantic/source facts.

Final technical reply formatting preserves Windows separators and the PowerShell
`PS>` prompt. The fixture regression checks the actual returned reply and excerpt.
Full-suite and loaded-service/UI acceptance are kept in the separate delivery
receipt; candidate success does not establish that a new version is loaded.
