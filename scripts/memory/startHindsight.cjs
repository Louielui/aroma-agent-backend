'use strict'
// Run under the local owner. Python packages and data are separate from the backend.
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const repo = path.resolve(__dirname, '../..')
const cfg = require('dotenv').parse(fs.readFileSync(process.argv.includes('--acceptance') ? 'C:/Aroma/hindsight-runtime/acceptance.env' : path.join(repo, '.env')))
const privateCfg = JSON.parse(fs.readFileSync('C:/Aroma/hindsight-runtime/local-config.json', 'utf8'))
if (cfg.XIANGXIANG_MEMORY !== 'on' || !cfg.CODEX_CHAT_BRIDGE_TOKEN || !cfg.HINDSIGHT_TOKEN) throw Error('memory_not_configured')
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(OPENAI|ANTHROPIC|HINDSIGHT)_/.test(key)) delete env[key]
Object.assign(env, {
  PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  HINDSIGHT_API_LLM_PROVIDER: 'openai', HINDSIGHT_API_LLM_MODEL: 'gpt-6-astra',
  HINDSIGHT_API_LLM_BASE_URL: process.argv.includes('--acceptance') ? 'http://127.0.0.1:8094/v1' : 'http://127.0.0.1:8091/v1', HINDSIGHT_API_LLM_API_KEY: cfg.CODEX_CHAT_BRIDGE_TOKEN,
  HINDSIGHT_API_LLM_MAX_CONCURRENT: '1', HINDSIGHT_API_LLM_MAX_RETRIES: '0', HINDSIGHT_API_LLM_TIMEOUT: '120',
  HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION: 'false', HINDSIGHT_API_ENABLE_TEMPORAL_RETRIEVAL: 'false',
  HINDSIGHT_API_DATABASE_URL: 'pg0://hindsight:' + privateCfg.dbPassword + '@xiangxiang-memory',
  HINDSIGHT_API_TENANT_EXTENSION: 'hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension',
  HINDSIGHT_API_TENANT_API_KEY: cfg.HINDSIGHT_TOKEN,
  HINDSIGHT_API_EMBEDDINGS_PROVIDER: 'local', HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  HINDSIGHT_API_RERANKER_PROVIDER: 'local', HINDSIGHT_API_RERANKER_LOCAL_MODEL: 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1',
  HINDSIGHT_API_WORKER_ID: 'xiangxiang-memory-local', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1'
})
const child = spawn('C:/Aroma/hindsight-runtime/Scripts/hindsight-api.exe', ['--host', '127.0.0.1', '--port', '8888', '--log-level', 'warning'], { cwd: 'C:/Aroma/hindsight-runtime', env, windowsHide: true, stdio: 'inherit' })
child.on('exit', code => { process.exitCode = code || 0 })
child.on('error', () => { console.error('Hindsight runtime failed to start.'); process.exitCode = 1 })
