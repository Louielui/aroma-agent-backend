'use strict'

/**
 * behaviourSurface.js — prove a change is byte-identical, or find out that it is not.
 *
 * Dumps the FULL observable surface of `processIntake` for a fixed set of turns, from
 * whichever repo root is handed to it. Run it against two commits and compare: identical
 * output is evidence of identical behaviour, in a form nobody has to take on trust.
 *
 *   git worktree add --detach /tmp/base <parent-commit>
 *   # give the worktree a node_modules (junction on Windows, symlink elsewhere)
 *   node scripts/diff/behaviourSurface.js /tmp/base            /tmp/data-base > base.json
 *   node scripts/diff/behaviourSurface.js .                    /tmp/data-head > head.json
 *   # then compare surface and logs SEPARATELY — see "EARN THE ZERO" below
 *
 * Built 2026-08-04 to prove the shadow turnRouter changed nothing with TURN_ROUTER unset.
 * Result then: surface identical at 14,021 bytes each, logs identical, 5 lines each.
 *
 * ═══ TWO MISTAKES THIS HARNESS ALREADY MADE. READ BOTH BEFORE TRUSTING IT. ═══
 *
 * 1. EARN THE ZERO — a false green of the worst kind.
 *
 *    The first comparison shelled out to `node -e "require('/c/Users/...')"` with a POSIX
 *    path. On Windows that throws MODULE_NOT_FOUND. BOTH sides threw, both produced no
 *    output, and `diff` of two empty streams reported ZERO DIFFERENCES — which was then
 *    one keystroke away from being reported as "proven identical".
 *
 *    The check passed while measuring nothing. A zero is only evidence if you have first
 *    shown the measurement ran: assert non-empty output, assert the expected record COUNT,
 *    and compare byte lengths alongside equality. This file prints the byte size of each
 *    surface for exactly that reason — `identical: true (0 bytes each)` is not a pass.
 *
 * 2. IT WROTE TO THE OWNER'S REAL DATA.
 *
 *    `store.js` resolves `AROMA_DATA_DIR || path.resolve(__dirname, '../../data')`. The
 *    first version set no `AROMA_DATA_DIR`, so the worktree side (no gitignored `data/`)
 *    threw on every usage write while the main-repo side wrote happily into the real
 *    `data/aroma-truth.json` — 25 records before it was caught.
 *
 *    Worse than the pollution: the asymmetry LOOKED like a behaviour difference between the
 *    two commits, and was nearly reported as one. A difference that appears only in the
 *    logs and only on one side is a harness bug until proven otherwise.
 *
 *    `AROMA_DATA_DIR` is therefore REQUIRED here (argv[3]) and the script refuses to run
 *    without it. See docs/MAINTENANCE-BACKLOG.md M-3 for the underlying default.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

const path = require('path')

const ROOT = process.argv[2]
const DATA_DIR = process.argv[3]

if (!ROOT || !DATA_DIR) {
  console.error('usage: node scripts/diff/behaviourSurface.js <repo-root> <scratch-data-dir>')
  console.error('  <scratch-data-dir> is REQUIRED: without it this writes to the real store.')
  process.exit(2)
}
if (path.resolve(DATA_DIR) === path.resolve(__dirname, '..', '..', 'data')) {
  console.error('refusing to run: <scratch-data-dir> is the real data directory')
  process.exit(2)
}

process.env.AROMA_DATA_DIR = DATA_DIR

// Identical env on both sides. Flags are pinned rather than inherited, so a shell that
// happens to have one set cannot make the two runs differ for a reason unrelated to the code.
delete process.env.TURN_ROUTER
process.env.READ_ACCESS = 'off'
process.env.CONVERSATION_CONTRACT = 'on'
process.env.DECISION_RECALL = 'off'

const stdout = []
const origLog = console.log
console.log = (...a) => { stdout.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }

// path.RESOLVE, not join: a relative root ('.') yields 'src\intake\intakeService', which
// require() reads as a bare package name and cannot find. It fails loudly, which is the
// design — but it fails for a reason that has nothing to do with the code under test.
const { processIntake } = require(path.resolve(ROOT, 'src', 'intake', 'intakeService'))

/** Fixed turns, one per route, with pinned UUIDs so nothing in the output is volatile. */
const TURNS = [
  { msg: '現在是幾點？', id: '11111111-1111-4111-8111-111111111111', mode: 'chat' },
  { msg: '你可以幫我做什麼？', id: '22222222-2222-4222-8222-222222222222', mode: 'chat' },
  { msg: '最近有哪些發票？', id: '33333333-3333-4333-8333-333333333333', mode: 'chat' },
  { msg: '幫我改 docs/canary/agent-canary.md 嗰行字', id: '44444444-4444-4444-8444-444444444444', mode: 'chat' },
  { msg: '你好', id: '55555555-5555-4555-8555-555555555555', mode: 'chat' }
]

function adapter (calls) {
  return {
    name: 'fake',
    async complete (prompt, o) {
      calls.push({
        prompt,
        system: o && o.system,
        maxTokens: o && o.maxTokens,
        temperature: o && o.temperature,
        responseFormat: (o && o.responseFormat) || null
      })
      return {
        text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '固定回覆，內容不變。' }),
        provider: 'claude',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'fake-model'
      }
    }
  }
}

;(async () => {
  const out = []
  for (const t of TURNS) {
    const calls = []
    let result = null
    let error = null
    try {
      result = await processIntake(t.msg, adapter(calls), [], { interactionMode: t.mode, demo: false, requestId: t.id })
    } catch (e) { error = { name: e && e.name, message: e && e.message } }
    out.push({ turn: t.msg, result, error, calls })
  }

  // Let fire-and-forget async loggers finish BEFORE the capture window closes, or the two
  // sides differ only in whether a late callback landed inside it — a flush race dressed up
  // as a behaviour change.
  await new Promise((r) => setTimeout(r, 3000))
  console.log = origLog

  // stdout is part of the surface: an extra log line IS a behaviour change. Timestamps
  // inside the lines are volatile and are normalised; nothing else is.
  const logs = stdout.map((l) => l.replace(/"timestamp":"[^"]*"/g, '"timestamp":"<t>"'))
  process.stdout.write(JSON.stringify({ turns: TURNS.length, surface: out, logs }, null, 2))
})()
