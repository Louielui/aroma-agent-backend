'use strict'

/**
 * goalGate.js — where B's requirement meets the read decision.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ B IS A REQUIREMENT DECLARATION, NOT A GATE. The distinction is the Owner's and it
 * decides every function below.
 *
 * A gate stops things. This states what a question NEEDS, and the server then reads only what
 * was named. The difference shows up in the failure path: a gate that breaks refuses
 * everything, whereas a requirement that cannot be produced simply has no opinion — and the
 * turn proceeds exactly as it did before B existed.
 *
 * > **Owner: 「B failing falls back to the existing reasoning loop, never to no answer.」**
 *
 * So `null` is the honest 「no opinion」 and it is returned for every failure: no plan, a plan
 * with no facts, a malformed plan. `[]` means something entirely different — 「the plan named
 * no operation, therefore read nothing」 — and only a real plan can say it.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ AND IT CAN ONLY EVER NARROW ──────────────────────────────────────────
 * Intersected with what is enabled, never unioned — the same sentence the route's own gate
 * carries. A plan is a statement about what would answer the question; it is never an
 * authorisation to reach somewhere the Owner's switches do not already allow.
 */

const { resolveReadOperation } = require('../../context/readOperations')

/** Exact-match, default OFF. Not `resolveFlag`'s READ_ACCESS family — this one has no shadow. */
const GOAL_FLAG = 'GOAL_DECOMPOSER'

/**
 * ⛔ 'on' AND NOTHING ELSE. There is deliberately no 'shadow' value.
 *
 * `intakeService` already ruled on this for A4-1: 「Shadowing a semantic decision means asking
 * the model, i.e. a second paid call per turn; that is not free and has no owner yet.」 B is a
 * model call, so the same pricing applies and shadow is not offered rather than being offered
 * and quietly costing money.
 */
function goalDecomposerEnabled (env) {
  return !!env && env[GOAL_FLAG] === 'on'
}

/**
 * ⛔ DOTTED NAMES ONLY. `resolveReadOperation` deliberately treats a bare word as a SOURCE name
 * (`'gmail'` → `{source:'gmail'}`), which is right for its own callers and wrong here: it would
 * let a plan naming a bare string reach a source by spelling rather than by being a real
 * operation. Requiring the dot means only the schema's own operation enum can resolve.
 */
function sourceOfOperation (operation) {
  const name = typeof operation === 'string' ? operation.trim() : ''
  if (!name.includes('.')) return null
  const hit = resolveReadOperation(name)
  return (hit && hit.source) || null
}

/**
 * Which sources this plan actually requires.
 *
 * @param   {object|null} plan    a judged goal plan, or null when B produced none
 * @param   {string[]}    enabled the sources already permitted for this turn
 * @returns {string[]|null} sources to read; `[]` for 「read nothing」; `null` for 「no opinion」
 */
function sourcesForPlan (plan, enabled) {
  const facts = plan && Array.isArray(plan.facts) ? plan.facts : null
  // ⛔ NO FACTS IS NOT AN INSTRUCTION. An empty plan is a plan that failed to say anything,
  // and treating it as 「read nothing」 would turn every decomposer hiccup into a silent
  // context-free turn — a wrong answer with no tell, which is the defect class this whole
  // system exists to remove.
  if (!facts || facts.length === 0) return null

  const allow = new Set(Array.isArray(enabled) ? enabled : [])
  const out = []
  for (const f of facts) {
    // Only a REQUIRED fact pulls a source in. An optional one is a nicety, and paying a read
    // for a nicety is how 「你可以幫我做什麼？」 once cost four connectors and thirteen rows.
    if (!f || f.necessity !== 'required') continue
    if (!f.operation) continue
    const src = sourceOfOperation(f.operation)
    if (!src) continue
    if (!allow.has(src)) continue      // narrow only, never widen
    if (!out.includes(src)) out.push(src)
  }
  return out
}

/**
 * The requirement, as the model sees it.
 *
 * ⛔ THE GAP IS STATED, NOT OMITTED. A fact nothing can supply must appear in the prompt as a
 * named absence. Leaving it out would hand the model a shorter list and no reason to mention
 * what is missing — which is exactly how 「給我 Aroma System 的 website」 became four stock
 * counts and a shrug.
 *
 * ⛔ AND 「不准就近替代」 TRAVELS IN THE BLOCK. The Owner's standing rule is carried here as a
 * sentence the model reads, not as an assumption about how it will behave.
 */
function requirementBlock (plan) {
  const facts = plan && Array.isArray(plan.facts) ? plan.facts : null
  if (!facts || facts.length === 0) return null

  const lines = ['【呢條問題需要嘅事實】']
  for (const f of facts) {
    const need = String((f && f.need) || '').trim() || '(未命名)'
    const need2 = f && f.necessity === 'optional' ? '（可有可無）' : ''
    if (f && f.operation) {
      lines.push('· ' + need + need2 + ' —— 由 ' + f.operation + ' 提供' +
        (f.status && f.status !== 'AVAILABLE' ? '（' + f.status + (f.reason ? '：' + f.reason : '') + '）' : ''))
    } else {
      lines.push('· ' + need + need2 + ' —— ⛔ UNAVAILABLE：冇任何一個讀取操作承載得到呢樣嘢。')
    }
  }
  lines.push('')
  lines.push('如果上面有 UNAVAILABLE，照直講你攞唔到嗰樣嘢係咩。**唔好就近搵一個似樣嘅頂替**，' +
    '亦唔好用其他讀到嘅嘢當作答案。講唔知好過講一個似樣但錯嘅答案。')
  return lines.join('\n')
}

module.exports = { goalDecomposerEnabled, sourcesForPlan, requirementBlock, GOAL_FLAG }
