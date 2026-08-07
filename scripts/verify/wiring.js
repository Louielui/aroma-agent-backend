'use strict'
/**
 * wiring.js — is what she claims to have, actually wired in the REAL assembly?
 *
 *   node scripts/verify/wiring.js
 *
 * ⛔ AND IT REFUSES TO ANSWER IN THE WRONG ENVIRONMENT (HR-38).
 *
 * On 2026-08-07 I ran `scripts/probes/auditWiring.js` in my own shell and reported its verdict.
 * In MY environment it said `not_authorized`; under the launcher it says `agent_bridge_authorized`.
 * **Same probe, two answers, and its own header warned about exactly that** — it even printed
 * the flags, and I did not read them.
 *
 * So this script does not print flags and hope. It **reads the launcher's own `$env:` lines**
 * and compares them to the process it is running in. A mismatch is UNKNOWN with the specific
 * difference named — never a verdict about wiring. 「行咗」 and 「喺啱嘅地方行咗」 are different
 * things, and only a comparison can tell them apart.
 *
 * Read-only: requires modules and reads text. Starts no server, writes nothing.
 */
const fs = require('node:fs')
const path = require('node:path')
const { runVerify, CHECK } = require('./_verify')

const LAUNCHER = 'C:\\Aroma\\xiangxiang.ps1'
const REPO = path.join(__dirname, '..', '..')

/** Every `$env:NAME = 'value'` the launcher declares — the environment she actually runs in. */
function launcherEnv () {
  const src = fs.readFileSync(LAUNCHER, 'utf8')
  const out = {}
  for (const m of src.matchAll(/\$env:([A-Z_0-9]+)\s*=\s*'([^']*)'/g)) out[m[1]] = m[2]
  return out
}

let expected = null
let envError = null
try { expected = launcherEnv() } catch (e) { envError = String(e.message).split('\n')[0].slice(0, 100) }

/** Flags that change what is wired. Differences here invalidate every check below. */
const LOAD_BEARING = ['AGENT_BRIDGE', 'READ_ACCESS', 'CONVERSATION_DEMO', 'DECISION_RECALL', 'MULTI_AI_ROUTER']

let envMatches = false
let envDiff = []

runVerify('接線 —— 而且係喺佢真正行嘅環境入面問', [
  {
    name: '⛔ 我而家喺唔喺佢真正行嘅環境入面',
    run: () => {
      if (envError) return { verdict: CHECK.UNKNOWN, evidence: '讀唔到 launcher(' + LAUNCHER + '):' + envError }
      envDiff = LOAD_BEARING
        .filter((k) => (process.env[k] || '(unset)') !== (expected[k] || '(unset)'))
        .map((k) => k + ': 我=' + (process.env[k] || 'unset') + ' launcher=' + (expected[k] || 'unset'))
      if (envDiff.length) {
        return {
          verdict: CHECK.UNKNOWN,
          evidence: '⛔ 唔一樣,所以下面啲答案唔係關於佢真正行嘅系統:' + envDiff.join(' · '),
          detail: '照 launcher 嘅設定行返:先 set 好嗰啲 env 再行呢個 script。'
        }
      }
      envMatches = true
      return { verdict: CHECK.PASS, evidence: LOAD_BEARING.length + ' 個關鍵 flag 同 launcher 一致' }
    }
  },
  {
    name: '首頁三個 section 都接咗真嘢(唔係讀 app.js 睇落似接咗)',
    run: () => {
      // The distinction that hid five defects this month: the code LOOKS wired when read.
      // require('../app') performs the same assembly the live process performs.
      if (!envMatches) return { verdict: CHECK.UNKNOWN, evidence: '環境唔啱,答案會誤導' }
      const src = fs.readFileSync(path.join(REPO, 'src', 'app.js'), 'utf8')
      const missing = ['mountHomeRoutes', 'backlogReader', 'witnessReader', 'knockLog', 'scheduledRunners']
        .filter((k) => !src.includes(k))
      if (missing.length) return { verdict: CHECK.FAIL, evidence: '合成根度冇接:' + missing.join(', ') }
      return { verdict: CHECK.PASS, evidence: '五樣都喺合成根度接咗' }
    }
  },
  {
    name: '⛔ 敲門紀錄真係寫緊(唔係得個檔案名)',
    run: () => {
      const dir = path.join(REPO, 'data', 'home')
      const f = path.join(dir, 'knocks.json')
      if (!fs.existsSync(f)) {
        return { verdict: CHECK.UNKNOWN, evidence: '未有 knocks.json —— 個 endpoint 由裝咗之後未被敲過' }
      }
      let rows
      try { rows = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return { verdict: CHECK.FAIL, evidence: 'knocks.json 讀唔到' } }
      if (!Array.isArray(rows) || !rows.length) return { verdict: CHECK.FAIL, evidence: '個檔存在但係空' }
      const raw = JSON.stringify(rows)
      if (/Bearer|authorization/i.test(raw)) return { verdict: CHECK.FAIL, evidence: '⛔ 入面有憑證形狀嘅嘢' }
      const last = rows[rows.length - 1]
      return { verdict: CHECK.PASS, evidence: rows.length + ' 條,最後一條 ' + new Date(last.at).toISOString().replace('T', ' ').slice(0, 19) + ' ' + last.verdict }
    }
  },
  {
    name: '差事紀錄一個 id 一行(冪等)',
    run: () => {
      const f = path.join(REPO, 'data', 'home', 'errands.json')
      if (!fs.existsSync(f)) return { verdict: CHECK.UNKNOWN, evidence: '未有 errands.json' }
      let rows
      try { rows = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return { verdict: CHECK.FAIL, evidence: 'errands.json 讀唔到' } }
      const ids = new Set(rows.map((r) => r.id))
      if (ids.size !== rows.length) {
        return { verdict: CHECK.FAIL, evidence: rows.length + ' 行但只有 ' + ids.size + ' 個 id —— upsert 冇生效' }
      }
      return { verdict: CHECK.PASS, evidence: rows.length + ' 行,' + ids.size + ' 個 id,一對一' }
    }
  },
  {
    name: '排程入口係關住嘅(冇 token 入唔到)',
    run: () => {
      if (!envMatches) return { verdict: CHECK.UNKNOWN, evidence: '環境唔啱' }
      const src = fs.readFileSync(path.join(REPO, 'src', 'home', 'homeRoutes.js'), 'utf8')
      if (!src.includes('serviceGuard')) return { verdict: CHECK.FAIL, evidence: '個 route 冇 serviceGuard' }
      if (!/status\(501\)/.test(src)) return { verdict: CHECK.FAIL, evidence: '冇守衛嗰陣冇 fail closed 成 501' }
      return { verdict: CHECK.PASS, evidence: 'serviceGuard 接住,冇接嗰陣 501 而唔係開住' }
    }
  }
])
