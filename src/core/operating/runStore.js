'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveDataDir } = require('../../store/dataDir')
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const copy = v => v == null ? null : structuredClone(v)
function createMemoryRunStore () {
  const rows = new Map()
  return { all: () => [...rows.values()].map(copy), get: id => copy(rows.get(id)), save: r => rows.set(r.id, copy(r)) }
}
function createRunStore ({ dir, workflow = 'daily_briefing' } = {}) {
  if (!['daily_briefing', 'development_proposal', 'code_diagnosis', 'code_repair', 'project_work', 'project_adoption', 'task_plan', 'project_task', 'dialogue_request', 'investigation'].includes(workflow)) throw Error('invalid_workflow')
  if (dir === undefined) dir = path.join(resolveDataDir(), { daily_briefing: 'manager-runs', development_proposal: 'development-plan-runs', code_diagnosis: 'code-diagnosis-runs', code_repair: 'code-repair-runs', project_work: 'project-work-runs', project_adoption: 'project-adoption-runs', task_plan: 'task-plan-runs', project_task: 'project-task-runs', dialogue_request: 'dialogue-requests', investigation: 'investigation-runs' }[workflow])
  function get (id) {
    if (!ID.test(id || '')) throw Error('invalid_run_id')
    try {
      const row = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'))
      if (!row || row.id !== id || row.workflow !== workflow || !Array.isArray(row.steps) || !Array.isArray(row.sections)) throw Error('invalid_run')
      return row
    } catch (e) { if (e.code === 'ENOENT') return null; throw Error('run_store_unavailable') }
  }
  function all () {
    let names
    try { names = fs.readdirSync(dir) } catch (e) { if (e.code === 'ENOENT') return []; throw Error('run_store_unavailable') }
    return names.filter(n => n.endsWith('.json') && ID.test(n.slice(0, -5))).map(n => get(n.slice(0, -5)))
  }
  function save (row) {
    if (!ID.test(row.id || '')) throw Error('invalid_run_id')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, row.id + '.json'); const tmp = file + '.' + randomUUID() + '.tmp'
    try { fs.writeFileSync(tmp, JSON.stringify(row), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file) }
    catch (_) { try { fs.unlinkSync(tmp) } catch (_) {} throw Error('run_store_unavailable') }
  }
  return { all, get, save }
}
module.exports = { createRunStore, createMemoryRunStore, ID }
