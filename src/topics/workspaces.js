'use strict'
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { isValidId } = require('../store/conversationStore')
const TOPICS = Object.freeze(['briefing', 'documents', 'operations', 'calendar', 'email', 'development', 'plans', 'tasks', 'workers', 'memory', 'connections', 'access', 'architecture'])
const STATES = Object.freeze(['todo', 'doing', 'done'])
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === keys.slice().sort().join(',')
const text = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0)
const validSource = s => s === null || exact(s, ['mailbox', 'messageId']) && ['owner', 'admin'].includes(s.mailbox) && /^[A-Za-z0-9_-]{1,100}$/.test(s.messageId)
function createTopicStore ({ dataDir }) {
  const file = path.join(dataDir, 'topic-workspaces.json')
  function topic (id) { if (!TOPICS.includes(id)) throw Error('invalid_topic'); return id }
  const fresh = () => ({ version: 1, topics: {} })
  const empty = () => ({ conversationIds: [], lastConversationId: null, notes: [] })
  function read () {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!exact(d, ['version', 'topics']) || d.version !== 1 || !d.topics || typeof d.topics !== 'object' || Array.isArray(d.topics)) throw Error()
      const seen = new Set()
      for (const [key, r] of Object.entries(d.topics)) {
        if (!TOPICS.includes(key) || !exact(r, ['conversationIds', 'lastConversationId', 'notes']) || !Array.isArray(r.conversationIds) || r.conversationIds.length > 1000 || new Set(r.conversationIds).size !== r.conversationIds.length || r.conversationIds.some(id => !isValidId(id) || seen.has(id)) || r.lastConversationId !== null && !r.conversationIds.includes(r.lastConversationId) || !Array.isArray(r.notes) || r.notes.length > 100) throw Error()
        for (const id of r.conversationIds) seen.add(id)
        for (const n of r.notes) if (!exact(n, ['id', 'requestId', 'title', 'nextStep', 'source', 'origin', 'state', 'revision', 'createdAt', 'updatedAt']) || !isValidId(n.id) || !isValidId(n.requestId) || !text(n.title, 160) || !text(n.nextStep, 600, true) || !validSource(n.source) || n.origin !== 'owner_note' || !STATES.includes(n.state) || !Number.isInteger(n.revision) || n.revision < 1 || !Number.isFinite(Date.parse(n.createdAt)) || !Number.isFinite(Date.parse(n.updatedAt))) throw Error()
      }
      return d
    } catch (e) { if (e.code === 'ENOENT') return fresh(); throw Error('topic_store_unavailable') }
  }
  function write (d) {
    fs.mkdirSync(dataDir, { recursive: true })
    const tmp = file + '.tmp-' + randomUUID()
    try { const fd = fs.openSync(tmp, 'wx'); try { fs.writeFileSync(fd, JSON.stringify(d)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }; fs.renameSync(tmp, file) }
    catch (_) { try { fs.unlinkSync(tmp) } catch (_) {}; throw Error('topic_store_unavailable') }
  }
  const get = id => structuredClone(read().topics[topic(id)] || empty())
  function link (id, cid) {
    topic(id); if (!isValidId(cid)) throw Error('invalid_request')
    const d = read()
    for (const [key, row] of Object.entries(d.topics)) if (key !== id && row.conversationIds.includes(cid)) throw Error('topic_conflict')
    const r = d.topics[id] ||= empty()
    if (!r.conversationIds.includes(cid)) { if (r.conversationIds.length >= 1000) throw Error('workspace_capacity'); r.conversationIds.push(cid) }
    r.lastConversationId = cid; write(d); return structuredClone(r)
  }
  function createNote (id, input) {
    topic(id)
    if (!exact(input, ['requestId', 'title', 'nextStep', 'source']) || !isValidId(input.requestId) || !text(input.title, 160) || !text(input.nextStep, 600, true) || !validSource(input.source) || input.source && id !== 'email') throw Error('invalid_request')
    const d = read(), r = d.topics[id] ||= empty()
    const old = r.notes.find(n => n.requestId === input.requestId)
    if (old) { if (old.title !== input.title || old.nextStep !== input.nextStep || JSON.stringify(old.source) !== JSON.stringify(input.source)) throw Error('request_conflict'); return structuredClone(old) }
    if (r.notes.length >= 100) throw Error('workspace_capacity')
    const at = new Date().toISOString(), n = { id: randomUUID(), ...input, origin: 'owner_note', state: 'todo', revision: 1, createdAt: at, updatedAt: at }
    r.notes.push(n); write(d); return structuredClone(n)
  }
  function updateNote (id, noteId, input) {
    topic(id)
    if (!isValidId(noteId) || !exact(input, ['revision', 'state', 'nextStep']) || !Number.isInteger(input.revision) || !STATES.includes(input.state) || !text(input.nextStep, 600, true)) throw Error('invalid_request')
    const d = read(), r = d.topics[id], n = r?.notes.find(n => n.id === noteId)
    if (!n) throw Error('note_not_found'); if (n.revision !== input.revision) throw Error('revision_conflict')
    Object.assign(n, { state: input.state, nextStep: input.nextStep, revision: n.revision + 1, updatedAt: new Date().toISOString() }); write(d); return structuredClone(n)
  }
  return { get, link, createNote, updateNote }
}
module.exports = { TOPICS, STATES, createTopicStore }
