'use strict'

/**
 * settingsRegistry.js — the things the Owner may change, in his own words. GOVERNANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「only things I would say in my own words. Ingredients, what time, how many a
 * > section shows, pacing. Not buffers, not retries, not MAX_ROWS = 500.」**
 * > **「if the registry grows past one screen, that is the signal it has become the abstraction
 * > layer I ruled out, not a sign it is going well.」**
 *
 * ⛔ THE ADMISSION TEST IS THE LABEL, NOT THE VALUE.
 * An entry belongs when the `say` field below is a sentence he would actually utter. If reading
 * it produces 「I would never say that」, it is a constant and it stays a constant.
 *
 * ── WHY THE DEFINITIONS ARE GOVERNANCE AND THE VALUES ARE NOT ───────────────
 * The values are his. **The RANGES are a fence.** `pauseBetweenMs` with no floor would let
 * HR-34 be set to zero — 「pace, do not retry」 defeated by a settings field, from a screen, with
 * no work order. So `min`/`max` live in the protected path and the values live in his settings.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** ⛔ Hard ceiling. R1.3: past this the registry has become the abstraction layer he ruled out. */
const MAX_ENTRIES = 8

/**
 * How a change takes effect. **Stated per entry, because a setting that silently does not
 * apply is worse than one he cannot change** — he would believe it took.
 */
const APPLIES = Object.freeze({
  LIVE: 'LIVE', // read at use time; the next run uses it
  REREGISTER_TASK: 'REREGISTER_TASK' // lives in Windows Task Scheduler, not in this process
})

const ENTRIES = Object.freeze([
  {
    id: 'recallIngredients',
    say: '查邊幾樣食材',
    type: 'string[]',
    def: ['mushrooms', 'chicken', 'cheese', 'beef', 'romaine', 'green onion'],
    minItems: 1,
    maxItems: 8, // ⛔ each costs ~12s of unattended browser time against a site that throttles
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'recallShownPerIngredient',
    say: '每樣食材顯示幾多條回收',
    type: 'int',
    def: 6,
    min: 1,
    max: 20,
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'pauseBetweenMs',
    say: '兩次搜尋之間隔幾耐',
    type: 'int',
    def: 5000,
    // ⛔ THE FLOOR IS THE FENCE. Measured: six back-to-back searches broke the register.
    // HR-34 — a read-only errand that retries harder is not read-only in any sense the site
    // cares about. A settings screen must not be able to undo that.
    min: 2000,
    max: 60000,
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'minRunIntervalMs',
    say: '同一單差事最少隔幾耐先再行',
    type: 'int',
    def: 60 * 60 * 1000,
    min: 5 * 60 * 1000, // ⛔ also a fence: ~95 searches in one morning is what this prevents
    max: 24 * 60 * 60 * 1000,
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'recallEveryMs',
    say: '幾耐查一次先算準時',
    type: 'int',
    def: 24 * 60 * 60 * 1000,
    min: 60 * 60 * 1000,
    max: 7 * 24 * 60 * 60 * 1000,
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'recallGraceMs',
    say: '遲幾耐先算過期',
    type: 'int',
    def: 6 * 60 * 60 * 1000,
    min: 0,
    max: 24 * 60 * 60 * 1000,
    appliesOn: APPLIES.LIVE
  },
  {
    id: 'recallDailyHour',
    say: '每朝幾點查',
    type: 'int',
    def: 7,
    min: 0,
    max: 23,
    /**
     * ⛔ NOT LIVE, AND SAYING SO IS THE POINT. This value lives in the Windows Task Scheduler
     * trigger, not in this process. Changing it here changes NOTHING until the task is
     * re-registered — so the write path returns that instruction rather than reporting success.
     *
     * A setting that looks applied and is not would be the calmest kind of lie.
     */
    appliesOn: APPLIES.REREGISTER_TASK,
    howToApply: 'powershell -File scripts/scheduler/aroma-errand-task.ps1 -Action Remove ' +
      'then -Action Install -At HH:00'
  }
])

/**
 * ⛔ WHAT IS DELIBERATELY NOT HERE, so nobody adds it later thinking it was an oversight:
 *
 *   MAX_LINES (12)       an attachment can structurally produce at most 4 lines — MEASURED.
 *                        A cap that cannot be reached is not a setting.
 *   MAX_ROWS_SHOWN (6)   caps the `rows` array in the briefing payload, which the client does
 *                        not draw — it renders conclusions. A cap on something invisible.
 *   knockLog MAX_ROWS    500 log entries. He would never say this sentence.
 *   timeouts, retries, buffer sizes, maxNodes/maxChars on the AX read.
 *
 * ⛔ AND THE MEASUREMENT THAT KILLED THE ORIGINAL PLAN: these three were described as 「one
 * concept with three names」. Checked, they were three different things, and only one of them
 * was ever something he would ask to change. Three numbers that happen to be 6 are not one
 * setting.
 */

const byId = new Map(ENTRIES.map((e) => [e.id, e]))

/** @returns {object|null} */
function entry (id) { return byId.get(id) || null }

/** Every default, as the object the app falls back to when nothing is stored. */
function defaults () {
  const out = {}
  for (const e of ENTRIES) out[e.id] = e.def
  return out
}

/**
 * Validate ONE value against its entry. Fail-closed: an unknown id is refused, never stored.
 * @returns {{ok:true, value:*}|{ok:false, reason:string, saying:string}}
 */
function validate (id, raw) {
  const e = entry(id)
  if (!e) return { ok: false, reason: 'unknown_setting', saying: '冇呢個設定:' + String(id).slice(0, 40) }

  if (e.type === 'int') {
    const n = Number(raw)
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, reason: 'not_an_integer', saying: '「' + e.say + '」要一個整數。' }
    }
    if (n < e.min || n > e.max) {
      return {
        ok: false,
        reason: 'out_of_range',
        saying: '「' + e.say + '」要喺 ' + e.min + ' 同 ' + e.max + ' 之間。呢個範圍係一道籬笆,唔係一個建議。'
      }
    }
    return { ok: true, value: n }
  }

  if (e.type === 'string[]') {
    if (!Array.isArray(raw)) return { ok: false, reason: 'not_a_list', saying: '「' + e.say + '」要一張清單。' }
    const list = raw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean)
    if (list.length < e.minItems) return { ok: false, reason: 'too_few', saying: '「' + e.say + '」至少要 ' + e.minItems + ' 樣。' }
    if (list.length > e.maxItems) {
      return {
        ok: false,
        reason: 'too_many',
        saying: '「' + e.say + '」最多 ' + e.maxItems + ' 樣 —— 每樣約 12 秒無人看管嘅瀏覽器時間,對住一個會限流嘅站。'
      }
    }
    return { ok: true, value: list }
  }

  return { ok: false, reason: 'unknown_type', saying: '呢個設定嘅型別我唔識處理。' }
}

module.exports = { ENTRIES, APPLIES, MAX_ENTRIES, entry, defaults, validate }
