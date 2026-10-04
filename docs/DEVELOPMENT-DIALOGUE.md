# Bounded development dialogue

The local Owner's sidebar/chat-page conversation now carries a server-held design
context into source planning. This fixes the previous handoff that sent only the
last confirmation or an Owner-only keyword summary, losing the assistant's actual
proposal and asking the Owner to repeat decisions or supply a file path.

## Flow

1. A named local surface or an existing valid server context selects this lane.
   The model interprets discussion, refinement, start, status, cancellation and
   explicit test-draft requests across languages. Surface matching does not grant
   write authority. Browser history cannot establish a context.
2. Discussion retains exact Owner requirements and actual displayed proposals.
   Context is bounded by conversation, build, age, length and a content digest.
   The digest is an integrity check, not an authentication credential.
3. A current start intent creates a real read-only plan. The planner receives the
   full bounded context, reads the fixed committed profile, verifies citations
   and rereads source before reporting completion. Clarification answers retain
   prior requirements and create a refined plan.
4. Explicit test drafting carries the verified goal, acceptance checks and host
   file profile into the existing project-task service. Independent review and
   registration/coding/adoption approvals remain separate. A completed plan is
   not completed coding.

Requests have durable receipts. A duplicate returns the original response; an
interrupted or uncertain request cannot automatically call a model or issue a
second task draft. Existing jobs remain readable through their work cards.
Concurrent conversation changes invalidate interpretation before dispatch.
Cancellation stops an active plan and clears continuation; it does not silently
cancel an independently approved test/coding job. Old valid advice receipts can
be upgraded with their displayed assistant proposal.

Host progress receipts use request-scoped language selection through the existing
i18n entrance; global UI language is not mutated. Model advice is not translated
through the interface catalogue. Interpretation latency is recorded separately.

## Limits and evidence

This is not a general autonomous agent. Only the local Owner and the existing
sidebar/chat-page profiles are connected. No arbitrary file, production, email,
credential, dependency-installation or automatic-adoption authority is added.
Long-term memory remains advisory and cannot route or authorize tasks. A new
conversation does not silently inherit approval. Semantic classification can
still be wrong; real multilingual scenarios supplement protocol fixtures.

`dialogue.test.js` covers language continuation, retained proposals, cancellation,
scope/schema rejection, replay, conversation races, context integrity, restart
receipts and clarification. `dialogueIntegration.test.js` exercises the actual
HTTP router, planner and project-task services through reviewed draft preparation,
asserting that no coding starts and no approval nonce enters conversation history.
Providers in those tests are fixtures; real model results belong in delivery
evidence, not inferred from mocked success. Full-suite runs use a clean isolated
checkout without remotes; actual source generation and live acceptance use the
existing subscriptions, never an API fallback.

## Supporting interface context

Sidebar planning also reads committed page markup, existing event bindings and
layout styles. These dependencies are separately hashed and checked for drift;
they do not expand the two editable sidebar files. The provider receives numbered
excerpts of the large application files, while full source remains in the plan
evidence for exact citations and revalidation. Missing source is a verification
risk, not a request for the Owner to locate files. Clarification questions are
reserved for unresolved Owner choices.

An explicit draft request after requirements changed first creates an updated
plan. It cannot silently draft obsolete acceptance criteria.

The semantic development lane precedes keyword mail routing. Mentioning a Mail
button and chat history does not query a mailbox. An actual topic change returns
to the existing mail lane and its unchanged source/access checks.

Test draft generation uses Sol 6.1 Medium with compact shared fixtures, separately
from High-effort coding. Its actual effort is recorded on the drafting event.
Claude review, protected tests and Owner approval are unchanged; failed or
uncertain generations are never automatically replayed.

The review policy is selected from the exact registered source profile. Sidebar
acceptance may read the packaged CSS inside the offline executor; Context tests
retain their no-filesystem boundary. Reviewer tools remain disabled. A generated
draft or a failed subscription review never counts as approved or executed tests.
Actual delivery evidence covers Chinese, English and mixed-language sidebar
planning. The latest test draft reached review, which failed authentication;
full review and coding are not accepted by that observation.
