# Saved conversation evidence at the existing reply guard

## Observed failure

PR127 native acceptance retained a real model answer and reviewer edits. The
existing route evidence guard then removed a conversation ordinal as an
unsupported operational quantity. The visible client matched the server output.
The same saved guard input also fails on the preceding PR126 code. This is an
existing evidence classification gap, not a provider error or a new runtime
permission regression.

## Candidate behavior

The existing authenticated demo composition root issues an in-process attestation
from the full `conversationStore.get()` snapshot before history normalization or
prompt slicing. Browser history, model output, memory rows and serialized tokens
cannot attest a conversation fact. The attestation contains no transcript text.
It passes through intake and the read-result boundary to the existing guard.

A bounded grammatical speech-count claim is checked against that snapshot. The
ordinal must equal the number of Owner messages, including current input exactly
once. Intentional repeated historical messages remain separate. To prove a
repeated request without semantic guessing, every Owner message must start with
the entire substantial first request (at least 24 characters). Mixed topics,
short acknowledgements, malformed roles and missing stored history are unknown.
This proves literal request repetition, not semantic equivalence or agreement.
Other phrasing and English count claims are outside this candidate's verifier.
The existing whole-request supplied-text classification stays separate: quoted
counts in a translation/rewrite are data, not assertions about this conversation.
Its original evidence checks remain; the new conversational classifier does not
reinterpret it. A focused failing regression caught and fixed that boundary
before final review. The first all-pass candidate was not deployed or reviewed;
the final full suite and review bind the later complete SHA.

The store getter promises the complete transcript; a prompt slice or browser
fallback is never used as a complete transcript. This relies on the existing
Owner host/store trust boundary, not cryptographic protection from a malicious
local Owner who can edit saved files or application code.

Each admitted clause is separate from business EvidenceSets. Unsupported
recognized conversation claims are withheld with a conversation-specific notice,
while all remaining answer bytes survive. Mixed operational assertions still go
through the original entity/status/numeric protection. No global guard bypass,
model prompt, model selection, business read/write, quota or permission change.

## Verification and delivery limits

Tests cover full saved roles/content, HTTP source precedence, client token
forgery, missing/unreadable history, wrong ordinals, assistant miscounting,
intentional repeats, mixed topics, mixed business clauses and Markdown retention.
Private saved native prompts/outputs remain outside Git. An offline replay is
distinct from new native acceptance and from deployment.

The previous native ledger remains paused at 2/2 turns and 10/12 helpers, zero
websites. Its two unused helpers cannot start another turn and are not moved to
this development work. Native acceptance requires a separately approved new
turn allowance after exact-version delivery. The candidate includes an inert
two-turn / twelve-helper / zero-website profile on the existing meter for that
proposal, not an activation or grant. A paused previous root stays selected;
its explicit closure and the new profile's activation each require Owner scope.
Concurrent reservations, child attempts and restarts retain the same hard limits.
The separate two-sentence native
regression also remains unexecuted. Independent repository review uses the
existing standing review mechanism and reports its own subscription usage.

The first full-suite run `f9492450-5694-4837-8d83-b581c2095cb1` is retained
as needs_attention (two failures): translating inside a MATCHING file violated
the text-class boundary, and an unconditional option addition leaked into the
U1 email-draft option contract. Display copy now lives in a classified interface
helper; the attestation option is added only to chat with actual saved evidence.
Neither protection/test was relaxed. The final candidate requires a fresh full
suite and review; the failed run is never resumed or relabelled.
