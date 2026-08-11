# CLAUDE.md — 香香 (Xiangxiang) agent backend

> **YOU ARE IN `C:\Aroma\aroma-agent-backend`. THIS IS NOT `aroma-system`.**
>
> This file exists because its absence was a live defect. Until 2026-08-05 this repo had no
> CLAUDE.md, so an agent working here loaded **`aroma-system`'s** project instructions —
> production's — and once proposed changes to production files while working on 香香. The
> only counterweight was a memory note, which is prose, not a mechanism. **This file is the
> mechanism.**

## 0. THE THREE REPOS — never conflate them

| path | what it is | risk |
|---|---|---|
| **`C:\Aroma\aroma-agent-backend`** | **HERE.** 香香, the Owner's local AI COO. Loopback `127.0.0.1:8090`. | local |
| `C:\Users\louis\Projects\aroma-system` | **PRODUCTION.** The restaurant's Business OS, `https://system.aromabistro741.com`. Has `origin`, and its `main` is the ref `deploy.sh` resets production to. | **production** |
| `C:\Aroma\aroma-3b` | Computer Operator observation work. Branch `feat/computer-3b-observation`, unpushed commits. | local |

**Before any file operation, confirm which repo the path is in. Use ABSOLUTE PATHS — never a
cwd-relative path that could resolve into the wrong repo (HR-9).**

## 1. WHO
Owner: **Louie — address him as "Chef"**. Owner-facing reporting is in written Traditional
Chinese, conclusion-first, senior-coordinator tone. Use **佢** for 香香. All code, comments,
specs, docs, commit messages: English.

## 2. THE WORKING RHYTHM — every round, in this order
```
diagnose from evidence → propose → explicit GO → failing tests FIRST (shown red)
  → implement → full suite → local merge to main → push → restart 8090
  → confirm live PID + commit → REPORT (what changed / what did NOT / risk / rollback)
```
**Never declare it working.** Report what was measured; the Owner decides what that means.

Standing approval covers ordinary work — git, tests, restarts, the launcher. Paid model calls
and real agent execution are surfaced every time.

## 3. THE DISCIPLINE THIS PROJECT IS BUILT ON
The recurring root cause, in the Owner's words: **「an unknown answered as a fact.」**

- **Measure, do not infer.** Read state from the LIVE process, not from the source that
  should produce it — that exact distinction has hidden defects here more than once.
- **Earn the zero.** A zero-count claim must first prove the instrument can record non-zero.
- **Recall is not evidence.** Routing must never be informed by recall.
- **Absent stays absent** (HR-5). Never default, never invent, never infer a date.
- **A test that asserts a field is MENTIONED can pass on a permanent null** (HR-6). Assert the
  value.
- **Silent drops** are the standing defect class. If something is withheld, it must be
  visible, not silent.
- **No new dependencies.** `node:test` only.

### ⛔ WRITING A ⛔ THAT RANGES OVER A CATEGORY? THE SURVEY TEST GOES IN THE SAME COMMIT.

A rule that says **「every X must Y」** names a category and belongs in a test that walks the
**DIRECTORY** — so files that do not exist yet are covered, and a non-conforming new file is red
the day it is written, by an author who never read the rule. A rule that explains **「this is
like this because…」** stays prose, correctly.

**Ask this before writing the test — it is the filter, not 「is it a class rule」:**

> ### **If this rule were quietly violated, would the Owner get a wrong answer he would believe?**

Yes → the survey test is required. No → prose is enough. The read-failure contract answered
**yes** (a 401 read as 「今日冇嘢要落單」), which is why it mattered; most category rules answer no
and would crash visibly or do nothing.

Measured 2026-08-11 (HR-69): **~489 of 913 ⛔ markers are category rules; 27 survey tests enforce
them.** That stock is a property of how this codebase is written, not a backlog — **it is not a
task and must never be logged as one.**

> ### 「一個完成唔到嘅 backlog 係一項長期指控，唔係計劃。」
> **A backlog that cannot be completed is a standing accusation, not a plan.** (Applies to any
> such list here, not only this one.)

**This rule is about FLOW, and that is the whole of it: 489 stays 489, and does not become 500.**

House rules HR-1..HR-9 are in `docs/HOUSE-RULES.md` and are binding.

## 4. GOVERNANCE — the central idea
**Structural vs declared.** A prohibition enforced by the environment is a mechanism; the
same words with no environment behind them are an intention.

> **`forbiddenActions` degrades from mechanism to intention** whenever a path to consequence
> exists from where the work happens. The condition is **not** the medium — it is whether a
> browser is logged in, or whether **a working copy has a remote**. See
> `docs/GOVERNANCE-BROWSER-VS-FILE.md`.

> ### 「危險嗰個唔似危險嗰個。」
> ### **The dangerous one is the one that does not look dangerous.**
>
> A browser logged into a retailer announces itself; nobody mistakes it for contained. **A
> git repo on disk looks identical whether or not it has a remote** — and the reassuring
> words (sandbox, working copy, local edit, just a diff) read exactly the same in both cases.
> That is why the browser felt obviously risky and production sitting in a working directory
> did not. **Before any file operation, ask what path to consequence exists from here.**

Identity is the third class of risk object — no identity / own identity / the Owner's
identity — and only the first is honestly carried today. See
`docs/DESIGN-IDENTITY-DIMENSION.md`. **`who` in the audit means the APPROVER, not the actor.**

**Four-flag execution matrix** (`WORKER_INVOCATION`, `DEVELOP_DISPATCH`, `AGENT_BRIDGE`,
`COMPUTER_OPERATOR`): any two on → `configuration_conflict` → zero execution. Do not weaken
it to avoid a choice.

## 5. LAYOUT
- `src/intake/` — turn router (pure, free, zero-context), answer plan (strict `json_schema`;
  the model decides, **the server proves every fact**), route/evidence guard.
- `src/context/` — read layer. Four read states plus 「not asked」. `readContext.js` holds the
  entity vocabulary; `adapters/aromaSystemRead.js` is **structurally read-only** (one constant
  `method: 'GET'`, a frozen path list, no write route reachable).
- `src/agent/` — sealed work orders, `workOrderView.js` (WYSIWYA: every card value is read
  from `canonicalWorkOrder`), audit.
- `src/store/` — the truth store. `dataDir.js` is the single resolver; tests are redirected to
  a temp dir so they can never write the Owner's store.
- `src/computer/` — Computer Operator surface. **`windowTitle` must never return to the audit
  record** — it can carry a customer name, and the audit mirrors offsite nightly.

## 6. ENVIRONMENT
Launcher `C:\Aroma\xiangxiang.ps1` sets the flags and hydrates `HUB_TOKEN` from the User
environment. Secrets in `.env` (`AROMA_SYSTEM_KEY`, model keys) — **never print one, never put
one in a log, an error or a commit.**

## 7. PRODUCTION IS A SEPARATE PROTECTION LAYER
Nothing in this repo may reach `aroma-system` production. **AromaBrain cannot deploy — no SSH
key exists on this machine and `known_hosts` names only `github.com`. That is a wall to
PRESERVE, not an inconvenience to fix.** See `docs/AROMA-SYSTEM-WORKING-MODEL.md`.

## 8. WHEN IN DOUBT
Report the uncertainty rather than resolving it silently. A stated unknown is always
acceptable here; a confident wrong answer is the one failure this project keeps removing.
