'use strict'
/**
 * servedAssets.js — is the RUNNING server serving the assets that are on disk?
 *
 *   node scripts/verify/servedAssets.js
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT THIS EXISTS FOR, 2026-08-07.
 *
 * `DEMO_HTML` is built ONCE at module load. Edit `index.html` after the server started and
 * the running process keeps serving the old page — indefinitely, silently, with a green suite.
 *
 * Measured: server started 16:40:49, index.html edited 16:51:43. The Owner was told 首頁 had
 * moved above 開新對話 and his screen showed the opposite, because it was showing a page built
 * eleven minutes before the edit.
 *
 * ⛔ AND THE VERIFICATION THAT MISSED IT WAS MINE. I checked 「the served string」 with
 * `require('./src/demo/demoHtml')` in a FRESH node process — which re-reads the files from
 * disk. **I verified the file, not the server.** Right check, wrong process: HR-38's family,
 * a third time.
 *
 * ⚠ AND THE EXISTING STALE-TAB BANNER CANNOT SEE THIS. It compares the BROWSER's stamp with
 * the SERVER's. Both come from the same module-load constant, so they agree perfectly while
 * both are stale. It detects an old tab, never an old server.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { runVerify, CHECK } = require('./_verify')

const REPO = path.join(__dirname, '..', '..')
const ASSETS = ['app.js', 'app.css', 'index.html'].map((n) => path.join(REPO, 'src', 'demo', 'assets', n))

/** When the live server process started. Credential-free: the demo page needs his session. */
function serverStartedAt () {
  const ps = "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*src/index.js*' } | Select-Object -First 1).CreationDate.ToString('o')"
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim()
  const t = Date.parse(out)
  return Number.isFinite(t) ? t : null
}

let started = null
let startErr = null
try { started = serverStartedAt() } catch (e) { startErr = String(e.message).split('\n')[0].slice(0, 80) }

runVerify('畫面 —— 行緊嗰個 server 有冇喺度餵緊舊 asset', [
  {
    name: '搵到行緊嗰個 process',
    run: () => {
      if (startErr) return { verdict: CHECK.UNKNOWN, evidence: '問唔到:' + startErr }
      if (!started) return { verdict: CHECK.UNKNOWN, evidence: '8090 冇行緊,所以冇嘢喺度餵' }
      return { verdict: CHECK.PASS, evidence: '由 ' + new Date(started).toISOString().replace('T', ' ').slice(0, 19) + ' 開始行' }
    }
  },
  {
    name: '⛔ 冇一個 asset 新過個 process',
    run: () => {
      if (!started) return { verdict: CHECK.UNKNOWN, evidence: '唔知個 process 幾時開始' }
      const stale = []
      for (const f of ASSETS) {
        if (!fs.existsSync(f)) return { verdict: CHECK.FAIL, evidence: '搵唔到 ' + path.basename(f) }
        const m = fs.statSync(f).mtimeMs
        if (m > started) stale.push(path.basename(f) + '(' + new Date(m).toISOString().slice(11, 19) + ')')
      }
      if (stale.length) {
        return {
          verdict: CHECK.FAIL,
          evidence: '⛔ 改咗但未重啟:' + stale.join(' · '),
          detail: '個 server 而家餵緊舊版。重啟先 —— DEMO_HTML 係開機嗰陣砌一次。'
        }
      }
      return { verdict: CHECK.PASS, evidence: ASSETS.length + ' 個 asset 全部舊過個 process' }
    }
  },
  {
    name: '磁碟上面嘅 build stamp',
    run: () => {
      // Printed as evidence: this is the value a freshly started server WOULD serve. It is not
      // proof of what the live one is serving — that is what the mtime check above is for.
      const { computeBuildStamp } = require('../../src/demo/demoHtml')
      return { verdict: CHECK.PASS, evidence: computeBuildStamp() + '(重啟之後個 server 會餵呢個)' }
    }
  }
])
