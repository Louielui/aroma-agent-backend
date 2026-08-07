# `scripts/verify/` — one command per long-lived claim

> **Owner: 「every 'verified' claim names a command he can re-run that reprints the verdict.
> Report 引用 the command, not the conclusion.」**
> **「一個假嘅『已驗證』唔止係漏咗一次檢查 —— 佢退役咗你嗰份關注。」**

Every gate in this system terminates in me saying 「verified」. A false verified does not cost
one check — **it costs every future check you would have made.** These scripts exist so the
verdict comes from an artefact I did not author, in a form you can re-run without me.

| claim | command |
|---|---|
| the core-data off-site copy is present and matches | `node scripts/verify/offsiteBackup.js` |
| the four scheduled tasks are armed and healthy | `node scripts/verify/scheduledTasks.js` |
| what she claims to have is wired in the real assembly | `node scripts/verify/wiring.js` |

## Three verdicts, never two

| | exit | meaning |
|---|---|---|
| `PASS` | 0 | checked, and it holds |
| `FAIL` | 1 | checked, and it does not |
| **`UNKNOWN`** | **2** | **could not check** |

⛔ `UNKNOWN` exits **non-zero**. HR-23: a guardrail that cannot read its own evidence is BLIND,
not clean — and 「I could not look」 must never share an exit code with 「I looked and it was fine」.

## Every check prints its EVIDENCE, not just its verdict

The number, the path, the date it read. A verdict with no evidence is the thing being replaced.

## `wiring.js` refuses to answer in the wrong environment

It reads `C:\Aroma\xiangxiang.ps1` for the launcher's own `$env:` declarations and compares them
to the process it is running in. A mismatch is `UNKNOWN` **with the differences named** — never
a verdict about wiring.

That is HR-38 mechanised: on 2026-08-07 the same probe answered `not_authorized` in one shell
and `agent_bridge_authorized` under the launcher, and its own header had warned about exactly
that. 「行咗」 and 「喺啱嘅地方行咗」 are different things, and only a comparison tells them apart.

## What these deliberately do NOT do

- **They do not read exit codes as evidence.** `scheduledTasks.js` reads task state; a green
  task result is what the other two backup legs returned every night while the third was dead.
- **They do not self-report a ratio.** A number attached to my own judgement closes the question
  without answering it. These count things you can count yourself.

## Adding one

A claim earns a script when it is **long-lived** — something that can quietly stop being true
between the day it is verified and the day it matters. One-off verifications stay in the round
that produced them.
