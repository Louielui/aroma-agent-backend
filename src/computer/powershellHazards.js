'use strict'

/**
 * powershellHazards.js — the StrictMode hazards that have actually cost this project runs,
 * detected by rule instead of by memory.
 *
 * ── WHY THIS IS A MODULE AND NOT A REGEX IN A TEST ────────────────────────
 * Because the detector needs to be correct about two things that a one-line regex is not:
 *
 *   1. WHICH FILES. The previous guard held a hand-written list of four filenames under a
 *      comment claiming it was "every PowerShell script this project owns and runs". There are
 *      fifty. Operator-MeasureNotepadLaunch.ps1 was written after that list and never added to
 *      it, so it was never scanned, and it died on the exact hazard the guard exists to catch.
 *      A list somebody has to remember to update is a list that is wrong the first busy day.
 *      This module ENUMERATES THE DIRECTORY, so a new script is covered by existing.
 *
 *   2. WHICH LINE. The first version of this scan stripped comments with a plain replace, which
 *      deleted the newlines inside <# #> blocks and shifted every line number after them. It
 *      reported the hazard at "line 7" of a file whose line 7 is a comment. A guard that names
 *      the wrong line teaches people the guard is wrong. `blankComments` below keeps a strict
 *      1:1 line mapping: comment content is removed, comment LINES are not.
 *
 * ── THE HAZARD ITSELF, MEASURED ───────────────────────────────────────────
 * PowerShell unrolls a function's output on the way out. `@()` INSIDE the function does not
 * survive the return, which is what made this look fixed when it was not:
 *
 *     function F { @(Get-Process ... | Where-Object ...) }   # looks safe
 *     $x = F                                                 # 0 results -> $x is $null
 *     $x.Count                                               # THROWS under StrictMode
 *
 * Measured on PowerShell 5.1.26100.8875, StrictMode Latest:
 *
 *     results   $x type     $x.Count      @($x).Count
 *     -------   ---------   ----------    -----------
 *     0         $null       THROWS        0
 *     1         scalar      THROWS        1
 *     2+        Object[]    2             2
 *
 * ONLY THE 2+ CASE WORKS — and for a measurement whose entire purpose is to tell zero from one
 * from two, 2+ is the case that would have been wrong anyway. The fix is always to wrap at the
 * CALL SITE or at the USE SITE: `@($x).Count` is correct for null, scalar and array alike.
 */

const fs = require('node:fs')
const path = require('node:path')

/**
 * Remove comment CONTENT while preserving the line count exactly, so a reported line number is
 * the line number in the file the Owner will open.
 */
function blankComments (source) {
  const lines = source.split(/\r?\n/)
  const out = []
  let inBlock = false
  for (let line of lines) {
    if (inBlock) {
      const end = line.indexOf('#>')
      if (end >= 0) { inBlock = false; line = line.slice(end + 2) } else { out.push(''); continue }
    }
    // A <# that opens and closes on one line, then possibly another.
    let guard = 0
    for (;;) {
      const start = line.indexOf('<#')
      if (start < 0 || guard++ > 50) break
      const end = line.indexOf('#>', start + 2)
      if (end >= 0) { line = line.slice(0, start) + line.slice(end + 2) } else { line = line.slice(0, start); inBlock = true; break }
    }
    // A trailing # comment, but not one inside a string. Cheap and good enough: if the # is
    // preceded by an even number of quotes on the line, it starts a comment.
    const hash = line.indexOf('#')
    if (hash >= 0) {
      const before = line.slice(0, hash)
      const singles = (before.match(/'/g) || []).length
      const doubles = (before.match(/"/g) || []).length
      if (singles % 2 === 0 && doubles % 2 === 0) line = before
    }
    out.push(line)
  }
  return out
}

/**
 * A right-hand side whose value PASSES THROUGH THE PIPELINE and is therefore unrolled:
 * a bare command or function call, optionally parenthesised, optionally via &.
 *
 * Deliberately NOT flagged: `@(...)` (already wrapped), `$var`, literals, casts, and
 * `New-Object` — which constructs exactly one object, so it is never unrolled to null.
 */
function unrollingRhs (rhs) {
  const t = rhs.trim()
  if (!t) return false
  if (/^@\(/.test(t)) return false
  if (/^[$'"0-9[@]/.test(t)) return false
  if (/^New-Object\b/i.test(t)) return false
  return /^(?:\(\s*)?(?:&\s*)?[A-Za-z][\w-]*(?:\s|$|\)|\|)/.test(t)
}

/**
 * Find `$x = <unrolling call>` followed by `$x.Count` or `$x[...]`.
 *
 * `.Length` is deliberately NOT checked: on a string it is the correct property and wrapping
 * would break it (`@('abcd').Length` is 1, not 4). A rule that produces a wrong fix is worse
 * than no rule.
 */
function findUnrollHazards (source) {
  const lines = blankComments(source)
  const risky = new Map()
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\$([A-Za-z_]\w*)\s*=\s*(.+)$/)
    if (m && unrollingRhs(m[2])) risky.set(m[1].toLowerCase(), i + 1)
  })

  const hits = []
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\$([A-Za-z_]\w*)\s*(\.Count\b|\[)/g)) {
      const key = m[1].toLowerCase()
      if (!risky.has(key)) continue
      if (/@\(\s*$/.test(line.slice(0, m.index))) continue          // @($x).Count — already fixed
      hits.push({
        line: i + 1,
        variable: m[1],
        operation: m[2] === '[' ? 'index' : 'Count',
        assignedAtLine: risky.get(key),
        text: line.trim().slice(0, 90)
      })
    }
  })
  return hits
}

/** Indexing [0] straight off a pipeline or an @() — the earlier member of the same family. */
function findIndexHazards (source) {
  const hits = []
  blankComments(source).forEach((line, i) => {
    for (const m of line.matchAll(/(@\([^)]*\)|\)\s*)\[\s*0\s*\]/g)) {
      hits.push({ line: i + 1, operation: 'index0', text: line.trim().slice(0, 90), match: m[0] })
    }
  })
  return hits
}

/**
 * Assignment to a genuinely READ-ONLY automatic variable.
 *
 * MEASURED, not listed from memory (PowerShell 5.1.26100.8875, StrictMode Latest):
 *
 *     THROWS   $PID  $host  $true  $false  $PSVersionTable  $Error
 *     ALLOWED  $null  $args  $input  $PSScriptRoot  $PSCommandPath  $MyInvocation
 *
 * $Error is in the THROWS column on the second measurement, not the first. The first harness
 * built each assignment as a scriptblock and invoked it — which creates a CHILD SCOPE, where
 * `$Error = 1` quietly shadows instead of failing. Measuring at script scope, the way a real
 * script runs, reverses the answer. The positive control in the test caught it, which is the
 * only reason it is right here.
 *
 * The previous guard banned all of them. Seven were wrong — most importantly `$null =`, which
 * is the ordinary PowerShell null sink and appears in nearly every script in this repo. That
 * rule survived only because the guard scanned four files and none of them used it; widening
 * coverage turned it into 14 false failures immediately. A rule that fires on correct code
 * gets suppressed, and then the real rules go with it.
 */
const AUTOMATIC = Object.freeze(['PID', 'host', 'true', 'false', 'PSVersionTable', 'Error'])
function findAutomaticAssignments (source) {
  const hits = []
  blankComments(source).forEach((line, i) => {
    for (const v of AUTOMATIC) {
      if (new RegExp('\\$' + v + '\\s*=(?!=)').test(line)) hits.push({ line: i + 1, variable: v, text: line.trim().slice(0, 90) })
    }
  })
  return hits
}

/**
 * EVERY PowerShell script in the scripts directory. Enumerated, never listed.
 *
 * This is the whole point of the module: coverage cannot fall behind the repo, because there is
 * no list to fall behind with.
 */
function allScripts (dir) {
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.ps1')).sort()
}

/** Scan every script and return findings keyed by file. */
function scanAll (dir) {
  const out = {}
  for (const name of allScripts(dir)) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
    const unroll = findUnrollHazards(source)
    const index0 = findIndexHazards(source)
    const auto = findAutomaticAssignments(source)
    if (unroll.length || index0.length || auto.length) out[name] = { unroll, index0, auto }
  }
  return out
}

module.exports = {
  blankComments,
  unrollingRhs,
  findUnrollHazards,
  findIndexHazards,
  findAutomaticAssignments,
  allScripts,
  scanAll,
  AUTOMATIC
}
