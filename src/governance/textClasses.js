'use strict'

/**
 * textClasses.js — WHICH Chinese in this codebase may be translated. GOVERNANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FINDING THAT MADE THIS FILE NECESSARY.
 *
 * 「Extract the interface strings」 sounds like one job. Measured, the source carries 721 quoted
 * Chinese lines, and only a minority of them are interface. The rest are Chinese that must NOT
 * move, and at a glance they look exactly the same:
 *
 *   · `'冇嘢等你決定。'`                          → he reads this.            INTERFACE
 *   · `'不誇大能力；未做過的事不說已完成'`          → she is TOLD this.         MODEL
 *   · `['地點','倉庫','邊個倉','哪個倉','門市']`    → his words are matched     MATCHING
 *                                                   against this.
 *
 * Translating the second changes her BEHAVIOUR, not her language. Translating the third deletes
 * a guard, and deletes it silently — the code still runs, the list simply stops matching what he
 * actually types. Both would look like tidy extraction work in a diff.
 *
 * ⛔ AND THE CLASSIFICATION IS PER-FILE, WHICH IS TOO COARSE FOR SOME FILES.
 *
 * `intake/answerPlan.js` holds all three at once:
 *   · unit/status/entity LABELS         → INTERFACE, extracted
 *   · the JSON-schema `description` fields → MODEL: she is TOLD them, and they shape her output
 *   · `MERIDIEM` (下午/早上/晚上…)          → MATCHING: they parse what HE types
 *
 * The table below can only give that file ONE class.
 *
 * ⛔ AND MEASURED: 8 OF THE 34 REMAINING INTERFACE FILES ARE MIXED — 24%, carrying 20 of the
 * 232 remaining lines. answerPlan is not an outlier.
 *
 * The fence is NOT a per-region registry — that would be a second hand-maintained list,
 * consulted by whoever remembers to, which is the thing HR-48 is about. It is
 * : no  call may stand in a MODEL or MATCHING
 * POSITION. It checks the failure rather than cataloguing the territory, and it found three
 * live instances on its first run.
 *
 * ⛔ SO THE BOUNDARY IS DECLARED, NOT REMEMBERED. A new file carrying Chinese must be classified
 * before the suite goes green — see `textClasses.test.js`. That is the difference between a fence
 * and a checklist someone has to remember to consult.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const CLASS = Object.freeze({
  /** He reads it on screen. Extract it, translate it. */
  INTERFACE: 'INTERFACE',

  /**
   * She is told it — prompts, the conversation contract, persona, and the canned replies a mock
   * adapter stands in for. ⛔ Translating it is a BEHAVIOUR change wearing a translation's
   * clothes. If her English replies are ever wanted, that is a change to the contract and to
   * `traditionalGuard.js`, made deliberately and tested as behaviour.
   */
  MODEL: 'MODEL',

  /**
   * Text matched against his input or against her output — scope-note word lists, injection
   * patterns, the simplified-character set. ⛔ Translating it removes a guard WITHOUT removing
   * any code, so nothing fails and nothing is reported. The most dangerous of the four.
   */
  MATCHING: 'MATCHING',

  /**
   * Frozen artefacts under hash verification — identity, the behavioural mapping, persona
   * closure. ⛔ Not ours to edit at all, in any language, for any reason.
   */
  FROZEN: 'FROZEN'
})

/**
 * Every production file carrying quoted Chinese, and what kind it is.
 * Counts are the measurement at classification time; they are documentation, not assertions —
 * the test checks COVERAGE (is every such file listed), never the number.
 */
const FILE_CLASS = Object.freeze({
  // ── INTERFACE ──────────────────────────────────────────────────────────────
  'demo/assets/app.js': CLASS.INTERFACE,              // 139 — the screen itself
  'agent/workOrderView.js': CLASS.INTERFACE,          //  39
  'agent/agentResultView.js': CLASS.INTERFACE,        //  33
  'intake/answerPlan.js': CLASS.INTERFACE,            //  32 — unit + status labels
  // B, the goal decomposer. MODEL text: these strings are read by a model, not by the Owner.
  'intake/goal/operationCatalogue.js': CLASS.MODEL,   //   1 — the 「(空)」 marker in the catalogue
  'intake/goal/goalDecomposer.js': CLASS.MODEL,       //  10 — the decomposer's whole instruction
  'intake/goal/goalPlanContract.js': CLASS.MODEL,     //   4 — JSON-schema `description` text
  // X1: schema `description` text she is TOLD, plus the EXECUTIVE FRAME block she is SHOWN.
  // Translating either changes what she understands the Owner to want — MODEL, like its siblings.
  'intake/goal/executiveFrame.js': CLASS.MODEL,       //  X1 — the frame contract and its block
  // X2: the WORKING CONTEXT block she is SHOWN — its label, its 「context not evidence」 warning
  // and its continuity instruction. Translating any of it changes what she takes the current
  // conversation to mean, which is the whole point of the block. MODEL, like its siblings.
  'intake/goal/workingContext.js': CLASS.MODEL,       //  X2 — the live-conversation block
  // S1: the SELF CAPABILITY block she is SHOWN, plus each capability's Owner-facing label.
  // Translating 「未實作」 into something softer changes what she believes she can do, which is
  // the one thing this registry exists to keep true. MODEL.
  'governance/selfCapability.js': CLASS.MODEL,        //  S1 — the capability block and labels
  'intake/executiveJudgment.js': CLASS.MODEL,        //  X3 — the judgement directive and the rendered position labels
  'intake/investigationState.js': CLASS.MODEL,       //  X4 — the investigation block and its read-state labels
  'intake/sectionAttribution.js': CLASS.MATCHING,    //  X4.2 — source aliases MATCHED against model headings; translating one deletes the guard
  'intake/negativeExistence.js': CLASS.MATCHING,     //  X4.3 — absence/period markers MATCHED against model prose; translating one deletes the gate
  // The requirement block B injects into the prompt. MODEL: the Owner never reads this, the
  // model does — and 「唔好就近搵一個似樣嘅頂替」 is an instruction, so rewording it changes
  // her behaviour rather than changing what he sees.
  'intake/goal/goalGate.js': CLASS.MODEL,             //   8 — the requirement block
  // ⛔ MATCHING, not INTERFACE. The Chinese here is the numeral and measure-word SET matched
  // against her own output. Translating it would delete the detector silently — the code still
  // runs and simply stops matching what she actually writes. The most dangerous of the classes.
  'intake/noEvidenceShadow.js': CLASS.MATCHING,       //   2 — CJK numerals + measure words
  // ⛔ MATCHING + INTERFACE in one file. The NAME list is matched against his words (translating
  // it deletes the detector silently); the describe() sentence he reads. MATCHING is the
  // stricter of the two, so it governs.
  'governance/selfDescription.js': CLASS.MATCHING,    //   6 — the internal-system name list
  /**
   * ⛔ MATCHING, and it holds INTERFACE text too — the stricter class governs.
   *
   * MATCHING: the internal/public/choice vocabularies matched against HER OWN OUTPUT, and the
   * read-question vocabulary matched against HIS. Translating any of them deletes a guard with
   * no code removed and nothing failing.
   * INTERFACE: the two fact sentences he reads.
   *
   * ⚠ AND THIS FILE IS WHY A GAP IN THIS FENCE IS NOW KNOWN. Its FIRST version carried Chinese
   * only inside REGEX LITERALS and the coverage scan did not see it — the scan matches Chinese
   * inside a quoted string (`textClasses.test.js:57`). It only became visible this round when
   * quoted fact sentences were added. Regex-literal MATCHING vocabulary is invisible to this
   * fence. Recorded, not fixed here: widening the scan is its own change.
   */
  'governance/internalSystemAnswer.js': CLASS.MATCHING, //  ~8 — axis vocabularies + 2 facts
  // ⛔ INTERFACE — he reads it — but its SHAPE is load-bearing and a test pins it: the sentence
  // must announce itself as a FAULT. A neutral placeholder would read as an answer, which is
  // the silence defect moved one layer up. Reword freely; do not make it sound like content.
  'governance/nonEmptyReply.js': CLASS.INTERFACE,     //   1 — the empty-reply defect sentence
  'governance/profileProbe.js': CLASS.INTERFACE,      //  24 — the `saying:` fields
  'errands/recallCheck.js': CLASS.INTERFACE,          //  23 — blocked reasons
  // The coverage line the Owner reads. INTERFACE: rewording it changes what he sees, never
  // what the check decides — the alarm/report split lives in shapeDrift.js, which has no text.
  'errands/shapeDriftRunner.js': CLASS.INTERFACE,     //   6 — the drift summary sentence
  'intake/readResultView.js': CLASS.INTERFACE,        //  19
  'demo/assets/settings.js': CLASS.INTERFACE,         //  18
  'home/errandKinds.js': CLASS.INTERFACE,             //  18 — titles + duration words
  'agent/workOrderProducer.js': CLASS.INTERFACE,      //  16 — refusal messages
  'home/schedulerWitness.js': CLASS.INTERFACE,        //  16
  'intake/utilityAnswer.js': CLASS.INTERFACE,         //  16
  'home/homeRoutes.js': CLASS.INTERFACE,              //  15
  'agent/investigationReport.js': CLASS.INTERFACE,    //  14
  'governance/settingsRegistry.js': CLASS.INTERFACE,  //  14 — the `say` sentences
  'context/invoiceBacklog.js': CLASS.INTERFACE,       //  12
  'home/briefing.js': CLASS.INTERFACE,                //  12
  'intake/readStateGuard.js': CLASS.INTERFACE,        //  12
  'agent/credentialHealth.js': CLASS.INTERFACE,       //   9
  'home/errandConclusion.js': CLASS.INTERFACE,        //   7
  'workers/registry.js': CLASS.INTERFACE,             //   7 — worker names shown on screen
  'agent/requestInference.js': CLASS.INTERFACE,       //   6
  'context/developmentRecord.js': CLASS.INTERFACE,    //   5
  'dispatch/dispatcher.js': CLASS.INTERFACE,          //   4
  'governance/launcherPin.js': CLASS.INTERFACE,       //   4
  'demo/appManifest.js': CLASS.INTERFACE,             //   3
  'demo/greeting.js': CLASS.INTERFACE,                //   3
  'governance/knockLog.js': CLASS.INTERFACE,          //   3
  'home/errandRunner.js': CLASS.INTERFACE,            //   3
  'home/sectionDetail.js': CLASS.INTERFACE,           //   3
  'routes/demoRouter.js': CLASS.INTERFACE,            //   3
  'utils/intakeDiagnostics.js': CLASS.INTERFACE,      //   3
  'agent/enquiryRunner.js': CLASS.INTERFACE,          //   2
  'agent/evidenceGate.js': CLASS.INTERFACE,           //   2
  'browser/groupBudget.js': CLASS.INTERFACE,          //   2
  'errands/recallRunner.js': CLASS.INTERFACE,         //   2
  'governance/sectionEnvelope.js': CLASS.INTERFACE,   //   2
  'home/sectionAttachment.js': CLASS.INTERFACE,       //   2
  'store/conversationStore.js': CLASS.INTERFACE,      //   2
  'agent/patchStore.js': CLASS.INTERFACE,             //   1
  'agent/requestShape.js': CLASS.INTERFACE,           //   1
  'home/scheduledRun.js': CLASS.INTERFACE,            //   1
  'routes/intakeRouter.js': CLASS.INTERFACE,          //   1
  'routes/ownerAuthRouter.js': CLASS.INTERFACE,       //   1
  'routes/workRequestRoute.js': CLASS.INTERFACE,      //   1
  'i18n/catalogue.js': CLASS.INTERFACE,               //   9 — already extracted; it IS the words
  'browse/browseAnswer.js': CLASS.INTERFACE,          //   9 — the answer he reads after a public
  //                                                          read. Replaces browseResult.js, which
  //                                                          was DELETED rather than refactored.
  //                                                          ⛔ TWO PHRASES ARE PINNED by
  //                                                          browseAnswer.test.js and cannot be
  //                                                          extracted silently: 「搵唔到」, which
  //                                                          must never become 「冇貨」, and the line
  //                                                          saying the price seen is NOT the
  //                                                          shop's 「售價」. Both carry a
  //                                                          distinction A1 enforces in a FIELD;
  //                                                          translating them away would delete it
  //                                                          from the only place he reads.

  /**
   * ⛔ DELIBERATELY ABSENT, so nobody reads their absence as an oversight:
   *   · demo/assets/index.html
   *   · demo/assets/settings.html
   *
   * Both were INTERFACE and are now EMPTY — their markup ships with no words at all and every
   * label is set from the catalogue by applyShellText(). They carry nothing and translate
   * nothing, so an entry here would be coverage they no longer give. If Chinese is ever put
   * back into either, the COVERAGE test fails until someone classifies it again.
   */

  // ── MODEL — she is told this. Translating it changes behaviour. ─────────────
  'persona/conversationContract.js': CLASS.MODEL,     //  46
  'intake/distillPrompt.js': CLASS.MODEL,             //  15
  // The O-1 evaluation corpus: labelled Owner-style questions fed to the deterministic
  // matcher. MATCHING because translating a row silently changes what the router is measured
  // against — the phrases ARE the guard, not decoration around it.
  'context/eval/businessIntentCorpus.js': CLASS.MATCHING,
  // O-1 semantic fallback. MATCHING and not INTERFACE, even though it also holds Owner-facing
  // clarify labels: the file carries AMBIGUOUS_WORDING, whose lookbehind is the entire
  // distinction between a shortage assertion (唔夠, ambiguous) and a sufficiency question
  // (夠唔夠, which resolves cleanly). Translating that regex deletes the guard in silence,
  // and MATCHING is the class that says so.
  'intake/semanticFallback.js': CLASS.MATCHING,
  'context/readContext.js': CLASS.MODEL,              //  15 — the safety header, and the exact
  //                                                          Chinese phrases it instructs her to
  //                                                          use for read-OK vs unavailable
  'adapters/MockAdapter.js': CLASS.MODEL,             //  12 — stands in for her own words
  'persona/xiangxiang.js': CLASS.MODEL,               //   6
  'context/adapters/aromaSystemRead.js': CLASS.MODEL, //  12
  'adapters/fixtures/demoTurns.js': CLASS.MODEL,      //   4
  'intake/groundedReply.js': CLASS.MODEL,             //   4
  'intake/intakeService.js': CLASS.MODEL,             //   6
  'intake/sourceAmbiguityGate.js': CLASS.MODEL,      //   2 — the verifier's own system
  'intake/publicQueryEgressPlanner.js': CLASS.MODEL, //   1 — the planner's own system
  'intake/mixedKnowledgeRequirement.js': CLASS.MODEL, //   1 — the mixed verifier's own system
  'intake/finalKnowledgeRequirement.js': CLASS.MODEL, //   3 — the final gate's system + world labels
  'intake/recoveryDecisionWorker.js': CLASS.MODEL,   //   3 — the worker's system + world labels
  'intake/ownerSourceIntentResolver.js': CLASS.MODEL, //   3 — the resolver's system + clarification
  //                                                          instruction and its ONE safe
  //                                                          fallback question. She is TOLD
  //                                                          them, and they decide allow vs
  //                                                          ask; the fallback is what Louie
  //                                                          actually reads when a question
  //                                                          is unusable.
  'intake/a4Contract.js': CLASS.MODEL,                //   5 — the JSON-schema `description`
  //                                                          fields on the A4 read-argument
  //                                                          shape. She is TOLD them, and they
  //                                                          decide whether she fills query /
  //                                                          freshness / location at all.
  //                                                          Translating them changes what she
  //                                                          sends, not what he reads.
  'context/readOperations.js': CLASS.MODEL,           //   7 — the Owner-facing gloss for each
  //                                                          read operation (aroma_system.purchasing
  //                                                          ＝採購單). She is TOLD it, in the schema
  //                                                          description, and it decides WHICH view
  //                                                          she asks for. Translating it away
  //                                                          leaves six opaque names to guess among.

  // ── MATCHING — his words are compared against this. ────────────────────────
  'intake/scopeNotes.js': CLASS.MATCHING,             //   3 — 「哪個倉」/「邊個倉」 both spellings
  'persona/ownerSettings.js': CLASS.MATCHING,         //   2 — injection patterns
  'intake/traditionalGuard.js': CLASS.MATCHING,       //   2 — the simplified charset IS the guard
  // ⛔ MATCHING, and the consequence of getting it wrong is unusually sharp. The list is
  //    compared against his WHOLE message to decide a turn is bare small talk. Translate
  //    「你好」 and the classifier stops recognising his greeting — it fails closed, so
  //    nothing breaks loudly; the eligibility simply stops being true and a future fast
  //    path silently never fires. Widen it carelessly and the opposite happens.
  'intake/pureChatEligibility.js': CLASS.MATCHING,    //  15 — the closed social vocabulary
  'routes/settingsOffer.js': CLASS.MATCHING,          //   7 — the deterministic entrance fires on
  //                                                          LITERAL tokens he types
  'lab/citationDetector.js': CLASS.MATCHING,          //   1
  'lab/conversationRecall.js': CLASS.MATCHING,        //   1
  'intake/routeEvidenceGuard.js': CLASS.MATCHING,     //   1
  // ⛔ CX1 — laneRouter ALWAYS matched his words; what changed is that one vocabulary is now a
  // STRING. `ADVERB` is the closed list of time/degree adverbs that may sit between 你 and the
  // modal (你現在能… / 你而家可唔可以…); it is composed into three RegExps rather than repeated
  // in each of them. Translating a token here does not soften a rule — it silently stops
  // recognising a capability question, which is the exact defect CX1 was opened for.
  'intake/laneRouter.js': CLASS.MATCHING,             //   1 — the ADVERB fragment; the lane vocabulary
  // ⛔ `intake/rankingProof.js` WAS CLASSIFIED HERE AND IS NOT ANY MORE — task 001-H, and the
  // staleness rule asked for it, not me. Its quoted Chinese was `CJK_DIGITS` (一: 1, 二: 2, …),
  // the count parser's numeral table, and the parser was deleted when cardinality became a
  // declared field. What remains is Chinese inside REGEX literals (最缺/排序), which this fence
  // has never been able to see — quoted and template strings only. So the entry was removed
  // because it went stale by the fence's definition, NOT because the file stopped mattering:
  // translating those patterns would still delete the leak-guard silently. The blind spot is
  // pre-existing and older than this change; it is reported, not widened here.
  'browse/browseIntent.js': CLASS.MATCHING,           //   4 — the whole file IS the guard: the
  //                                                          browse verbs (查/睇下), the web
  //                                                          markers (網站/官網), the PURCHASE
  //                                                          words (買/落單/加入購物車) and the
  //                                                          price field (幾多錢/價錢) are matched
  //                                                          against what Louie types.
  //                                                          ⛔ Translating the purchase list does
  //                                                          not break a test or remove a line of
  //                                                          code — it silently turns 「幫我買」
  //                                                          from REFUSED into an ordinary read.

  // ── FROZEN — hash-verified. Not ours to edit, in any language. ─────────────
  'core/memory/shadow/behavioralMapping.js': CLASS.FROZEN, // 2
  'core/memory/shadow/identityShadow.js': CLASS.FROZEN     // 1
})

/** @returns {string|null} the class, or null if the file has never been classified. */
function classOf (relPath) {
  return Object.prototype.hasOwnProperty.call(FILE_CLASS, relPath) ? FILE_CLASS[relPath] : null
}

/** ⛔ Only INTERFACE files may call the resolver. Enforced by `textClasses.test.js`. */
function mayTranslate (relPath) {
  return classOf(relPath) === CLASS.INTERFACE
}

module.exports = { CLASS, FILE_CLASS, classOf, mayTranslate }
