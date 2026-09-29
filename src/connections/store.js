'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')
function createStore ({ dir = path.join(resolveDataDir(), 'connections') } = {}) {
  const file = path.join(dir, 'status.json')
  return {
    load () { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (!s || typeof s !== 'object' || Array.isArray(s)) throw Error('invalid_store'); return s } catch (e) { if (e.code === 'ENOENT') return {}; throw Error('connection_store_unavailable') } },
    save (state) { fs.mkdirSync(dir, { recursive: true }); const tmp = file + '.' + randomUUID() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state), { flag: 'wx' }); fs.renameSync(tmp, file) },
    event (e) {
      fs.mkdirSync(path.join(dir, 'events'), { recursive: true })
      const row = { id: randomUUID(), actor: 'owner', at: e.at, source: e.source, action: e.action, state: e.state || null, count: Number.isInteger(e.count) ? e.count : null }
      fs.writeFileSync(path.join(dir, 'events', row.id + '.json'), JSON.stringify(row), { flag: 'wx' })
    }
  }
}
module.exports = { createStore }
