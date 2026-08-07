'use strict'

/**
 * schedulerWitness.js — WITNESS #1: what WINDOWS says about the task.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「DID_NOT_RUN needs both witnesses — the task failing in Windows, and the registry
 * > noticing the gap via nextRunAt. One is not enough, and the registry half is the one that
 * > catches a trigger that never fired.」**
 *
 * Two independent witnesses to the same absence (DESIGN-SCHEDULED-SURFACE.md §3):
 *
 * | | catches |
 * |---|---|
 * | **this file** (Windows) | the task ERRORED, was DISABLED, or was DELETED |
 * | **the registry** (`errandKinds.js`, via `nextRunAt`) | the task NEVER FIRED — no error, no row, nothing to report on |
 *
 * Neither alone is enough. A trigger that never fires leaves Windows perfectly healthy, and a
 * deleted task leaves the registry with nothing to notice a gap against.
 *
 * ── ⛔ AND THIS IS WHY `scheduled` IS MEASURED, NOT DECLARED ────────────────
 * The instruction was to flip `scheduled: true` 「so the DUE sentence changes meaning at the
 * moment the meaning changes」. A hand-edited boolean changes meaning when I EDIT it — before
 * the task exists, and long after it is removed. The second gap is the dangerous one: a deleted
 * task would still be described as scheduled, so its silence would read as calm.
 *
 * Reading it from Task Scheduler makes the flip happen at registration and un-happen at
 * removal, with no edit and no window in which the briefing states the opposite of the truth.
 */

const { execFile } = require('node:child_process')

/** ⛔ ONE constant, shared with `scripts/scheduler/aroma-errand-task.ps1`. If these drift, the
 *  witness reports NOT_INSTALLED for a task that exists — and the briefing says 「手動」 about
 *  something running on a timer. A test greps the script for this exact string. */
const TASK_NAME = 'AromaXiangXiang-ErrandRecall'

const WITNESS = Object.freeze({
  NOT_INSTALLED: 'NOT_INSTALLED',
  INSTALLED: 'INSTALLED',
  DISABLED: 'DISABLED',
  UNREADABLE: 'UNREADABLE'
})

const TTL_MS = 60 * 1000
const cacheStore = new Map()

/** Ask Windows. Read-only: Get-ScheduledTask / Get-ScheduledTaskInfo, nothing else. */
const PS = [
  '$ErrorActionPreference = "Stop"',
  '$t = Get-ScheduledTask -TaskName "' + TASK_NAME + '" -ErrorAction SilentlyContinue',
  'if (-not $t) { ConvertTo-Json @{found=$false} -Compress; exit 0 }',
  '$i = Get-ScheduledTaskInfo -TaskName "' + TASK_NAME + '" -ErrorAction SilentlyContinue',
  '$last = $null; if ($i -and $i.LastRunTime) { $last = $i.LastRunTime.ToString("s") }',
  '$next = $null; if ($i -and $i.NextRunTime) { $next = $i.NextRunTime.ToString("s") }',
  '$res = $null;  if ($i) { $res = $i.LastTaskResult }',
  'ConvertTo-Json @{ found=$true; state=[string]$t.State; lastTaskResult=$res; lastRunTime=$last; nextRunTime=$next } -Compress'
].join('\n')

function defaultExec () {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))))
  })
}

const ms = (s) => { const n = s ? Date.parse(s) : NaN; return Number.isFinite(n) ? n : null }

/**
 * @param {{exec?:function, now?:number, cache?:boolean, cacheKey?:string}} opts
 * @returns {Promise<{state, scheduled, healthy, lastRunAt, nextRunAt, saying, readAt}>}
 */
async function readSchedulerWitness (opts) {
  const o = opts || {}
  const now = Number(o.now) || Date.now()
  const key = o.cacheKey || 'default'
  const useCache = o.cache !== false

  if (useCache) {
    const hit = cacheStore.get(key)
    if (hit && (now - hit.readAt) < TTL_MS) return hit
  }

  let raw
  try {
    raw = await (o.exec || defaultExec)()
  } catch (e) {
    // ⛔ 「I could not look」 is NOT 「it is not there」. `scheduled: null` — false would claim a
    // fact this witness just failed to establish, and the DUE sentence would then confidently
    // say 「手動」 about a task that may be running fine.
    return remember(key, useCache, {
      state: WITNESS.UNREADABLE,
      scheduled: null,
      healthy: null,
      lastRunAt: null,
      nextRunAt: null,
      saying: '問唔到 Windows 排程(' + String(e && e.message).split('\n')[0].slice(0, 80) + ')。我唔知有冇 task。',
      readAt: now
    })
  }

  let d
  try { d = JSON.parse(String(raw).trim()) } catch (_) { d = null }
  if (!d || typeof d !== 'object') {
    return remember(key, useCache, {
      state: WITNESS.UNREADABLE,
      scheduled: null,
      healthy: null,
      lastRunAt: null,
      nextRunAt: null,
      saying: 'Windows 答咗啲我讀唔明嘅嘢,所以我唔知有冇 task。',
      readAt: now
    })
  }

  if (!d.found) {
    return remember(key, useCache, {
      state: WITNESS.NOT_INSTALLED,
      scheduled: false,
      healthy: null,
      lastRunAt: null,
      nextRunAt: null,
      saying: '冇裝過排程 task。',
      readAt: now
    })
  }

  const disabled = String(d.state || '').toLowerCase() === 'disabled'
  const code = Number(d.lastTaskResult)
  const ran = ms(d.lastRunTime)
  // A task that has never run has no result to judge; `healthy` stays null rather than false.
  const healthy = Number.isFinite(code) && ran ? code === 0 : null

  let saying
  if (disabled) {
    // ⛔ The quietest way for a schedule to stop: still listed, still there, never fires.
    saying = '個 task 裝咗但係俾人停用咗 —— 佢唔會行。'
  } else if (healthy === false) {
    saying = '上次行嗰次 Windows 報失敗,退出碼 ' + code + '(0x' + (code >>> 0).toString(16) + ')。' +
      '⚠ 0x1 通常係排程 logon 睇唔到 user profile 入面嘅檔案 —— 備份 task 就係咁死過。'
  } else if (healthy === null) {
    saying = '個 task 裝咗,但 Windows 話佢未行過。'
  } else {
    saying = '個 task 裝咗,行緊,上次 Windows 報成功。'
  }

  return remember(key, useCache, {
    state: disabled ? WITNESS.DISABLED : WITNESS.INSTALLED,
    scheduled: !disabled,
    healthy,
    lastRunAt: ran,
    nextRunAt: ms(d.nextRunTime),
    lastTaskResult: Number.isFinite(code) ? code : null,
    saying,
    readAt: now
  })
}

function remember (key, useCache, w) {
  if (useCache) cacheStore.set(key, w)
  return w
}

module.exports = { readSchedulerWitness, WITNESS, TASK_NAME, TTL_MS }
