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
  const cwd = path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'AromaXiangXiang', 'subscription-chat-empty')
  fs.mkdirSync(cwd, { recursive: true })
  const server = createBridge({ token: env.CODEX_CHAT_BRIDGE_TOKEN, clientOptions: { executable, cwd } })
  server.on('error', () => { console.error('Subscription bridge could not listen on its loopback port.'); process.exitCode = 1 })
  server.listen(DEFAULT_PORT, '127.0.0.1', () => console.log('Xiangxiang subscription bridge ready on loopback.'))
}
if (require.main === module) main()
module.exports = { main }
