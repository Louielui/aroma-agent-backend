'use strict'

/**
 * displayLayerHonesty.test.js — the screens may not promise what the order does not do, and a
 * success may not be told less than a failure.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * When the canary shrank to two steps I changed the approval screen's file promises and missed
 * this, on the Companion screen:
 *
 *     DONE. The file has been created.
 *     Please open it, check it, and delete it when you are satisfied.
 *
 * The Owner ran the two-step canary, it passed, and the screen sent him to look for a file that
 * was never going to exist.
 *
 * It survived because NOTHING POINTED AT IT. A failing test pointed at ownerApproval.js. An
 * `undefined` rendering pointed at ownerApproval.js. This line is a hardcoded string with no
 * test on its content, it reads no allowedPath so it never rendered undefined, and it is on a
 * different screen in a different session. I fixed what the signals pointed at and never asked
 * "where else does this category live" — which is the same failure I had already written up
 * about the strict-mode guard's hand-maintained file list, one round earlier.
 *
 * So: a rule, over the whole display layer, instead of a memory.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts', 'computer')

/** Every production file that prints to a person. Enumerated from disk, not listed by hand. */
function displayFiles () {
  return fs.readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .filter((f) => /^(tool-|operatorToolsCommon|ownerApproval|run-notepad-canary)/.test(f))
    .sort()
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (f) => strip(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'))

/* ── 1. no screen may claim a file was created ────────────────────────────── */

/**
 * Claims about a file HAVING BEEN created or written. Deliberately not "any mention of a file":
 * the approval screen legitimately describes a file when the order contains a save, and a
 * refusal legitimately says a folder is not empty. What is banned is an unconditional past-tense
 * claim on an outcome screen.
 */
const FILE_CLAIMS = [
  /file has been created/i,
  /the file was created/i,
  /file has been written/i,
  /your file is (?:ready|saved)/i,
  /has been saved to/i
]

test('*** no display file claims a file was created ***', () => {
  const offenders = []
  for (const f of displayFiles()) {
    const code = read(f)
    code.split('\n').forEach((line, i) => {
      for (const re of FILE_CLAIMS) if (re.test(line)) offenders.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 76))
    })
  }
  assert.deepEqual(offenders, [],
    'the two-step order creates no file; say what actually happened:\n  ' + offenders.join('\n  '))
})

test('*** POSITIVE CONTROL — the rule catches the real line and permits the honest ones ***', () => {
  // Without this, "no offenders" could mean the patterns match nothing at all. The first sample
  // is the exact line that shipped and misled the Owner.
  const caught = (s) => FILE_CLAIMS.some((re) => re.test(s))

  for (const bad of [
    "T.out('  DONE. The file has been created.')",
    "T.out('  The file was created.')",
    "out('your file is ready')"
  ]) {
    assert.equal(caught(bad), true, 'must be caught: ' + bad)
  }
  for (const good of [
    "T.out('  No file was created - this task does not save anything.')",
    "lines.push(['File written', order.allowedPath + '\\\\' + save.fileName])",
    "items.push(entries.length + ' file(s) in ' + ALLOWED_DIR)",
    "return no('folder_not_empty', 'The folder is not empty.')"
  ]) {
    assert.equal(caught(good), false, 'must be permitted: ' + good)
  }
})

/* ── 2. success and failure are told the same measured facts ──────────────── */

test('*** the Companion reports cleanup and leftovers on BOTH outcomes ***', () => {
  const code = read('tool-start-companion.js')
  const at = code.indexOf('if (res && res.ok) {')
  assert.ok(at > 0, 'the outcome branch exists')

  const elseAt = code.indexOf('} else {', at)
  const successBranch = code.slice(at, elseAt)
  const failureBranch = code.slice(elseAt, code.indexOf('The switch is off', elseAt))

  for (const [label, branch] of [['success', successBranch], ['failure', failureBranch]]) {
    assert.match(branch, /reportCleanup\(res\)/, label + ' branch reports the cleanup measurement')
    assert.match(branch, /reportLeftovers\(res\)/, label + ' branch reports what is left behind')
  }
})

test('*** POSITIVE CONTROL — a one-sided branch is detectable ***', () => {
  // The shape that shipped: the measurement lived only in the else.
  const oneSided = `
  if (res && res.ok) {
    T.out('DONE')
  } else {
    T.out('IT DID NOT RUN.')
    reportLeftovers(res)
  }
  The switch is off`
  const at = oneSided.indexOf('if (res && res.ok) {')
  const elseAt = oneSided.indexOf('} else {', at)
  const success = oneSided.slice(at, elseAt)
  assert.equal(/reportLeftovers\(res\)/.test(success), false,
    'the old shape has no measurement on the success path — which is what this rule catches')
})

/* ── 3. the measurement is shown, not summarised into a word ──────────────── */

test('*** every measured cleanup field reaches the screen ***', () => {
  const code = read('tool-start-companion.js')
  for (const f of ['processExited', 'notepadWindowsAfter', 'notepadProcessesAfter', 'forced', 'method']) {
    assert.ok(code.includes(f), 'the screen prints ' + f)
  }
  // Absent must not render as zero or false: "I could not look" and "I looked and found none"
  // are different facts.
  assert.match(code, /not measured/, 'a null is shown as "not measured"')
  // And a cleanup that did not finish says so rather than being folded into DONE.
  assert.match(code, /THE CLEANUP DID NOT FINISH/)
})

test('*** the step list on screen is READ from the result, never written out ***', () => {
  const code = read('tool-start-companion.js')
  const at = code.indexOf('if (res && res.ok) {')
  const successBranch = code.slice(at, code.indexOf('} else {', at))
  assert.match(successBranch, /res\.result[\s\S]{0,60}\.steps/, 'the actions come from the run')
  // A hardcoded step list is exactly how the last message went stale.
  for (const literal of ['open_app then type_text', 'two steps', 'three steps']) {
    assert.equal(successBranch.includes(literal), false, 'the step list must not be hardcoded: ' + literal)
  }
})

/* ── 4. an unconditional reassurance is never a substitute for looking ────── */

const UNCONDITIONAL = [
  /Nothing was left behind/i,
  /everything is clean/i,
  /no problems found/i
]

test('*** no screen reassures without measuring ***', () => {
  const offenders = []
  for (const f of displayFiles()) {
    const code = read(f)
    code.split('\n').forEach((line, i) => {
      for (const re of UNCONDITIONAL) if (re.test(line)) offenders.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 70))
    })
  }
  assert.deepEqual(offenders, [], 'measure it, or do not say it:\n  ' + offenders.join('\n  '))
})

test('*** POSITIVE CONTROL — the reassurance rule catches its own history ***', () => {
  const caught = (s) => UNCONDITIONAL.some((re) => re.test(s))
  assert.equal(caught("T.out('  Nothing was left behind.')"), true, 'the line that used to ship')
  assert.equal(caught("T.out('  Checked: no Notepad left open, and the folder is empty.')"), false,
    'a statement that follows a measurement is fine')
})
