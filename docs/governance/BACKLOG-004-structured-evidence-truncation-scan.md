# BACKLOG-004 — structured evidence truncated on the way to the audit

**Recorded 2026-08-02.** Four instances FIXED this round; the rest enumerated below with a
recommendation each, none of them applied.

## The shape

A layer measures something, the next layer up keeps only part of it, and the audit records a
refusal that names a stage and explains nothing. It has now cost three rounds:

1. **cleanup** measured `processExited / notepadWindowsAfter / forced / method`, and the adapter
   routed it through `call()`, which throws on `ok:false` — precisely when cleanup has something
   to say. The numbers went into an exception.
2. **the display layer** turned a failed production lookup into a success-shaped line.
3. **Resolve-SaveUiBinding** measured `candidatesObserved / elapsedMs / dialogOwnership /
   dialogHandle / filenameCandidates`, `uiaCanary` turned four of them into a sentence and dropped
   the evidence hashtable, and the executor then kept only `err.message` — the reason code alone.
   The canary of 2026-08-02 failed with `filename_field_not_found` and not one fact about why.

Every one was invisible to the test suite, because every test asserted **that a record existed**.
A record existed all three times. What was missing was inside it. Hence
`evidenceReachesAudit.test.js`, which asserts **field completeness** and has positive controls
that drop one field, drop all evidence, and reproduce the old `err.message`-only shape.

## FIXED this round

| # | Site | Was | Now |
|---|---|---|---|
| 1 | `aromaJsonTransport.ps1` `Write-AromaRefusal` | reason + one string, no slot for structure | optional `[hashtable] $Evidence`; absent stays absent, never an empty object |
| 2 | `uiaCanary.ps1` resolver-failure block | a sentence built from 4 of the fields | six top-level fields + the whole `evidence` hashtable copied key by key, so a new field travels without another edit here |
| 3 | `desktopAdapter.js` `fail()` / `call()` | `Error` carried reason + detail | carries `e.evidence` from `res.evidence` |
| 4 | `computerExecutor.js` step failure | `finishFailed('step_failed', err.message, …)` | reason code **and** detail, and the evidence spread flat into the `aborted` record |
| 5 | `uiaLookups.ps1` `Resolve-SaveUiBinding` | `Find-SaveDialog`'s `rejected` list never left the function | `evidence.dialogsVerified` + `evidence.dialogsRejected` — see §"why this one now" below |

#5 is a search-**reporting** change only. No candidate is accepted or refused differently.

## REMAINING — same shape, ranked, none applied

### A. `desktopAdapter.js:196-201` — a truncation that becomes a FALSE claim. **Highest.**

```js
} catch (err) {
  act = { ok: false, reason: (err && err.reason) || 'activation_failed', sendCount: 0, activated: false }
}
```

and the transport-failure line above it does the same. `act.ok !== true` then produces
`outcome: 'save_refused'` with `detail: 'refused before sending'`.

If `runner.run` throws — spawn failure, or the **timeout killing the helper process** — we do not
know whether BM_CLICK was posted. `sendCount: 0` and "refused before sending" are not incomplete,
they are **wrong in the dangerous direction**: they assert that nothing happened to the machine.
The helper's own catch is careful here (`sendCount = $script:SendCount`,
`activated = ($script:SendCount -gt 0)`); the JS layer above it throws that care away.

**Recommendation:** `sendCount: null` (unknown), and the outcome must be
`activation_outcome_unknown`, not `save_refused`. Fix before the next real Save canary — this path
is reachable exactly when a canary times out, which is the state the last two runs were closest to.

### B. `desktopAdapter.js:219` — the observation failure is swallowed whole.

```js
try { obs = call('save_outcome', { bind }) } catch (_) { obs = null }
```

`obs = null` then feeds `activation_outcome_unknown`, whose entire purpose is to be diagnosed
later. Why the observation itself failed is unrecoverable. **Recommendation:** keep
`err.reason / err.detail` as `obsError` and put it in the outcome's detail and evidence. Fix with A.

### C. `desktopAdapter.js:243-253` — `verifyBinding` says what changed, never what it saw.

`process_identity_changed` is returned without the observed pid beside the expected one, and the
`catch` keeps `err.reason` while dropping `err.detail` and (now) `err.evidence`. No other record
carries them. This bit us in this very round: a test double returning a bare `{ ok: true }`
produced `process_identity_changed`, and the refusal said nothing that would have located the
cause. **Recommendation:** return `observed` / `expected` for the field that differed, and carry
`err.detail`. Cheap, and it is asked on every step.

### D. `computerExecutor.js:527 / 555 / 559` — the three save outcomes throw bare strings.

```js
throw new Error((sv.refusal || 'save_refused') + ': ' + (sv.detail || 'refused before sending'))
throw new Error('save_rejected: ' + (sv.detail || …))
throw new Error('activation_outcome_unknown: ' + (sv.detail || …))
```

`sv.sendCount / dialogPresent / errorTextSeen / verified / target` are lost at the throw, so the
`aborted` record has none of them. **Partly mitigated:** `native_target_verified` and the
`sv.outcome` record are written *before* each throw, so the facts do reach the audit — in a
different record. **Recommendation:** attach them as `evidence` on the thrown error, so the abort
record is self-contained. Same one-line pattern as fix #3. Medium: data exists, it is just scattered.

### E. `uiaCanary.ps1:389` — a helper's detail replaced by a constant.

`Emit-Refusal $r.reason 'binding no longer resolves'` overwrites whatever `Resolve-Binding`
determined with a fixed sentence. Same shape as the bug just fixed, one layer lower.
**Recommendation:** pass `$r.detail` and an evidence hashtable. Lines 395 and 416
(`Emit-Refusal 'stale_binding' $r.reason`) put a reason *code* in the detail slot — same fix.

### F. `powershellJsonRunner.js:139` — a timeout keeps no partial output.

`fail('timeout', r.error.message)` discards whatever the helper had already written to stdout,
which is exactly when a helper is most likely to have printed a partial envelope.
**Recommendation:** carry truncated stdout/stderr as detail. Low, but it is the outermost boundary,
so nothing else can recover it.

### G. `computerExecutor.js:509 refuse_overwrite`, `:540 activation_unrecorded`, `:561 unknown_action`

String-fused reason codes. `unknown_action` has no data to lose — **no change**. The other two
should be structured for consistency when D is done. Low.

### NO CHANGE — correct as they stand

- **`nativeSaveActivation.ps1:118` `Refuse()`** — returns `reason`, `detail`, `sendCount` and
  `activated` structurally on every refusal. This is the **reference implementation** for the rest
  of this list; the others should look like it.
- `computerSupervisor.js:184,281` and `executeRequestStore.js:217` — audit-sink and claim failures,
  where the cause string is genuinely all there is.

## Why #5 was done now and `Find-SaveDialog` was NOT changed

The open question is the **multi-layer `#32770`** hypothesis: the modern Windows file dialog nests
common-dialog frames, so the `#32770` that verified may not be the one containing the filename
field. `Find-FilenameField` searches `Descendants` of the verified dialog, so if the verified
window is the inner frame — or the outer, with the field under a sibling — the field is genuinely
not there, and `filename_field_not_found` would be **true and useless**: right about the search,
wrong about the world.

**How it would change if the hypothesis holds.** Either (a) resolve the outermost `#32770`
ancestor of the verified dialog and search from there, or (b) treat a related set of `#32770`
windows as one logical dialog keyed by a common root and require the field to be unique **across
the set** rather than within one frame.

**Why not now — three reasons, in order of weight:**

1. **It would be a guess.** The last five rounds' recurring defect was code written to a mental
   model that was never measured. `verifiedCount` was 1, so exactly one window passed — but we do
   not know whether the second frame was never observed, or was observed and rejected, or for what.
   Both (a) and (b) are plausible and they are not the same change.
2. **It weakens a security invariant, not a convenience.** "The filename field is only ever taken
   from inside a verified dialog" is the containment rule that keeps the approved path from being
   typed into some other window. Broadening the root loosens it. That trade may be right, but it
   must be paid for with a measurement, not a hypothesis.
3. **Changing it in the same round would destroy the experiment.** The fix landing now is precisely
   what makes `dialogsRejected`, `dialogHandle`, `dialogOwnership` and `filenameCandidates` reach
   the audit. Editing the search at the same time means the next run measures a *different*
   implementation and we would never learn whether the hypothesis was true.

So #5 — reporting the rejection reasons the function already computed — is deliberately the whole
of the change to that module. A second `#32770` appearing in `dialogsRejected` under `not_visible`,
`pid` or `no_handle` settles the question on the next run, with no code written on a guess.

---

## SEPARATE FINDING — the package hash moves when git touches the tree

Found while measuring the hash for this round, not looked for.

`computePackageHash` sha256s the **raw bytes** of each packaged file. This repo has
`core.autocrlf = true` and **no `.gitattributes`**, so git rewrites line endings whenever it
materialises a file. A `git stash push` / `git stash pop` round-trip over five packaged files —
no textual change at all, `git diff` showing nothing — moved the package hash:

```
167b15cb…   before      (those five files LF)
57f24d25…   after       (the same five files CRLF, identical text)
167b15cb…   restored    (LF put back — exactly the original value)
```

The round-trip also turned `controlIdentity.test.js` red: it slices `uiaCanary.ps1` on `'\n}\n'`,
which stops matching under CRLF. **A guard test failed with no logic changed.** That is the same
class of problem as everything above — a fact destroyed in transit — except the transit is git.

Two consequences, both bad for a control whose purpose is to prove the approved bytes are the
executed bytes:

1. **The hash is not reproducible across checkouts or machines.** A clone, a stash, a branch
   switch, or a different `core.autocrlf` produces a different number for identical source. An
   integrity value that moves for reasons unrelated to content trains its readers to wave it
   through — which is precisely how an integrity control stops working.
2. **The package is already mixed.** 32 files LF, 11 CRLF; six of the eleven predate this round.
   So the current hash encodes an accident of history, not a decision.

**Recommendation, needs an Owner decision because it moves the hash and therefore requires
re-staging:** add a `.gitattributes` pinning packaged files to LF (`* text eol=lf`, with the
BOM-bearing `.ps1` files still binary-identical apart from endings), renormalise once, record the
new package hash, and re-stage. Until then the working-tree hash is only meaningful **on this
machine, in this checkout**, and that limit should be stated wherever it is quoted.

Not applied this round: it is outside the scope given, and it would move the hash in the same
commit as the evidence fix, making it impossible to attribute the change to either.

The line endings this round's stash disturbed have been **restored**, and the hash is back to the
value the code change alone produces.
