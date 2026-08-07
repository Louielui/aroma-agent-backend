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
  'governance/profileProbe.js': CLASS.INTERFACE,      //  24 — the `saying:` fields
  'errands/recallCheck.js': CLASS.INTERFACE,          //  23 — blocked reasons
  'intake/readResultView.js': CLASS.INTERFACE,        //  19
  'demo/assets/settings.js': CLASS.INTERFACE,         //  18
  'home/errandKinds.js': CLASS.INTERFACE,             //  18 — titles + duration words
  'agent/workOrderProducer.js': CLASS.INTERFACE,      //  16 — refusal messages
  'home/schedulerWitness.js': CLASS.INTERFACE,        //  16
  'intake/utilityAnswer.js': CLASS.INTERFACE,         //  16
  'demo/assets/index.html': CLASS.INTERFACE,          //  15
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
  'demo/assets/settings.html': CLASS.INTERFACE,       //   2
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

  // ── MODEL — she is told this. Translating it changes behaviour. ─────────────
  'persona/conversationContract.js': CLASS.MODEL,     //  46
  'intake/distillPrompt.js': CLASS.MODEL,             //  15
  'context/readContext.js': CLASS.MODEL,              //  15 — the safety header, and the exact
  //                                                          Chinese phrases it instructs her to
  //                                                          use for read-OK vs unavailable
  'adapters/MockAdapter.js': CLASS.MODEL,             //  12 — stands in for her own words
  'persona/xiangxiang.js': CLASS.MODEL,               //   6
  'context/adapters/aromaSystemRead.js': CLASS.MODEL, //  12
  'adapters/fixtures/demoTurns.js': CLASS.MODEL,      //   4
  'intake/groundedReply.js': CLASS.MODEL,             //   4
  'intake/intakeService.js': CLASS.MODEL,             //   6

  // ── MATCHING — his words are compared against this. ────────────────────────
  'intake/scopeNotes.js': CLASS.MATCHING,             //   3 — 「哪個倉」/「邊個倉」 both spellings
  'persona/ownerSettings.js': CLASS.MATCHING,         //   2 — injection patterns
  'intake/traditionalGuard.js': CLASS.MATCHING,       //   2 — the simplified charset IS the guard
  'routes/settingsOffer.js': CLASS.MATCHING,          //   7 — the deterministic entrance fires on
  //                                                          LITERAL tokens he types
  'lab/citationDetector.js': CLASS.MATCHING,          //   1
  'lab/conversationRecall.js': CLASS.MATCHING,        //   1
  'intake/routeEvidenceGuard.js': CLASS.MATCHING,     //   1

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
