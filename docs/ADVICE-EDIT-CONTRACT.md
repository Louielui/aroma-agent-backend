# Advice edit contract and conditional draft objects

PR138 deployed candidate `c29ddc588631e829760b9d9476fdb4e7feda959f` as
`030ba03ffe5e91ebb2da7ebc814c7c050b543f21`. Technical checks passed. Its native
one-turn/five-helper case retained the earlier Owner scope in the final verifier
and received `allow_final`; the entire visible conversation still failed.

The saved premise review returned five exact, unique edits with complete checks.
Its second edit removed a 63-character unsupported conclusion with `after: ""`.
The provider schema allowed that string, but the runtime validator rejected it.
The whole review became `unavailable / invalid_review`, with no edit applied.

The correction treats an empty replacement as deletion of that exact span. It
still refuses a whitespace-only replacement, an empty final answer, missing or
ambiguous spans, overlaps, extra fields, unsafe insertions, excessive bounds,
incomplete/unresolved assessments, identity drift and transport failure. No
permission, provider, schema outcome or retry path is added. The prompt documents
the same deletion meaning. Unaffected text and line endings remain byte exact.

Full offline intake replay exposed a second independent issue after applying the
actual review: an earlier file noun carried into a new conditional draft object.
The numeral in a suggestion to prepare one work-order draft was treated as a
quantity of that earlier file subject. The entire planning preview was refused.
The existing document-structure module now recognizes a bounded single proposed
text object with an indefinite article. Only reviewed no-read advice can use it,
with no explicit business noun, status predicate or current business referent in
that clause. Other quantities and adjacent clauses remain checked; the earlier
subject is retained for subsequent elliptical business claims. This neither
permits execution nor admits completed work or business-source claims.

Retained actual outputs are fixtures, not a fresh native success. The exact edit
and complete intake tests demonstrate the contract and presentation integration.
Fresh connector data and earlier receipt fixtures remain explicitly offline
substitutes. Negative cases preserve operational quantities, status/completion
claims and action boundaries. Previous positive cases and the full suite run
against the complete candidate, followed by independent subscription review.

The old root `08cb9cff-cad8-4b3c-9aea-323a947dd253` is paused with one turn and five
helpers used, zero websites and one unused helper. Automatic memory is restored;
failure evidence and the closed earlier root are retained. Installation cannot
close, reset or reactivate it. The proposed next acceptance definition
`95f9ab4d-7d67-4a72-b679-1b4f4f058ffb` is inert: one turn, at most six helpers
including failures/retries, zero websites, Claude Opus 5.5 / Medium through the
existing subscription. It requires separate explicit approval and installed
boundary/parallel/restart proof before activation. No allowance transfers.

This candidate has not been deployed or natively retested. Meaningful foreground
content, tone, general understanding and latency still require actual input,
provider output, all guard decisions, pixels, archive and usage evidence. No
business writes, API fallback, purchases, credentials/ACL or P02-C changes occur.
