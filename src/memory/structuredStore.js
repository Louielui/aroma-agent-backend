'use strict'
const path = require('node:path')
const { spawn } = require('node:child_process')
const { isTestProcess } = require('../testProcess')
function createStructuredStore({ invoke } = {}) {
  const run = invoke || (request => new Promise((resolve, reject) => {
    if (isTestProcess()) return reject(Error('memory_database_test_fence'))
    const child = spawn('C:/Aroma/hindsight-runtime/Scripts/python.exe', ['-X', 'utf8', path.join(__dirname, '../../scripts/memory/structured.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let raw = ''; let failed = false
    const timeout = setTimeout(() => { failed = true; child.kill(); reject(Error('memory_database_unavailable')) }, 15000)
    child.stdout.on('data', chunk => { raw += chunk; if (raw.length > 64000000) { failed = true; child.kill() } })
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timeout); reject(Error('memory_database_unavailable')) })
    child.on('close', code => {
      clearTimeout(timeout)
      if (failed || code) return reject(Error('memory_database_unavailable'))
      try { const value = JSON.parse(raw); if (value.error) reject(Error(value.error)); else resolve(value.result) } catch (_) { reject(Error('memory_database_unavailable')) }
    })
    child.stdin.end(JSON.stringify(request))
  }))
  return {
    get: id => run({ op: 'get', id }),
    all: async () => {
      const rows = []
      for (let offset = 0; ; offset += 200) {
        const page = await run({ op: 'all', offset })
        rows.push(...page)
        if (page.length < 200) return rows
      }
    },
    commit: (changes, event) => run({ op: 'commit', changes, event }),
    audit: id => run({ op: 'audit', id }),
    grants: () => run({ op: 'grants' }),
    grant: value => run({ op: 'grant', value }),
    health: () => run({ op: 'health' })
  }
}
// Injected only by tests. Runtime has no file or in-memory fallback for canonical data.
function createTestStore() {
  const rows = new Map(); const events = []; const grants = new Map()
  return {
    get: async id => structuredClone(rows.get(id) || null), all: async () => structuredClone([...rows.values()]),
    commit: async (changes, event) => {
      for (const c of changes) if ((rows.get(c.row.id)?.version || 0) !== c.expected) throw Error('revision_conflict')
      const next = new Map(rows)
      for (const c of changes) next.set(c.row.id, structuredClone(c.row))
      const active = [...next.values()].filter(r => r.status === 'active' && r.type === 'decision')
      if (new Set(active.map(r => r.scope + ':' + r.subject)).size !== active.length) throw Error('decision_conflict')
      for (const c of changes) { rows.set(c.row.id, structuredClone(c.row)); events.push({ ...event, recordId: c.row.id, version: c.row.version, sequence: events.length + 1 }) }
      return changes.map(c => structuredClone(c.row))
    },
    audit: async id => structuredClone(events.filter(e => e.recordId === id)),
    grants: async () => structuredClone([...grants.values()]),
    grant: async g => { grants.set(g.id, structuredClone(g)); return g },
    health: async () => ({ state: 'connected', database: 'test', vector: true })
  }
}
module.exports = { createStructuredStore, createTestStore }
