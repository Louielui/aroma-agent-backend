'use strict'
/**
 * testNames.js — extract every test NAME in the suite.
 *
 * ⛔ NAMES, NOT COUNTS. The defect this exists for was a rewrite that deleted five assertions
 * and ADDED more tests than it removed: the count went UP while a guarantee disappeared. A
 * count cannot see that. A name can — `*** 11 — the model/client cannot supply or widen a
 * target origin ***` either exists or it does not.
 */
const fs = require('fs')
const path = require('path')

/** Handles escaped quotes inside a name: test('… the model\'s own status …'). */
const TEST_RE = /\btest\(\s*(['"`])((?:\.|(?!\1).)*)\1/g

function collect (dir, out = new Map()) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (n !== 'node_modules') collect(p, out); continue }
    if (!/\.test\.js$/.test(n)) continue
    const src = fs.readFileSync(p, 'utf8')
    let m
    while ((m = TEST_RE.exec(src)) !== null) {
      /**
       * Unescape so the ledger holds the name as it is displayed, not as it is quoted.
       *
       * ⛔ TRIMMED, because several tests build their name by concatenation —
       * `test('response passthrough preserved: ' + label, …)`. The literal fragment ends in a
       * space, and a ledger written trimmed but compared untrimmed reports every one of them
       * as vanished. My first version did exactly that: four false alarms on the first run,
       * which is the failure mode that gets a check ignored (HR-63).
       *
       * ⚠ AND THOSE NAMES ARE RECORDED AS FRAGMENTS. A concatenated name can only ever be
       * pinned up to its literal part, so the ledger protects the prefix and not the label.
       * Stated rather than hidden: this check is weaker for dynamically-named tests.
       */
      const name = m[2].replace(/\\(['"`\\])/g, '$1').trim()
      if (name) out.set(name, true)
    }
  }
  return out
}

function testNames (root) {
  return Array.from(collect(root).keys()).sort()
}

module.exports = { testNames, TEST_RE }

if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..', 'src')
  process.stdout.write(testNames(root).join('\n') + '\n')
}
