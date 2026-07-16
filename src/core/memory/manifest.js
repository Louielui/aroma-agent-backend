'use strict'

/**
 * manifest — read-only snapshot seam for a future Guardian backup.
 *
 * A snapshot is identified by a `generation` = SHA-256 over the canonical list of
 * (relative artifact path, hash). Because artifacts are append-only and written
 * atomically, existing artifacts are immutable: a concurrent write only ADDS new
 * artifacts (a later generation) and never mutates a captured one. So a captured
 * generation is a consistent boundary WITHOUT freezing writes. Guardian copies
 * exactly the listed artifacts and re-verifies their hashes; a differing
 * generation means the store advanced and Guardian should re-snapshot.
 *
 * M1 does NOT implement backup — it only exposes this seam. Paths are relative
 * (no absolute/user paths leak).
 */

const fs = require('fs')
const path = require('path')
const { canonicalize, sha256Hex } = require('./canonical')
const { storeDir, loadRevisions, loadEvents, listRecordIds } = require('./store')

function collectArtifacts (baseDir, store) {
  const arts = []
  for (const recordId of listRecordIds(baseDir, store)) {
    for (const r of loadRevisions(baseDir, store, recordId)) {
      const relPath = path.posix.join('records', recordId, `${r.revisionId}.json`)
      if (r.__unreadable) arts.push({ relPath, kind: 'revision', unreadable: true })
      else arts.push({ relPath, kind: 'revision', hash: r.contentHash })
    }
    const { events, corrupt } = loadEvents(baseDir, store, recordId)
    for (const e of events) arts.push({ relPath: path.posix.join('events', recordId, `${e.eventId}.json`), kind: 'event', hash: e.eventHash })
    for (const badId of corrupt) arts.push({ relPath: path.posix.join('events', recordId, `${badId}.json`), kind: 'event', unreadable: true })
  }
  arts.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  return arts
}

function getStoreManifest (baseDir, store) {
  const artifacts = collectArtifacts(baseDir, store)
  const generation = sha256Hex(canonicalize(artifacts.map((a) => ({ p: a.relPath, h: a.hash || null, u: !!a.unreadable }))))
  const counts = {
    total: artifacts.length,
    revisions: artifacts.filter((a) => a.kind === 'revision').length,
    events: artifacts.filter((a) => a.kind === 'event').length,
    unreadable: artifacts.filter((a) => a.unreadable).length
  }
  return { store, root: storeDir(baseDir, store), generation, artifacts, counts }
}

// A snapshot boundary Guardian can copy against. Same shape as the manifest plus
// an explicit contract note. No write freeze required (append-only + atomic).
function beginSnapshot (baseDir, store) {
  const m = getStoreManifest(baseDir, store)
  return {
    store,
    generation: m.generation,
    artifacts: m.artifacts,
    counts: m.counts,
    contract: 'copy exactly these artifacts then re-verify each hash; a changed generation means re-snapshot'
  }
}

module.exports = { getStoreManifest, beginSnapshot, collectArtifacts }
