'use strict'
/**
 * scheduledTasks.js — are the timers actually armed?
 *
 *   node scripts/verify/scheduledTasks.js
 *
 * ⛔ THE CLAIM THIS REPLACES: 「the backups are running」. Three of four tasks were green and one
 * had been failing nightly for twelve days. Nobody ran `Get-ScheduledTaskInfo`, because nobody
 * thought of it as a check.
 *
 * ⛔ AND IT KNOWS THE SCHED_S_* VOCABULARY (HR-36). `267011` is SCHED_S_TASK_HAS_NOT_RUN — a
 * freshly registered task, not a failing one. 「≠ 0」 would report a clean install as broken and
 * a DISABLED task as merely quiet.
 *
 * Read-only: Get-ScheduledTask / Get-ScheduledTaskInfo. Changes nothing.
 */
const { execFileSync } = require('node:child_process')
const { runVerify, CHECK } = require('./_verify')

/** ⛔ The tasks that are SUPPOSED to exist. Absence is a FAIL, not an empty list. */
const EXPECTED = [
  { name: 'AromaCoreBackup-B2Sync', what: '核心資料 → B2', daily: true },
  { name: 'AromaReleaseRecords-B2Sync', what: '發佈紀錄 → B2', daily: true },
  { name: 'AromaTruthData-B2Sync', what: '倉存/發票 → B2', daily: true },
  { name: 'AromaXiangXiang-ErrandRecall', what: '每日回收檢查', daily: true }
]

/** Statuses, not exit codes. Some mean trouble and some do not — see HR-36. */
const SCHED_S = {
  267008: { ok: true, say: 'Ready' },
  267009: { ok: true, say: '行緊' },
  267011: { ok: true, say: '未行過(未到時間,唔係失敗)' },
  267012: { ok: false, say: '⚠ 冇下一次執行 —— trigger 出事' },
  267013: { ok: false, say: '⚠ 冇被排程' },
  267014: { ok: false, say: '⚠ 上次被終止(通常撞執行時限)' },
  267015: { ok: false, say: '⚠ 冇有效 trigger' }
}

const PS = [
  '$ErrorActionPreference = "Stop"',
  '$out = @()',
  'foreach ($t in Get-ScheduledTask | Where-Object { $_.TaskName -like "*Aroma*" }) {',
  '  $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -ErrorAction SilentlyContinue',
  '  $next = $null; if ($i -and $i.NextRunTime) { $next = $i.NextRunTime.ToString("s") }',
  '  $last = $null; if ($i -and $i.LastRunTime) { $last = $i.LastRunTime.ToString("s") }',
  '  $res = $null;  if ($i) { $res = $i.LastTaskResult }',
  '  $out += @{ name=$t.TaskName; state=[string]$t.State; result=$res; last=$last; next=$next }',
  '}',
  'ConvertTo-Json @($out) -Compress'
].join('\n')

let tasks = null
let readError = null
try {
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS],
    { encoding: 'utf8', timeout: 30000, windowsHide: true })
  const parsed = JSON.parse(String(raw).trim())
  tasks = Array.isArray(parsed) ? parsed : [parsed]
} catch (e) {
  readError = String(e.message).split('\n')[0].slice(0, 120)
}

const find = (n) => (tasks || []).find((t) => t && t.name === n)

runVerify('排程任務 —— 四個都要真係武裝緊', EXPECTED.map((exp) => ({
  name: exp.name + '  (' + exp.what + ')',
  run: () => {
    // ⛔ Cannot read Task Scheduler → UNKNOWN for every task, never PASS and never FAIL.
    if (readError) return { verdict: CHECK.UNKNOWN, evidence: '問唔到 Windows 排程:' + readError }
    const t = find(exp.name)
    if (!t) return { verdict: CHECK.FAIL, evidence: '冇裝 —— 呢個 task 應該存在但唔喺度' }
    if (String(t.state).toLowerCase() === 'disabled') {
      // ⛔ Installed but off is NOT the same as absent, and neither is quiet.
      return { verdict: CHECK.FAIL, evidence: '裝咗但俾人停用咗 —— 佢一世唔會行' }
    }
    const code = Number(t.result)
    const known = SCHED_S[code]
    const when = t.last ? t.last.replace('T', ' ') : '未行過'
    if (known && !known.ok) return { verdict: CHECK.FAIL, evidence: known.say + '(' + code + ')' }
    if (!known && code !== 0) {
      return {
        verdict: CHECK.FAIL,
        evidence: '上次執行失敗,退出碼 ' + code + (code === 1 ? ' —— 0x1 通常係排程 logon 睇唔到 user profile 入面嘅檔案' : ''),
        detail: '上次:' + when
      }
    }
    if (!t.next) return { verdict: CHECK.FAIL, evidence: '冇下一次執行時間 —— 即係佢唔會再行' }
    return {
      verdict: CHECK.PASS,
      evidence: (known ? known.say : '上次成功') + ' · 上次 ' + when + ' · 下次 ' + t.next.replace('T', ' ')
    }
  }
})))
