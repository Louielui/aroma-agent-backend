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
 */

const { canonicalWorkOrder, canonicalWorkOrderJson, hashWorkOrder } = require('./workOrder')

const NOT_PROVIDED = '（未提供）'

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
  commit: '提交',
  push: '上傳',
  PR: '開 PR',
  merge: '合併',
  deploy: '部署',
  'cred-edit': '改憑證',
  'env-edit': '改環境設定',
  'gate-edit': '改授權閘',
  'audit-edit': '改稽核紀錄'
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
function willNotHappenFrom (actions) {
  const list = Array.isArray(actions) ? actions.filter((a) => typeof a === 'string') : []
  const exec = EXECUTION.filter((a) => list.includes(a)).map((a) => WILL_NOT_LABELS[a])
  const rest = list.filter((a) => !EXECUTION.includes(a) && WILL_NOT_LABELS[a]).map((a) => WILL_NOT_LABELS[a])
  // AN ACTION THIS MAP DOES NOT KNOW IS COUNTED, NEVER DROPPED. A sentence that reads
  // complete while quietly omitting a term is the exact failure this project has spent
  // weeks removing — and here the omission would be a safety guarantee.
  const unknown = list.filter((a) => !WILL_NOT_LABELS[a])

  const parts = []
  if (exec.length) parts.push(exec.map((w) => '不會' + w).join('、') + '。')
  if (rest.length) parts.push('亦不會' + rest.join('、') + '。')
  if (!parts.length) parts.push('這張工作單沒有宣告任何禁止動作。')
  if (unknown.length) parts.push(`另有 ${unknown.length} 項禁止動作未能顯示名稱（${unknown.join('、')}）。`)
  return parts.join('')
}

/** 120 -> "2 分鐘"; 90 -> "90 秒". Deterministic, no locale lookup. */
function humanDuration (sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return NOT_PROVIDED
  if (sec % 60 === 0) return `${sec / 60} 分鐘`
  return `${sec} 秒`
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
  const file = canonical.allowedFiles[0] || NOT_PROVIDED
  const test = canonical.allowedTestCommand

  // ── the visible face — plain Chinese, one decision ────────────────────────
  // The Owner needs to know WHAT SHE WANTS TO DO, not what category of exercise it is.
  // 「安全測試」 described the machinery; this describes the request.
  const heading = '香香想改一個檔案'

  const whatChanges = canonical.goal || NOT_PROVIDED

  const scope = [
    `只修改 ${file} 一個檔案。`,
    '只在丟棄式副本內操作，真實程式庫不會被改動。'
  ]

  // Before/after. The labels carry the epistemic status, so the Owner cannot mistake the
  // intended text for something that has already happened.
  const beforeLabel = `現時內容（讀自真實檔案${canonical.currentExcerptTruncated ? '，已截斷，下面還有' : ''}）`
  const afterLabel = '香香打算改成（這是香香的打算，不是已完成的結果 —— 它仍未執行，實際結果可能不同）'
  const before = canonical.currentExcerpt == null ? NOT_PROVIDED : canonical.currentExcerpt
  const after = canonical.intendedChange // may be null — see below
  // If she stated no intent, SAY NOTHING rather than printing 「（未提供）」. An empty
  // promise box reads as a broken form and invites the Owner to fill it in himself, which
  // is backwards: the intent is hers to state, not his to supply.
  const hasIntent = typeof after === 'string' && after.trim() !== ''

  const worstCase = '改壞了？只改副本，你的程式庫不受影響。'

  const willNotHappen = willNotHappenFrom(canonical.forbiddenActions)
  // The face carries the EXECUTION half, derived the same way — drop an action from the
  // order and the face stops claiming it.
  const willNotHappenFace = EXECUTION.filter((a) => canonical.forbiddenActions.includes(a))
    .map((a) => '不會' + WILL_NOT_LABELS[a]).join('、')

  // Money reads as money: 0.5 -> US$0.50, never US$0.5.
  const money = (n) => (n == null ? NOT_PROVIDED : `US$${Number(n).toFixed(2)}`)
  const caps = `最長 ${humanDuration(canonical.timeoutSec)} · 最多 ${money(canonical.costCapUsd)}`

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
    `approvalId        : ${technical.approvalId == null ? NOT_PROVIDED : technical.approvalId}`,
    `分支              : ${technical.branch == null ? NOT_PROVIDED : technical.branch}`,
    `hash              : ${technical.hash}`,
    `可改檔案          : ${technical.allowedFiles.join(', ') || NOT_PROVIDED}`,
    `測試指令          : ${test == null || test === '' ? '（無）' : test}`,
    `禁止動作          : ${technical.forbiddenActions.join(', ') || NOT_PROVIDED}`,
    `上限（原始值）    : ${technical.timeoutSec}s / ${money(technical.costCapUsd)}`,
    `工作單有效時間    : ${humanDuration(technical.approvalTtlSec)}（逾時自動失效，需重新產生）`,
    `現時內容是否截斷  : ${technical.currentExcerptTruncated ? '是' : '否'}`,
    // The no-amend rule. It was on v1's front face; it is a real guarantee but it is not
    // part of the Owner's decision, so it lives here rather than crowding the card.
    '如需改第二個檔案  : 必須重新建立一張新的工作單（沒有中途加檔案的機制）',
    '隔離方式          : 丟棄式副本，已移除所有 remote，改動無法回到 main'
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
      { title: null, body: willNotHappenFace ? `${worstCase}\n${willNotHappenFace}。` : worstCase }
    ],
    details: [
      // The before/after keeps its FULL honest labelling here. The Owner asked that the
      // face stop explaining that an intention is not a result — 「香香想改」 already says
      // it — but where the two texts sit side by side the distinction still has to be
      // spelled out, and collapsed it costs him nothing.
      hasIntent
        ? { title: '現時內容 / 打算改成', body: `${beforeLabel}：\n${indent(before)}\n${afterLabel}：\n${indent(after)}` }
        : { title: '現時內容', body: `${beforeLabel}：\n${indent(before)}` },
      { title: '要修改的內容', body: whatChanges },
      { title: '影響範圍', body: scope.join('\n') },
      { title: '不會發生', body: willNotHappen },
      { title: '上限', body: caps }
    ],
    actions: ['批准', '拒絕'],
    detailsTitle: '詳細',
    technicalTitle: '技術細節'
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
