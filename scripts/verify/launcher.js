'use strict'
/**
 * launcher.js — is the launcher what the repo says it is?
 *
 *   node scripts/verify/launcher.js
 *
 * ⛔ THE CLAIM THIS REPLACES: nothing. Until 2026-08-07 the file that starts everything had no
 * hash, no history, no backup and nothing that read it. A silently changed launcher looked
 * exactly like a working one — the same shape that cost twelve days on the core-data backup.
 *
 * ⚠ AND WHAT IT DOES NOT CLAIM: this DETECTS. It does not prevent. She runs as the same Windows
 * principal as the Owner, so no ACL can tell her process from his keyboard — see
 * docs/DESIGN-LAUNCHER-PROTECTION.md §1. Read-only: hashes a file and reads an ACL.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { runVerify, CHECK } = require('./_verify')
const { checkLauncher, SHIM_PATH, BODY_REL, PIN } = require('../../src/governance/launcherPin')

const REPO = path.join(__dirname, '..', '..')
const BODY = path.join(REPO, BODY_REL)

function acl () {
  const ps = "(Get-Acl '" + SHIM_PATH + "').Access | " +
    "Where-Object { $_.AccessControlType -eq 'Allow' -and $_.FileSystemRights -match 'Write|Modify|FullControl' } | " +
    'ForEach-Object { $_.IdentityReference.ToString() }'
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim().split(/\r?\n/).filter(Boolean)
}

runVerify('啟動器 —— 佢係咪 repo 講嗰個', [
  {
    name: '⛔ shim 嘅 hash 同 repo 釘住嗰個一樣',
    run: () => {
      const r = checkLauncher()
      if (r.state === 'MATCH') return { verdict: CHECK.PASS, evidence: 'sha256 ' + PIN.slice(0, 16) + '… 對得上' }
      if (r.state === 'UNREADABLE') return { verdict: CHECK.UNKNOWN, evidence: r.saying }
      return { verdict: CHECK.FAIL, evidence: r.saying, detail: '釘住:' + r.expected.slice(0, 16) + '…  而家:' + String(r.actual).slice(0, 16) + '…' }
    }
  },
  {
    name: 'shim 冇夾帶設定(有 flag 喺度就等於冇人審得到)',
    run: () => {
      let s
      try { s = fs.readFileSync(SHIM_PATH, 'utf8') } catch (e) { return { verdict: CHECK.UNKNOWN, evidence: '讀唔到' } }
      if (/\$env:/.test(s)) return { verdict: CHECK.FAIL, evidence: '⛔ shim 入面有 $env: —— 一個冇歷史嘅 flag' }
      return { verdict: CHECK.PASS, evidence: s.length + ' bytes,冇 $env:,得一個 handoff' }
    }
  },
  {
    name: '真身喺 repo 入面(即係佢有 git 歷史)',
    run: () => {
      if (!fs.existsSync(BODY)) return { verdict: CHECK.FAIL, evidence: '搵唔到 ' + BODY_REL + ' —— shim 會叫唔到嘢' }
      const b = fs.readFileSync(BODY, 'utf8')
      if (!/\$env:/.test(b)) return { verdict: CHECK.FAIL, evidence: '真身入面冇 flag —— 即係 flag 走咗去第度' }
      return { verdict: CHECK.PASS, evidence: BODY_REL + ',' + b.length + ' bytes,flag 喺入面' }
    }
  },
  {
    name: '⚠ 邊個寫得到個 shim(呢個係報告,唔係一個閘)',
    run: () => {
      let who
      try { who = acl() } catch (e) { return { verdict: CHECK.UNKNOWN, evidence: '讀唔到 ACL:' + String(e.message).split('\n')[0].slice(0, 60) } }
      // ⛔ Deliberately NOT a FAIL. She runs as the Owner, so a permissive ACL is not the
      // vulnerability and a tight one would not be the fix. This prints who, as evidence.
      return {
        verdict: CHECK.PASS,
        evidence: who.join(' · '),
        detail: '⚠ 佢同你係同一個 Windows principal,所以 ACL 分唔到你同佢 —— 呢行係證據,唔係保護。'
      }
    }
  },
  {
    name: '啟動器有備份',
    run: () => {
      const monthly = path.join(REPO, 'scripts', 'backup', 'Monthly-OfflineBackup.ps1')
      if (!fs.existsSync(monthly)) return { verdict: CHECK.UNKNOWN, evidence: '搵唔到每月備份 script' }
      const s = fs.readFileSync(monthly, 'utf8')
      if (!/launcher/i.test(s)) {
        return { verdict: CHECK.FAIL, evidence: '⛔ 啟動器唔喺每月離線備份入面 —— 起動一切嗰個檔案冇副本' }
      }
      return { verdict: CHECK.PASS, evidence: '喺每月離線備份嘅來源清單入面' }
    }
  }
])
