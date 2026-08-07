'use strict'
/**
 * offsiteBackup.js — is the core-data off-site copy REALLY there, and does it match?
 *
 *   node scripts/verify/offsiteBackup.js
 *
 * ⛔ THE CLAIM THIS REPLACES: 「verified byte-identical」, written in a memory on 2026-07-19 and
 * still saying that on 2026-08-07 while the sync had been dead for twelve days. Nothing lied;
 * nothing re-checked. **That is the shape this file exists to remove.**
 *
 * It does NOT read the backup task's exit code. A green task result is what the other two legs
 * returned every night while this one was dead. It hashes the live store and compares against
 * the bytes actually sitting in B2.
 *
 * Read-only. Downloads to a temp dir and deletes it. Touches nothing in B2.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { runVerify, CHECK } = require('./_verify')

const SOURCE = process.env.AROMA_CORE_DIR || 'C:\\Users\\louis\\AromaCore\\core-data'
const STAGING = 'C:\\AromaBackupStaging\\Core'
const RCLONE = 'C:\\ProgramData\\AromaBackup\\bin\\rclone.exe'
const RCONF = 'C:\\ProgramData\\AromaBackup\\config\\rclone.conf'
const B2_ROOT = 'b2:aroma-core-backups/core-data-v2'
const MAX_AGE_DAYS = 8

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

function walk (dir, base) {
  const root = base || dir
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) out.push(...walk(p, root))
    else out.push({ rel: path.relative(root, p).split(path.sep).join('/'), abs: p })
  }
  return out
}
function treeHash (files) {
  const h = crypto.createHash('sha256')
  for (const f of files) h.update(f.rel + '\0' + sha256(fs.readFileSync(f.abs)) + '\0')
  return h.digest('hex')
}
const rclone = (args) => execFileSync(RCLONE, args.concat(['--config', RCONF]), { encoding: 'utf8', timeout: 180000 })

let liveHash = null
let bundleId = null

runVerify('異地備份 —— 核心資料 (core-data → B2)', [
  {
    name: '活資料庫讀得到',
    run: () => {
      if (!fs.existsSync(SOURCE)) return { verdict: CHECK.UNKNOWN, evidence: '搵唔到 ' + SOURCE }
      const files = walk(SOURCE)
      if (!files.length) return { verdict: CHECK.FAIL, evidence: '個資料夾空嘅 —— 呢個本身就係一個問題' }
      liveHash = treeHash(files)
      bundleId = 'core-v2-' + liveHash.slice(0, 16)
      return { verdict: CHECK.PASS, evidence: files.length + ' 個檔,tree hash ' + liveHash.slice(0, 16) }
    }
  },
  {
    name: '⛔ B2 上面有一個同活資料庫一致嘅 bundle',
    run: () => {
      if (!liveHash) return { verdict: CHECK.UNKNOWN, evidence: '上一步冇成功,冇 hash 好比' }
      let listing
      try { listing = rclone(['lsf', B2_ROOT + '/' + bundleId]) } catch (e) {
        return {
          verdict: CHECK.FAIL,
          evidence: 'B2 上面冇 ' + bundleId,
          detail: '即係活資料庫改咗之後未備份過。行 `node scripts/backup/coreDataBackup.js`。'
        }
      }
      if (!String(listing).trim()) return { verdict: CHECK.FAIL, evidence: bundleId + ' 喺 B2 係空嘅' }
      return { verdict: CHECK.PASS, evidence: bundleId + ' 喺 B2,內容定址對得上' }
    }
  },
  {
    name: '⛔ 由 B2 載返落嚟嘅位元,重新 hash 之後同活資料庫一樣',
    run: () => {
      // The only check that is actually evidence. Everything above proves a NAME matches.
      if (!liveHash) return { verdict: CHECK.UNKNOWN, evidence: '冇 hash 好比' }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verifyb2-'))
      try {
        rclone(['copy', B2_ROOT + '/' + bundleId + '/data', path.join(tmp, 'data')])
        const pulled = walk(path.join(tmp, 'data'))
        if (!pulled.length) return { verdict: CHECK.FAIL, evidence: 'B2 嗰個 bundle 裡面冇檔案' }
        const back = treeHash(pulled)
        if (back !== liveHash) {
          return { verdict: CHECK.FAIL, evidence: '載返落嚟 ' + back.slice(0, 16) + ' ≠ 活資料庫 ' + liveHash.slice(0, 16) }
        }
        return { verdict: CHECK.PASS, evidence: pulled.length + ' 個檔由 B2 載返落嚟重新 hash,一模一樣' }
      } catch (e) {
        return { verdict: CHECK.UNKNOWN, evidence: '載唔返落嚟:' + String(e.message).split('\n')[0].slice(0, 100) }
      } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (_) {}
      }
    }
  },
  {
    name: '最近一次備份唔算太舊',
    run: () => {
      if (!fs.existsSync(STAGING)) return { verdict: CHECK.UNKNOWN, evidence: '冇本地暫存資料夾 ' + STAGING }
      const dirs = fs.readdirSync(STAGING).map((n) => ({ n, m: fs.statSync(path.join(STAGING, n)).mtimeMs }))
      if (!dirs.length) return { verdict: CHECK.FAIL, evidence: '暫存資料夾入面冇 bundle' }
      const newest = dirs.sort((a, b) => b.m - a.m)[0]
      const days = (Date.now() - newest.m) / 86400000
      const when = new Date(newest.m).toISOString().slice(0, 10)
      if (days > MAX_AGE_DAYS) {
        return { verdict: CHECK.FAIL, evidence: '最新 bundle ' + when + ',' + Math.round(days) + ' 日前,超過 ' + MAX_AGE_DAYS + ' 日' }
      }
      return { verdict: CHECK.PASS, evidence: '最新 ' + newest.n + ',' + when + '(' + Math.round(days) + ' 日前)' }
    }
  }
])
