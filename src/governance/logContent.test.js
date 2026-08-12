'use strict'

/**
 * logContent.test.js — a log line carries FACTS ABOUT a turn, never the turn's content.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT A LOG LINE MAY CONTAIN: status, counts, routes, capability names, timings,
 * requestIds, model ids, flags, outcomes.
 *
 * ⛔ WHAT IT MAY NOT: prompts, source content, message bodies, reply text, secrets, tokens.
 *
 * Verified against the live logs on 2026-08-12: the Owner's own three questions that day
 * (「網址我沒有了」, 「aroma bistro有公開網站」, 「公開網站網址是什麼」) each appear ZERO times
 * in `C:\Aroma\logs\xiangxiang-server-*.log`, as do `sk-ant`, `Bearer `, both key names, and
 * the persona opening. The discipline holds today; this test is what keeps it holding.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ AND IT CAUGHT ONE. `noEvidenceShadow` logged `tokens` — numerals lifted verbatim out of
 * her reply. Small, and still reply content. Replaced by `tokenCount`, which is the
 * measurement the shadow actually exists to produce.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..')

function productionFiles (dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules') productionFiles(p, out); continue }
    if (/\.js$/.test(n) && !/\.test\.js$/.test(n)) out.push(p)
  }
  return out
}

function codeOnly (src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
}

/**
 * Field names that carry a turn's CONTENT rather than a fact about it.
 * ⛔ `text`/`content`/`body` are the dangerous ones: they are what a model returns and what a
 * source hands back, and they are one keystroke from a logger.
 */
const CONTENT_KEY = /\b(prompt|systemPrompt|reply|replyText|messageText|body|snippet|excerpt|content|rawText|tokens)\s*:/

/** The console emitters that reach a log file. */
const LOG_CALL = /console\.(log|warn|error)\s*\(/

/**
 * ⛔ THE CALL'S OWN ARGUMENTS, BY PAREN BALANCE — NOT A LINE WINDOW.
 *
 * The first version scanned twelve lines after each `console.log` and flagged six sites, all
 * false: ordinary code that merely sat nearby. A fence that fires on healthy files teaches
 * people to ignore fences (HR-63), so it reads exactly what is passed and nothing else.
 */
function logCallArgs (code) {
  const out = []
  const re = /console\.(?:log|warn|error)\s*\(/g
  let m
  while ((m = re.exec(code)) !== null) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < code.length && depth > 0) {
      const c = code[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    out.push({ text: code.slice(start, i - 1), line: code.slice(0, m.index).split('\n').length })
  }
  return out
}

test('*** ⛔ no logger field carries a turn\'s CONTENT ***', () => {
  const offenders = []
  for (const f of productionFiles(SRC)) {
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    for (const call of logCallArgs(code)) {
      const m = call.text.match(CONTENT_KEY)
      if (m) offenders.push(path.relative(SRC, f).replace(/\\/g, '/') + ':' + call.line + ' → ' + m[1])
    }
  }
  assert.deepEqual(offenders, [],
    '⛔ A log line may carry status, counts, routes, capability names, timings and requestIds — ' +
    'never prompts, source content, message bodies, reply text or secrets. Log a COUNT or an ' +
    'enum instead; the conversation store is the record that is supposed to hold text.')
})

test('*** ⛔ and no logger interpolates a secret ***', () => {
  const SECRET = /\b(apiKey|api_key|ANTHROPIC_API_KEY|AROMA_SYSTEM_KEY|OPENAI_API_KEY|HUB_TOKEN|password|token)\b/
  const offenders = []
  for (const f of productionFiles(SRC)) {
    const code = codeOnly(fs.readFileSync(f, 'utf8'))
    for (const call of logCallArgs(code)) {
      /**
       * ⛔ THE VALUE, NOT THE NAME — and the first version failed this distinction.
       *
       * It flagged `index.js:49`, which is a fatal message reading 「HUB_TOKEN is not
       * configured … Set HUB_TOKEN in the service environment.」 That names a config key inside
       * a STRING so an operator can fix it, which is correct and necessary. Interpolating the
       * key's VALUE would be the leak.
       *
       * So string literals are removed before testing: what remains is only interpolated
       * expressions. `!!key` and `key ? 'PRESENT' : …` report existence and stay allowed.
       */
      const stripped = call.text
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``')
        .replace(/!!\s*[\w.]+/g, '')
      if (SECRET.test(stripped)) offenders.push(path.relative(SRC, f).replace(/\\/g, '/') + ':' + call.line)
    }
  }
  assert.deepEqual(offenders, [], '⛔ a credential, or its value, reached a log call')
})

test('*** the fence can see the shape it is built for ***', () => {
  // A fence matching nothing proves nothing. These are the exact forms it must catch.
  assert.ok(CONTENT_KEY.test("console.log('[X]', JSON.stringify({ reply: r.text }))"), 'reply:')
  assert.ok(CONTENT_KEY.test('  tokens: r.tokens.slice(0, 8),'), 'tokens: — the one it caught')
  assert.ok(CONTENT_KEY.test('  prompt: p,'), 'prompt:')
  // And it must NOT fire on the measurements that are the whole point of logging.
  for (const ok of ['  tokenCount: r.tokens.length,', '  replyChars: n,', '  rowsRetrieved: rows,', '  capability: c,']) {
    assert.equal(CONTENT_KEY.test(ok), false, 'false positive on: ' + ok)
  }
})
