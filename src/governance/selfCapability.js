'use strict'
/**
 * selfCapability.js — S1. What Xiangxiang can actually do, as product fact.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ TWO NATURAL FAILURES, THE SAME GAP.
 *
 * 「我沒法貼圖給你,你好像還沒有這個功能」 — he was right, and she could not say so: there is
 * no image input anywhere in this product and nothing that knew it.
 *
 * 「我下月23號會出席一個meeting,幫我加到calendar」 — calendarRead.js is list/get only and the
 * read connector refuses write-shaped method names at registration. No event could ever have
 * been created. She had no way to know that either.
 *
 * ⛔ FOUR SEPARATE FACTS, AND COLLAPSING ANY TWO IS A LIE.
 *
 *   IMPLEMENTATION   does the surface exist in this build         ← ONLY THIS LIVES HERE
 *   REACHABILITY     would it answer right now                    ← unknowable without trying
 *   TURN AUTHORITY   may THIS turn use it                         ← READ_ACCESS, flags, routing
 *   TURN RESULT      what happened when it was tried              ← the read-state guards
 *
 * `calendar.read` being implemented does NOT mean 「我而家讀得到」, and it does NOT mean this
 * turn may read. The existing selfDescription already says the first half out loud —
 * 「我讀唔讀得到，要真係去讀一次先知——我唔會用設定嚟當答案」 — and this file is the structural
 * form of the same rule.
 *
 * ⛔ AND IT IS DECLARED, NOT DERIVED FROM CONFIGURATION. A flag proves an intention; a
 * credential proves a secret exists. Neither proves a method was written. Every entry below is
 * asserted against a real callable surface in selfCapability.test.js — the code is the fact,
 * this table is the contract, and a test fails when they disagree.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** ⛔ THREE STATES, AND `unknown` IS A REAL ANSWER. Never a fourth meaning smuggled in. */
const IMPLEMENTATION = Object.freeze({
  IMPLEMENTED: 'implemented',
  NOT_IMPLEMENTED: 'not_implemented',
  UNKNOWN: 'unknown'
})

const KIND = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  INPUT: 'input',
  EXECUTION: 'execution',
  MEMORY: 'memory'
})

/**
 * ⛔ THE CLOSED REGISTRY. Product surfaces the Owner can sensibly ask about, and nothing else.
 *
 * There is deliberately no `reachable`, `available`, `connected` or `enabled` field. A field
 * like that would be answered from configuration within a week, and configuration is exactly
 * what this must never speak for.
 */
const REGISTRY = Object.freeze([
  Object.freeze({ capability: 'aroma_system.read', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: 'Aroma System 唯讀' }),
  Object.freeze({ capability: 'aroma_system.write', kind: KIND.WRITE, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '改 Aroma System 資料' }),
  Object.freeze({ capability: 'gmail.read', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: '讀 Gmail' }),
  Object.freeze({ capability: 'gmail.send', kind: KIND.WRITE, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: 'send／回覆郵件' }),
  Object.freeze({ capability: 'drive.read', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: '讀 Drive' }),
  Object.freeze({ capability: 'drive.write', kind: KIND.WRITE, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '改／上載 Drive 檔案' }),
  Object.freeze({ capability: 'calendar.read', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: '讀 Calendar' }),
  Object.freeze({ capability: 'calendar.write', kind: KIND.WRITE, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '加／改 Calendar 事件' }),
  Object.freeze({ capability: 'github.read', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: '讀 GitHub' }),
  Object.freeze({ capability: 'github.write', kind: KIND.WRITE, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '改 GitHub' }),
  Object.freeze({ capability: 'public_knowledge.search', kind: KIND.READ, implementation: IMPLEMENTATION.IMPLEMENTED, label: '搵公開資料' }),
  /**
   * ⛔ ONE VISUAL-INPUT CAPABILITY, NOT TWO. The product draws no line between 「貼圖」 and
   * 「上載圖」 because it has neither: the intake route accepts `message` and `interactionMode`,
   * both strings, and no adapter builds an image block. Inventing `image.upload` beside
   * `image.input` would be describing a distinction this build does not make.
   */
  Object.freeze({ capability: 'image.input', kind: KIND.INPUT, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '睇圖／收圖' }),
  Object.freeze({ capability: 'file.input', kind: KIND.INPUT, implementation: IMPLEMENTATION.NOT_IMPLEMENTED, label: '收檔案附件' }),
  Object.freeze({ capability: 'decision_recall', kind: KIND.MEMORY, implementation: IMPLEMENTATION.IMPLEMENTED, label: '記得過往決定' }),
  Object.freeze({ capability: 'conversation_recall', kind: KIND.MEMORY, implementation: IMPLEMENTATION.IMPLEMENTED, label: '記得過往對話' }),
  Object.freeze({ capability: 'working_context', kind: KIND.MEMORY, implementation: IMPLEMENTATION.IMPLEMENTED, label: '記得當前對話前文' }),
  /**
   * ⛔ IMPLEMENTED IS NOT AUTHORISED, AND NOWHERE IS THAT SHARPER THAN HERE. The proposal and
   * work-order paths exist; whether a turn may reach them is decided by execution governance,
   * which this table neither reads nor influences.
   */
  Object.freeze({ capability: 'proposal.create', kind: KIND.EXECUTION, implementation: IMPLEMENTATION.IMPLEMENTED, label: '出提案' }),
  Object.freeze({ capability: 'work_order.dispatch', kind: KIND.EXECUTION, implementation: IMPLEMENTATION.IMPLEMENTED, label: '派工單' })
])

const NAMES = Object.freeze(REGISTRY.map((e) => e.capability))
const BY_NAME = new Map(REGISTRY.map((e) => [e.capability, e]))

/** Exact membership. A name outside the table resolves to nothing — never to a guess. */
function capabilityEntry (name) {
  const n = typeof name === 'string' ? name.trim() : ''
  return BY_NAME.get(n) || null
}

/** @returns {'implemented'|'not_implemented'|'unknown'|null} null when the name is unknown. */
function implementationOf (name) {
  const e = capabilityEntry(name)
  return e ? e.implementation : null
}

const isImplemented = (name) => implementationOf(name) === IMPLEMENTATION.IMPLEMENTED
const isNotImplemented = (name) => implementationOf(name) === IMPLEMENTATION.NOT_IMPLEMENTED

/**
 * The block the models see.
 *
 * ⛔ PRODUCT FACT, NEVER BUSINESS EVIDENCE. It carries no source row, no id, no date and no
 * value, so nothing in it can enter the evidence index or be cited by an Answer Plan. And it
 * grants nothing: 「implemented」 is a statement about this build, not about this turn.
 */
function capabilityBlock () {
  const line = (e) => '· ' + e.capability + '（' + e.label + '）：' +
    (e.implementation === IMPLEMENTATION.IMPLEMENTED ? '已實作'
      : e.implementation === IMPLEMENTATION.NOT_IMPLEMENTED ? '未實作' : '未知')
  return [
    '【SELF CAPABILITY — 實作事實，唔係實時證據】',
    ...REGISTRY.map(line),
    '規則：',
    '· 「已實作」唔等於而家連得到。要知道而家讀唔讀得到，要真係讀一次先知。',
    '· 「未實作」係確定嘅：嗰件事呢個版本做唔到，唔好應承、唔好當係暫時connection問題。',
    '· 呢一段唔係生意資料嘅證據，亦唔會批准任何來源、寫入或者執行。'
  ].join('\n')
}

module.exports = {
  IMPLEMENTATION,
  KIND,
  REGISTRY,
  CAPABILITY_NAMES: NAMES,
  capabilityEntry,
  implementationOf,
  isImplemented,
  isNotImplemented,
  capabilityBlock
}
