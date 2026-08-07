'use strict'

/**
 * rootUntouched.helper.js — TEST HELPER (not a Phase 1 module; not in the `MODULES` purity list).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS: three tests asserted the wrong thing and were right for a year.
 *
 * They asserted `fs.existsSync('C:\Aroma\ComputerOperator-Test') === false`, meaning
 * **「this code created nothing」**. Absence was a PROXY for that claim, and the proxy was true
 * only because nothing else had ever created the folder.
 *
 * Then the Owner-approved canary provisioning created it — deliberately, with its own ACL, in
 * a different repo. The proxy went false. **The underlying claim never did:** the code under
 * test still creates nothing, and still cannot, since none of those modules may require `fs`.
 *
 * Deleting the folder would make the tests pass by destroying the evidence they were written
 * to protect. Deleting the ASSERTION would make them pass by giving up the guarantee.
 *
 * So: assert the claim. Snapshot the root, run the code, assert the snapshot is IDENTICAL.
 * That holds whether the canary folder exists or not — and, unlike the original, it would also
 * catch this code WRITING INTO a folder that already exists, which absence never could.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('node:fs')

/**
 * A comparable description of a path's state: whether it exists, and what is directly in it.
 * @param {string} p
 * @returns {string} e.g. `absent` or `dir:0` or `dir:2[a.txt,b.txt]`
 */
function snapshotRoot (p) {
  if (!fs.existsSync(p)) return 'absent'
  let st
  try { st = fs.statSync(p) } catch (e) { return 'unreadable:' + e.code }
  if (!st.isDirectory()) return 'file:' + st.size
  let entries
  try { entries = fs.readdirSync(p).sort() } catch (e) { return 'dir-unreadable:' + e.code }
  return 'dir:' + entries.length + (entries.length ? '[' + entries.join(',') + ']' : '')
}

module.exports = { snapshotRoot }
