# Planning draft context handoff

## Measured failure

PR136 runtime `26b61c46c93e01bd53c750bef9ac31892ecde888` passed the technical
deployment checks. Its approved native case used one turn and five helper sends,
Claude Opus 5.5 / medium / existing subscription, with no retry or website call.
Backend time was 104,225 ms; provider time summed to 84,238 ms. The premise
review correctly returned `review_unresolved`; this is a failed behavior result.

The main input was 94,136 prompt characters plus 10,412 system characters. It
included the Owner's prior explicit request, but omitted the full 484-character
reviewed speed/readability draft. That draft was saved at receipt
`eccaa2b9-48ca-48ff-b5f8-de17ce0e16f6`, linked from the then-latest saved receipt
`202424f9-a333-4dde-ba62-58c05c285149`. The later failed result receipt is not
used as context in this before-send reproduction. Prompt size is measured;
its contribution to latency is not established.

## Reversible correction

The existing continuity loader binds a private, request-local reader to the
last server-owned transcript pointer. Only a judged planning/proposal-draft
continuation with `investigationReference=previous` and matching general focus
resolves a prior draft. New topics do not follow older links. Resolution follows
existing `compared` receipt references, at most four receipts including the
latest. A missing, foreign, failed, future, mismatched or cyclic link stops it.
It never searches conversation directories or uses browser-provided receipt IDs.
Serialized or fabricated context cannot acquire that private reader.

Only a completed read-only receipt with the existing reviewed planning
presentation and matching supported/revised premise status supplies full draft
text, bounded to 3,600 characters. This is quoted assistant context, not an Owner
instruction, a current fact, an absence claim or authorization. The current
Owner goal and corrections retain priority. Settings, file scope, timing and
completion still require fresh evidence. The answer prompt states the planning
deliverable before supplementary operational reports. It does not change the
judged goal, required-source reads or final mode.

The investigation receipt records the selected draft ID, time, hop count and
character count, or an unavailable/not-referenced status. It does not promote
that draft into the fresh evidence catalog. The existing premise review, exact
span validation, zero-evidence/route guards, Action Gateway and execution gates
remain intact. A replay of the actual bad answer and actual unresolved review
must still fail; no substitute review relabels that native failure as a pass.
No additional helper call is introduced by context transfer.

## Validation boundary

`src/intake/planningContextReplay.test.js` preserves actual native outputs and
pre-send conversation/receipt data. Connectors are explicit offline substitutes.
Tests check the exact draft reaches the main input once, current-message/history
assembly remains intact, context boundaries fail closed, required source failure
remains visible, and no Task/Proposal/business action is created. Related prior
positive draft/desktop/mobile replay tests remain separate fixture evidence.
They do not establish a fresh real-model answer, lower latency, formal-memory
conversational recall or Codex App acceptance.

## Proposed native window; no allowance granted

The spent draft-intent root `dfdc4b48-8463-4ac1-8629-d2beed9cecf7` remains paused
with one turn/five sends and one unused helper. Installation cannot close it,
reset it or transfer that helper. Automatic memory was restored after the test.

The inert proposed root `2b1ae609-da43-460f-a18e-445b91adda88` defines at most
one turn/six helpers including failures and retries/zero websites, Claude Opus
5.5 / medium through existing subscription only. It is neither selected while
the prior root is paused nor activated by installation. Explicit Owner approval
is needed for old-root closure, a new allowance and exact-version deployment;
the existing personal confirmation and gates still apply. First substantive
failure or limit stops acceptance. No API fallback, purchase, P02-C change,
business write or deployment is authorized by this document.
