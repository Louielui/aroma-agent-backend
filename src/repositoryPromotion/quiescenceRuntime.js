'use strict'
const { AsyncLocalStorage, createHook } = require('node:async_hooks')
const SLOT = Symbol.for('aroma.deploymentQuiescence.runtime')
function createRuntime ({ gate, participant, requiredInspectors = [] }) {
  const storage = new AsyncLocalStorage(), promises = new Map(), scopes = new Set()
  const inspectors = new Map()
  let muted = 0, closed = false, writing = 0, untrackedWrites = 0
  function control (fn) { muted++; try { return fn() } finally { muted-- } }
  function retry (fn) {
    for (let i = 0; ; i++) {
      try { return control(fn) } catch (e) {
        if (e.message !== 'gate_busy' || i >= 200) throw e
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
      }
    }
  }
  function settle (s) {
    if (!s.finished && s.done && s.promises === 0 && s.holds === 0) {
      retry(() => s.lease.finish()); s.finished = true; scopes.delete(s)
    }
  }
  const hook = createHook({
    init (id, type) {
      const s = storage.getStore()
      if (!muted && type === 'PROMISE' && s && !s.finished) { s.promises++; promises.set(id, s) }
    },
    promiseResolve (id) { const s = promises.get(id); if (s) { promises.delete(id); s.promises--; settle(s) } }
  }).enable()
  function run (operation, { parentId = null, kind = 'work', forceRoot = false } = {}) {
    if (closed) return Promise.reject(Error('runtime_closed'))
    const inherited = storage.getStore()
    if (!forceRoot && inherited && !inherited.finished) { try { return Promise.resolve(operation(inherited)) } catch (e) { return Promise.reject(e) } }
    let lease
    try { lease = retry(() => gate.admit(participant, parentId)) } catch (e) { return Promise.reject(e) }
    const s = { lease, kind, done: false, finished: false, promises: 0, holds: 0 }
    scopes.add(s)
    let result
    try { result = storage.run(s, () => operation(s)) } catch (e) { s.done = true; settle(s); return Promise.reject(e) }
    return storage.exit(() => Promise.resolve(result).then(value => { s.done = true; settle(s); return value }, error => { s.done = true; settle(s); throw error }))
  }
  function call (operation, { parentId = null, kind = 'work', forceRoot = false } = {}) {
    if (closed) throw Error('runtime_closed')
    const inherited = storage.getStore()
    if (!forceRoot && inherited && !inherited.finished) return operation(inherited)
    const s = { lease: retry(() => gate.admit(participant, parentId)), kind, done: false, finished: false, promises: 0, holds: 0 }
    scopes.add(s)
    try { return storage.run(s, () => operation(s)) } finally { s.done = true; settle(s) }
  }
  function hold (s = storage.getStore()) {
    if (!s || s.finished) throw Error('writer_not_admitted')
    s.holds++; let released = false
    return () => { if (!released) { released = true; s.holds--; settle(s) } }
  }
  function write (operation) {
    if(writing)return operation()
    const guarded=()=>{writing++;try{return operation()}finally{writing--}}
    const s = storage.getStore()
    if (s && !s.finished) return retry(() => s.lease.write(guarded))
    // Synchronous writers cannot escape the common fence even without an HTTP
    // scope. Unknown detached admission still prevents a coverage PASS.
    const lease = retry(() => gate.admit(participant))
    untrackedWrites++
    try { return retry(() => lease.write(guarded)) } finally { retry(() => lease.finish()) }
  }
  function enter (s, operation) { if (s.finished) throw Error('writer_not_admitted'); return storage.run(s, operation) }
  function close () { closed = true; hook.disable() }
  function registerInspector(name,inspect){if(typeof inspect!=='function')throw Error('invalid_idle_inspector');if(!inspectors.has(name))inspectors.set(name,[]);inspectors.get(name).push(inspect)}
  function inspectIdle(){
    if(scopes.size||untrackedWrites||requiredInspectors.some(name=>!inspectors.has(name)))return{idle:false,reason:'writers_or_inspectors_pending'}
    try{for(const inspect of [...inspectors.values()].flat()){const r=inspect();if(r?.idle!==true||typeof r.then==='function')return{idle:false,reason:'pending_work'}}}catch(_){return{idle:false,reason:'inspection_unavailable'}}
    return{idle:true}
  }
  function acknowledge(){return retry(()=>gate.acknowledge(participant,inspectIdle))}
  return { participant, untracked:()=>untrackedWrites, registerInspector, inspectIdle, acknowledge, run, call, write, hold, enter, current: () => { const s=storage.getStore();return s&&!s.finished?s:null }, status: () => retry(() => gate.status()), control, close,
    active: () => [...scopes].map(s => ({ id: s.lease.id, kind: s.kind, promises: s.promises, holds: s.holds, done: s.done })) }
}
function current () { return globalThis[SLOT] || null }
function install (runtime) { if (current()) throw Error('runtime_already_installed'); globalThis[SLOT] = runtime; return () => { delete globalThis[SLOT] } }
function operation (fn) { const r = current(); return r ? r.run(fn) : fn() }
module.exports = { createRuntime, current, install, operation }
