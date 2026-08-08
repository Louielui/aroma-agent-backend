'use strict'

/**
 * workOrderView.js — the OWNER DECISION CARD (v2). Renders a SEALED Work Order for the
 * one person who has to decide about it.
 *
 * v1 was written for an engineer verifying security properties: constants, a 64-character
 * hash on the front face, a monospace field dump. The Owner read it and could not tell
 * what he was approving — which breaks the whole governance model, because every gate in
 * this system assumes he understood. v2 is the same information, arranged as a decision:
 * what changes, what it touches, before/after, worst case, what cannot happen, the caps.
 * Everything machine-shaped moves into a collapsed 技術細節 section.
 *
 * THREE PROPERTIES THIS FILE MUST KEEP:
 *
 * 1. WYSIWYA — every value on the card (visible face AND collapsed section) is read from
 *    canonicalWorkOrder(wo), the exact same serialization hashWorkOrder() digests. There
 *    is no second projection and no display-time rewrite, so a field cannot be
 *    shown-but-unhashed or hashed-but-hidden. Mutate any canonical value and both the hash
 *    and the rendered card change.
 * 2. DETERMINISTIC — pure. No I/O, no clock, no randomness, and above all NO model call at
 *    render time. The same sealed order always renders the same card.
 * 3. HONEST BEFORE/AFTER — 「現時內容」 is a bounded read of the real file taken at seal
 *    time (a fact). 「香香打算改成」 is INTENT: the agent has not run and may produce
 *    something else. The card labels it as intent and never states it as a result.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ AND PROPERTY #1 APPLIES TO THE SENTENCES, NOT ONLY TO THE VALUES.
 *
 * 「no second projection」 is written above about fields. During the bilingual extraction the
 * card face turned out to build the 「不會發生」 sentence a SECOND time, separately from
 * willNotHappenFrom(). My substitution updated one and dropped the 「不會」 prefix from the
 * other, and the face rendered:
 *
 *       提交、上傳、開 PR、合併、部署。
 *
 * A list of the actions that WILL happen, on the card whose entire purpose is to say what will
 * NOT. It is one character per item, it reads as a normal list, and it inverts the guarantee
 * the Owner approves on.
 *
 * **Caught by cardFace.test.js, not by reading it.** I wrote the change, read it back, and did
 * not see it. Both paths now go through `execPhrase()` — one builder, because a promise stated
 * twice is a promise that can disagree with itself.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { canonicalWorkOrder, canonicalWorkOrderJson, hashWorkOrder } = require('./workOrder')
const { t } = require('../i18n/t')

const NOT_PROVIDED = () => t('card.notProvided')

/**
 * ── 「不會發生」, DERIVED FROM THE SEALED ORDER ───────────────────────────────
 *
 * This sentence used to be a hardcoded string: 「不會提交、不會上傳、不會合併、不會部署。」
 * Two things were wrong with that, and only the second was visible.
 *
 * It broke property #1 above. Every other value on this card is read from
 * canonicalWorkOrder; the one sentence whose entire job is to say WHAT CANNOT HAPPEN was
 * retyped by hand — the second projection the header says does not exist.
 *
 * And because it was retyped, it UNDER-REPORTED. MUST_FORBID is five actions: commit, push,
 * PR, merge, deploy. The card named four. **開 PR — the one that would publish his code
 * somewhere he did not choose — was never shown to the Owner at all.**
 *
 * A promise that is retyped drifts. This one is now generated from the order's own
 * forbiddenActions, so the card cannot claim less than the order enforces.
 */
const WILL_NOT_LABELS = Object.freeze({
  // ⛔ Thunks, not key strings — `t(WILL_NOT_LABELS[a])` would be a DYNAMIC key (HR-48).
  commit: () => t('wont.commit'),
  push: () => t('wont.push'),
  PR: () => t('wont.pr'),
  merge: () => t('wont.merge'),
  deploy: () => t('wont.deploy'),
  'cred-edit': () => t('wont.credEdit'),
  'env-edit': () => t('wont.envEdit'),
  'gate-edit': () => t('wont.gateEdit'),
  'audit-edit': () => t('wont.auditEdit')
})

/**
 * THE TWO KINDS OF FORBIDDEN ACTION, and why the card face can be complete without
 * listing all nine.
 *
 * EXECUTION is not implied by anything else on the face, so it goes ON the face.
 * FILE_SCOPE is exactly what 「只修改 X 一個檔案」 already promises, so repeating it on the
 * face would state one guarantee twice — which is how the card became unreadable the
 * first time. It stays in 詳細, stated in full.
 *
 * A test asserts these two sets COVER FORBIDDEN_ACTIONS. Add a tenth action belonging to
 * neither and it fails, forcing a decision about where the Owner sees it, rather than
 * letting the face quietly promise less than the order enforces.
 */
const EXECUTION = Object.freeze(['commit', 'push', 'PR', 'merge', 'deploy'])
const FILE_SCOPE = Object.freeze(['cred-edit', 'env-edit', 'gate-edit', 'audit-edit'])

/**
 * @param {string[]} actions  the sealed order's own forbiddenActions
 * @returns {string} one or two sentences naming every one of them
 */
/**
 * The EXECUTION half as one phrase: 「不會提交、不會上傳、不會開 PR…」
 * ⛔ ONE BUILDER, used by both the full sentence and the card face. See the note at the face.
 */
function execPhrase (actions) {
  const list = Array.isArray(actions) ? actions : []
  return EXECUTION.filter((a) => list.includes(a))
    .map((a) => t('wont.each', { item: WILL_NOT_LABELS[a]() }))
    .join(t('punct.listSep'))
}

function willNotHappenFrom (actions) {
  const list = Array.isArray(actions) ? actions.filter((a) => typeof a === 'string') : []
  const exec = EXECUTION.filter((a) => list.includes(a)).map((a) => WILL_NOT_LABELS[a]())
  const rest = list.filter((a) => !EXECUTION.includes(a) && WILL_NOT_LABELS[a]).map((a) => WILL_NOT_LABELS[a]())
  // AN ACTION THIS MAP DOES NOT KNOW IS COUNTED, NEVER DROPPED. A sentence that reads
  // complete while quietly omitting a term is the exact failure this project has spent
  // weeks removing — and here the omission would be a safety guarantee.
  const unknown = list.filter((a) => !WILL_NOT_LABELS[a])

  /**
   * ⛔ THE CHINESE IS PRESERVED EXACTLY, AND MY FIRST ATTEMPT DID NOT PRESERVE IT.
   *
   * The execution list negates EVERY item — 「不會提交、不會上傳、不會開 PR」 — while the
   * file-scope list negates once — 「亦不會改憑證、改環境設定」. That asymmetry is the Owner's
   * wording and it is emphatic on purpose.
   *
   * I first collapsed it to a single negation because that reads better in English, and
   * `cardFace.test.js` failed on 「不會上傳」. Rewriting HIS Chinese to suit MY English is the
   * translation equivalent of narrowing a claim so it fits — on the one card whose whole job
   * is to state what cannot happen. The per-item form stays.
   */
  const parts = []
  if (exec.length) parts.push(t('wont.execSentence', { list: execPhrase(list) }))
  if (rest.length) parts.push(t('wont.alsoSentence', { list: rest.join(t('punct.listSep')) }))
  if (!parts.length) parts.push(t('wont.none'))
  if (unknown.length) parts.push(t('wont.unnamed', { n: unknown.length, ids: unknown.join(t('punct.listSep')) }))
  return parts.join(t('punct.sentenceSep'))
}

/** 120 -> "2 分鐘"; 90 -> "90 秒". Deterministic, no locale lookup. */
function humanDuration (sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return NOT_PROVIDED()
  if (sec % 60 === 0) return t('card.minutes', { n: sec / 60 })
  return t('card.seconds', { n: sec })
}

function indent (text, pad = '    ') {
  return String(text == null ? '' : text).split('\n').map((l) => pad + l).join('\n')
}

/**
 * @param {object} workOrder  a sealed Work Order
 * @returns {{ canonical, canonicalJson, hash, display, card, technical, lines, technicalLines }}
 */
function buildApprovalView (workOrder) {
  const canonical = canonicalWorkOrder(workOrder)
  const canonicalJson = canonicalWorkOrderJson(workOrder)
  const hash = hashWorkOrder(workOrder)
  const file = canonical.allowedFiles[0] || NOT_PROVIDED()
  const test = canonical.allowedTestCommand

  // ── the visible face — plain Chinese, one decision ────────────────────────
  // The Owner needs to know WHAT SHE WANTS TO DO, not what category of exercise it is.
  // 「安全測試」 described the machinery; this describes the request.
  const heading = t('card.heading')

  const whatChanges = canonical.goal || NOT_PROVIDED()

  const scope = [
    t('card.scopeOneFile', { file }),
    t('card.scopeThrowaway')
  ]

  // Before/after. The labels carry the epistemic status, so the Owner cannot mistake the
  // intended text for something that has already happened.
  const beforeLabel = t('card.beforeLabel', { truncated: canonical.currentExcerptTruncated ? t('card.truncated') : '' })
  const afterLabel = t('card.afterLabel')
  const before = canonical.currentExcerpt == null ? NOT_PROVIDED() : canonical.currentExcerpt
  const after = canonical.intendedChange // may be null — see below
  // If she stated no intent, SAY NOTHING rather than printing 「（未提供）」. An empty
  // promise box reads as a broken form and invites the Owner to fill it in himself, which
  // is backwards: the intent is hers to state, not his to supply.
  const hasIntent = typeof after === 'string' && after.trim() !== ''

  const worstCase = t('card.worstCase')

  const willNotHappen = willNotHappenFrom(canonical.forbiddenActions)
  /**
   * The face carries the EXECUTION half — drop an action from the order and the face stops
   * claiming it.
   *
   * ⛔ AND IT NOW USES THE SAME BUILDER, because it did not before and that cost a defect.
   * This line assembled the sentence itself, so when the full version moved to keys, the face
   * silently lost its 「不會」 prefix and rendered 「提交、上傳、開 PR」 — a list of the actions
   * that WILL happen, on the card whose job is to say what cannot. Caught by cardFace.test.js.
   *
   * Two derivations of one guarantee is the shape this file's own header warns about
   * (「no second projection」). It applies to the sentence as much as to the values.
   */
  const willNotHappenFace = execPhrase(canonical.forbiddenActions)

  // Money reads as money: 0.5 -> US$0.50, never US$0.5.
  const money = (n) => (n == null ? NOT_PROVIDED() : `US$${Number(n).toFixed(2)}`)
  const caps = t('card.caps', { time: humanDuration(canonical.timeoutSec), money: money(canonical.costCapUsd) })

  // ── the collapsed 技術細節 — every machine-shaped value, still inside the hash ──
  const technical = {
    approvalId: canonical.approvalId,
    branch: canonical.branch,
    hash,
    allowedFiles: canonical.allowedFiles,
    allowedTestCommand: test,
    forbiddenActions: canonical.forbiddenActions,
    timeoutSec: canonical.timeoutSec,
    costCapUsd: canonical.costCapUsd,
    approvalTtlSec: canonical.approvalTtlSec,
    currentExcerptTruncated: canonical.currentExcerptTruncated
  }

  const technicalLines = [
    `approvalId        : ${technical.approvalId == null ? NOT_PROVIDED() : technical.approvalId}`,
    t('tech.branch', { v: technical.branch == null ? NOT_PROVIDED() : technical.branch }),
    `hash              : ${technical.hash}`,
    t('tech.allowedFiles', { v: technical.allowedFiles.join(', ') || NOT_PROVIDED() }),
    t('tech.testCommand', { v: test == null || test === '' ? t('card.none') : test }),
    t('tech.forbidden', { v: technical.forbiddenActions.join(', ') || NOT_PROVIDED() }),
    t('tech.capsRaw', { v: technical.timeoutSec + 's / ' + money(technical.costCapUsd) }),
    t('tech.ttl', { v: humanDuration(technical.approvalTtlSec) }),
    t('tech.truncated', { v: technical.currentExcerptTruncated ? t('card.yes') : t('card.no') }),
    // The no-amend rule. It was on v1's front face; it is a real guarantee but it is not
    // part of the Owner's decision, so it lives here rather than crowding the card.
    t('tech.secondFile'),
    t('tech.isolation')
  ]

  /**
   * ── HOUSE RULE: A CARD SHOWS ONLY WHAT THE DECISION NEEDS ────────────────
   * Before adding a section, ask: would the Owner make a WRONG decision without it?
   * If not, it collapses. Everything else is available, one click away, and nothing has
   * been deleted — but eight sections to approve a one-line edit is a card nobody reads,
   * and a card nobody reads is an approval that is not really being given.
   *
   * The Owner judges three things: which file, what change, what is the worst case. So
   * the face carries exactly those, and the heading already says 「香香想改」 — the card
   * does not additionally explain that an intention is not a result, because saying it
   * twice is how a page starts sounding anxious rather than clear.
   */
  const card = {
    heading,
    sections: [
      // A FILENAME IS DATA; 「只修改 X 一個檔案」 IS THE PROMISE. Printing the bare path left
      // the one-file guarantee to be inferred — and it is what covers FILE_SCOPE.
      { title: null, body: scope[0] },
      { title: null, body: hasIntent ? after : whatChanges },
      // 2026-08-05, Owner decision. He described this card from memory as carrying the
      // negations and the isolation scope on one screen. It did not — they were behind
      // 詳細, and he had been approving on a belief about the card rather than on the card.
      // The face grows by ONE line, not by five sections; see EXECUTION / FILE_SCOPE above.
      // ⛔ The full stop was a LITERAL 「。」 here, outside the catalogue, so the English face
      // ended 「…will not deploy。」 — Chinese punctuation closing an English sentence. The
      // terminator belongs to the sentence, so it comes from the sentence's own key.
      { title: null, body: willNotHappenFace ? worstCase + '\n' + t('wont.execSentence', { list: willNotHappenFace }) : worstCase }
    ],
    details: [
      // The before/after keeps its FULL honest labelling here. The Owner asked that the
      // face stop explaining that an intention is not a result — 「香香想改」 already says
      // it — but where the two texts sit side by side the distinction still has to be
      // spelled out, and collapsed it costs him nothing.
      hasIntent
        ? { title: t('card.secBeforeAfter'), body: `${beforeLabel}：\n${indent(before)}\n${afterLabel}：\n${indent(after)}` }
        : { title: t('card.secBefore'), body: `${beforeLabel}：\n${indent(before)}` },
      { title: t('card.secWhatChanges'), body: whatChanges },
      { title: t('card.secScope'), body: scope.join('\n') },
      { title: t('card.secWillNot'), body: willNotHappen },
      { title: t('card.secCaps'), body: caps }
    ],
    actions: [t('card.approve'), t('card.reject')],
    detailsTitle: t('card.details'),
    technicalTitle: t('card.technical')
  }

  // Plain-text rendering — exactly what the Owner sees, used by the report and asserted
  // by the WYSIWYA tests. The collapsed section is included after its ▸ marker.
  const lines = [card.heading, '']
  for (const s of card.sections) {
    if (s.title) lines.push(s.title)
    lines.push(indent(s.body, '  '))
    lines.push('')
  }
  lines.push(`[${card.actions[0]}]  [${card.actions[1]}]`, '', `▸ ${card.detailsTitle}`)
  for (const d of card.details) {
    lines.push('  ' + d.title)
    lines.push(indent(d.body, '    '))
  }
  lines.push('', `▸ ${card.technicalTitle}`)
  for (const t of technicalLines) lines.push('  ' + t)

  // `display` keeps the v1 field-parity contract (each value mirrors canonical) so the
  // existing chain proof still checks the projection field by field.
  const display = {
    goal: canonical.goal,
    allowedFile: file,
    allowedTestCommand: test,
    forbiddenActions: canonical.forbiddenActions,
    timeoutSec: canonical.timeoutSec,
    costCapUsd: canonical.costCapUsd,
    branch: canonical.branch,
    approvalId: canonical.approvalId,
    hash,
    currentExcerpt: canonical.currentExcerpt,
    currentExcerptTruncated: canonical.currentExcerptTruncated,
    intendedChange: canonical.intendedChange,
    hasIntent,
    approvalTtlSec: canonical.approvalTtlSec,
    // kept for continuity with v1 callers; both are now derived from the card above
    whatWillHappen: [scope.join('\n'), willNotHappen, caps].join('\n'),
    // The ACTIONS the sentence was generated from, so a caller can check coverage
    // against the sealed order without parsing prose.
    willNotHappenActions: [...canonical.forbiddenActions],
    worstCase
  }

  return { canonical, canonicalJson, hash, display, card, technical, lines, technicalLines }
}

module.exports = { buildApprovalView, humanDuration, willNotHappenFrom, WILL_NOT_LABELS, EXECUTION, FILE_SCOPE, NOT_PROVIDED }
