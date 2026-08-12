'use strict'

/**
 * bootCommit.js — WHICH COMMIT IS ACTUALLY RUNNING.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FIFTH ENVIRONMENTAL GAP, AND THE ONE THAT REFRAMES THE OTHER FOUR.
 *
 * 2026-08-12: the node process started at 07:25:47; the fixes being verified were committed
 * at 09:13:19. **The running server predated every one of them.** A test through the real
 * endpoint reproduced the defect, and the obvious report — 「verified through the real
 * endpoint, the fix does not work」 — would have been false. Node reads the files once, at
 * start; a running server is a SNAPSHOT, and nothing in this system said which.
 *
 * > **Owner: 「『nothing in this system tells me which commit is live』 is the sharpest of them,
 * > because it means every PASS in this project's history has an unverified premise.」**
 *
 * The other four gaps were provider, lane, caller and build. Each time the layer skipped was
 * the layer that decided. This one is different in kind: it is not a wrong choice among
 * options, it is a fact nobody could observe at all.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ READ ONCE, AT MODULE LOAD, ON PURPOSE. Reading it per request would report the WORKING
 * TREE's HEAD — which is the file on disk, not the code in memory. That would be a freshness
 * claim about the past dressed as one about the present, and it would say 「match」 at exactly
 * the moment the two had diverged. The value below is what was on disk when this process
 * booted, which is the only honest answer to 「what are you running」.
 *
 * ⛔ AND IT IS NOT A VERSION. `version: '0.1.0'` in /health has never changed and never will;
 * it identifies the product, not the code. This identifies the code.
 */

const fs = require('fs')
const path = require('path')

/** Resolve HEAD without spawning git — a health endpoint may not shell out. */
function readHeadSync (repoRoot) {
  try {
    const headPath = path.join(repoRoot, '.git', 'HEAD')
    const head = fs.readFileSync(headPath, 'utf8').trim()
    if (!head.startsWith('ref:')) return /^[0-9a-f]{40}$/i.test(head) ? head : null
    const ref = head.slice(4).trim()
    const refPath = path.join(repoRoot, '.git', ref)
    if (fs.existsSync(refPath)) {
      const sha = fs.readFileSync(refPath, 'utf8').trim()
      return /^[0-9a-f]{40}$/i.test(sha) ? sha : null
    }
    // Packed refs — the ref file is absent after `git gc`.
    const packed = path.join(repoRoot, '.git', 'packed-refs')
    if (!fs.existsSync(packed)) return null
    for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
      const m = line.match(/^([0-9a-f]{40})\s+(.+)$/i)
      if (m && m[2].trim() === ref) return m[1]
    }
    return null
  } catch (_) {
    // ⛔ null, never a guess. 「I do not know what I am running」 is a usable answer;
    // a wrong hash is not.
    return null
  }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..')

/** Frozen at boot. Deliberately not re-read. */
const BOOT_COMMIT = readHeadSync(REPO_ROOT)
const BOOTED_AT = new Date().toISOString()

module.exports = { BOOT_COMMIT, BOOTED_AT, readHeadSync }
