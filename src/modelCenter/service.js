'use strict'
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { TOPICS } = require('../topics/workspaces'), { isValidId } = require('../store/conversationStore')
const { isBrainModel, REASONING_EFFORTS } = require('../subscription/chatModels')
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === keys.slice().sort().join(',')
const validChoice = v => v && isBrainModel(v.model) && REASONING_EFFORTS.includes(v.effort)
const rev = v => Number.isInteger(v) && v >= 0
function createModelCenter ({ dataDir, catalogue, topicForConversation = () => null }) {
  const file = path.join(dataDir, 'model-center.json')
  const fresh = () => ({ version: 1, revision: 0, brain: { model: 'claude-sonnet', effort: 'medium' }, scopes: {}, audit: [] })
  function key (kind, id) {
    if (kind === 'topic' ? !TOPICS.includes(id) : kind !== 'conversation' || !isValidId(id)) throw Error('invalid_scope')
    return kind + ':' + id
  }
  function read () {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!exact(d, ['version', 'revision', 'brain', 'scopes', 'audit']) || d.version !== 1 || !rev(d.revision) || !exact(d.brain, ['model', 'effort']) || !validChoice(d.brain) || !d.scopes || typeof d.scopes !== 'object' || Array.isArray(d.scopes) || Object.keys(d.scopes).length > 2000 || !Array.isArray(d.audit)) throw Error()
      for (const [scope, s] of Object.entries(d.scopes)) {
        const [kind, id] = scope.split(':'); if (key(kind, id) !== scope || !rev(s.revision) || !['central', 'custom'].includes(s.mode) || !exact(s, s.mode === 'central' ? ['mode', 'revision'] : ['mode', 'revision', 'model', 'effort']) || s.mode === 'custom' && !validChoice(s)) throw Error()
      }
      return d
    } catch (e) { if (e.code === 'ENOENT') return fresh(); throw Error('model_settings_unavailable') }
  }
  function write (d, event) {
    d.audit.push({ ...event, actor: 'owner', at: new Date().toISOString() })
    fs.mkdirSync(dataDir, { recursive: true }); const tmp = file + '.tmp-' + randomUUID()
    try { const fd = fs.openSync(tmp, 'wx'); try { fs.writeFileSync(fd, JSON.stringify(d)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; fs.renameSync(tmp, file) }
    catch (_) { try { fs.unlinkSync(tmp) } catch (_) {}; throw Error('model_settings_unavailable') }
  }
  async function validateChoice (input) {
    if (!validChoice(input)) throw Error('invalid_model_selection')
    const row = (await catalogue()).models?.find(r => r.model === input.model && r.available === true)
    if (!row || (row.supportsEffort === false ? input.effort !== 'auto' : !row.efforts?.includes(input.effort))) throw Error('model_selection_unavailable')
  }
  function selection (kind, id) {
    const scope = key(kind, id), d = read(), s = d.scopes[scope] || { mode: 'central', revision: 0 }
    return { scope: { kind, id }, ...s, centralRevision: d.revision, effective: s.mode === 'central' ? { ...d.brain } : { model: s.model, effort: s.effort } }
  }
  async function saveBrain (input, context = {}) {
    if (!exact(input, ['revision', 'model', 'effort']) || !rev(input.revision)) throw Error('invalid_request')
    await validateChoice(input); const d = read()
    if (d.revision !== input.revision) throw Error('revision_conflict')
    const before = { ...d.brain }; d.brain = { model: input.model, effort: input.effort }; d.revision++
    if (context.investigationId && !require('../core/operating/runStore').ID.test(context.investigationId)) throw Error('invalid_request')
    write(d, { scope: 'brain', revision: d.revision, before, after: d.brain, ...(context.investigationId ? { investigationId: context.investigationId } : {}) })
    const actual = read()
    if (actual.revision !== d.revision || actual.brain.model !== input.model || actual.brain.effort !== input.effort) throw Error('model_settings_unavailable')
    return actual
  }
  async function saveSelection (kind, id, input) {
    const scope = key(kind, id)
    if (!exact(input, input?.mode === 'central' ? ['revision', 'mode'] : ['revision', 'mode', 'model', 'effort']) || !rev(input.revision) || !['central', 'custom'].includes(input.mode)) throw Error('invalid_request')
    if (input.mode === 'custom') await validateChoice(input)
    const d = read(), before = d.scopes[scope] || { mode: 'central', revision: 0 }
    if (before.revision !== input.revision) throw Error('revision_conflict')
    if (!d.scopes[scope] && Object.keys(d.scopes).length >= 2000) throw Error('settings_capacity')
    d.scopes[scope] = { ...input, revision: before.revision + 1 }; write(d, { scope, revision: before.revision + 1, before, after: d.scopes[scope] })
    return selection(kind, id)
  }
  function resolveConversation (id) {
    const topic = topicForConversation(id), s = selection(topic ? 'topic' : 'conversation', topic || id)
    return Object.freeze({ ...s.effective })
  }
  return { read, selection, saveBrain, saveSelection, resolveConversation }
}
module.exports = { createModelCenter }
