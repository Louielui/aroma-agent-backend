'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveDataDir } = require('../../store/dataDir')

// One exclusive-create file per event: no overwritten audit or stored source text.
function createActivityStore ({ dir = path.join(resolveDataDir(), 'manager-activity'), workflow = 'daily_briefing', reason = 'owner_requested_briefing' } = {}) {
  function append (entry) {
    const event = { id: randomUUID(), runId: entry.runId, sequence: entry.sequence,
      at: entry.at, actor: entry.actor, workflow, reason,
      agent: entry.agent || null, model: null, tool: entry.tool || null,
      source: entry.source || null, layer: entry.layer || null, action: 'read',
      approval: 'not_required', result: entry.result, count: Number.isInteger(entry.count) ? entry.count : null }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, event.id + '.json'), JSON.stringify(event), { flag: 'wx' })
    return event
  }
  function list () {
    let files
    try { files = fs.readdirSync(dir) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    return files.filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (!e || typeof e.id !== 'string' || typeof e.at !== 'string' || typeof e.runId !== 'string') throw Error('activity_unreadable')
      return e
    }).sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence).slice(0, 100)
  }
  return { append, list }
}
module.exports = { createActivityStore }
