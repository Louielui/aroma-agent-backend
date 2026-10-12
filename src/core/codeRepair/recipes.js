'use strict'
const { t } = require('../../i18n/t')
const { hash } = require('./contract')
// Exact reviewed executable inputs. Models can select enum recipes; they never
// supply JavaScript, tests, paths or shell commands to this v1 execution lane.
const BASE_DIGESTS = Object.freeze({
 'src/core/developmentPlan/service.js':'3942249d9b9f3187bde830952059174a008cc0fcebf815e186966c014fa60571',
 'src/core/operating/runStore.js':'fc58c33f6131b6329fcd652291840a104f986ada8e6922fa0f9036e243bcd8f1',
 'src/capability/dispatcher.js':'095141c9746ecc14967518ed5a4160da0137e270b92f57c00826427f14939844',
 'src/capability/agents.js':'cb308eb51d95f49b371fb9afecf78f5e6299c2381d4c5be00ca1d97cf4f5547b',
 'src/capability/registry.js':'dd8f19aa7efc0d75865d1cdd1a68726270762771cb459907229a5e91aa60d2a7',
 'src/capability/adapter.js':'239350bb0c45c56cdfae36304292a4811799a214e659444a3a7ef4e8e65554dc',
 'src/capability/policy.js':'64ec664444be1a77ea78da615900f4e7172c2bc46a770bfe4b1d85c592804895',
 'src/context/githubContext.js':'6cb8c262aebdefb5fcfa57c16c096a7efa3ff0ed0f6950de40cd7fd6a3e0ea91',
 'src/context/contextResult.js':'7555c7ad5bfbc906319e45a83572fb4e865c392ba1e599c41800da8e2796e539',
 'src/context/adapters/githubRead.js':'35b1851334626b6d04ace873170e162d32bf4f785aef1ec6fb94a2e57c9bfcce',
 'src/subscription/codexClient.js':'43fcf6cc9cf0b7c5e254bd5bec7f69b51090a4a2ea30098bc677a9ed7a43da7d',
 'src/subscription/chatModels.js':'e6b8ef626a728db767e75f58d5eb10d2bc63e2be61d062cf1a3566b46a05ace5',
 'src/adapters/liveEgressFence.js':'e8d5e9a2072cf7b41a757effb613ddaaf1a1dc1475a643f878fba53ddc3701e5',
 'src/store/dataDir.js':'db1c34ba01897a085cee9d84eb71685ad3dd1f2012fc14f1d0fb74b922a88610',
 'src/testProcess.js':'ff1261a1b1b72fc694bb8d2351b80de026c47f7400a470465190b78736fa7c56'
})
const RECIPES = Object.freeze([
 { id:'planner-terminal-once', title:t('repair.recipePlanner'), files:['src/core/developmentPlan/service.js'], effect:'Discard late provider results and hold the busy slot until an uncooperative provider settles.' },
 { id:'workflow-default-directories', title:t('repair.recipeDirectories'), files:['src/core/operating/runStore.js'], effect:'Keep manager-runs and explicit directories compatible. Latent default-interface defect; live app already supplies separate directories.' },
 { id:'unknown-cost-telemetry', title:t('repair.recipeCost'), files:['src/capability/dispatcher.js','src/capability/agents.js'], effect:'Null remains unknown. Numeric averages count only measured cost observations.' }
])
function replace (text, before, after) { if (text.split(before).length !== 2) throw Error('recipe_source_changed'); return text.replace(before,after) }
function replacement (file, text) {
 if (hash(text) !== BASE_DIGESTS[file]) throw Error('recipe_source_changed')
 if (file === 'src/core/developmentPlan/service.js') {
  text=replace(text,"    const check = () => { if (control.abort.signal.aborted) throw Error(control.reason || 'cancelled'); owner({ id: 'owner', role: 'owner' }) }",`    const check = () => { if (control.abort.signal.aborted) throw Error(control.reason || 'cancelled'); owner({ id: 'owner', role: 'owner' }) }
    const awaitStep = async call => {
      check(); let listener
      const pending = Promise.resolve().then(() => { check(); return call() }); control.inflight.add(pending)
      pending.then(() => control.inflight.delete(pending), () => control.inflight.delete(pending))
      const stopped = new Promise((resolve, reject) => { listener = () => reject(Error(control.reason || 'cancelled')); control.abort.signal.addEventListener('abort', listener, { once: true }) })
      try { const value = await Promise.race([pending, stopped]); check(); return value } finally { control.abort.signal.removeEventListener('abort', listener) }
    }`)
  text=replace(text,'await provider.preflight({ signal: control.abort.signal }); check()', 'await awaitStep(() => provider.preflight({ signal: control.abort.signal })); check()')
  text=replace(text,"await source.read({ id: 'owner', role: 'owner' }, { refresh: true }); check()\n      const evidence", "await awaitStep(() => source.read({ id: 'owner', role: 'owner' }, { refresh: true })); check()\n      const evidence")
  text=replace(text,"await provider.complete(JSON.stringify({ workOrder: WORK_ORDER, evidence }), { system: SYSTEM, signal: control.abort.signal, responseFormat: { type: 'json_schema', name: 'development_proposal', schema: PROPOSAL_SCHEMA } }); check()", "await awaitStep(() => provider.complete(JSON.stringify({ workOrder: WORK_ORDER, evidence }), { system: SYSTEM, signal: control.abort.signal, responseFormat: { type: 'json_schema', name: 'development_proposal', schema: PROPOSAL_SCHEMA } })); check()")
  text=replace(text,"await source.read({ id: 'owner', role: 'owner' }, { refresh: true }); check()\n      const matched", "await awaitStep(() => source.read({ id: 'owner', role: 'owner' }, { refresh: true })); check()\n      const matched")
  const begin=text.indexOf("    const control = { abort: new AbortController(), reason: null }; controls.set(run.id, control)"),end=text.indexOf('    return structuredClone(rows.get(run.id))',begin)
  if(begin<0||end<begin)throw Error('recipe_source_changed')
  text=text.slice(0,begin)+`    const control = { abort: new AbortController(), reason: null, inflight: new Set() }; controls.set(run.id, control)
    const timer = setTimeout(() => { control.reason = 'timed_out'; control.abort.abort() }, timeoutMs)
    control.promise = execute(run, control).finally(() => {
      clearTimeout(timer)
      const release = () => { if (activeId === run.id) activeId = null; controls.delete(run.id) }
      if (control.inflight.size) Promise.allSettled([...control.inflight]).then(release)
      else release()
    })
`+text.slice(end)
 } else if(file==='src/core/operating/runStore.js') {
  text=replace(text,"function createRunStore ({ dir = path.join(resolveDataDir(), 'manager-runs'), workflow = 'daily_briefing' } = {}) {", "function createRunStore ({ dir, workflow = 'daily_briefing' } = {}) {")
  text=replace(text,'  function get (id) {', "  if (dir === undefined) dir = path.join(resolveDataDir(), { daily_briefing: 'manager-runs', development_proposal: 'development-plan-runs', code_diagnosis: 'code-diagnosis-runs' }[workflow])\n  function get (id) {")
 } else if(file==='src/capability/dispatcher.js') {
  text=text.replaceAll('result.cost','provenCost')
  text=replace(text,'cost: Number.isFinite(cost) ? cost : 0,','cost: Number.isFinite(cost) ? cost : null,')
  text=replace(text,'        lastCost = 0','        lastCost = null')
  text=replace(text,'success: false, latencyMs: 0, cost: 0','success: false, latencyMs: 0, cost: null')
 } else if(file==='src/capability/agents.js') {
  text=replace(text,'      cost: 0,','      cost: null,\n      cost_samples: 0,')
  text=replace(text,'  record.cost += (event.cost - record.cost) / n',`  if (Number.isFinite(event.cost)) {
    record.cost_samples++
    record.cost = record.cost_samples === 1 ? event.cost : record.cost + (event.cost - record.cost) / record.cost_samples
  }`)
 }
 return text
}
function reviewed (packet) { if(!packet || packet.files.length!==Object.keys(BASE_DIGESTS).length)throw Error('recipe_source_changed'); for(const f of packet.files)if(f.sha256!==BASE_DIGESTS[f.path]||hash(f.content)!==f.sha256)throw Error('recipe_source_changed'); return true }
module.exports = { BASE_DIGESTS, RECIPES, replacement, reviewed }
