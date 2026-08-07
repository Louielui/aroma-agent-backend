'use strict'

/**
 * recallCheck.js — ERRAND-003, as a value instead of a print.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *   「我入嘅貨有冇被回收?」
 *
 * The one errand that has ever produced a real answer. Canada's recall register is public, has
 * no login, and — measured — no bot mitigation. It also has no usable API, which is what makes
 * the browser the right tool for it (HR-21).
 *
 * ⛔ IT DOES NOT TOUCH THE LOGGED-IN PROFILE.
 * That profile is a credential and the Owner ruled it be treated as one. A public register
 * needs none of it, and borrowing it would also mean the errand fails whenever his own Chrome
 * is open — a lock refusal on a page that never needed a session.
 *
 * ⛔ IT RETURNS, IT DOES NOT PRINT.
 * `scripts/errandRecallCheck.js` worked and `console.log`ged its answer, so nothing could
 * record it and 首頁 said 「未有差事紀錄」 while the errand was running fine. The shape below is
 * exactly what `runErrand` stores and 首頁 renders.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const HOST = 'https://recalls-rappels.canada.ca'
const SEARCH_PATH = '/en/search/site?f%5B0%5D=type%3Arecall'
const MAX_ACTIONS = 12

/** BLOCKED_BY_SITE, with its reason. Never a quiet 「冇回收」 — see the two-lies note below. */
const blocked = (detail) => ({ outcome: 'BLOCKED_BY_SITE', detail })

/**
 * @param {{session, goto, query, url?, maxActions?, note?}} args
 *   `session` is a composed browser session (read/type/click/waitFor) — the composition rule
 *   and L1 live inside it. `goto` navigates; the caller owns the origin check.
 * @returns {Promise<{outcome:string, answer?:string, detail?:string, stop?:object}>}
 */
async function checkRecall ({ session, goto, query, url, maxActions, note }) {
  const cap = maxActions || MAX_ACTIONS
  const target = url || (HOST + SEARCH_PATH)
  let actions = 0
  const say = (verb, outcome, detail) => { if (note) note(verb, outcome, detail || '') }
  const spend = () => { actions++; return actions <= cap }

  if (!spend()) return blocked('未開始就已經爆咗動作上限 (budget)。')
  const nav = await goto(target)
  if (nav && nav.ok === false) return blocked('去唔到個回收登記處:' + (nav.reason || 'navigation failed'))
  say('navigate', 'ARRIVED', target)
  await session.waitFor({ condition: 'network_idle', timeoutMs: 8000 })

  // ── 1. READ ────────────────────────────────────────────────────────────────
  if (!spend()) return blocked('讀個頁之前就爆咗動作上限 (budget)。')
  let v = await session.read()
  say('read_page', 'READ', v.nodes.length + ' nodes')

  // ⛔ A login wall ends the errand. She does not type a credential, ever — and a public
  // register that suddenly asks for one is a change worth being told about.
  if (v.nodes.some((n) => /password/i.test(n.name))) {
    return blocked('個頁面出咗登入牆(讀到 password 欄位)。冇打過任何嘢就收咗手。')
  }

  const box = v.nodes.find((n) => /searchbox|textbox|combobox/.test(n.role) && /search|recherche/i.test(n.name))
  if (!box) {
    // ⛔ THE TWO LIES THIS GUARD PREVENTS. 「搜尋框搵唔到」 and 「冇回收」 look alike from the
    // outside and mean opposite things: one is 「我查唔到」, the other is 「我查過,安全」.
    return blocked('個站冇浮到搜尋框出嚟,所以根本冇查成。呢個唔等於「冇回收」。')
  }

  // ── 2. TYPE ────────────────────────────────────────────────────────────────
  if (!spend()) return blocked('打字之前爆咗動作上限 (budget)。')
  const t = await session.type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: query })
  say('type', t.outcome, t.reason || '')
  if (t.outcome !== 'TYPED') return blocked('打唔到字入去:' + t.reason + ' — ' + (t.detail || ''))

  // ── 3. READ AGAIN — the composition rule; the session enforces it anyway ───
  if (!spend()) return blocked('打完字之後爆咗動作上限 (budget)。')
  v = await session.read()

  const go = v.nodes.find((n) => n.interactive && /^(search|go|submit|rechercher)$/i.test(n.name.trim())) ||
             v.nodes.find((n) => n.role === 'button' && /search/i.test(n.name))
  if (!go) return blocked('搵唔到一粒撳得嘅搜尋掣(type 從來唔會自己撳 Enter),所以查唔成。')

  // ── 4. CLICK ───────────────────────────────────────────────────────────────
  if (!spend()) return blocked('撳掣之前爆咗動作上限 (budget)。')
  const c = await session.click({ ref: go.ref, domId: go.domId, expectRole: go.role, expectName: go.name })
  say('click', c.outcome, c.reason || '')

  if (c.outcome === 'STOPPED_FOR_YOU') {
    // ⛔ THE STOP IS BUILT COMPLETE, HERE. The store REFUSES a stop with no report, and the
    // runner then downgrades it to BLOCKED_BY_SITE — which would tell him a site blocked her
    // when in fact she stopped, for him, at a control she would not press.
    return {
      outcome: 'STOPPED_FOR_YOU',
      stop: {
        where: target,
        notPressed: c.record || { role: go.role, name: go.name, ref: go.ref },
        whichLayer: c.whichLayer || 'L1'
      }
    }
  }
  if (c.outcome !== 'CLICKED') return blocked('撳唔到個搜尋掣:' + c.reason + ' — ' + (c.detail || ''))

  // ── 5. WAIT, READ, EXTRACT ────────────────────────────────────────────────
  await session.waitFor({ condition: 'network_idle', timeoutMs: 12000 })
  if (!spend()) return blocked('讀結果之前爆咗動作上限 (budget)。')
  v = await session.read()
  say('read_page', 'READ', v.nodes.length + ' nodes')

  const hits = extract(v, query)
  if (!hits.length) {
    // 「冇回收」 is the good news, and it is still news — reached only after a real search.
    return { outcome: 'ANSWERED', answer: '「' + query + '」冇搵到相關回收。', detail: '讀咗 ' + v.nodes.length + ' 個節點。' }
  }
  return {
    outcome: 'ANSWERED',
    answer: '「' + query + '」有 ' + hits.length + ' 條回收:' +
      hits.map((h) => (h.when || '日期不明') + ' ' + h.title).join(' / '),
    detail: '讀咗 ' + v.nodes.length + ' 個節點。'
  }
}

/** A recall entry is a link, followed within a few lines by "<category> | <date>". */
function extract (v, query) {
  const out = []
  const rx = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  for (let i = 0; i < v.nodes.length && out.length < 4; i++) {
    const n = v.nodes[i]
    if (n.role !== 'link' || n.name.length < 25 || !rx.test(n.name)) continue
    let when = ''
    for (let j = i + 1; j < Math.min(i + 5, v.nodes.length); j++) {
      const m = v.nodes[j].name.match(/([A-Za-z ]+)\s\|\s(\d{4}-\d{2}-\d{2})/)
      if (m) { when = m[2]; break }
    }
    out.push({ title: n.name.replace(/\s+/g, ' ').slice(0, 68), when })
  }
  return out
}

module.exports = { checkRecall, HOST, SEARCH_PATH, MAX_ACTIONS }
