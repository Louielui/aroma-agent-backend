'use strict'

// Run as the signed-in owner. The Windows service calls this loopback-only bridge.
// No login token is copied into the service account and no API credential is used.
const fs = require('node:fs')
const path = require('node:path')
const { createBridge, DEFAULT_PORT } = require('../../src/subscription/bridge')

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
  const workerProviders = createProviders({ executable, root: workspaceRoot })
  // The new switch enables only this fixed recipe within the existing sandbox
  // worker lane. Other execution lanes still conflict through the shared matrix.
  const enabled = () => env.XIANGXIANG_WORKER_FLOW === 'on' && authorizeExecution({ worker: 'on',
    develop: env.DEVELOP_DISPATCH, agent: env.AGENT_BRIDGE, computer: env.COMPUTER_OPERATOR }).workerAuthorized
  const memoryRuntime = env.XIANGXIANG_MEMORY === 'on' ? require('../../src/memory/runtime').createRuntime({ engine: require('../../src/memory/hindsight').createHindsight({ env }),
    dir: path.join(env.AROMA_DATA_DIR || path.join(repo, 'data'), 'memory-outbox') }) : null
  const workerFlow = createWorkflow({ dir: path.join(workerRoot, 'runs'), providers: workerProviders, enabled,
    onEvent: value => memoryRuntime && memoryRuntime.event('worker', value.id + ':' + value.stage + ':' + value.at, JSON.stringify(value), 'measured_result', value.at) })
  const server = createBridge({ token: env.CODEX_CHAT_BRIDGE_TOKEN, clientOptions: { executable: chatExecutable, cwd, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' }, memoryClientOptions: { executable, cwd, allowCredits: env.CODEX_CHAT_ALLOW_CREDITS === 'true' }, workerFlow, workerProviders, websiteEnabled: env.XIANGXIANG_WEBSITE_FLOW === 'on', memoryEnabled: env.XIANGXIANG_MEMORY === 'on',
    memoryStore: require('../../src/memory/structuredStore').createStructuredStore({ local: true }),
    codeSourceFactory: bootCommit => require('../../src/core/codeDiagnosis/source').createCodeSource({ root: repo, env, bootCommit }) })
  server.on('error', () => { console.error('Subscription bridge could not listen on its loopback port.'); process.exitCode = 1 })
  server.listen(DEFAULT_PORT, '127.0.0.1', () => console.log('Xiangxiang subscription bridge ready on loopback.'))
}
if (require.main === module) main()
module.exports = { main }
