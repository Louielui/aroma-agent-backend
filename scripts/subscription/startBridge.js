'use strict'

// Run as the signed-in owner. The Windows service calls this loopback-only bridge.
// No login token is copied into the service account and no API credential is used.
const fs = require('node:fs')
const path = require('node:path')
const { createBridge, DEFAULT_PORT } = require('../../src/subscription/bridge')
// This is a closed Owner read grant at host composition, not a caller option.
// The authenticated backend enforces its live READ_ACCESS flag before/after
// every source request. The bridge's dotenv file has no service-launcher flags.
function createOwnerCodeSource (repo, bootCommit) {
  return require('../../src/core/codeDiagnosis/source').createCodeSource({ root: repo, env: { READ_ACCESS: 'on' }, bootCommit })
}

function main () {
  const repo = path.resolve(__dirname, '../..')
  const env = require('dotenv').parse(fs.readFileSync(path.join(repo, '.env')))
  const executable = env.CODEX_CHAT_EXECUTABLE
  if (!executable || !path.isAbsolute(executable) || !fs.existsSync(executable)) throw new Error('Configure an absolute CODEX_CHAT_EXECUTABLE path')
  const chatExecutable = env.CODEX_CHAT_MODEL_EXECUTABLE || executable
  if (!path.isAbsolute(chatExecutable) || !fs.existsSync(chatExecutable)) throw new Error('Configure an absolute CODEX_CHAT_MODEL_EXECUTABLE path')
  const cwd = path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'AromaXiangXiang', 'subscription-chat-empty')
  fs.mkdirSync(cwd, { recursive: true })
  const { createProviders } = require('../../src/core/workerFlow/providers')
  const { createWorkflow } = require('../../src/core/workerFlow/workflow')
  const { authorizeExecution } = require('../../src/agent/agentAuthorization')
  const workerRoot = path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'AromaXiangXiang', 'worker-flow')
  const configuredRoot = env.XIANGXIANG_WORKER_WORKSPACE_ROOT
  const workspaceRoot = configuredRoot && path.isAbsolute(configuredRoot) ? configuredRoot : path.join(require('node:os').homedir(), 'Documents', 'AromaXiangXiang', 'worker-workspaces')
  const workerProviders = createProviders({ executable: chatExecutable, root: workspaceRoot, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' })
  // The new switch enables only this fixed recipe within the existing sandbox
  // worker lane. Other execution lanes still conflict through the shared matrix.
  const enabled = () => env.XIANGXIANG_WORKER_FLOW === 'on' && authorizeExecution({ worker: 'on',
    develop: env.DEVELOP_DISPATCH, agent: env.AGENT_BRIDGE, computer: env.COMPUTER_OPERATOR }).workerAuthorized
  const memoryRuntime = env.XIANGXIANG_MEMORY === 'on' ? require('../../src/memory/runtime').createRuntime({ engine: require('../../src/memory/hindsight').createHindsight({ env }),
    dir: path.join(env.AROMA_DATA_DIR || path.join(repo, 'data'), 'memory-outbox') }) : null
  const workerFlow = createWorkflow({ dir: path.join(workerRoot, 'runs'), providers: workerProviders, enabled,
    onEvent: value => memoryRuntime && memoryRuntime.event('worker', value.id + ':' + value.stage + ':' + value.at, JSON.stringify(value), 'measured_result', value.at) })
  const projectSource = require('../../src/core/projectWork/source').createSource({ root: repo })
  const projectWork = require('../../src/core/projectWork/service').createProjectWork({
    source: projectSource, providers: workerProviders, enabled,
    store: require('../../src/core/operating/runStore').createRunStore({ dir: path.join(workerRoot, 'project-runs'), workflow: 'project_work' }),
    onEvent: value => memoryRuntime && memoryRuntime.event('worker', 'project-work:' + value.id + ':' + value.stage + ':' + value.at, JSON.stringify(value), 'measured_result', value.at) })
  const repairClient = { executable: chatExecutable, cwd, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' }
  const projectAdoption = require('../../src/core/projectWork/adoption').createAdoption({ source: projectSource,
    repository: require('../../src/core/projectWork/adoptionRepository').createRepository({ root: repo, source: projectSource }),
    executor: { run: pack => workerProviders.testOrder(pack), isBusy: () => workerProviders.executionBusy() }, work: projectWork, enabled,
    isolated: id => {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id || '')) throw Error('accepted_evidence_changed')
      const file = path.join(workspaceRoot, 'isolated-coding-runs', id + '.json'), stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 5000000) throw Error('accepted_evidence_changed')
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }, store: require('../../src/core/operating/runStore').createRunStore({ dir: path.join(workerRoot, 'adoptions'), workflow: 'project_adoption' }),
    loader: require('../../src/core/projectWork/adoptionLoader').createLoader({ root: repo }),
    onEvent: value => memoryRuntime && memoryRuntime.event('worker', 'project-adoption:' + value.id + ':' + value.stage + ':' + value.at, JSON.stringify(value), 'measured_result', value.at) })
  const codexClient = require('../../src/subscription/codexClient')
  const codeRepair = require('../../src/core/codeRepair/service').createCodeRepair({ repo, root: path.join(workspaceRoot,'controlled-repairs'), store: require('../../src/core/operating/runStore').createRunStore({dir:path.join(env.AROMA_DATA_DIR || path.join(repo,'data'),'code-repair-runs'),workflow:'code_repair'}),
    provider: { preflight: options => codexClient.checkSubscription({...repairClient,...options,model:'gpt-6.1-sol',effort:'medium'}), complete: (prompt,options) => codexClient.complete({...repairClient,signal:options.signal},{prompt,system:options.system,schema:options.responseFormat.schema,model:'gpt-6.1-sol',effort:'medium'}) },
    onFinish: run => memoryRuntime ? memoryRuntime.event('worker','code-repair:'+run.id,JSON.stringify({id:run.id,state:run.state,reason:run.reason,diagnosisId:run.diagnosisId,approvalHash:run.approvalHash,patchHash:run.result?.patchHash || null,tests:run.tests?{tests:run.tests.tests,pass:run.tests.pass,fail:run.tests.fail}:null,sourceRevision:run.source?.revision,appliedToLive:false}),'measured_result',run.finishedAt) : {state:'not_connected'} })
  const server = createBridge({ token: env.CODEX_CHAT_BRIDGE_TOKEN, clientOptions: { executable: chatExecutable, cwd, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' }, memoryClientOptions: { executable, cwd, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' }, workerFlow, workerProviders, websiteEnabled: env.XIANGXIANG_WEBSITE_FLOW === 'on', memoryEnabled: env.XIANGXIANG_MEMORY === 'on',
    memoryStore: require('../../src/memory/structuredStore').createStructuredStore({ local: true }),
    taskPlanSource: require('../../src/core/taskPlanner/source').createSource({ root: repo }), codeSourceFactory: bootCommit => createOwnerCodeSource(repo, bootCommit), codeRepair, projectWork, projectAdoption })
  server.on('error', () => { console.error('Subscription bridge could not listen on its loopback port.'); process.exitCode = 1 })
  server.listen(DEFAULT_PORT, '127.0.0.1', () => console.log('Xiangxiang subscription bridge ready on loopback.'))
}
if (require.main === module) main()
module.exports = { main, createOwnerCodeSource }
