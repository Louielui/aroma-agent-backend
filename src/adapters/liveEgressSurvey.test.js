'use strict'

/**
 * liveEgressSurvey.test.js — THE CATEGORY RULE, ENFORCED BY A DIRECTORY WALK.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RULE THIS EXISTS FOR: **every default model/provider network path in `src/` goes
 * through `liveEgressFence`.** That names a CATEGORY, so per CLAUDE.md §3 it belongs in a test
 * that walks the DIRECTORY — files that do not exist yet are covered, and a non-conforming new
 * file is red the day it is written, by an author who never read the rule.
 *
 * ⛔ AND IT PASSES THE FILTER, WHICH IS WHAT MAKES IT REQUIRED RATHER THAN TIDY:
 *
 *   > If this rule were quietly violated, would the Owner get a wrong answer he would believe?
 *
 * YES. That is not a hypothetical — it is what was measured. An unfenced provider path inside
 * the suite flipped 7–8 A4 outcomes, and the suite still reported green. A green run is the
 * Owner's evidence that behaviour is deterministic; an unfenced file makes that evidence false
 * while leaving it looking exactly the same. Prose would not have caught it. This walk does.
 *
 * ── WHAT THIS DOES **NOT** CLAIM, STATED PLAINLY ────────────────────────────
 * ⚠ It sees a destination only when the destination is a LITERAL in the file. A vendor SDK
 * that hides its base URL behind its own client, a `node:https` request built from parts, or a
 * spawned CLI would NOT be caught by the host survey. That residual limitation is real and is
 * not argued away here: the survey is complete against the three transports that exist and
 * against any new file that names its host, and it is honestly silent about the rest.
 *
 * ⚠ Google (`googleapis`), the GitHub connector and the Aroma System connector are DELIBERATELY
 * out of scope for this tranche. They are a different transport class and not model calls;
 * folding them in here would widen the tranche by accident. Recorded, not fixed.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..')
const FENCE_MODULE = 'liveEgressFence'
const DETECTOR_MODULE = 'testProcess'

/**
 * The closed set of files that may speak to a model provider. Adding a fourth is a code change
 * reviewed as one — which is the whole point of asserting the SET rather than each member.
 */
const EXPECTED_EGRESS_FILES = [
  'adapters/ClaudeAdapter.js',
  'adapters/OpenAIAdapter.js',
  'context/providers/openaiWebSearchProvider.js'
]

/**
 * Model-provider hosts. Deliberately broader than what this repo uses today: a file that names
 * a provider nobody has wired yet must still land inside the survey rather than outside it.
 */
const PROVIDER_HOST = /\b(api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(com|ai)|api\.x\.ai|api\.deepseek\.com|api\.groq\.com|api\.together\.xyz|openrouter\.ai|api\.perplexity\.ai|bedrock-runtime\.[a-z0-9-]+\.amazonaws\.com)\b/

/** Every non-test .js file under src/, excluding the browser bundle in demo/assets. */
function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || p.endsWith(path.join('demo', 'assets'))) continue
      walk(p, out)
    } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/')

/**
 * Comments stripped with the repo's own pattern — the ':' guard keeps 'https://' intact
 * (a4ProductionWiring.test.js:274). A rule that can be satisfied by a comment is not a rule.
 */
function codeOnly (src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const FILES = walk(SRC)
const read = (p) => fs.readFileSync(p, 'utf8')

/* ═══ G1 — THE SET IS CLOSED ═══════════════════════════════════════════ */

/**
 * ⛔ COMMENTS ARE STRIPPED HERE TOO, AND THE FENCE ITSELF IS WHY. `liveEgressFence.js` quotes
 * `api.anthropic.com` in the paragraph explaining the defect it exists for. A host named in
 * PROSE is not egress, and a survey that counted it would have forced the explanation out of
 * the file to keep the test green — trading the reason for the rule, which is the trade this
 * repository refuses everywhere else.
 */
test('*** G1 — exactly these files name a model provider IN CODE, and no others ***', () => {
  const naming = FILES.filter((p) => PROVIDER_HOST.test(codeOnly(read(p)))).map(rel).sort()
  assert.deepEqual(naming, EXPECTED_EGRESS_FILES.slice().sort(),
    '⛔ a file names a model provider host and is not in the fenced set — add the fence, then add it here')
})

/* ═══ G2 — EACH ONE IS WIRED TO THE FENCE ══════════════════════════════ */

test('*** G2 — every provider file requires liveEgressFence ***', () => {
  for (const r of EXPECTED_EGRESS_FILES) {
    const code = codeOnly(read(path.join(SRC, r)))
    assert.ok(code.includes(FENCE_MODULE), '⛔ ' + r + ' opens a provider socket without requiring the fence')
  }
})

/* ═══ G3 — NO BARE DEFAULT TRANSPORT SURVIVES ══════════════════════════ */

/**
 * ⛔ THE RULE IS 「A PROVIDER FILE MAY NOT NAME A TRANSPORT AT ALL」, AND THAT WORDING WAS EARNED
 * BY A MUTATION THAT SURVIVED.
 *
 * This assertion first read `axios\s*\.\s*post`, which is the shape the code actually had. The
 * mutation that removes the Claude fence replaced it with `require('axios').post(...)` — the
 * same call, one indirection along — and the survey passed. A fence that can be stepped around
 * by moving the import inline is a fence that reads like one.
 *
 * ⛔ AND THE FETCH HALF WAS EARNED THE SAME WAY, BY A SECOND SURVIVOR. It first read
 * `fetch\s*\(` — a CALL. The mutation that removes the web fence writes `transport || fetch`,
 * a bare REFERENCE handed to a variable and called one line later, and that passed too. Both
 * survivors are the same lesson: a survey that matches the SHAPE the code happens to have
 * checks the code, not the rule.
 *
 * So the invariant is now the strong one, and it is about NAMING rather than calling: after
 * this tranche NONE of the three provider files mentions `axios` or the global `fetch` in code
 * at all, and each must INVOKE a fenced helper — an import alone is not wiring.
 */
test('*** G3 — no provider file names a transport at all; the fence owns both doors ***', () => {
  for (const r of EXPECTED_EGRESS_FILES) {
    const code = codeOnly(read(path.join(SRC, r)))
    assert.equal(/\baxios\b/.test(code), false,
      '⛔ ' + r + ' reaches axios directly — however it is spelled, that is an unfenced door')
    // `fencedFetch` and `doFetch` carry a capital F, so a case-sensitive \bfetch\b sees only
    // the global — whether it is CALLED or merely handed to a variable.
    const bareFetch = code.match(/\bfetch\b/g) || []
    assert.deepEqual(bareFetch, [], '⛔ ' + r + ' names the global fetch — call or reference, it is the same door')
    assert.match(code, /fenced(AxiosPost|Fetch)\s*\(/,
      '⛔ ' + r + ' imports the fence but never invokes it — an import is not wiring')
  }
})

/* ═══ G4 — ONE DETECTOR, ONE HOME ══════════════════════════════════════ */

test('*** G4 — isTestProcess is DEFINED in exactly one file, and it is the shared module ***', () => {
  const defining = FILES.filter((p) => /function\s+isTestProcess\s*\(/.test(codeOnly(read(p)))).map(rel)
  assert.deepEqual(defining, [DETECTOR_MODULE + '.js'],
    '⛔ two components establishing the same fact is a coincidence waiting to diverge')
})

test('*** G4 — the fence IMPORTS the detector and does not re-implement it ***', () => {
  const code = codeOnly(read(path.join(SRC, 'adapters', FENCE_MODULE + '.js')))
  assert.match(code, new RegExp('require\\([\'"][^\'"]*' + DETECTOR_MODULE + '[\'"]\\)'),
    '⛔ the fence must take the detector from its one home')
  for (const tok of ['NODE_TEST_CONTEXT', "'--test'", '.test.js']) {
    assert.equal(code.includes(tok), false, '⛔ «' + tok + '» is a SECOND detector growing inside the fence')
  }
})

test('*** G4 — dataDir still re-exports the shared detector, so its own suite is unchanged ***', () => {
  const code = codeOnly(read(path.join(SRC, 'store', 'dataDir.js')))
  assert.match(code, new RegExp('require\\([\'"][^\'"]*' + DETECTOR_MODULE + '[\'"]\\)'))
  assert.match(code, /isTestProcess/, '⛔ dataDir must keep exporting isTestProcess — its tests are the proof')
})

/* ═══ G5 — THE OPT-IN IS THE ONE THE REPO ALREADY USES ═════════════════ */

test('*** G5 — the fence honours RUN_PAID_E2E, the switch the three paid E2Es already set ***', () => {
  const code = codeOnly(read(path.join(SRC, 'adapters', FENCE_MODULE + '.js')))
  assert.ok(code.includes('RUN_PAID_E2E'),
    '⛔ a second opt-in name would leave the existing paid suites fenced out of their own purpose')
})
