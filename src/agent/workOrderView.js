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
 *    time (a fact). 「守燈打算改成」 is INTENT: the agent has not run and may produce
 *    something else. The card labels it as intent and never states it as a result.
 */

const { canonicalWorkOrder, canonicalWorkOrderJson, hashWorkOrder } = require('./workOrder')

const NOT_PROVIDED = '（未提供）'

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
  const heading = '守燈想進行一項安全測試'

  const whatChanges = canonical.goal || NOT_PROVIDED

  const scope = [
    `只修改 ${file} 一個檔案。`,
    '只在丟棄式副本內操作,真實程式庫不會被改動。'
  ]

  // Before/after. The labels carry the epistemic status, so the Owner cannot mistake the
  // intended text for something that has already happened.
  const beforeLabel = `現時內容（讀自真實檔案${canonical.currentExcerptTruncated ? ',已截斷,下面還有' : ''}）`
  const afterLabel = '守燈打算改成（這是守燈的打算,不是已完成的結果 —— 它仍未執行,實際結果可能不同）'
  const before = canonical.currentExcerpt == null ? NOT_PROVIDED : canonical.currentExcerpt
  const after = canonical.intendedChange // may be null — see below
  // If 守燈 stated no intent, SAY NOTHING rather than printing 「（未提供）」. An empty
  // promise box reads as a broken form and invites the Owner to fill it in himself, which
  // is backwards: the intent is hers to state, not his to supply.
  const hasIntent = typeof after === 'string' && after.trim() !== ''

  const worstCase = '任務失敗或超時,測試副本會被丟棄。你的真實程式庫不受影響。'

  const willNotHappen = '不會提交、不會上傳、不會合併、不會部署。'

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
    `上限(原始值)      : ${technical.timeoutSec}s / ${money(technical.costCapUsd)}`,
    `工作單有效時間    : ${humanDuration(technical.approvalTtlSec)}（逾時自動失效,需重新產生）`,
    `現時內容是否截斷  : ${technical.currentExcerptTruncated ? '是' : '否'}`,
    // The no-amend rule. It was on v1's front face; it is a real guarantee but it is not
    // part of the Owner's decision, so it lives here rather than crowding the card.
    '如需改第二個檔案  : 必須重新建立一張新的工作單（沒有中途加檔案的機制）',
    '隔離方式          : 丟棄式副本,已移除所有 remote,改動無法回到 main'
  ]

  const card = {
    heading,
    sections: [
      { title: '要修改的內容', body: whatChanges },
      { title: '影響範圍', body: scope.join('\n') },
      hasIntent
        ? { title: '現時內容 / 打算改成', body: `${beforeLabel}：\n${indent(before)}\n${afterLabel}：\n${indent(after)}` }
        : { title: '現時內容', body: `${beforeLabel}：\n${indent(before)}` },
      { title: '最壞情況', body: worstCase },
      { title: '不會發生', body: willNotHappen },
      { title: '上限', body: caps }
    ],
    actions: ['批准測試', '拒絕'],
    technicalTitle: '技術細節'
  }

  // Plain-text rendering — exactly what the Owner sees, used by the report and asserted
  // by the WYSIWYA tests. The collapsed section is included after its ▸ marker.
  const lines = [card.heading, '']
  for (const s of card.sections) {
    lines.push(s.title)
    lines.push(indent(s.body, '  '))
    lines.push('')
  }
  lines.push(`[${card.actions[0]}]  [${card.actions[1]}]`, '', `▸ ${card.technicalTitle}`)
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
    worstCase
  }

  return { canonical, canonicalJson, hash, display, card, technical, lines, technicalLines }
}

module.exports = { buildApprovalView, humanDuration, NOT_PROVIDED }
