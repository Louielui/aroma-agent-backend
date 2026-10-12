'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { resolveDataDir } = require('./dataDir')
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
function directory () { return path.join(resolveDataDir(), 'website-runs') }
function save (id, run) {
  if (!ID.test(id)) throw Error('invalid_run_id')
  const dir = directory(); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, id + '.json'); fs.writeFileSync(file + '.tmp', JSON.stringify({ id, ...run })); fs.renameSync(file + '.tmp', file)
}
function get (id) {
  if (!ID.test(id)) return null
  try { return JSON.parse(fs.readFileSync(path.join(directory(), id + '.json'), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
module.exports = { save, get, ID }
