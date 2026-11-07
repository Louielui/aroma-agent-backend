# Memory clarification arbitration

Status: isolated candidate; production model and UI acceptance remain unverified.

## Observed failure

A retained native follow-up asked for only the latter corrected memory value, in
two sentences and without other actions. Its main model answer was correct. The
current-message semantic classifier instead produced a MEDIUM business category.
`semanticClarify` replaced the main answer with a generic business question before
the existing final knowledge verifier returned `require_memory` using conversation
context. Successful memory retrieval made `missingRecallReply` return null, so the
unrelated question survived into the route guard and final response.

The raw answer, input history and saved guard packets establish a host overwrite;
they do not establish a model failure or missing/deleted memory. Original failures
and usage records remain intact. Private prompts and records stay in local evidence.

## Candidate behavior

Keep the pre-clarification conversational envelope only when it has mode chat/ask
and no nextRead, answerPlan, decision or tasks. The existing validated final
`require_memory` verdict may restore its reply and conversational intent/mode when
there is no operational investigation. Task/decision/read fields stay empty.
Missing or unavailable recall still takes precedence with its existing precise
response. Genuine model-authored memory questions remain questions.

The memory resolution has a separate read fence: it does not open automatic reads
or self-readable ASK escalation, and is no longer falsely presented as a business
clarification. Existing recall, read-claim, route evidence, source presentation and
work-offer handling still run. Unavailable/invalid verifiers and other knowledge
domains never authorize this restoration. Recalled text cannot grant this verdict.
The content-free arbitration event records no private response or memory body.

No keyword exception, new classifier, extra helper, dependency, budget alteration,
model change, API fallback, permission change or memory write is introduced.

## Verification and limits

The isolated intake regressions reproduce the business-classifier conflict and
cover English/Chinese follow-ups, real clarification, missing/unavailable memory,
other verifier decisions/failure, planned business reads and source disclosures.
Every injected forbidden request is counted even if an error handler catches it.
Unknown citation markers retain their existing visible behavior and do not gain a
canonical source receipt; disclosure is not proof that a model claim is correct.

Local replay verifies every saved packet hash and feeds the same native outputs
through baseline and candidate intake. Main/provider input hashes are compared,
then raw reply, recall guard, route guard, work offer, final reply, archive reply
and canonical reference disclosure are checked. The offline classifier is given
the saved opinion twice; this is not a second original native send. No new model,
connector, business operation or browser acceptance is performed by the replay.

The original live acceptance ledger remains paused with its round allowance
exhausted. Unused helper reservations cannot substitute for a new round. Any
future live acceptance needs separately scoped authorization; this candidate does
not add a budget profile or restart that ledger. Deployment remains held pending
exact-version Owner decisions and all existing promotion gates.
