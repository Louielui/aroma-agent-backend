'use strict'

/**
 * store.js — Aroma truth store (M1).
 *
 * Faithful JS implementation of Wall-E's DB-003 contract (Decision / Task /
 * Event / llm-usage), backed by a JSON file so data survives restarts without
 * any native module (better-sqlite3 needs a Windows build; this does not).
 *
 * When Aroma moves to Docker, Wall-E's TypeScript+SQLite hub can replace this
 * with the SAME contract — no caller changes (Principle 4: capability, not vendor).
 */

const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')

const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
const DATA_FILE = path.join(DATA_DIR, 'aroma-truth.json')

function load () {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    return { decisions: [], tasks: [], events: [], llm_usage: [], dispatches: [] }
  }
}
function save (db) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

/** Persist a distilled intake: Decision + Tasks + Events, atomically. */
function persistIntake ({ understanding, decision, tasks = [], provenance = {} }) {
  const db = load()
  const now = new Date().toISOString()

  const decisionId = 'dec_' + uuidv4().slice(0, 8)
  const storedDecision = {
    id: decisionId,
    statement: decision?.statement || understanding || '',
    rationale: decision?.rationale || '',
    provenance: {
      proposed_by: provenance.proposed_by || 'louie',
      source: provenance.source || 'homepage-intake',
      approved_by: provenance.approved_by || null,
      decided_at: now
    },
    data_class: 'operational',
    status: 'active'
  }
  db.decisions.push(storedDecision)
  db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'decision.created', entity_id: decisionId, actor: 'louie', at: now })

  const storedTasks = tasks.map((t) => {
    const taskId = 'task_' + uuidv4().slice(0, 8)
    const task = { id: taskId, title: t.title || '', note: t.note || '', decision_id: decisionId, state: 'todo', created_at: now }
    db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'task.created', entity_id: taskId, actor: 'louie', at: now })
    return task
  })
  db.tasks.push(...storedTasks)

  save(db)
  return { decision_id: decisionId, task_ids: storedTasks.map((t) => t.id), decision: storedDecision, tasks: storedTasks }
}

/** Record LLM usage — metrics ONLY. Any content/secret fields are dropped. */
function recordLLMUsage (metrics = {}) {
  const db = load()
  db.llm_usage.push({
    id: 'usg_' + uuidv4().slice(0, 8),
    model: metrics.model || 'unknown',
    request_count: 1,
    latency_ms: metrics.latencyMs || 0,
    estimated_tokens: metrics.totalTokens || 0,
    blocked: !!metrics.blocked,
    at: new Date().toISOString()
    // message content / api key are intentionally never accepted here
  })
  save(db)
  return { ok: true }
}

function listDecisions () { return load().decisions }
function listTasks () { return load().tasks }
function listEvents () { return load().events.slice(-50).reverse() }
function usageSummary () {
  const u = load().llm_usage
  return {
    request_count: u.length,
    estimated_tokens: u.reduce((s, x) => s + (x.estimated_tokens || 0), 0),
    by_model: u.reduce((m, x) => { m[x.model] = (m[x.model] || 0) + 1; return m }, {})
  }
}

// ---- Dispatch state machine persistence ----
function createDispatch (d) {
  const db = load()
  if (!db.dispatches) db.dispatches = []
  const now = new Date().toISOString()
  const dispatch = {
    id: 'dsp_' + uuidv4().slice(0, 8),
    task_id: d.task_id,
    decision_id: d.decision_id || null,
    capability: d.capability || 'ops',
    worker_id: d.worker_id,
    worker_name: d.worker_name,
    worker_role: d.worker_role || null,
    status: d.status || 'queued',
    result: null,
    error: null,
    created_at: now,
    updated_at: now
  }
  db.dispatches.push(dispatch)
  db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'dispatch.created', entity_id: dispatch.id, actor: 'aroma', at: now })
  save(db)
  return dispatch
}

function updateDispatch (id, patch) {
  const db = load()
  const d = (db.dispatches || []).find(x => x.id === id)
  if (!d) return null
  Object.assign(d, patch, { updated_at: new Date().toISOString() })
  if (patch.status) {
    db.events.push({ id: 'evt_' + uuidv4().slice(0, 8), type: 'dispatch.' + patch.status, entity_id: id, actor: 'aroma', at: new Date().toISOString() })
    // reflect terminal states on the task
    const task = (db.tasks || []).find(t => t.id === d.task_id)
    if (task) {
      if (patch.status === 'completed') task.state = 'done'
      else if (patch.status === 'running') task.state = 'in_progress'
    }
  }
  save(db)
  return d
}

function listDispatches () { return (load().dispatches || []).slice().reverse() }
function getDispatch (id) { return (load().dispatches || []).find(x => x.id === id) || null }

module.exports = { persistIntake, recordLLMUsage, listDecisions, listTasks, listEvents, usageSummary, createDispatch, updateDispatch, listDispatches, getDispatch }
