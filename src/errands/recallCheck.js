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
/** How many lines he reads per ingredient. He said six is fine; the total is always stated. */
const MAX_SHOWN = 6

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
  // ⛔ The narrowing is DECLARED here and reported in every answer. The Owner's ruling:
  // 「it is a claim about what I was shown and it belongs on screen, not in a config file.」
  const asked = '"' + query + '"'
  const narrowing = ['詞組搜尋']
  const narrowLabel = '(' + narrowing.join(';') + ')'
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

  // ── 2. TYPE — THE NARROWED QUESTION ───────────────────────────────────────
  //
  // ⛔ NARROW THE QUESTION, NEVER THE ANSWER.
  //
  // The register OR-matches words, so 「green onion」 returned 349 items led by a Mifepristone
  // packaging recall — it was matching 「green」. Quoting asks a narrower QUESTION; the site
  // still decides what matches and in what order, and we still report everything it returns.
  // That is categorically different from dropping results after the fact (HR-35).
  //
  // MEASURED 2026-08-07: green onion 349 → 1 (and the 1 is a real green-onion phrase match).
  // Single words are unaffected: cheese 89 → 89. Nothing dropped to zero anywhere.
  if (!spend()) return blocked('打字之前爆咗動作上限 (budget)。')
  const t = await session.type({ ref: box.ref, domId: box.domId, expectRole: box.role, expectName: box.name, text: asked })
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

  const hits = extract(v)
  const count = siteCount(v)

  // ⛔ THE GUARD THAT MATTERS MOST: 「I recognised nothing」 is never 「there is nothing」.
  //
  // If the site restructures its markup, the extractor finds no rows — and the old code would
  // have reported 「冇搵到相關回收」 with total confidence, every morning, unattended, in a
  // sentence that reads like good news. A false all-clear on a recall is the one failure where
  // the cost is not the Owner's time.
  if (!hits.length) {
    if (count && count.total > 0) {
      // The site says there are results and we parsed none. That is a contradiction, and the
      // only honest reading of it is 「my parser is broken」.
      return blocked('個站話有 ' + count.total + ' 條結果,但我一條都認唔到 —— 即係個頁面結構改咗,我讀漏嘢。' +
        '⛔ 唔好當佢係「冇回收」。')
    }
    if (count && count.total === 0) {
      return { outcome: 'ANSWERED', answer: '「' + query + '」' + narrowLabel + ':冇搵到相關回收。', found: 0, shown: 0, narrowing, items: [], detail: '個站自己講明零條。' }
    }
    if (saysNoResults(v)) {
      return { outcome: 'ANSWERED', answer: '「' + query + '」' + narrowLabel + ':冇搵到相關回收。', found: 0, shown: 0, narrowing, items: [], detail: '個站顯示「no results」。' }
    }
    // No count, no recognisable rows, no explicit 「no results」. Cannot tell the difference
    // between an empty search and a page we failed to read — so claim neither.
    return blocked('我讀唔到結果數目,又認唔到任何一條回收紀錄,所以我唔敢講「冇回收」。' +
      '(讀咗 ' + v.nodes.length + ' 個節點。)')
  }

  // ⛔ SITE ORDER, UNTOUCHED. Re-ranking by our own idea of relevance — including by date —
  // is the same filter one step later, and the filter is what produced the false all-clear.
  const shown = hits.slice(0, MAX_SHOWN)
  const found = count ? count.total : hits.length
  const foundLabel = count
    ? '個站搵到 ' + count.total + ' 條'
    : '我喺第一頁讀到 ' + hits.length + ' 條(個站冇畀總數)'
  const shownLabel = found > shown.length ? ',顯示頭 ' + shown.length + ' 條' : ''

  return {
    outcome: 'ANSWERED',
    answer: '「' + query + '」' + narrowLabel + ':' + foundLabel + shownLabel + ':' +
      shown.map((h) => h.when + ' ' + h.title).join(' / '),
    found,
    shown: shown.length,
    narrowing,
    // ⛔ THE STRUCTURED RESULT, not just the sentence. 「新」 is a comparison between runs, and
    // a comparison needs values — diffing the prose answer would break on any wording change.
    items: shown.map((h) => ({ when: h.when, title: h.title })),
    detail: '讀咗 ' + v.nodes.length + ' 個節點。' + (count ? '' : ' ⚠ 個站冇畀總數,可能仲有下一頁。')
  }
}

/**
 * Every recall the SITE returned, in the SITE's order.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Report what the site actually returns rather than filtering it. Noise is fine;
 * > I will read six lines and dismiss four. Silence I cannot audit.」**
 *
 * ⛔ THERE IS DELIBERATELY NO QUERY MATCHING HERE, AND IT MUST NOT BE ADDED BACK.
 *
 * The previous version kept only recalls whose TITLE contained the query word. It looked like
 * precision and was a second, invisible filter on top of the site's own search — so a romaine
 * recall the site returned under the title 「Certain Caesar Salad Kits recalled due to E. coli」
 * was dropped, and the errand reported 「冇搵到相關回收」.
 *
 * ── THE WORKED EXAMPLE, KEPT SO NOBODY 「IMPROVES」 THIS BACK INTO A FILTER ──
 * Searching 「green onion」 returns **Old Dutch Ridgies Sour Cream, Green Onion & Bacon Flavour
 * Potato Chips** — a FLAVOUR NAME, not an ingredient. It is useless to a chef, and it is
 * **exactly the false positive the Owner said he would accept**:
 *
 *   > 「Noise is fine; I will read six lines and dismiss four. Silence I cannot audit.」
 *
 * The asymmetry is the whole argument: a false positive costs two seconds of reading. A false
 * negative costs a recalled product going out on a plate. Any change here that makes the chips
 * go away will also make some Caesar salad kit go away, and only one of those is visible.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Measured page structure (scripts/probes/probeRecallResults.js):
 *     link       「Coaticook brand White Cheddar cheeses recalled due to Listeria monocytogenes」
 *     StaticText 「Recall」
 *     StaticText 「Food recall warning | 2026-08-03」
 *
 * The date stamp is what distinguishes a result from page furniture — structural, from the
 * page, rather than our judgement about what is relevant.
 */
function extract (v) {
  const out = []
  const nodes = v.nodes || []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.role !== 'link') continue
    let when = null
    let kind = null
    for (let j = i + 1; j < Math.min(i + 4, nodes.length); j++) {
      if (nodes[j].role === 'link') break // the next result began; this link carries no stamp
      const m = String(nodes[j].name || '').match(/^(.+?)\s\|\s(\d{4}-\d{2}-\d{2})\s*$/)
      if (m) { kind = m[1].trim(); when = m[2]; break }
    }
    if (!when) continue // page furniture: skip links, language switches, facets
    out.push({ title: String(n.name).replace(/\s+/g, ' ').slice(0, 76), when, kind })
  }
  return out
}

/** The site states its own total: 「Displaying 1 - 15 of 89 items.」 */
function siteCount (v) {
  for (const n of (v.nodes || [])) {
    const m = String(n.name || '').match(/Displaying\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i)
    if (m) return { from: +m[1], to: +m[2], total: +m[3] }
  }
  return null
}

/** An explicit 「no results」 from the site is a real answer; our own silence is not. */
function saysNoResults (v) {
  return (v.nodes || []).some((n) => /no results|yielded no|aucun résultat/i.test(String(n.name || '')))
}

module.exports = { checkRecall, HOST, SEARCH_PATH, MAX_ACTIONS }
