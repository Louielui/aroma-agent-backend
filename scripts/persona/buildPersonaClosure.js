'use strict'

/**
 * buildPersonaClosure — thin CLI over src/persona/personaClosure.buildPersonaClosure.
 *
 * Usage:
 *   AROMA_CORE_DIR=<coreDir> node scripts/persona/buildPersonaClosure.js --dry-run
 *   AROMA_CORE_DIR=<coreDir> node scripts/persona/buildPersonaClosure.js --out <recordsDir> \
 *     [--release-commit <40hex> --install-auth <str> --release-relationship REFERENCE_ONLY] \
 *     [--supersede-path <priorJson> --supersede-hash <64hex>]
 *
 * Release-ref flags are ALL-or-NONE. Supersede flags are ALL-or-NONE. A REAL write
 * (--out, not --dry-run) requires a clean tree AND the sourceCommit to contain the
 * builder (else fail closed). Dry-run may run dirty but is stamped
 * generatorProvenance:INCOMPLETE and never writes. READ-ONLY on core-data. Never
 * touches any historical artifact. Never prints persona text (the closure has none).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { buildPersonaClosure } = require('../../src/persona/personaClosure')

const REPO_ROOT = path.resolve(__dirname, '../..')
const BUILDER_REL = 'scripts/persona/buildPersonaClosure.js'
const VERIFIER_REL = 'scripts/persona/verifyPersonaClosure.js'
const CORE_REL = 'src/persona/personaClosure.js'

function makeGet (argv) {
  return (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; return (v == null || v.startsWith('--')) ? true : v }
}
function present (argv, name) { return argv.includes(name) }

// --- ALL-or-NONE combinatorial resolution of the three release-ref flags ---------
function resolveReleaseRef (argv) {
  const flags = ['--release-commit', '--install-auth', '--release-relationship']
  const get = makeGet(argv)
  const presentFlags = flags.filter((f) => present(argv, f))
  if (presentFlags.length === 0) return { ok: true, value: null }
  if (presentFlags.length !== 3) return { ok: false, error: 'RELEASE_REF_PARTIAL', detail: 'all three release flags (--release-commit --install-auth --release-relationship) required together' }
  const rc = get('--release-commit'); const ia = get('--install-auth'); const rr = get('--release-relationship')
  for (const [n, v] of [['--release-commit', rc], ['--install-auth', ia], ['--release-relationship', rr]]) {
    if (v === true || typeof v !== 'string' || v.length === 0) return { ok: false, error: 'RELEASE_REF_BLANK', detail: n + ' has no value' }
  }
  // value-level validation (40hex commit, REFERENCE_ONLY) is enforced by the builder.
  return { ok: true, value: { releaseCommit: rc, installAuthorization: ia, relationship: rr } }
}

// --- ALL-or-NONE supersede flags -----------------------------------------------
function resolveSupersede (argv) {
  const get = makeGet(argv)
  const p = present(argv, '--supersede-path'); const h = present(argv, '--supersede-hash')
  if (!p && !h) return { ok: true, value: null }
  if (p !== h) return { ok: false, error: 'SUPERSEDE_PARTIAL', detail: 'both --supersede-path and --supersede-hash required together' }
  const cp = get('--supersede-path'); const ch = get('--supersede-hash')
  if (cp === true || ch === true || typeof cp !== 'string' || typeof ch !== 'string' || !cp || !ch) return { ok: false, error: 'SUPERSEDE_BLANK', detail: 'supersede flags need values' }
  return { ok: true, value: { closurePath: cp, closurePayloadHash: ch, reason: 'GENERATOR_PROVENANCE_INCOMPLETE' } }
}

// --- write path rule: base <gen> for first; supersede goes to a unique, non-
//     overwritable, provenance-addressed sibling under <gen>/supersedes/. -----------
function compactStamp (generatedAt) { return String(generatedAt || '').replace(/[^0-9]/g, '').slice(0, 14) }
function computeWritePath (outDir, gen, supersedes, generatorCommit, generatedAt) {
  if (!supersedes) return path.join(outDir, gen)
  const disc = String(generatorCommit || 'nocommit').slice(0, 12) + '-' + compactStamp(generatedAt)
  return path.join(outDir, gen, 'supersedes', disc)
}

function gitOut (args) { try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }) } catch { return null } }
function sha256File (rel) { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, rel))).digest('hex') } catch { return null } }
function collectGitFacts () {
  const head = (gitOut(['rev-parse', 'HEAD']) || '').trim() || null
  const status = gitOut(['status', '--porcelain'])
  const workingTreeClean = status != null && status.trim() === ''
  const tree = gitOut(['ls-tree', '-r', '--name-only', 'HEAD']) || ''
  const trackedSet = new Set(tree.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  const builderInCommit = [BUILDER_REL, VERIFIER_REL, CORE_REL].every((f) => trackedSet.has(f))
  return { head, workingTreeClean, builderInCommit, builderPath: BUILDER_REL, builderSha256: sha256File(BUILDER_REL), verifierPath: VERIFIER_REL, verifierSha256: sha256File(VERIFIER_REL) }
}
function writeAtomic (finalPath, text) { const tmp = finalPath + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, finalPath) }

function main (argv) {
  const args = argv || process.argv.slice(2)
  const get = makeGet(args)
  const coreDir = get('--core') || process.env.AROMA_CORE_DIR
  if (typeof coreDir !== 'string' || coreDir === true || !path.isAbsolute(coreDir)) { console.error(JSON.stringify({ ok: false, reason: 'CONFIG_ERROR', detail: 'AROMA_CORE_DIR (or --core) absolute path required' })); return 3 }
  const outDir = present(args, '--out') ? get('--out') : null
  const dryRun = present(args, '--dry-run') || !outDir
  const mode = dryRun ? 'dry-run' : 'real'

  const rr = resolveReleaseRef(args)
  if (!rr.ok) { console.error(JSON.stringify({ ok: false, reason: rr.error, detail: rr.detail })); return 3 }
  const sup = resolveSupersede(args)
  if (!sup.ok) { console.error(JSON.stringify({ ok: false, reason: sup.error, detail: sup.detail })); return 3 }

  const git = collectGitFacts()
  const generatorCommit = get('--commit') || git.head

  let built
  try {
    built = buildPersonaClosure({
      coreDir,
      generatorCommit,
      generatedAt: new Date().toISOString(),
      productionReleaseReference: rr.value,
      supersedes: sup.value,
      provenance: { workingTreeClean: git.workingTreeClean, builderInCommit: git.builderInCommit, builderPath: git.builderPath, builderSha256: git.builderSha256, verifierPath: git.verifierPath, verifierSha256: git.verifierSha256 },
      mode
    })
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: e.code || 'BUILD_ERROR', detail: e.detail || e.message })); return 3 }
  const { gen, closure } = built

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, gen, generatorProvenance: closure.generatorProvenance, closurePayloadHash: closure.closurePayloadHash, overallResult: closure.overallResult, productionPersonaMode: closure.productionPersonaMode }))
    console.log(JSON.stringify(closure, null, 2))
    return 0
  }

  const genDir = computeWritePath(outDir, gen, sup.value, generatorCommit, closure.generatedAt)
  const jsonPath = path.join(genDir, 'PERSONA-CLOSURE.json')
  if (fs.existsSync(jsonPath)) { console.error(JSON.stringify({ ok: false, reason: 'ALREADY_EXISTS', detail: jsonPath + ' (non-overwritable; fail closed)' })); return 4 }
  fs.mkdirSync(genDir, { recursive: true })
  const jsonText = JSON.stringify(closure, null, 2)
  writeAtomic(jsonPath, jsonText)
  const summary = [
    'Aroma Xiang Xiang — Persona Closure',
    'schema: ' + closure.schemaVersion, 'closureId (gen): ' + gen,
    'generatedAt: ' + closure.generatedAt, 'generatorProvenance: ' + closure.generatorProvenance,
    'generator.sourceCommit: ' + closure.generator.sourceCommit,
    'overallResult: ' + closure.overallResult, 'productionPersonaMode: ' + closure.productionPersonaMode,
    'closurePayloadHash: ' + closure.closurePayloadHash,
    'supersedes: ' + (closure.supersedes ? closure.supersedes.closurePayloadHash : 'none')
  ].join('\n') + '\n'
  writeAtomic(path.join(genDir, 'VERIFICATION-SUMMARY.txt'), summary)
  const fileSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
  const sums = ['# SHA256SUMS — covers PERSONA-CLOSURE.json + VERIFICATION-SUMMARY.txt; does NOT self-hash.', fileSha(jsonText) + '  PERSONA-CLOSURE.json', fileSha(summary) + '  VERIFICATION-SUMMARY.txt'].join('\n') + '\n'
  writeAtomic(path.join(genDir, 'SHA256SUMS.txt'), sums)
  console.log(JSON.stringify({ ok: true, gen, path: jsonPath, generatorProvenance: closure.generatorProvenance, closurePayloadHash: closure.closurePayloadHash }))
  return 0
}

if (require.main === module) process.exit(main())
module.exports = { main, resolveReleaseRef, resolveSupersede, computeWritePath, compactStamp, collectGitFacts }
