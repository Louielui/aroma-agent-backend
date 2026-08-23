'use strict'

/**
 * runtimeContract.test.js — THE SERVICE AND THE LAUNCHER MUST BE THE SAME ASSISTANT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE.
 *
 * The installed service declared FOUR environment values. The launcher running production sets
 * TWENTY-ONE. The nineteen-key gap was every read flag — READ_ACCESS, all six CONTEXT_*,
 * GOAL_DECOMPOSER, A4_KNOWLEDGE_ROUTING — plus the provider, the model pin and the port. A
 * service booted from that config would have passed /health and been a different assistant, and
 * nothing in the system would have said so.
 *
 * ⛔ SO EQUALITY IS KEY-BY-KEY, NOT 「most of them」. Missing keys, extra keys and changed values
 * are each their own failure, because each is a different way of quietly becoming something
 * else.
 *
 * ⛔ AND THE LAUNCHER IS PARSED WITH COMMENTS STRIPPED. Line 124 of the launcher body is a
 * COMMENTED-OUT `$env:CLAUDE_MODEL = 'claude-opus-5'`. A naive grep reads it as the live value
 * and reports the wrong model — that already happened once during the audit that produced this
 * file. Strip first, scan after.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test scripts/service/runtimeContract.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const contract = require('./runtimeContract')
const { STABLE_ENV, INSTALL_TIME_REQUIRED, FORBIDDEN_ENV, FORBIDDEN_PATHS, PRODUCTION_REPO } = contract
const { checkInstallTimeEnv, preflightReport } = require('./serviceEnvPreflight')
const entry = require('./xiangxiang-service-entry')

const REPO = path.resolve(__dirname, '..', '..')
const LAUNCHER = path.join(REPO, 'scripts', 'launcher', 'xiangxiang-body.ps1')
const CLIENT = path.join(REPO, 'scripts', 'launcher', 'xiangxiang-client.ps1')
const XML = path.join(__dirname, 'AromaXiangXiangBackend.v2.xml')
const TEMPLATE = path.join(__dirname, 'service.env.template')

/** ⛔ COMMENTS ARE NOT CODE — see the header. */
const psCode = (p) => fs.readFileSync(p, 'utf8')
  .replace(/<#[\s\S]*?#>/g, '')
  .split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n')

/** ⛔ AND NEITHER ARE XML COMMENTS. The v2 XML documents the superseded install in prose; the
 *  effective configuration is what is left once that prose is removed. */
const xmlCode = () => fs.readFileSync(XML, 'utf8').replace(/<!--[\s\S]*?-->/g, '')

/** The launcher's live literal assignments — last write wins, as PowerShell would. */
function launcherContract () {
  const code = psCode(LAUNCHER)
  const out = new Map()
  const re = /\$env:([A-Z_0-9]+)\s*=\s*'([^']*)'/g
  let m
  while ((m = re.exec(code))) out.set(m[1], m[2])
  return out
}

describe('the service runs the same assistant as the launcher', () => {
  test('*** ⛔ EXACT KEY SET — no missing key, no extra key ***', () => {
    const live = launcherContract()
    const ours = Object.keys(STABLE_ENV).sort()
    const theirs = [...live.keys()].sort()
    assert.deepEqual(ours, theirs,
      '⛔ contract drift.\n  only in service: ' + ours.filter((k) => !live.has(k)).join(',') +
      '\n  only in launcher: ' + theirs.filter((k) => !(k in STABLE_ENV)).join(','))
  })

  test('*** ⛔ EXACT VALUES — key by key ***', () => {
    const live = launcherContract()
    for (const [k, v] of live) {
      assert.equal(STABLE_ENV[k], v, '⛔ ' + k + ': launcher=' + v + ' service=' + STABLE_ENV[k])
    }
  })

  test('*** ⛔ THE PORT IS 8090, NOT THE APPLICATION DEFAULT ***', () => {
    // src/index.js is `process.env.PORT || 8081`. The superseded service set no PORT at all,
    // so it would have bound 8081 beside a launcher holding 8090 — two live assistants and no
    // collision to notice. This is why PORT is a contract value and not a default.
    assert.equal(STABLE_ENV.PORT, '8090')
    assert.match(fs.readFileSync(path.join(REPO, 'src', 'index.js'), 'utf8'), /process\.env\.PORT \|\| 8081/)
  })

  test('*** ⛔ THE COMMENTED-OUT MODEL LINE IS NOT READ AS LIVE ***', () => {
    const raw = fs.readFileSync(LAUNCHER, 'utf8')
    assert.ok(/#\s*\$env:CLAUDE_MODEL\s*=\s*'claude-opus-5'/.test(raw), 'the commented line still exists to be misread')
    assert.equal(STABLE_ENV.CLAUDE_MODEL, 'claude-haiku-4-5-20251001', '⛔ a comment was read as configuration')
  })
})

describe('secrets and the canary stay out of git', () => {
  test('*** ⛔ INSTALL-TIME KEYS ARE NOT IN THE COMMITTED CONTRACT ***', () => {
    for (const k of INSTALL_TIME_REQUIRED) {
      assert.equal(k in STABLE_ENV, false, '⛔ ' + k + ' was canonicalised into committed truth')
    }
  })

  test('*** ⛔ CLAUDE_CHAT_MODEL IS INSTALL-TIME, AND IS IN NO TRACKED FILE AS A VALUE ***', () => {
    assert.ok(INSTALL_TIME_REQUIRED.includes('CLAUDE_CHAT_MODEL'))
    // It is an intentional uncommitted launcher canary; the committed body must not carry it.
    assert.equal(fs.readFileSync(LAUNCHER, 'utf8').includes('CLAUDE_CHAT_MODEL'), false,
      '⛔ the canary reached the committed launcher body')
    for (const f of [XML, TEMPLATE]) {
      const t = fs.readFileSync(f, 'utf8')
      assert.equal(/CLAUDE_CHAT_MODEL\s*=\s*\S/.test(t), false, '⛔ a value was written for the canary in ' + path.basename(f))
    }
  })

  test('*** ⛔ THE TEMPLATE IS KEYS ONLY — every required key present, every value empty ***', () => {
    const lines = fs.readFileSync(TEMPLATE, 'utf8').split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
    assert.deepEqual(lines.map((l) => l.split('=')[0].trim()).sort(), [...INSTALL_TIME_REQUIRED].sort())
    for (const l of lines) {
      assert.equal(l.split('=').slice(1).join('=').trim(), '', '⛔ a value was committed: ' + l.split('=')[0])
    }
  })

  test('*** ⛔ NO CREDENTIAL-SHAPED LITERAL IN ANY SERVICE ARTEFACT ***', () => {
    const files = [XML, TEMPLATE, path.join(__dirname, 'runtimeContract.js'),
      path.join(__dirname, 'serviceEnvPreflight.js'), path.join(__dirname, 'xiangxiang-service-entry.js'), CLIENT]
    // sk- keys, Google client ids, long base64/hex runs that are not the forbidden commit we name.
    const shapes = [/sk-[A-Za-z0-9_-]{16,}/, /AIza[A-Za-z0-9_-]{20,}/, /\b[A-Za-z0-9+/]{40,}={0,2}\b/]
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8').split(FORBIDDEN_PATHS[0]).join('<superseded-commit>')
      for (const re of shapes) {
        const hit = t.match(re)
        assert.equal(hit, null, '⛔ credential-shaped literal in ' + path.basename(f) + ': ' + (hit && hit[0].slice(0, 12)))
      }
    }
  })
})

describe('the v2 service config owns the production tree and nothing else', () => {
  test('*** ⛔ THE SUPERSEDED INSTALL APPEARS IN NO EFFECTIVE CONFIG ***', () => {
    // The XML explains the old install in PROSE on purpose — that is how the next person
    // learns why this one looks the way it does. What must be absent is the CONFIGURATION.
    const eff = xmlCode()
    for (const p of FORBIDDEN_PATHS) {
      assert.equal(eff.includes(p), false, '⛔ superseded path is live config, not prose: ' + p)
    }
    assert.equal(/<env name="(AROMA_DATA_DIR|AROMA_ARTIFACT_DIR|AROMA_PROCESS_ROLE)"/.test(eff), false,
      '⛔ the old service relocated the application; v2 must not')
    assert.equal(/8081/.test(eff), false, '⛔ the 8081 default reappeared')
  })

  test('*** ⛔ IT RUNS THE HEADLESS SEAM FROM THE PRODUCTION REPO ***', () => {
    const eff = xmlCode()
    const SEAM = [PRODUCTION_REPO, 'scripts', 'service', 'xiangxiang-service-entry.js'].join(String.fromCharCode(92))
    assert.ok(eff.includes('<arguments>' + SEAM + '</arguments>'), '⛔ the service does not run the headless seam')
    assert.ok(eff.includes('<workingdirectory>' + PRODUCTION_REPO + '</workingdirectory>'), '⛔ cwd is not the production repo')
    assert.equal(PRODUCTION_REPO, String.raw`C:\Aroma\aroma-agent-backend`)
    // Not src/index.js directly: the seam is what fails closed before the app is required.
    assert.equal(eff.includes(String.fromCharCode(92) + 'src' + String.fromCharCode(92) + 'index.js</arguments>'), false, '⛔ the XML bypasses the fail-closed seam')
  })

  test('*** ⛔ ACCOUNT, START MODE AND BOUNDED RESTART ***', () => {
    const eff = xmlCode()
    assert.match(eff, /<user>LocalService<\/user>/)
    assert.match(eff, /<startmode>Automatic<\/startmode>/)
    assert.match(eff, /<delayedAutoStart\s*\/>/)
    assert.match(eff, /<logpath>/)
    const restarts = (eff.match(/<onfailure action="restart"/g) || []).length
    assert.equal(restarts, 5, 'five escalating restarts')
    // ⛔ WinSW REPEATS THE LAST onfailure FOREVER. Without a closing action="none" a broken
    // build restarts all night and the failure is invisible behind a service that looks alive.
    assert.match(eff, /<onfailure action="none"\s*\/>/, '⛔ unbounded restart loop')
  })

  test('*** ⛔ THE ONLY <env> IN THE XML IS A NON-SECRET POINTER ***', () => {
    const names = [...xmlCode().matchAll(/<env name="([A-Z_]+)"/g)].map((m) => m[1])
    assert.deepEqual(names, ['AROMA_SERVICE_ENV_FILE'],
      '⛔ a second source of truth for runtime values: ' + names.join(','))
  })
})

describe('boot identity survives the ownership change', () => {
  test('*** ⛔ bootCommit STILL COMES FROM .git, AND IS NEVER HARDCODED ***', () => {
    const { readHeadSync } = require(path.join(REPO, 'src', 'governance', 'bootCommit.js'))
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svc2-boot-'))
    const sha = 'a'.repeat(40)
    fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    fs.writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'main'), sha + '\n')
    assert.equal(readHeadSync(dir), sha, 'the ordinary mechanism resolves from the tree it runs in')

    // ⛔ AND AN UNREADABLE IDENTITY IS null, NEVER A GUESS. 「I do not know what I am running」
    // is a usable answer; a plausible wrong hash is not.
    assert.equal(readHeadSync(fs.mkdtempSync(path.join(os.tmpdir(), 'svc2-nogit-'))), null)

    // No service artefact may substitute a commit for that mechanism.
    for (const f of ['runtimeContract.js', 'serviceEnvPreflight.js', 'xiangxiang-service-entry.js']) {
      const code = fs.readFileSync(path.join(__dirname, f), 'utf8')
      assert.equal(/BOOT_COMMIT\s*=|bootCommit\s*[:=]\s*['"][0-9a-f]{40}/.test(code), false,
        '⛔ ' + f + ' assigns a boot identity instead of letting the repo answer')
    }
  })

  test('the service points at a tree that HAS a .git identity to read', () => {
    // Not the pinned immutable release the old service used — that tree carries no .git, so
    // /health would have reported bootCommit:null and the whole deploy discipline would have
    // gone quiet without failing.
    assert.ok(xmlCode().includes('<workingdirectory>' + PRODUCTION_REPO + '</workingdirectory>'), '⛔ cwd is not a tree with a .git identity')
    assert.equal(xmlCode().includes('releases'), false)
  })
})

describe('production identity cannot be redirected from the environment', () => {
  test('*** ⛔ AMBIENT AROMA_SERVICE_REPO CANNOT MOVE THE SERVICE ***', () => {
    // This used to be honoured. Anything able to set a machine or service environment variable
    // could then point the resident service at another tree, and ANY directory containing
    // src/index.js would boot under production's identity, reporting whatever bootCommit that
    // tree carried. A test seam is not worth an ambient redirect of production identity.
    const alt = path.resolve(REPO, '..', 'x44')      // a real sibling worktree with src/index.js
    const hasEntry = fs.existsSync(path.join(alt, 'src', 'index.js'))
    const saved = process.env.AROMA_SERVICE_REPO
    process.env.AROMA_SERVICE_REPO = alt
    try {
      assert.equal(entry.resolveRepo().root, PRODUCTION_REPO,
        '⛔ the environment redirected production identity')
      // and the alternate really is a bootable-looking tree, so this is not a vacuous pass
      assert.equal(hasEntry, true, 'the alternate tree genuinely contains src/index.js')
    } finally {
      if (saved === undefined) delete process.env.AROMA_SERVICE_REPO; else process.env.AROMA_SERVICE_REPO = saved
    }
  })

  test('*** ⛔ resolveRepo TAKES NO INPUT AT ALL ***', () => {
    assert.equal(entry.resolveRepo.length, 0, '⛔ it accepts an argument again')
    const code = fs.readFileSync(path.join(__dirname, 'xiangxiang-service-entry.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.equal(code.includes('AROMA_SERVICE_REPO'), false,
      '⛔ the ambient override is back in code')
  })

  test('fixtures inject the repo instead — the seam is dependency injection, not the environment', () => {
    const fake = { root: 'X', entry: 'Y' }
    const prepared = entry.prepare({ ANTHROPIC_API_KEY: 'a', HUB_TOKEN: 'b', CLAUDE_CHAT_MODEL: 'c' },
      { resolveRepo: () => fake })
    assert.equal(prepared.root, 'X')
    assert.equal(prepared.preflight.ok, true)
  })
})

describe('the install plan cannot describe something the runtime refuses', () => {
  const PLAN = () => fs.readFileSync(path.join(__dirname, 'INSTALL-PLAN-v2.md'), 'utf8')

  test('*** ⛔ NO SPARE-PORT OVERRIDE IS PRESCRIBED — the runtime could not honour it ***', () => {
    const plan = PLAN()
    // The earlier draft told the installer to override PORT in service.env. The entry loads
    // service.env and THEN applies STABLE_ENV, and the allowlist now refuses a PORT key, so the
    // instruction was impossible. Documentation that cannot be followed is worse than none:
    // someone follows it, sees 8090, and concludes the file was ignored.
    // ⛔ SCAN THE STEPS, NOT THE EXPLANATION. The plan QUOTES the withdrawn instruction in
    // order to explain why it is refused — the same trap as a comment containing the very token
    // a source fence bans. Only numbered, actionable steps are prescriptive.
    const NL = String.fromCharCode(10)
    const steps = plan.split(NL).filter((l) => {
      const t = l.trim()
      return t.length > 2 && t[0] >= '0' && t[0] <= '9' && t.indexOf('. ') > 0 && t.indexOf('. ') < 4
    }).join(NL).toLowerCase()
    assert.equal(steps.includes('override') && steps.includes('port') && steps.includes('service.env'), false,
      '⛔ a step prescribes the impossible PORT override: ' + steps)
    assert.match(plan, /There is no spare-port live validation/,
      'the plan states plainly that the rehearsal is non-binding')
  })

  test('*** ⛔ THE PLAN STOPS THE INTERACTIVE OWNER BEFORE STARTING THE SERVICE ***', () => {
    const plan = PLAN()
    const stopAt = plan.indexOf('Stop the interactive owner')
    const startAt = plan.indexOf('Start the service owner')
    assert.ok(stopAt > 0 && startAt > 0, 'both steps are named')
    assert.ok(stopAt < startAt, '⛔ the plan would have two owners of 8090 at once')
    assert.match(plan, /never owned concurrently/)
  })

  test('the documented preflight is non-binding and names what it must prove', () => {
    const plan = PLAN()
    assert.match(plan, /non-binding/i)
    assert.match(plan, /binds no\s*\r?\n?\s*port|binds no port/i)
    for (const claim of ['bootCommit', 'effective', 'PRESENT']) {
      assert.ok(plan.includes(claim), 'the preflight proves: ' + claim)
    }
  })
})
