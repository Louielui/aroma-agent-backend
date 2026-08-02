'use strict'

/**
 * ownerApprovalCeremony.test.js — the two-screen Owner ceremony.
 *
 * Two properties carry the whole design, and both are asserted by running the real script
 * rather than by reading it:
 *
 *   1. NO NON-INTERACTIVE APPROVE. If a builder, a script, a CI job or an agent could produce
 *      the "Owner approved" state, the receipt proves nothing. So the approval screen is run
 *      here with redirected input — the only way a test CAN run it — and must Cancel, writing
 *      no receipt.
 *
 *   2. EXECUTE RENDERS FROM THE RECEIPT. If the second screen regenerated its summary from the
 *      work order, an order edited between the screens would be shown as approved and the Owner
 *      would consent to something he never saw.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const A = require('../../scripts/computer/ownerApproval')
const { computeOrderHash } = require('./sealedOrderGate')

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts', 'computer')
const APPROVE_PS1 = path.join(SCRIPTS, 'Owner-Approve.ps1')
const EXECUTE_PS1 = path.join(SCRIPTS, 'Owner-Execute.ps1')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-ceremony-'))

/**
 * Does this script declare a SCRIPT-LEVEL param block?
 *
 * The first version of this check was `/param\s*\(/` over the source, and it failed — on
 * `function Say { param([string]$T) }`. Function parameters are not script parameters, and a
 * regex cannot tell them apart without becoming a parser. So it asks the real parser: the
 * script block's own ParamBlock, which is null unless the file takes arguments.
 *
 * Same lesson as the `-Object`/`-Context` guard: when a textual rule starts needing exceptions,
 * it is answering a different question from the one being asked.
 */
function scriptParamNames (file) {
  const ps = [
    '$e=$null;',
    `$ast=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$null,[ref]$e);`,
    'if($ast.ParamBlock -eq $null){ "" } else { ($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }) -join "," }'
  ].join(' ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, 'the parser ran: ' + (r.stderr || ''))
  return String(r.stdout).trim().split(',').filter(Boolean)
}

/* ── 1. the interactivity gate ────────────────────────────────────────────── */

test('*** running the approval screen from a SCRIPT yields Cancel and no receipt ***', () => {
  // This is the strongest form available: the test is itself the "builder" trying to approve.
  // spawnSync gives the child redirected stdin, which is exactly what a CI job or an agent
  // would have, and the script must refuse.
  const receipts = tmp()
  const before = fs.readdirSync(receipts)
  assert.deepEqual(before, [], 'clean start')

  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', APPROVE_PS1],
    { encoding: 'utf8', timeout: 60000, input: 'A\nA\nA\n' })

  assert.notEqual(r.status, 0, 'a scripted run must not succeed')
  // 5, not 2, since 2026-07-31: the two outcomes are now told apart. 2 means the Owner chose
  // Cancel or pressed another key; 5 means the keyboard could not be read at all. A script has
  // no keyboard, so 5 is the correct and more informative answer.
  assert.equal(r.status, 5, 'and must exit with the keyboard-unavailable code, not the Cancel code')
  assert.match(String(r.stdout), /COULD NOT READ YOUR KEYBOARD/, 'it says which of the two it is')
  assert.match(String(r.stdout), /input is redirected/, 'and gives the reason for whoever set it up')
  // Feeding it the letter A did not help, which is the point.
  assert.doesNotMatch(String(r.stdout), /APPROVED\./, 'no approval was recorded')
})

test('*** the approval screen exposes NO parameter that could approve ***', () => {
  const src = fs.readFileSync(APPROVE_PS1, 'utf8')
  const code = src.replace(/^\s*#.*$/gm, '') // comments discuss the ban; code must not offer it
  for (const banned of ['-Approve', '-Yes', '-Force', '-NonInteractive', '-Confirm', '-Silent', '-Auto']) {
    assert.equal(code.includes(banned), false, 'must not accept: ' + banned)
  }
  assert.deepEqual(scriptParamNames(APPROVE_PS1), [],
    'the approval screen takes no parameters at all — asked of the parser, not a regex')
  // No environment variable may stand in for consent.
  assert.equal(/\$env:[A-Za-z_]*APPROV/i.test(code), false, 'no env var may approve')
  assert.equal(/\$env:[A-Za-z_]*(YES|FORCE|AUTO)/i.test(code), false, 'no env var may approve')
})

test('*** both screens read consent from the real console, and fail closed ***', () => {
  for (const p of [APPROVE_PS1, EXECUTE_PS1]) {
    const name = path.basename(p)
    const code = fs.readFileSync(p, 'utf8').replace(/^\s*#.*$/gm, '')
    assert.ok(code.includes('RawUI.ReadKey'), name + ' must read a real key')
    assert.ok(code.includes('IsInputRedirected'), name + ' must refuse redirected input')
    assert.ok(code.includes('UserInteractive'), name + ' must refuse a non-interactive session')

    // Every failure to READ resolves to kind='no_keyboard', which the screen turns into a
    // refusal. The old assertion looked for `catch { Cancel-Now`, which stopped matching when
    // the reader started returning a classified result instead of exiting inline — the shape
    // changed, the guarantee did not, so the assertion follows the guarantee.
    assert.match(code, /catch\s*\{\s*return\s*@\{\s*ok\s*=\s*\$false;\s*kind\s*=\s*'no_keyboard'/,
      name + ' must fail closed when the keyboard cannot be read')
    assert.ok(code.includes("exit 5"), name + ' must exit non-zero on an unreadable keyboard')

    // Queued events are discarded before asking, so nothing that arrived before the question
    // can answer it.
    assert.ok(code.includes('FlushInputBuffer'), name + ' must discard anything already queued')
  }
})

test('*** a no-keyboard failure is told APART from a wrong key ***', () => {
  // The defect the Owner hit: both produced "you pressed something other than A", so a tool
  // failure was reported to him as his own mistake. They are now different messages, different
  // exit codes, and the tool-failure one says explicitly that he did nothing wrong.
  for (const p of [APPROVE_PS1, EXECUTE_PS1]) {
    const name = path.basename(p)
    const code = fs.readFileSync(p, 'utf8')
    assert.ok(code.includes('COULD NOT READ YOUR KEYBOARD'), name + ' names the tool failure')
    assert.ok(code.includes('You did nothing wrong'), name + ' says whose fault it is not')
    assert.match(code, /kind\s*-eq\s*'no_keyboard'/, name + ' branches on the classification')
    assert.match(code, /rather than [AE] or C/, name + ' has a separate message for a wrong key')
  }

  // Measured end to end: a run with no keyboard gives 5 and the tool-failure text, never the
  // wrong-key text.
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', APPROVE_PS1],
    { encoding: 'utf8', timeout: 60000, input: '' })
  assert.equal(r.status, 5)
  assert.match(String(r.stdout), /COULD NOT READ YOUR KEYBOARD/)
  assert.doesNotMatch(String(r.stdout), /you pressed/, 'it must not blame the Owner for a tool failure')
})

test('*** the reader waits past modifier keys instead of treating them as an answer ***', () => {
  // The immediate false "wrong key" came from a key event carrying no character. Skipping those
  // is not leniency — a Shift key-down was never an answer — and the loop is bounded so a
  // stream of junk events ends in a no_keyboard refusal rather than spinning forever.
  for (const p of [APPROVE_PS1, EXECUTE_PS1]) {
    const code = fs.readFileSync(p, 'utf8').replace(/^\s*#.*$/gm, '')
    assert.match(code, /IsNullOrEmpty\(\$ch\)/, 'characterless events are skipped')
    assert.match(code, /\[int\]\[char\]\$ch\[0\]\s*-lt\s*32/, 'control characters are skipped')
    assert.match(code, /while\s*\(\$ignored\s*-lt\s*50\)/, 'the skipping is bounded')
    assert.match(code, /only non-character key events arrived/, 'and exhausting it is a no_keyboard refusal')
  }
})

test('*** the fix introduces no console-encoding or hidden-setting workaround ***', () => {
  // The tempting fix was to set [Console]::OutputEncoding or chcp. That makes the screen depend
  // on state nobody can see, and the Owner ruled it out.
  for (const p of [APPROVE_PS1, EXECUTE_PS1]) {
    const code = fs.readFileSync(p, 'utf8').replace(/^\s*#.*$/gm, '')
    for (const banned of ['OutputEncoding', 'InputEncoding', 'chcp', '[Console]::SetIn', 'SetConsoleMode']) {
      assert.equal(code.includes(banned), false, path.basename(p) + ' must not set: ' + banned)
    }
  }
})

test('the execute screen also refuses a scripted run', () => {
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', EXECUTE_PS1],
    { encoding: 'utf8', timeout: 60000, input: 'E\n' })
  assert.notEqual(r.status, 0)
  assert.doesNotMatch(String(r.stdout), /execution would begin/, 'nothing reached the execution point')
})

/* ── 2. the builder does not choose the id ────────────────────────────────── */

test('*** the approvalId is minted at consent, with 128 bits of randomness ***', () => {
  const ids = new Set()
  for (let i = 0; i < 200; i++) ids.add(A.mintApprovalId())
  assert.equal(ids.size, 200, 'no collisions — it is not a counter or a template')
  for (const id of ids) {
    assert.match(id, /^appr_[0-9a-f]{32}$/, 'shape')
    assert.match(id, /^[A-Za-z0-9_-]{1,64}$/, 'and it satisfies the registry rule')
  }
})

test('*** the shipped draft carries NO approvalId and NO hash ***', () => {
  const draft = A.readOrder()
  assert.equal(draft.approvalId, '', 'the builder did not invent one')
  assert.equal(draft.orderHash, '', 'and could not have hashed it if it had')
  // Belt: the file itself must not contain anything that looks like a minted id.
  const raw = fs.readFileSync(A.DRAFT, 'utf8')
  assert.doesNotMatch(raw, /appr_[0-9a-f]{8}/, 'no id-shaped value anywhere in the draft')
})

test('issuing binds the id into the hash — the same hash the gate will compute', () => {
  const receipts = tmp()
  const { receipt } = A.issue({ receiptDir: receipts, by: 'TEST', machine: 'TEST', at: '2026-07-31T00:00:00.000Z' })
  assert.equal(receipt.approvedOrder.approvalId, receipt.approvalId)
  assert.equal(computeOrderHash(receipt.approvedOrder), receipt.workOrderHash,
    'one canonicalisation, shared with sealedOrderGate — not a second implementation')
  assert.equal(fs.existsSync(receipt.approvedOrder.orderHash ? path.join(receipts, 'receipt-' + receipt.approvalId + '.json') : ''), true)
})

test('a draft that already has an approvalId is refused — no re-approval in place', () => {
  const receipts = tmp()
  const orderFile = path.join(receipts, 'wo.json')
  const o = A.readOrder(); o.approvalId = 'appr_deadbeef'
  fs.writeFileSync(orderFile, JSON.stringify(o))
  assert.throws(() => A.issue({ receiptDir: receipts, orderFile }), /already carries an approvalId/)
})

/* ── 3. EXECUTE derives from the receipt ──────────────────────────────────── */

test('*** a work order changed after approval is REFUSED, naming both hashes ***', () => {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)

  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })
  assert.equal(A.verify({ receiptDir: dir, orderFile }).ok, true, 'unchanged: fine')

  // Someone edits the order between the screens — a different file, quietly.
  const tampered = A.readOrder(orderFile)
  tampered.steps[1].text = tampered.steps[1].text + ' TAMPERED'
  fs.writeFileSync(orderFile, JSON.stringify(tampered))

  const v = A.verify({ receiptDir: dir, orderFile })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'work_order_changed')
  assert.equal(v.approvedHash, receipt.workOrderHash)
  assert.notEqual(v.currentHash, receipt.workOrderHash)
})

test('*** the EXECUTE summary comes from the receipt, not from the current order ***', () => {
  // The claim, tested rather than asserted: change the order, and what the receipt renders is
  // still what was approved. (Execution is refused separately — that is the previous test.)
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })
  const approvedRender = A.renderReceiptSummary(receipt)

  const tampered = A.readOrder(orderFile)
  tampered.steps[1].text = 'something the Owner never saw'
  tampered.sealedText = tampered.steps[1].text
  fs.writeFileSync(orderFile, JSON.stringify(tampered))

  assert.equal(A.renderReceiptSummary(receipt), approvedRender, 'the receipt renders what it always did')
  assert.match(approvedRender, /Aroma Computer Operator canary\. Two steps\. Round 1\./)
  assert.doesNotMatch(approvedRender, /never saw/, 'the tampered text cannot appear on the screen')
})

test('an altered receipt is refused', () => {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const out = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })

  const r = JSON.parse(fs.readFileSync(out.file, 'utf8'))
  r.approvedOrder.timeoutSec = 9999 // widen the scope after the fact
  fs.writeFileSync(out.file, JSON.stringify(r))

  const v = A.verify({ receiptDir: dir, orderFile })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'receipt_self_mismatch')
})

test('with no receipt at all, EXECUTE refuses', () => {
  const dir = tmp()
  const v = A.verify({ receiptDir: dir, orderFile: A.DRAFT })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'no_receipt')
})

/* ── 4. the receipt is a complete record ──────────────────────────────────── */

test('*** the receipt records everything the Owner would otherwise have to keep ***', () => {
  const dir = tmp()
  const { receipt } = A.issue({ receiptDir: dir, by: 'AROMABRAIN\\louis', machine: 'AROMABRAIN', at: '2026-07-31T12:00:00.000Z' })
  for (const field of ['approvalId', 'workOrderHash', 'approvedAt', 'approvedBy', 'machine', 'scope', 'approvedOrder', 'approvedSummary', 'receiptHash']) {
    assert.ok(receipt[field], 'receipt must carry: ' + field)
  }
  // TWO-STEP SCOPE, 2026-08-02. The receipt records what was actually approved, and what was
  // approved no longer includes a save — so allowedPath and fileName are absent rather than
  // carrying values from a scope the Owner did not consent to.
  assert.deepEqual(receipt.scope.actions, ['open_app', 'type_text'])
  assert.equal(receipt.scope.allowedPath, undefined, 'no path, because nothing is written')
  assert.equal(receipt.scope.fileName, null, 'and no filename')
  assert.equal(receipt.scope.timeoutSec, 300)
})

test('the summary a person reads names every capability in plain words', () => {
  const s = A.renderSummary(A.readOrder())
  for (const must of ['Notepad only', '300 seconds', 'open_app', 'type_text']) {
    assert.ok(s.includes(must), 'the summary must state: ' + must)
  }
  // TWO-STEP SCOPE, 2026-08-02: the screen must say plainly that nothing is written. It used
  // to name canary-1.txt and a folder; with no save in the order that would be asking for
  // consent to something the order cannot do, and allowedPath is now absent so it would have
  // rendered as 'undefined\canary-1.txt'.
  assert.ok(s.includes('NOTHING - this order does not save and creates no file'), 'the screen says no file is written')
  assert.equal(s.includes('canary-1.txt'), false, 'no filename is promised')
  assert.equal(s.includes('undefined'), false, 'and nothing renders as undefined')
  // No hashes, no ids, no JSON on the screen a person has to check.
  assert.doesNotMatch(s, /[0-9a-f]{32}/, 'no hash is shown to the Owner')
  assert.doesNotMatch(s, /approvalId|orderHash|nonce/, 'no machine vocabulary on the human screen')
})

/* ── 5. the execute fence ─────────────────────────────────────────────────── */

test('*** the execute fence is a LITERAL $true, and nothing outside can move it ***', () => {
  // FINAL UNLOCK, 2026-08-01 by Owner decision, after the staged closure was independently
  // verified: 37/37, missing 0, extra 0, no Phase 3a remnant by exact path, operator
  // ReadAndExecute only, and the package hash recomputed FROM THE STAGED TREE matching.
  //
  // THIS TEST IS THE SOLE OWNER OF THE VALUE. canaryEntrypoint.test.js used to assert it too,
  // which meant a flip touched three files and one of them would eventually be missed — and
  // missed silently, because the remaining assertion would still pass. Its subject is the
  // ordering; the value is here and nowhere else. That narrowing is why this flip is two files
  // and not three.
  //
  // Kept through all four flips rather than deleted and re-added: the fence's value must be
  // something a diff shows in two files, in either direction. A guard removed the moment it
  // becomes inconvenient guards nothing — and an OPEN fence needs its guard more than a shut
  // one did, because from here every other control is what stands between a keypress and a
  // desktop.
  const code = fs.readFileSync(EXECUTE_PS1, 'utf8')
  const stripped = code.replace(/^\s*#.*$/gm, '')

  assert.match(stripped, /\$CANARY_EXECUTE_AUTHORISED\s*=\s*\$true/, 'the fence is OPEN')
  assert.doesNotMatch(stripped, /\$CANARY_EXECUTE_AUTHORISED\s*=\s*\$false/,
    'and nothing shuts it again further down — a later re-assignment would make this one a lie')

  // Exactly ONE assignment. A second one anywhere — a fallback, a re-assignment further down,
  // a branch that flips it — would make the first meaningless. This matters MORE now, not less:
  // with the fence open, a second assignment is the only way the value could differ from what
  // this test reads.
  const assignments = stripped.match(/\$CANARY_EXECUTE_AUTHORISED\s*=/g) || []
  assert.equal(assignments.length, 1, 'exactly one assignment, no fallback path')

  // A literal, never a value from outside: not a parameter, not an environment variable, not
  // a computed expression. Unchanged by the flip, and deliberately so — the direction of the
  // fence is a decision, and where the value comes from is a property.
  assert.deepEqual(scriptParamNames(EXECUTE_PS1), [], 'no script parameter can move it')
  assert.doesNotMatch(stripped, /\$env:[A-Za-z_]*CANARY/i, 'no environment variable can move it')
  assert.doesNotMatch(stripped, /Read-Host|\[Console\]::In\b/, 'and no stdin')
  const rhs = (stripped.match(/\$CANARY_EXECUTE_AUTHORISED\s*=\s*(.+)/) || [])[1] || ''
  assert.match(rhs.trim(), /^\$true\s*$/, 'the right-hand side is the bare literal, nothing else')
})

/* ── 6. the execution package: the receipt binds the CODE, not just the intent ── */

const PKG = require('../../scripts/computer/executionPackage')

test('*** the execution package is an allowlist, and every listed file exists ***', () => {
  const m = PKG.buildManifest()
  assert.deepEqual(m.missing, [], 'a listed file is gone — the package is incomplete')
  assert.equal(m.files.length, PKG.PACKAGE_FILES.length)
  // The screens ARE part of it. Owner-Execute.ps1 decides whether execution happens, so a
  // change to it is a change to what runs — which is exactly why the eventual unlock commit
  // will invalidate prior receipts, and why that is a feature.
  for (const must of [
    'scripts/computer/Owner-Execute.ps1', 'scripts/computer/uiaCanary.ps1',
    'src/computer/computerExecutor.js', 'src/computer/desktopAdapter.js',
    'src/computer/sealedOrderGate.js', 'src/computer/orderRegistry.js',
    'docs/governance/canary-work-order-2step.draft.json'
  ]) {
    assert.ok(PKG.PACKAGE_FILES.includes(must), 'must be packaged: ' + must)
  }
  // Tests and the A/B launchers do not run during a canary; packaging them would mean an
  // unrelated edit invalidating a live approval, which trains people to re-approve blind.
  for (const notPackaged of ['run-script-a-measured.ps1', 'run-script-b-measured.ps1', 'stage-companion.ps1']) {
    assert.equal(PKG.PACKAGE_FILES.some((p) => p.endsWith(notPackaged)), false, 'must not be packaged: ' + notPackaged)
  }
  assert.equal(PKG.PACKAGE_FILES.some((p) => p.includes('.test.')), false, 'no test files in the package')
})

test('*** the package hash depends on content, not on list order ***', () => {
  const h = PKG.computePackageHash()
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(PKG.computePackageHash(), h, 'stable across calls')
  // Sorting before hashing is what makes it content-addressed; assert the property directly
  // by hashing a shuffled copy of the same pairs.
  const files = PKG.buildManifest().files
  const canon = (arr) => JSON.stringify(arr.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => [f.path, f.sha256]))
  assert.equal(canon(files), canon(files.slice().reverse()), 'order-independent')
})

test('*** an incomplete package refuses rather than hashing the absence ***', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-pkg-'))
  assert.throws(() => PKG.computePackageHash(empty), /execution package is incomplete/)
})

test('*** a receipt pins the package, and a changed package is REFUSED by name ***', () => {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })

  assert.ok(receipt.executionPackageManifestHash, 'the receipt pins the package')
  assert.equal(receipt.executionPackageManifestHash, PKG.computePackageHash())
  assert.equal(A.verify({ receiptDir: dir, orderFile }).ok, true, 'unchanged package: fine')

  // Simulate the package moving — e.g. the unlock commit editing Owner-Execute.ps1.
  const moved = JSON.parse(JSON.stringify(receipt))
  moved.executionPackageManifestHash = 'f'.repeat(64)
  moved.executionPackageManifest = moved.executionPackageManifest.map((f) =>
    f.path === 'scripts/computer/Owner-Execute.ps1' ? { path: f.path, sha256: '0'.repeat(64) } : f)

  const v = A.verify({ receipt: moved, orderFile })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'execution_package_changed')
  assert.equal(v.approvedPackageHash, 'f'.repeat(64))
  assert.equal(v.currentPackageHash, PKG.computePackageHash())
  // and it says WHICH file moved, so the Owner is not left comparing hashes
  assert.ok(v.changedFiles.some((c) => c.path === 'scripts/computer/Owner-Execute.ps1' && c.change === 'modified'),
    'the refusal names the changed file')
})

/* ── 7. migration: v1 receipts are audit, never authorisation ─────────────── */

test('*** a PRE-IMPLEMENTATION receipt is refused, and never reaches the spent ledger ***', () => {
  // Owner ruling 2026-07-31. A v1 receipt approved a SCOPE and pinned nothing about the code,
  // so the Owner who signed it cannot have been shown an implementation that did not exist.
  // Kept for audit; never honoured.
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })

  const v1 = JSON.parse(JSON.stringify(receipt))
  delete v1.executionPackageManifestHash
  delete v1.executionPackageManifest
  delete v1.receiptVersion

  const v = A.verify({ receipt: v1, orderFile })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'pre_implementation_receipt')
  // ASCII hyphens since 2026-07-31: this string is PRINTED, and an em dash turned to mojibake
  // on the Owner's real console. The wording is unchanged; only the dash characters are.
  assert.equal(v.status, 'SCOPE APPROVED - PRE-IMPLEMENTATION - NOT EXECUTABLE')
  assert.equal(A.PRE_IMPLEMENTATION_STATUS, v.status)

  // The refusal happens BEFORE any registry is consulted, which is what makes "never accepted
  // as execution authorisation" structural rather than procedural: nothing carries that
  // approvalId onward to admit().
  const { createOrderRegistry } = require('./orderRegistry')
  const reg = createOrderRegistry({ now: () => 1 })
  assert.equal(reg.wasUsed(v1.approvalId), false, 'it was never spent, because it never got that far')
})

test('*** a receipt is executable ONLY if it binds the code on disk right now ***', () => {
  // ── THIS TEST'S PREMISE EXPIRED, 2026-08-01 ──────────────────────────────
  // It used to assert "no receipt on this machine is currently executable", and that was true
  // for as long as the fence was shut and nobody had approved anything. Then the Owner unlocked
  // the fence and approved, on purpose — and a build-time containment guard went red for the
  // one reason that is not a defect: the state it was guarding had been deliberately left.
  //
  // Deleting it would have thrown away the property worth keeping. Weakening it to "or ok" would
  // have made it assert nothing. What it holds now is the invariant that survives approval:
  // a receipt may authorise a run ONLY while it binds the exact package on disk. The moment the
  // code moves, every receipt made against the old code stops being executable — which is the
  // reason the unlock invalidated the previous one, and the reason this one will not outlive the
  // next change to a packaged file.
  const found = A.latestReceipt()
  if (!found) { assert.ok(true, 'no receipt on this machine'); return }

  const PKG = require('../../scripts/computer/executionPackage')
  const v = A.verify({})

  if (v.ok) {
    // A valid approval exists. It must be bound to the CURRENT package, not merely well-formed.
    assert.equal(v.receipt.executionPackageManifestHash, PKG.computePackageHash(),
      'an executable receipt binds the code that is on disk right now')
    assert.ok(v.receipt.approvalId, 'and names the approval it belongs to')
  } else {
    assert.ok(['receipt_superseded', 'pre_implementation_receipt', 'execution_package_changed'].includes(v.refusal),
      'refused for a stated reason, not an unexplained one: ' + v.refusal)
  }
})

test('*** any change to a packaged file invalidates every existing receipt ***', () => {
  // The mechanism the test above relies on, exercised rather than assumed — in a temp copy, so
  // the real receipts are untouched. This is what makes an approval a statement about code and
  // not just about intent.
  const PKG = require('../../scripts/computer/executionPackage')
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: new Date().toISOString() })

  assert.equal(A.verify({ receiptDir: dir, orderFile }).ok, true, 'valid against the package it was made from')
  assert.equal(receipt.executionPackageManifestHash, PKG.computePackageHash())

  // Now pretend one packaged file moved: the receipt's binding no longer matches.
  const rf = fs.readdirSync(dir).find((n) => n.startsWith('receipt-'))
  const raw = JSON.parse(fs.readFileSync(path.join(dir, rf), 'utf8'))
  raw.executionPackageManifestHash = 'a'.repeat(64)
  fs.writeFileSync(path.join(dir, rf), JSON.stringify(raw))
  const after = A.verify({ receiptDir: dir, orderFile })
  assert.equal(after.ok, false)
  assert.equal(after.refusal, 'execution_package_changed')
})

test('*** a SUPERSEDED marking beats every other verdict, and never edits the receipt ***', () => {
  // An Owner ruling about a specific approval cannot be overturned by hashes agreeing. And the
  // marking is a SIDECAR: a signed record that gets amended afterwards is no longer the thing
  // that was signed.
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: new Date().toISOString() })
  assert.equal(A.verify({ receiptDir: dir, orderFile }).ok, true, 'valid to begin with')

  const rf = path.join(dir, 'receipt-' + receipt.approvalId + '.json')
  const before = fs.readFileSync(rf)

  fs.writeFileSync(path.join(dir, 'superseded-' + receipt.approvalId + '.json'), JSON.stringify({
    kind: 'owner-approval-superseded',
    approvalId: receipt.approvalId,
    status: A.SUPERSEDED_STATUS,
    reason: 'test ruling'
  }))

  const v = A.verify({ receiptDir: dir, orderFile })
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'receipt_superseded')
  assert.equal(v.status, 'SUPERSEDED - WRONG EXECUTION IDENTITY - NOT EXECUTABLE')
  assert.doesNotMatch(A.SUPERSEDED_STATUS, /[^\x00-\x7F]/, 'ASCII, like every other printed string')
  assert.deepEqual(fs.readFileSync(rf), before, 'the receipt itself is byte-identical')
})

/* ── 8. the screen must be readable on a real console ─────────────────────── */

const NON_ASCII = /[^\x00-\x7F]/
/**
 * The mojibake the Owner actually saw. UTF-8 bytes decoded as CP1252/OEM produce these:
 * an em dash (E2 80 94) reads as "â€"", a box-drawing dash (E2 94 80) as "â”€", and the
 * high bytes surface as stray capitals and diaereses — the "[Cö" on his screen.
 */
const MOJIBAKE = /â€|â”|Ã.|â‚|Â.|�|\[C[öÖäÄüÜ]/

test('*** the approval summary is pure ASCII — no mojibake is possible ***', () => {
  // Asserted on the RENDERED OUTPUT, not on the source. A source scan would pass while the
  // screen still broke, because what reaches the console is what summarise() produced.
  const rendered = A.renderSummary(A.readOrder())
  assert.doesNotMatch(rendered, NON_ASCII, 'every character the Owner reads must be ASCII')
  assert.doesNotMatch(rendered, MOJIBAKE, 'and none of it can already be mangled')

  // The two lines that were broken, now stated exactly.
  assert.ok(rendered.includes('Notepad only - nothing else is opened'))
  // The overwrite line exists only when there IS a save. Two-step scope: the screen says
  // plainly that nothing is written instead of promising a rule about a file.
  assert.ok(rendered.includes('NOTHING - this order does not save and creates no file'))
  assert.equal(rendered.includes('—'), false, 'no em dash anywhere')
  assert.equal(rendered.includes('─'), false, 'no box-drawing dash anywhere')
})

test('*** every string the ceremony can PRINT is ASCII — receipt summary included ***', () => {
  const dir = tmp()
  const orderFile = path.join(dir, 'wo.json')
  fs.copyFileSync(A.DRAFT, orderFile)
  const { receipt } = A.issue({ receiptDir: dir, orderFile, at: '2026-07-31T00:00:00.000Z' })

  // The EXECUTE screen renders from the receipt, so that path needs the same guarantee.
  assert.doesNotMatch(A.renderReceiptSummary(receipt), NON_ASCII, 'the receipt-rendered summary')
  assert.doesNotMatch(A.PRE_IMPLEMENTATION_STATUS, NON_ASCII, 'the pre-implementation marking')

  // Refusal reasons reach the screen too.
  const v1 = JSON.parse(JSON.stringify(receipt))
  delete v1.executionPackageManifestHash
  const refused = A.verify({ receipt: v1, orderFile })
  assert.doesNotMatch(String(refused.reason), NON_ASCII, 'refusal reasons are printed, so they are ASCII too')
  assert.doesNotMatch(String(refused.status), NON_ASCII)
})

test('*** no NON-COMMENT line of the ceremony code carries a non-ASCII character ***', () => {
  // Comments are exempt on purpose: they never reach a console, and banning them would push
  // the prose towards worse English for no benefit. Code lines are where the risk lives.
  const files = [
    path.join(SCRIPTS, 'ownerApproval.js'),
    path.join(SCRIPTS, 'Owner-Approve.ps1'),
    path.join(SCRIPTS, 'Owner-Execute.ps1')
  ]
  const offenders = []
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      const isComment = /^\s*(\*|\/\*|\/\/|#)/.test(line)
      if (!isComment && NON_ASCII.test(line)) offenders.push(path.basename(f) + ':' + (i + 1) + '  ' + line.trim().slice(0, 60))
    })
  }
  assert.deepEqual(offenders, [], 'non-ASCII on a code line:\n  ' + offenders.join('\n  '))
})

test('*** POSITIVE CONTROL — the rules catch a real em dash and real mojibake ***', () => {
  // Without this, "no non-ASCII found" could mean the regexes match nothing at all.
  assert.match('Notepad only — nothing else', NON_ASCII, 'an em dash is caught')
  assert.match('Notepad only ─ nothing', NON_ASCII, 'a box dash is caught')
  assert.match('Notepad only â€" nothing', MOJIBAKE, 'CP1252-decoded UTF-8 is caught')
  assert.match('summary [Cö broken', MOJIBAKE, 'the exact shape seen on screen is caught')
  assert.doesNotMatch('Notepad only - nothing else is opened', NON_ASCII, 'and the fixed text passes')
  assert.doesNotMatch('Notepad only - nothing else is opened', MOJIBAKE)
})

test('the sealed text itself is ASCII, so it survives any console', () => {
  const d = A.readOrder()
  assert.doesNotMatch(d.sealedText, NON_ASCII)
  // Deliberately DIFFERENT from the superseded three-step order's text, so no receipt, audit
  // line or screenshot is ever ambiguous about which scope produced it.
  assert.equal(d.sealedText, 'Aroma Computer Operator canary. Two steps. Round 1.')
})
