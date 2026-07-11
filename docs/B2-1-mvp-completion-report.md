# B2-1 MVP — Completion Report

**Feature:** Worker Invocation (integration slice — the first "doing" after "talking")
**Branch:** `feature/b2-1-worker-invocation` (cut from B0 baseline `5f79f62`; independent of the B1-1a/1c stack)
**Head:** `fa81627`
**Status:** Complete. Default suite green, production flag `off`, real end-to-end proven once (paid).

---

## 1. What B2-1 does

When a proposal is **confirmed** (the authorising human gate at `POST /proposals/:id/confirm`),
Aroma can — for the first time — autonomously drive a **real headless `claude` worker** to
perform the confirmed task inside a throwaway sandbox, and record a **traceable result**, with
**zero human relay**. Confirm returns immediately; the worker runs in the background; the result
surfaces later as a filesystem artifact.

It is an **integration** slice: it wires talking → doing end-to-end behind a default-off flag.
It does not add planning, retries, result-surfacing endpoints, or a containment model.

---

## 2. Delivery (5 commits, each reviewed and stopped)

| SHA | Step | Summary |
|---|---|---|
| `ccf2508` | 1 | Filesystem artifact store (`.aroma/tasks` + `.aroma/results`), JSON+timestamp, deterministic |
| `4a99678` | 2 | Worker invocation adapter — exact spike command + the sandbox brake |
| `81f27e7` | 3 | Async post-confirm trigger (fire-and-forget) + traceability chain |
| `fb19ed3` | fix | Run `claude` with `cwd=sandbox` and stdin closed (safety) |
| `fa81627` | 4 | Real gated unattended E2E — Capability Verification Task |

### Files
- **New:** `src/store/artifactStore.js`, `src/workers/claudeWorker.js`,
  `src/workers/runWorkerInBackground.js`, and their tests + `claudeWorker.e2e.test.js`.
- **Changed:** `src/app.js` (additive composition-root wiring + one line in the confirm handler),
  `.gitignore` (`.aroma`).
- **Untouched governance:** `confirmProposal` (`src/coo/proposal.js`), `startRun`/`approveRun`
  (`src/run/store.js`), both dispatchers — **0 changed lines** (git-verified).

---

## 3. Architecture

```
POST /proposals/:id/confirm
  └─ confirmProposal(...) → startRun(...)        [governance — unchanged]
  └─ res.status(201).json({ runId })             [response returns immediately]
  └─ scheduleWorker(id, runId)   ← the ONE added line, fire-and-forget AFTER the response
        └─ (flag on) runWorkerInBackground:
             1. write Execution Artifact → .aroma/tasks   (proposalId + confirm provenance)
             2. mkdtemp sandbox under os.tmpdir(), git init
             3. claudeWorker.invoke('Invoke', 1, { task, sandbox })
                  • assertSandboxUnderTmpdir(sandbox)  ← THE BRAKE (before any spawn)
                  • spawn claude, cwd=sandbox, stdin closed, shell:false
                  • claude -p <task> --add-dir <sandbox>
                       --permission-mode bypassPermissions --output-format json
             4. write Result Artifact → .aroma/results   (taskId link, relay 0/0/0)
```

- **Non-blocking:** `scheduleWorker` only schedules a microtask and swallows errors into a log
  line; it never throws synchronously into the handler and never writes to an already-sent
  response. Confirm latency is unchanged.
- **Flag:** `WORKER_INVOCATION`, single read site, **default `off`** (invalid → `off` + warn,
  never open to `on`). Off ⇒ confirm is byte-for-byte `{ runId }`, nothing scheduled.

---

## 4. Safety

### Tightening 1 — the sandbox brake (the only brake)
`assertSandboxUnderTmpdir()` canonicalises the target (`path.resolve` + `realpath`, resolving `..`
and symlinks) and refuses to invoke unless it resolves **strictly under `os.tmpdir()`**. It runs
**before any spawn**, so a refusal means the runner is never called (asserted:
`calls.length === 0`). Rejected: the repo path, `..` escapes, homedir, tmpdir itself, cross-drive,
symlink-out, and empty.

### The cwd hole (caught before spending)
`--add-dir` widens the allowed set but does **not** move claude's workspace. With no `cwd`, spawn
inherited the **repo** — a real `bypassPermissions` worker would have created files and committed
**in the repo**. Fixed (`fb19ed3`): spawn with `cwd=<validated sandbox>` (the same brake-checked
path) so the workspace **is** the sandbox, and `stdio:['ignore','pipe','pipe']` so **stdin is
physically closed**.

### Tightening 3 — relay 0/0/0 by mechanism
Stdin closed ⇒ the process cannot read input; `bypassPermissions` ⇒ no Allow dialog. The E2E
**completed on its own** ⇒ no paste, no screenshot, no mid-approval. Autonomous completion *is*
the proof; `relay {toUser:0, fromUser:0, manual:0}` is recorded in every artifact.

### Honest residual (out of scope — needs a policy + containment decision)
`bypassPermissions` is inherently unrestricted; `cwd=sandbox` is the **necessary minimum** so it
doesn't default to the repo, but full containment (OS sandbox / container / chroot) is future
hardening. This slice runs **only** the fixed, content-controlled Capability Verification Task —
never a worker-generated task against a real repo.

---

## 5. Traceability (Tightening 2)

The chain is walked end-to-end, asserting every hop **resolves** (not mere field presence):

```
Result Artifact
  └─ taskId      → Execution Artifact
                     └─ proposalId → Proposal (getProposal)
                                       └─ confirmedBy / confirmedAt  (the authorising act)
```

Provenance decision (recorded): `POST /proposals/:id/confirm` is the authorising gate;
`confirmedBy`/`confirmedAt` is the execution provenance. A run-level `approve` second gate (with
`proposalId` propagation) is a possible future addition — an explicit design, never a silent
change.

---

## 6. Real E2E evidence (verified run)

| Item | Result |
|---|---|
| Command | `claude.exe -p "<task>" --add-dir <sandbox> --permission-mode bypassPermissions --output-format json` |
| cwd / stdin | `…\Temp\aroma-sandbox-aJcce4` / stdin closed |
| Exit code | **0** |
| File | `hello-aroma.txt` exists, content bytes `"Hello Aroma"` (byte-exact) |
| Commit | `1c6f3b790262a47f48cb3d38c587fa4e46b37c8f` — `test: prove headless worker invocation` |
| Result Artifact | readable JSON, `ok:true`, `exit:0` |
| Chain | `result.taskId → execution.proposalId=prop_88bf490b → proposal.status=confirmed` |
| Provenance | `confirmedBy: louie`, `confirmedAt: 2026-07-11T12:19:23.422Z` |
| Relay | `{0,0,0}` |
| Cost | **$0.1289** |
| Elapsed | **6.85 s** |

The worker ran in the sandbox (not the repo); the repo working tree stayed clean; the sandbox was
auto-cleaned.

---

## 7. Cost protection

- **Paid E2E is gated:** runs **only** with `RUN_PAID_E2E=1`.
  Enable: `RUN_PAID_E2E=1 node --test src/workers/claudeWorker.e2e.test.js`.
- **Fail closed:** default `node --test` skips it — **155 pass / 1 skipped / 0 fail**, zero paid
  calls. `npm test`-style default runs never spend.

---

## 8. Test totals

- Whole repo (default): **156 tests — 155 pass, 1 skipped (the paid E2E), 0 fail.**
- Unit coverage: artifact store (7), worker adapter incl. the brake + cwd/stdin (9), trigger glue
  (3), HTTP flag-off/flag-on-chain (2).

---

## 9. Windows note

The bare `claude` on PATH is a bash script; `spawn(shell:false)` needs the real executable, and
`.cmd` throws `EINVAL` under `shell:false`. The E2E resolves
`…\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` on win32 (bare `claude` elsewhere).
The production adapter default stays `claude` (correct on the Linux VPS).

---

## 10. Rollback

- **Runtime:** set `WORKER_INVOCATION=off` (or unset) + restart — no data migration, no code revert.
- **Full:** discard the branch (`git checkout 5f79f62` / delete `feature/b2-1-worker-invocation`).
- `.aroma/` and sandboxes are disposable runtime artifacts (gitignored / under `os.tmpdir()`).

---

## 11. Merge order (stacked branches — unchanged)

B2-1 is independent of B1 and cut from B0, so it can merge to `staging` on its own. The B1 stack
rule stands separately: B1-1a → `staging` first, then rebase B1-1c and merge. Never merge a child
before its parent.

---

## 12. Open items (design decisions, not code)

1. **Containment/policy model** for `bypassPermissions` workers (OS sandbox) — required before any
   worker-generated task runs against a real repo.
2. **Result-surfacing** HTTP endpoint (read `.aroma/results`) so the UI/user can see outcomes.
3. **Run-level approval** as an optional second gate (with `proposalId` propagation), if ever made
   mandatory.
4. `.aroma/` retention / GC policy (this slice ships write-only).
