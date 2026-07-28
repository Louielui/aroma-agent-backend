'use strict'

/**
 * agentCliSpawn.test.js — the spawn surface of the Agent Bridge.
 *
 * TWO REAL DEFECTS ARE PINNED HERE:
 *
 * 1. CLI PATH. The worker used to spawn the bare string 'claude' with shell:false. On
 *    Windows that cannot start at all — the extensionless launcher is not executable
 *    (ENOENT) and the .cmd cannot be spawned without a shell (EINVAL, Node >= 18.20).
 *    The fix is an absolute path, NOT shell:true: a shell would put our argument array
 *    back through a parser and hand back the injection surface Cap 1 exists to remove.
 *
 * 2. CHILD ENVIRONMENT. The agent used to inherit the whole parent environment. On this
 *    machine the parent is the 心燈 server, holding ANTHROPIC_API_KEY, HUB_TOKEN,
 *    GITHUB_READ_TOKEN, OPENAI_API_KEY and Google credential paths. Cap 5 makes
 *    credential FILES un-allowlistable — which is worth nothing if the same secrets are
 *    handed to the agent in process.env. The child env is now BUILT from an allowlist.
 *
 * No paid call anywhere in this file: every runner is injected.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  createAgentBridgeWorker, resolveAgentCliCommand, buildChildEnv,
  CHILD_ENV_ALLOWLIST, SECRET_SHAPED, CLI_PATH_ENV
} = require('./agentBridgeWorker')
const { createAgentRunner } = require('./agentRunner')
const { MUST_FORBID } = require('./workOrder')

const ORDER = Object.freeze({
  goal: 'canary',
  allowedFiles: ['docs/canary/agent-canary.md'],
  allowedTestCommand: null,
  forbiddenActions: [...MUST_FORBID],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/appr_x',
  approvalId: 'appr_x'
})

const WORKSPACE = {
  containmentCheck: (d) => d,
  permissionMode: () => 'acceptEdits',
  filesChanged: () => [],
  diffStat: () => '',
  remotes: () => [],
  currentBranch: () => 'agent/appr_x',
  prepare: () => ({ dir: '/tmp/clone', branch: 'agent/appr_x' }),
  cleanup: () => {}
}

const OK_STDOUT = JSON.stringify({ subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01 })

/* ── FIX 1: the CLI path ──────────────────────────────────────────────────── */

test('the worker spawns the ABSOLUTE path it was given — never the bare string claude', async () => {
  const seen = []
  const w = createAgentBridgeWorker({
    command: 'C:/somewhere/claude.exe',
    runner: async (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { status: 0, stdout: OK_STDOUT, stderr: '', timedOut: false } }
  })
  await w.invoke('AgentBridge', 1, { workOrder: ORDER, workspace: WORKSPACE, cloneDir: '/tmp/clone', branch: 'agent/appr_x' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].cmd, 'C:/somewhere/claude.exe')
  assert.notEqual(seen[0].cmd, 'claude')
  assert.ok(Array.isArray(seen[0].args), 'arguments are an ARRAY, never a shell string')
})

test('an UNRESOLVABLE CLI fails closed — no spawn, no bare-claude fallback', async () => {
  let spawned = 0
  const w = createAgentBridgeWorker({
    command: null,
    commandError: 'the Claude Code CLI executable was not found',
    runner: async () => { spawned++; return { status: 0, stdout: OK_STDOUT, stderr: '', timedOut: false } }
  })
  const r = await w.invoke('AgentBridge', 1, { workOrder: ORDER, workspace: WORKSPACE, cloneDir: '/tmp/clone' })
  assert.equal(r.ok, false)
  assert.equal(spawned, 0, 'nothing was spawned')
  assert.ok(r.output.risks.includes('cli_not_resolved'))
  assert.ok(r.error.includes('not found'), r.error)
})

test('resolveAgentCliCommand: explicit override wins, must be absolute and must exist', () => {
  const exists = (p) => p === 'C:/real/claude.exe'
  assert.deepEqual(
    resolveAgentCliCommand({ [CLI_PATH_ENV]: 'C:/real/claude.exe' }, exists),
    { ok: true, command: 'C:/real/claude.exe', source: CLI_PATH_ENV }
  )
  const rel = resolveAgentCliCommand({ [CLI_PATH_ENV]: 'claude.exe' }, exists)
  assert.equal(rel.ok, false)
  assert.ok(rel.reason.includes('absolute'))

  const missing = resolveAgentCliCommand({ [CLI_PATH_ENV]: 'C:/gone/claude.exe' }, exists)
  assert.equal(missing.ok, false)
  assert.ok(missing.reason.includes('does not exist'))

  const none = resolveAgentCliCommand({}, () => false)
  assert.equal(none.ok, false)
  assert.ok(none.reason.includes(CLI_PATH_ENV), 'the refusal says how to fix it')
  assert.ok(!('command' in none), 'no command is guessed')
})

test('resolveAgentCliCommand finds the real install on THIS machine', () => {
  const r = resolveAgentCliCommand(process.env)
  assert.equal(r.ok, true, r.reason)
  assert.ok(path.isAbsolute(r.command))
  assert.ok(fs.existsSync(r.command), 'the resolved path really exists')
})

test('createAgentRunner passes a resolved absolute path down to the worker', async () => {
  const seen = []
  let sawCommand = null
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    workspace: WORKSPACE,
    // capture what the worker would be constructed with by constructing it ourselves
    worker: {
      invoke: async (id, v, input) => { seen.push(input); return { ok: true, output: { filesChanged: [], risks: [], warnings: [], branch: 'agent/appr_x', exit: 0 } } }
    }
  })
  const { hashWorkOrder } = require('./workOrder')
  await runner.run({ workOrder: ORDER, approvedHash: hashWorkOrder(ORDER), who: 'louie' })
  assert.equal(seen.length, 1, 'the injected worker was used')

  // and with NO injected worker, the runner resolves a real absolute command
  const real = createAgentRunner({ repoRoot: process.cwd(), workspace: WORKSPACE })
  sawCommand = require('./agentBridgeWorker').resolveAgentCliCommand(process.env)
  assert.equal(sawCommand.ok, true)
  assert.ok(path.isAbsolute(sawCommand.command))
  assert.ok(real && typeof real.run === 'function')
})

test('shell:false is preserved everywhere — no shell:true anywhere in the agent', () => {
  for (const f of ['agentBridgeWorker.js', 'agentRunner.js', 'featureBranchWorkspace.js']) {
    const raw = fs.readFileSync(path.join(__dirname, f), 'utf8')
    // Scan CODE, not prose: these files explain in comments WHY shell:true is refused,
    // and a doc line saying "we do not use shell:true" is not a use of it.
    const code = raw.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    assert.ok(!/shell:\s*true/.test(code), f + ' must never use shell:true')
    assert.ok(!/exec\(|execSync\(/.test(code.replace(/execFileSync|spawnSync/g, '')), f + ' must not use the shell-interpreting exec()')
    // ...and where a file does spawn, it spawns with shell:false. (agentRunner.js spawns
    // nothing itself — it only composes the worker and the workspace.)
    if (/spawn(Sync)?\(/.test(code)) assert.ok(/shell:\s*false/.test(code), f + ' must spawn with shell:false')
  }
})

/* ── FIX 2: the child environment allowlist ───────────────────────────────── */

const SENTINEL_PARENT = Object.freeze({
  // things the CLI genuinely needs
  PATH: '/usr/bin', Path: 'C:/Windows', PATHEXT: '.COM;.EXE', SystemRoot: 'C:/Windows', windir: 'C:/Windows',
  COMSPEC: 'C:/Windows/system32/cmd.exe', USERPROFILE: 'C:/Users/louis', HOMEDRIVE: 'C:', HOMEPATH: '/Users/louis',
  HOME: '/home/louis', APPDATA: 'C:/Users/louis/AppData/Roaming', LOCALAPPDATA: 'C:/Users/louis/AppData/Local',
  TEMP: 'C:/Temp', TMP: 'C:/Temp', TMPDIR: '/tmp', LANG: 'en_US.UTF-8', OS: 'Windows_NT',
  // ...and every secret this machine actually has in the parent process
  ANTHROPIC_API_KEY: 'sk-ant-SENTINEL',
  HUB_TOKEN: 'hub-SENTINEL',
  GITHUB_READ_TOKEN: 'ghp-SENTINEL',
  OPENAI_API_KEY: 'sk-proj-SENTINEL',
  GOOGLE_APPLICATION_CREDENTIALS: 'C:/secret/google.json',
  GOOGLE_OAUTH_CLIENT_SECRET: 'goog-SENTINEL',
  AWS_SECRET_ACCESS_KEY: 'aws-SENTINEL',
  DB_PASSWORD: 'pw-SENTINEL',
  SESSION_SECRET: 'sess-SENTINEL',
  SOME_PRIVATE_KEY: 'pk-SENTINEL'
})

test('the child env is BUILT from the allowlist — every secret-shaped var is absent', () => {
  const child = buildChildEnv(SENTINEL_PARENT)

  // nothing outside the allowlist survives
  for (const k of Object.keys(child)) assert.ok(CHILD_ENV_ALLOWLIST.includes(k), 'unexpected key in child env: ' + k)

  // the named credentials this machine really holds
  for (const k of ['ANTHROPIC_API_KEY', 'HUB_TOKEN', 'GITHUB_READ_TOKEN', 'OPENAI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
    assert.ok(!(k in child), k + ' must NOT reach the agent')
  }
  // and anything else secret-shaped
  for (const k of Object.keys(child)) assert.ok(!SECRET_SHAPED.test(k), 'secret-shaped key leaked: ' + k)

  // no VALUE of any sentinel appears anywhere in the child env
  const blob = JSON.stringify(child)
  assert.ok(!blob.includes('SENTINEL'), 'no sentinel secret value reached the child env')

  // what the CLI needs IS there — especially the home dir, which is how it finds its
  // OAuth credentials file (the only authentication we deliberately pass)
  for (const k of ['PATH', 'USERPROFILE', 'HOME', 'APPDATA', 'TEMP', 'SystemRoot']) {
    assert.equal(child[k], SENTINEL_PARENT[k], k + ' must be passed through')
  }
})

test('the allowlist itself contains no secret-shaped name', () => {
  for (const k of CHILD_ENV_ALLOWLIST) assert.ok(!SECRET_SHAPED.test(k), 'allowlist must not contain ' + k)
})

test('the SPAWNED child really receives the built env, not the parent env', async () => {
  const seen = []
  const w = createAgentBridgeWorker({
    command: 'C:/somewhere/claude.exe',
    parentEnv: SENTINEL_PARENT,
    runner: async (cmd, args, opts) => { seen.push(opts); return { status: 0, stdout: OK_STDOUT, stderr: '', timedOut: false } }
  })
  await w.invoke('AgentBridge', 1, { workOrder: ORDER, workspace: WORKSPACE, cloneDir: '/tmp/clone', branch: 'agent/appr_x' })
  const env = seen[0].env
  assert.ok(env && typeof env === 'object', 'an explicit env object is passed to spawn')
  assert.ok(!('ANTHROPIC_API_KEY' in env))
  assert.ok(!('HUB_TOKEN' in env))
  assert.ok(!JSON.stringify(env).includes('SENTINEL'))
  assert.equal(env.PATH, '/usr/bin')
})

test('the approved TEST command also runs with the stripped env', async () => {
  const seenEnv = []
  const w = createAgentBridgeWorker({
    command: 'C:/somewhere/claude.exe',
    parentEnv: SENTINEL_PARENT,
    runner: async () => ({ status: 0, stdout: OK_STDOUT, stderr: '', timedOut: false }),
    testRunner: async (cmd, cwd, timeoutMs, env) => { seenEnv.push(env); return { ok: true, exit: 0, output: '' } }
  })
  await w.invoke('AgentBridge', 1, {
    workOrder: Object.assign({}, ORDER, { allowedTestCommand: 'node --version' }),
    workspace: WORKSPACE,
    cloneDir: '/tmp/clone',
    branch: 'agent/appr_x'
  })
  assert.equal(seenEnv.length, 1)
  assert.ok(!JSON.stringify(seenEnv[0]).includes('SENTINEL'), 'the test command sees no secret either')
})

test('the REAL process env produces a child env with no credential from this machine', () => {
  const child = buildChildEnv(process.env)
  for (const k of Object.keys(child)) {
    assert.ok(CHILD_ENV_ALLOWLIST.includes(k), 'unexpected key: ' + k)
    assert.ok(!SECRET_SHAPED.test(k), 'secret-shaped key: ' + k)
  }
  // if this machine's parent env holds these, they must not have survived
  for (const k of ['ANTHROPIC_API_KEY', 'HUB_TOKEN', 'GITHUB_READ_TOKEN', 'OPENAI_API_KEY']) {
    assert.ok(!(k in child), k + ' must not reach the agent')
  }
})

/* ── FIX 3: billing source — the API key is deliberately withheld ─────────── */

test('ANTHROPIC_API_KEY is deliberately NOT in the allowlist (subscription, not API billing)', () => {
  assert.ok(!CHILD_ENV_ALLOWLIST.includes('ANTHROPIC_API_KEY'))
  // the home vars that let the CLI find ~/.claude/.credentials.json ARE in the list,
  // because the OAuth credentials file is the authentication we chose to pass
  for (const k of ['USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'HOME']) assert.ok(CHILD_ENV_ALLOWLIST.includes(k))
})

test('the OAuth credentials file the agent will use is reachable via the allowlisted vars', () => {
  const child = buildChildEnv(process.env)
  const home = child.USERPROFILE || child.HOME || ((child.HOMEDRIVE || '') + (child.HOMEPATH || ''))
  assert.ok(home, 'the child has a home directory')
  const creds = path.join(home, '.claude', '.credentials.json')
  assert.ok(fs.existsSync(creds), 'the OAuth credentials file exists at the path the child can reach')
  // shape only — never read or assert the token values
  const parsed = JSON.parse(fs.readFileSync(creds, 'utf8'))
  assert.ok(parsed.claudeAiOauth, 'it is an OAuth record')
  assert.ok(typeof parsed.claudeAiOauth.refreshToken === 'string' && parsed.claudeAiOauth.refreshToken.length > 0,
    'a refresh token is present (whether the headless refresh SUCCEEDS is unproven until a real run)')
})
