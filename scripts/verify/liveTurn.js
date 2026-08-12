'use strict'

/**
 * liveTurn.js — the ONLY thing that counts as verification.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS: FIVE PASSES THAT DID NOT SURVIVE CONTACT WITH THE OWNER'S MACHINE.
 *
 *   provider  B's acceptance passed on OpenAI; production runs Claude.
 *   lane      the smoke test passed on a path the defect could not reach.
 *   caller    「verified on a live turn」 meant `processIntake(...)` called directly, with an
 *             options bag I built myself. His turn goes through POST /api/v1/demo/intake.
 *   build     the running server had started TWO HOURS BEFORE the commit being verified.
 *
 * Each time the layer skipped was the layer that decided, and each time the harness was a
 * subset of production read as equal to it.
 *
 * > **Owner: 「Make that structural, not a resolution. A rule you remember is the thing this
 * > month has disproven four times over.」**
 *
 * So this is not a rule. It is a script that REFUSES TO PRINT A PASS when its premises fail.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node --env-file=.env scripts/verify/liveTurn.js "給我 Aroma System 的 website"
 *
 * It exits non-zero, with no verdict, unless ALL of:
 *   1. the server answers /health
 *   2. `bootCommit` matches the working tree's HEAD   ← the gap that voided the last attempt
 *   3. the working tree is CLEAN (uncommitted edits are not running in that process)
 *   4. the turn goes through POST /api/v1/demo/intake — the endpoint the page posts to
 */

const { execSync } = require('child_process')
const path = require('path')
const { readHeadSync } = require('../../src/governance/bootCommit')

const BASE = 'http://127.0.0.1:8090'
const REPO = path.resolve(__dirname, '..', '..')
const MESSAGE = process.argv[2] || '給我 Aroma System 的 website'

function die (why) {
  console.error('')
  console.error('⛔ NOT VERIFIED — ' + why)
  console.error('   No verdict is printed, because a verdict here would be a claim about a')
  console.error('   harness rather than about 香香.')
  process.exit(1)
}

;(async () => {
  // ── 1. is it up ──────────────────────────────────────────────────────────
  let health
  try {
    const r = await fetch(BASE + '/health')
    health = await r.json()
  } catch (e) {
    die('the server is not answering on ' + BASE + ' (' + (e && e.message) + ')')
  }

  // ── 2. IS IT RUNNING THE CODE UNDER TEST ────────────────────────────────
  const tree = readHeadSync(REPO)
  if (!health.bootCommit) {
    die('this server predates /health carrying bootCommit — it cannot say what it is running,\n' +
        '   which is exactly the condition that voided the previous verification. Restart it.')
  }
  if (!tree) die('could not read the working tree HEAD')
  if (health.bootCommit !== tree) {
    console.error('   server booted  ' + health.bootCommit.slice(0, 12) + '  at ' + health.bootedAt)
    console.error('   working tree   ' + tree.slice(0, 12))
    die('the server is running a DIFFERENT COMMIT from the one being tested. Restart it.')
  }

  // ── 3. AND NOTHING UNCOMMITTED, because edits on disk are not edits in memory ──
  let dirty = ''
  try { dirty = execSync('git status --porcelain', { cwd: REPO }).toString().trim() } catch (_) { dirty = '' }
  if (dirty) {
    console.error(dirty.split('\n').slice(0, 8).map((l) => '   ' + l).join('\n'))
    die('the working tree has uncommitted changes. They are on disk and NOT in the running\n' +
        '   process — a PASS now would describe neither state.')
  }

  // ── 4. through the endpoint the page actually posts to ──────────────────
  const password = process.env.AROMA_OWNER_PASSWORD
  if (!password) die('AROMA_OWNER_PASSWORD absent — run with --env-file=.env')

  let cookie = null
  try {
    const login = await fetch(BASE + '/owner/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ password }),
      redirect: 'manual'
    })
    const raw = login.headers.get('set-cookie')
    if (raw) cookie = raw.split(';')[0]
  } catch (e) { die('login failed: ' + (e && e.message)) }
  if (!cookie) die('no owner session cookie was issued')

  const started = Date.now()
  let body
  try {
    const r = await fetch(BASE + '/api/v1/demo/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
      body: JSON.stringify({ message: MESSAGE, interactionMode: 'chat', history: [] })
    })
    body = await r.json()
  } catch (e) { die('the turn failed: ' + (e && e.message)) }

  console.log('')
  console.log('════ LIVE TURN — premises checked ════')
  console.log('  commit    ' + tree.slice(0, 12) + '  (server booted the same, at ' + health.bootedAt + ')')
  console.log('  tree      clean')
  console.log('  route     POST /api/v1/demo/intake')
  console.log('  elapsed   ' + (Date.now() - started) + ' ms')
  console.log('')
  console.log('  question  ' + MESSAGE)
  console.log('  reply     ' + JSON.stringify(body && (body.reply || body.error || body)).slice(0, 600))
  console.log('')
  console.log('⛔ THIS SCRIPT DOES NOT JUDGE THE ANSWER. It establishes that the premises of a')
  console.log('   verification hold; whether the reply is right is the Owner\'s call.')
})()
