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
const { t } = require('../i18n/t')

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
  '$t = @(Get-ScheduledTask -TaskPath "\\" -ErrorAction Stop | Where-Object { $_.TaskName -eq "' + TASK_NAME + '" })',
  'if (-not $t) { ConvertTo-Json @{found=$false} -Compress; exit 0 }',
  'if ($t.Count -ne 1) { throw "ambiguous_fixed_task" }; $t = $t[0]',
  '$i = Get-ScheduledTaskInfo -TaskName "' + TASK_NAME + '" -TaskPath "\\" -ErrorAction Stop',
  '$last = $null; if ($i -and $i.LastRunTime) { $last = $i.LastRunTime.ToUniversalTime().ToString("o") }',
  '$next = $null; if ($i -and $i.NextRunTime) { $next = $i.NextRunTime.ToUniversalTime().ToString("o") }',
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

/**
 * ⛔ THE 0x41300 FAMILY ARE STATUSES, NOT EXIT CODES — AND 「≠ 0」 LUMPS THEM TOGETHER.
 *
 * A freshly registered task reports `267011` (`0x41303`, SCHED_S_TASK_HAS_NOT_RUN). Testing
 * `code === 0` described a clean install as a failing task within seconds of registering it,
 * and appended the 0x1 profile-visibility hint, which had nothing to do with it.
 *
 * Some of the family mean trouble and some do not. That distinction is the whole point.
 */
const SCHED_S = {
  // ⛔ EACH ROW HOLDS A THUNK, NOT A KEY STRING — AND THIS IS THE SECOND ATTEMPT.
  // The first stored `key: 'sched.ready'` and called `t(status.key)`, which is a DYNAMIC key:
  // exactly the hole rule ① exists to close, written by me, at exactly the moment the Owner
  // predicted — 「it will be tempting to break the first time something looks repetitive」.
  // The source scan failed the build. A thunk keeps the table's shape and keeps every key a
  // literal at a real call site, so the scan can still see all eight.
  267008: { healthy: null, say: () => t('sched.ready') },
  267009: { healthy: null, say: () => t('sched.running') },
  267010: { healthy: null, say: () => t('sched.disabled') },
  267011: { healthy: null, say: () => t('sched.notYetRun') },
  267012: { healthy: false, say: () => t('sched.noMoreRuns') },
  267013: { healthy: false, say: () => t('sched.notScheduled') },
  267014: { healthy: false, say: () => t('sched.terminated') },
  267015: { healthy: false, say: () => t('sched.noValidTrigger') }
}

/** Windows' 「never ran」 sentinel. Showing it as a date would be showing him a 1999 timestamp. */
const NEVER_RAN_BEFORE = Date.parse('2000-01-01T00:00:00Z')

const ms = (s) => {
  const n = s ? Date.parse(s) : NaN
  if (!Number.isFinite(n)) return null
  return n < NEVER_RAN_BEFORE ? null : n
}

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

  // The service identity cannot establish absence in the Owner's scheduler.
  // Use the authenticated, fixed read under the signed-in Owner; failure stays unknown.
  if (!o.exec && !require('../testProcess').isTestProcess() && process.env.CODEX_CHAT_BRIDGE_TOKEN) {
    try {
      const { scheduler: w } = await require('../adapters/CodexSubscriptionAdapter').localRequest('/runtime-metadata', {}, process.env,AbortSignal.timeout(10000))
      if (!w || !Object.values(WITNESS).includes(w.state) || !Number.isFinite(w.readAt) ||
        (w.state === WITNESS.NOT_INSTALLED && w.scheduled !== false)) throw Error('invalid_scheduler_receipt')
      return remember(key, useCache, w)
    } catch (_) {
      return remember(key, useCache, {state:WITNESS.UNREADABLE,scheduled:null,healthy:null,lastRunAt:null,nextRunAt:null,currentRunningState:'unknown',readAt:now,saying:t('sched.unparseable')})
    }
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
      saying: t('sched.cannotAsk', { error: String(e && e.message).split('\n')[0].slice(0, 80) }),
      readAt: now
    })
  }

  let d
  try { d = JSON.parse(String(raw).trim()) } catch (_) { d = null }
  if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.found !== 'boolean' || (d.found && !['ready','running','disabled','queued','unknown'].includes(String(d.state).toLowerCase()))) {
    return remember(key, useCache, {
      state: WITNESS.UNREADABLE,
      scheduled: null,
      healthy: null,
      lastRunAt: null,
      nextRunAt: null,
      saying: t('sched.unparseable'),
      readAt: now
    })
  }

  if (d.found === false) {
    return remember(key, useCache, {
      state: WITNESS.NOT_INSTALLED,
      scheduled: false,
      currentRunningState: 'not_installed',
      healthy: null,
      lastRunAt: null,
      nextRunAt: null,
      saying: t('sched.notInstalled'),
      readAt: now
    })
  }

  const disabled = String(d.state || '').toLowerCase() === 'disabled'
  const code = typeof d.lastTaskResult === 'number' && Number.isInteger(d.lastTaskResult) ? d.lastTaskResult : NaN
  const ran = ms(d.lastRunTime)
  const status = Number.isFinite(code) ? SCHED_S[code] : undefined

  let healthy
  if (status) healthy = status.healthy               // an informational status, judged by name
  else if (!Number.isFinite(code)) healthy = null    // nothing to judge
  else if (!ran) healthy = null                      // a code with no run behind it judges nothing
  else healthy = code === 0

  let saying
  if (disabled) {
    // ⛔ The quietest way for a schedule to stop: still listed, still there, never fires.
    saying = t('sched.installedButDisabled')
  } else if (status) {
    saying = status.say()
  } else if (healthy === false) {
    saying = t('sched.lastRunFailed', { code, hex: (code >>> 0).toString(16) }) +
      // ⛔ ONLY for code 1. Printing this hint under every non-zero code sent him looking at
      // user-profile visibility for failures that had nothing to do with it.
      (code === 1 ? t('sched.hint0x1') : '')
  } else if (healthy === null) {
    saying = t('sched.noResultReported')
  } else {
    saying = t('sched.healthy')
  }

  return remember(key, useCache, {
    state: disabled ? WITNESS.DISABLED : WITNESS.INSTALLED,
    scheduled: !disabled,
    currentRunningState: String(d.state).toLowerCase() === 'running' ? 'active' : disabled ? 'disabled' : String(d.state).toLowerCase() === 'ready' ? 'idle' : 'unknown',
    executionKind: 'deterministic_food_recall_check',
    usesModel: false,
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

module.exports = { readSchedulerWitness, readWindowsSchedulerWitness: () => readSchedulerWitness({exec:defaultExec,cache:false}), windowsCommand:PS, WITNESS, TASK_NAME, TTL_MS }
