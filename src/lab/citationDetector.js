'use strict'

/**
 * citationDetector.js — did THIS REPLY actually draw on the read context?
 *
 * ── WHY THE QUESTION CHANGED ──────────────────────────────────────────────
 * A′ omitted the assistant's body whenever a turn HAD READ external context. Owner
 * decision 2026-08-02: that is the wrong question. What A′ exists to prevent is 香香
 * transcribing other people's mail onto disk — not her forgetting that she said "I suggest
 * you do X first". A reply that cites nothing carries nothing of anyone else's, and under
 * the old rule it was thrown away anyway. Five turns of five, in the real archive.
 *
 * So the test is now on the REPLY, not on the turn: does the reply contain material that
 * came from the context block?
 *
 * ── FAIL-SAFE, AND DELIBERATELY LOPSIDED ──────────────────────────────────
 * The two mistakes are not equals:
 *
 *   say "cites" when it does not   → the body is omitted. A memory is lost. Recoverable:
 *                                    the Owner still has the conversation.
 *   say "does not cite" when it does → third-party content is written to disk. NOT
 *                                    recoverable, and it is the exact thing A′ forbids.
 *
 * Everything here therefore leans toward "cites". Any doubt — no block, no reply, an
 * unparseable block, an error — returns true. The matching is deliberately GENEROUS: one
 * distinctive token is enough. A false "cites" costs a memory; a false "does not" costs a
 * promise.
 *
 * PURE. It returns a boolean. It never logs, never stores, and never returns a needle —
 * the needles ARE the third-party content, and a diagnostic that printed them would put
 * the leak back.
 */

/** Latin words this short, or this common, decide nothing. */
const MIN_LATIN = 5
const MIN_CJK = 2

/**
 * Words that appear in the context block's own furniture, or in any ordinary sentence.
 * A match on one of these is not evidence of citation.
 */
const NOISE = new Set([
  'gmail', 'drive', 'calendar', 'github', 'google', 'email', 'inbox', 'dated', 'https',
  'http', 'untitled', 'results', 'result', 'recent', 'items', 'item', 'read', 'source',
  'sources', 'context', 'external', 'reference', 'retrieved', 'unavailable', 'matching',
  'message', 'messages', 'thread', 'threads', 'about', 'their', 'there', 'these', 'those',
  'which', 'would', 'could', 'should', 'because', 'context', 'please', 'first', 'today',
  'tomorrow', 'yesterday', 'morning', 'afternoon', 'evening'
])

const CJK_NOISE = new Set(['郵件', '文件', '檔案', '資料', '今日', '明天', '最近', '日期', '出處', '內容', '收到'])

function normalize (s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Distinctive tokens from the read-context block: the quoted titles, the ids, the links,
 * and the item text after the em dash. Returns a Set. NEVER exported into a log.
 */
function extractNeedles (block) {
  const out = new Set()
  if (typeof block !== 'string' || block.length === 0) return out

  for (const rawLine of block.split('\n')) {
    // Only ITEM lines carry third-party material. The safety header and the tag lines are
    // our own words and must not become needles, or every reply would look like a citation.
    if (!/^\[(gmail|drive|calendar|github)[^\]]*\]/i.test(rawLine.trim())) continue
    const line = rawLine

    // 1. quoted titles — the strongest single signal
    for (const m of line.matchAll(/"([^"]{3,})"/g)) out.add(normalize(m[1]))

    // 2. ids and links, which cannot occur in a reply by chance
    for (const m of line.matchAll(/\bid=([^\s]+)/g)) out.add(normalize(m[1]))
    for (const m of line.matchAll(/(https?:\/\/[^\s]+)/g)) out.add(normalize(m[1]))

    // 3. the item's own content, after the em dash
    const dash = line.indexOf(' — ')
    const body = dash >= 0 ? line.slice(dash + 3) : ''

    // 4. word-level tokens from title + body, so a paraphrase that reuses a distinctive
    //    noun still counts.
    const material = (line.match(/"([^"]*)"/g) || []).join(' ') + ' ' + body
    for (const w of normalize(material).match(/[a-z0-9][a-z0-9._'-]*/g) || []) {
      if (w.length >= MIN_LATIN && !NOISE.has(w)) out.add(w)
    }
    for (const run of material.match(/[一-鿿]+/g) || []) {
      for (let i = 0; i + MIN_CJK <= run.length; i++) {
        const gram = run.slice(i, i + MIN_CJK)
        if (!CJK_NOISE.has(gram)) out.add(gram)
      }
    }
  }
  return out
}

/**
 * Does `reply` draw on `block`?
 * @returns {boolean} true when it does, AND whenever the answer cannot be established.
 */
function replyCitesContext (reply, block) {
  try {
    // No reply and no block are both doubts, and a doubt cites.
    if (typeof block !== 'string' || block.length === 0) return true
    if (typeof reply !== 'string' || reply.length === 0) return true

    const needles = extractNeedles(block)
    // A block we could not take anything from tells us nothing about the reply.
    if (needles.size === 0) return true

    const hay = normalize(reply)
    for (const n of needles) {
      if (n && hay.includes(n)) return true
    }
    return false
  } catch (_) {
    return true // an error is a doubt
  }
}

module.exports = { replyCitesContext, extractNeedles, NOISE, CJK_NOISE, MIN_LATIN, MIN_CJK }
