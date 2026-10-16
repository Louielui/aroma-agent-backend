# U1 integration preparation on E1-enabled main

Owner scope: integrate the reviewed `b6f2fc8d3bc6da6fece88ebcd2bcb30ec73b6125`
U1 delta onto `f3967c838dab085ff41fee3dd6bb574fddc72ea7`; stop after offline
verification. The original branch, source, exact review and test receipts remain
preserved. No deployment, merge, framework, planner, memory, registry or feature
expansion is part of this preparation.

Three files required conflict resolution:

- `src/app.js`: keep E1's Gmail connector injection alongside U1's intake adapter.
- `src/browserRead/service.js`: retain all V3 source/identity/hash/goal/receipt
  behavior; add only reviewed U1 V2 reservation, linkage and Main transport.
- `src/core/operating/architecture.test.js`: retain E1 and U1 inventory assertions;
  count both partial capability cards (36 total).

All other runtime changes match the reviewed U1 delta. New integration tests and
this reconciliation record supply evidence; no E1 domain, Owner Goal, Context
Routing, source grant, Action Gateway or Native Host authentication implementation
is changed. U1 remains default-off. V1/V2/V3 Native request shapes remain exact.

## Application-independent continuity and its boundary

The same V2 intake seam handles synthetic Gmail page context, Drive page context,
and generic browser page context. It binds the immutable Owner objective, task,
goal, attempt and source hash before the existing bounded runner dispatches.
Main viewing is observational; explicit continuation keeps task/goal, creates a
new attempt and captures current capabilities with browser context unavailable.
The native token cannot read, cancel or use Main records as ancestors. Only a
valid existing Owner web session can access the Main task routes. Unrelated
conversation messages are neither merged nor loaded into the runner.

Gmail V2 page context is an explicitly consented synthetic snapshot, without an
exact Gmail locator or API grant. It is not a Gmail thread read or reply preview.
Existing E1 V3 previews remain independent and unlinked, with their own existing
goal and verified domain receipt. V3 account/message/thread/route hashes, read-only
OAuth, header-derived recipient/subject, cancellation and no-write boundaries are
retained. U1 does not move a V3 receipt into a V2 task, grant Main Gmail access from
an open tab, save a draft or send mail. Unified V3 continuation is deferred because
it would expand the reviewed U1 scope.

## All 27 acceptance criteria

Status applies to the full design criterion, not just its tested subset. `passed`
means the criterion is demonstrated for the declared offline slice; `deferred`
identifies a design requirement outside that implemented slice. `blocked` is
reserved for a required verification prevented by an unresolved failure or
external dependency. There are 19 passed, 8 deferred and 0 blocked criteria.
Deferred criteria prevent claiming full U1 architecture acceptance.

Tests named below are under `src/intake/` unless a domain path is explicit.

| ID | Status | Measured evidence and remaining limitation |
|---|---|---|
| C01 | passed | `unifiedIntake.test.js`, `unifiedIntegration.test.js`, `unifiedE1Integration.test.js`: exact multiclause objective/time/no-checkout retained; only explicit task reference continues identity. Same text alone never merges tasks. |
| C02 | passed | Exact retry returns the original task/attempt, even after newer continuation; changed payload conflicts and duplicate history/dispatch is prevented. |
| C03 | passed | Closed schema rejects injected role, grants, capability, evidence, unknown version and portable context references before dispatch. |
| C04 | passed | Hostile synthetic document/page content remains untrusted; existing runner can perform only admitted reads and cannot rewrite the Owner goal or send mail. |
| C05 | passed | Relevant Drive context uses existing bounded search/get and content verification; general/page-only requests make no company-source call. Existing real Drive gateway/panel regressions remain mandatory. |
| C06 | passed | Browser Read source/freshness and E1 identity regressions, plus V3 identity-hash tampering and V2 rejection of exact Gmail locators. Main receives no portable browser identity/grant. |
| C07 | passed | Existing provider-sharing/source-lease tests plus revocation before/during read: denied content is not delivered and cannot complete a goal. |
| C08 | passed | Admitted capability version change blocks dispatch; old scope remains frozen, new Main attempt captures current scope. No capability installation/activation is added. |
| C09 | passed | Gmail/Drive/generic V2 fixtures preserve task/goal across observational view and explicit Main follow-up. New attempt and current authorization; no automatic history merge or browser authority transfer. |
| C10 | deferred | Existing Action Gateway session/hash/nonce/expiry regressions pass; unified cross-surface action proposal/presentation is outside this read-only slice. |
| C11 | deferred | Bounded-read cancel/controller and late callback tests pass. General action supersession/cancellation integration is not implemented. |
| C12 | deferred | Reservation/link failure, restart and observational retry tests pass. Exhaustive crash recovery across every domain execution/receipt/projection boundary remains unimplemented. |
| C13 | passed | CAS permits only one continuation at a shared revision. A stale client conflicts and the Main UI refreshes observationally without replay. |
| C14 | deferred | Forged/missing/mismatched evidence cannot complete any U1 outcome. A positive exact domain full-goal completion verifier is not supplied by this slice. |
| C15 | passed | Existing Drive/source coverage and common view tests retain partial/failed/unknown evidence and every unresolved mandatory outcome. Unsupported supplier/action work stays unresolved. |
| C16 | passed | Finished reads, generated preview and other intermediate results remain distinct from full Owner-goal completion; no Costco or scheduling effect is inferred. |
| C17 | deferred | Original instruction clauses/time/no-checkout remain exact. Full procurement/supplier/Costco workflow integration is outside the reviewed implementation. |
| C18 | passed | Legacy V1/V2/V3 tests preserved; flag-off blocks new/linked U1 execution without downgrade, while existing E1 V3 preview remains available under its original checks. |
| C19 | passed | Failed reservation/link dispatches nothing; corrupt/missing receipt is unavailable. Main history-save failure is returned explicitly; no false empty/success projection. |
| C20 | passed | Synthetic E1 V3 tests with U1 both off/on retain exact account/thread/headers and existing Owner Goal; only message/thread reads occur, no save/draft/send operations or permissions. No claim of unified V3 handoff. |
| C21 | passed | New intake events contain only IDs/enums/time. UI uses existing emitted stages and conservative outcome/coverage status, without raw source/prompt/token logs or fabricated progress. |
| C22 | passed | Actual pinned E1-baseline Task Store is loaded as a legacy reader/writer against synthetic U1 records; optional metadata and complete goal/task survive unchanged. Existing conversation round-trip tests also pass. |
| C23 | deferred | Directory survey proves one common reservation seam for opted-in V2 Browser and explicit Main bounded-read entries. Other specialized Main handlers remain on legacy routes. |
| C24 | passed | Unknown capability/ref/version/ownership fails closed; unsupported receipt kinds never become goal completion. |
| C25 | passed | Real existing Owner session store gates HTTP view/continue; native bearer, forged/revoked session and cross-origin requests fail. Main records and unrelated conversation history are inaccessible to native transport. |
| C26 | deferred | Existing Native exact-version/package/frame regressions are retained; no protocol or packaged dependency is added. A newly negotiated expanded Native intake protocol is not implemented. |
| C27 | deferred | One canonical task/goal and no false Decision are verified for the bounded-read seam; E1's separate legacy goal is preserved. Integration of every existing specialized domain handler remains deferred. |

## Verification and handoff

Full-suite and E1 regression receipts, baseline/candidate differential output,
changed-file hashes, preservation comparisons, and independent exact-candidate
review are retained in the separate integration evidence directory. Tests use
fresh stores, synthetic source readers/model outputs and credential-free test
environments; no live Gmail, Drive or production business data is read.

Source-level preservation is checked for all E1-only files and the unchanged
Owner Goal, Context Routing, auth, Action Gateway, installer and permission
contracts. Production HEAD, main, boot identity, original U1 candidate, E1 driver,
launcher/configuration bytes and original review evidence are compared to the
preparation baseline. No production reload, permission change or deployment is
part of these checks. Pending deployment/live acceptance remains an Owner gate.
