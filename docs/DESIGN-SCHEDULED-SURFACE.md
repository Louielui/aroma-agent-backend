# A Scheduled surface — design, and the truth first

<!-- record-status: ACTIVE 2026-08-06 -->

**DESIGN ONLY. No code.** 2026-08-06.

---

# 0. THE TRUTH FIRST — she has no scheduler

> **Owner: 「香香今日一個排程任務都冇。備份嗰啲係 Windows 排程任務,唔係佢嘅。」**

Measured, not taken on trust:

| check | result |
|---|---|
| `setInterval` / `cron` / `schedule(` in `src/` | **0 matches** (excluding tests) |
| scheduling dependency in `package.json` | **none** — octokit, axios, dotenv, express, express-validator, googleapis, uuid |
| Windows tasks matching `Aroma` | `AromaBackup-SchedulerProbe`, `AromaCoreBackup-B2Sync`, `AromaReleaseRecords-B2Sync`, `AromaTruthData-B2Sync` — **all backup infrastructure, none hers** |

**So this is not a screen over existing data. It is a capability that does not exist, and the
screen is the last part of it.** A Scheduled tab built today would render an empty list
truthfully and be useless.

## And the question it exposes about what was just built

The Drive backlog check is **not scheduled**. It is computed lazily when the greeting is
fetched, with a 5-minute cache. So the honest answer to 「佢幾時去數?」 today is:

> **When you open a new empty conversation — at most once every five minutes.**

Which is a real answer, and for one task it may be the right one. See §5.

---

# 1. What should actually run on a schedule?

> ## The honest answer today is ONE — and even that one is weakly justified.

## The Drive batch check — the obvious candidate, and it buys less than it looks

The failure mode is the Owner forgetting. But **he only sees the line when he opens her**. A
schedule that runs at 07:00 and writes a row he does not look at has changed nothing.

> **A schedule only adds value once there is a delivery channel he sees WITHOUT opening her.**
> There is none today — no email out, no notification, no push. So scheduled-at-07:00 and
> computed-when-you-open are **equivalent in effect**, and the second is already built.

> ## ⚠ 2026-08-07 — THE MEASUREMENT THAT BOUNDS THE PARAGRAPH ABOVE
>
> **The equivalence holds for a sub-second list call. It does not survive a browser errand.**
>
> Measured, not estimated: **ERRAND-003 costs 6.8s for one ingredient**, and roughly **5–7s per
> additional one** sharing the browser. For the eight or so ingredients the Owner actually
> stocks that is **40–55 seconds**. 首頁 cannot compute that on open — nobody accepts a home
> screen that paints in fifty seconds.
>
> **So the recall check has exactly two possible modes: run by hand, or run on a trigger. There
> is no third**, where the Drive check has always had one.
>
> The reasoning above is **still correct and no longer applicable**. It was never a rule about
> schedules; it was a rule about tasks *cheap enough to compute on demand*, and it never said
> so because at the time no other kind existed. **The Drive check made the cheap case look like
> the general case.**
>
> ### Corrected form of §1's test
>
> | | verdict |
> |---|---|
> | cheap enough to compute on open (Drive: one list, sub-second) | on-open wins; a schedule buys only a series |
> | **too expensive to compute on open (recall: 40–55s of browser)** | **on-open is not available at all — the schedule is the only mode** |
>
> **The Owner's original 「唔好住起」 was right on the evidence available.** What changed is not
> the argument; it is that a task appeared on the other side of a distinction the argument had
> never needed to draw.
>
> ⛔ **And a schedule still does not make the briefing TRUE** — only fresher. See
> `src/home/errandKinds.js`: a timestamp is a fact about the past, and freshness is a claim
> about the present. Built 2026-08-07, **before** the scheduler, deliberately: without it a
> scheduler that silently stopped renders identically to one working perfectly.

What a schedule *would* add, and it is not nothing: **a series**. A daily row makes 「64 files,
53 days」 into a trend that can be shown to be getting worse. That is a byproduct, not a
justification.

## Credential health — the one thing that is genuinely schedule-shaped

A Google refresh token can go stale, and **nobody notices until they ask a question and get
nothing**. That is the exact failure a timer is for: a fault that is silent until the moment
it matters.

| | Drive backlog check | credential health |
|---|---|---|
| noticed without a schedule? | yes — the number is visibly stale | **no — it looks like 「nothing found」** |
| costs anything to run? | one Drive list | one cheap call |
| genuinely schedule-shaped? | not really | **yes** |

## What does NOT belong, stated so it is not proposed later

- **The backups.** Already Windows tasks, already working. Moving them into her would trade a
  scheduler that survives reboots for one that does not.
- **Anything against `aroma-system`.** Reads are cheap and she can do them on demand; nothing
  there changes on a clock he cares about.
- **Anything that costs money per run.** A paid model call on a timer is a standing bill with
  no one watching it. See §4.

> ### Verdict: one task genuinely earns a schedule (credential health), and the Drive check earns one only when a push channel exists.

---

# 2. What a scheduled run must record

```
taskId          which task
startedAt       when it began
finishedAt      when it ended  (absent = it did not finish — a crash is not a failure row)
outcome         one of the states below, never a boolean
found           the payload: { fileCount, oldestDays } — the WHAT, not just the whether
nextRunAt       when it is expected again  ← load-bearing, see below
reason          on any non-success, the specific cause
```

## Outcomes are states, never `ok: true/false`

| outcome | meaning |
|---|---|
| `RAN_FOUND_SOMETHING` | ran, and there is something to act on |
| `RAN_FOUND_NOTHING` | ran, and there genuinely is not |
| `RAN_SOURCE_UNREADABLE` | ran, but the source refused — **not the same as「nothing」** |
| `SKIPPED` | a precondition was unmet (flag off, no credentials) — deliberate, not a fault |
| `DID_NOT_RUN` | **see below** |

The first three are the read states this project already uses, arriving one layer up.

## ⚠ `DID_NOT_RUN` cannot be written by the thing that did not run

**This is the whole difficulty, and it decides §3.**

If a scheduled task never fires — the process was down, the trigger was disabled, the machine
was asleep — **nothing writes a row, because nothing ran.** A screen reading its own table
would show the last successful run and look calm.

> ### The absence of a row IS the signal, and something has to interpret absence.

That is what `nextRunAt` is for. It is stored on every run so a reader can compute:

```
now > lastRun.nextRunAt + grace   →   DID_NOT_RUN
```

**A scheduler that silently stopped must not be indistinguishable from one with nothing to
report.** That is `count: 43` in the time dimension: a quiet answer that reads as a calm one.

---

# 3. Where it runs — NEITHER of the two options alone

## In-process timer — it would lie

`setInterval` inside the 8090 process dies with the process, and the Owner restarts it by
hand. Two consequences, and the second is worse:

1. it stops silently whenever she is restarted or crashes;
2. **the screen would say 「scheduled daily」 while nothing has run for two days** — and it
   cannot record `DID_NOT_RUN`, because there was nothing running to record it.

**A timer inside a process that is restarted by hand does not implement 「scheduled」. It
implements 「scheduled, while I happen to be up」, and says the first.**

## Windows Task Scheduler alone — survives, but is not hers

It survives restarts and reboots and keeps its own `LastRunTime` / `LastTaskResult`. But the
work would live outside her, so **her Scheduled screen would be reporting on something she
does not own** and cannot describe beyond an exit code.

There is also a measured trap in this exact place: the backup tasks failed `0x1` because a
scheduler logon could not see user-profile files, and the fix was relocating the toolchain to
`C:\ProgramData`. **The same trap is waiting for any new task that touches
`C:\Aroma\secrets`.**

## ✅ The right shape: Windows triggers, she does the work and writes the row

```
Windows Task  ──HTTP──▶  127.0.0.1:8090  ──▶  she runs the check
   (trigger)                                   and writes the run record
```

| | |
|---|---|
| **the trigger survives restarts** | Windows owns it — the thing an in-process timer cannot do |
| **the work and the record live in her** | she owns the truth, and the record is in her store beside everything else |
| **`DID_NOT_RUN` is visible from BOTH sides** | Windows records a failed task when 8090 is down; she records the gap via `nextRunAt`. **Two independent witnesses to the same absence** |

### What it costs, stated plainly

- **A task must be installed out-of-band** — and this project has already flagged that shape
  as a governance smell (`a6-service-installed-outside-governance`). Whatever installs it
  should be a script in the repo, reviewed, not a one-off `schtasks` command nobody can find
  later.
- **The trigger needs a token** to call a guarded route, so a credential now lives in a task
  definition. It must be the service token, not the Owner session.
- **Two places to look when it misbehaves** — Task Scheduler history and her run records.
  That is the price of the two witnesses, and it is worth paying.

---

# 4. What a scheduled task must NOT do

> **Owner: 「everything on a schedule runs without me watching, which is exactly the condition
> the approval gates exist for.」** That is the whole rule, and it should be drawn now.

## The line

> ## On a timer: READS ONLY.
> **Anything that writes, dispatches, spends, or acts as the Owner requires approval — and
> approval requires him present. A schedule is by definition his absence.**

Forbidden on a schedule, without exception:

| forbidden | why |
|---|---|
| any write to `aroma-system` | production, and the deploy gates assume a human |
| any agent dispatch or work-order execution | an `effect` result has **no second gate** — `DESIGN-WORKER-ADAPTER.md` |
| any paid model call | a standing bill with nobody watching. If ever allowed: capped, declared, and visible on the screen |
| anything acting as the Owner | identity case 3 — `DESIGN-IDENTITY-DIMENSION.md` |
| **Phase 2 of the Drive work — moving files** | it writes. It stays manual or behind an approval, never on a timer |

## The one edge worth ruling on now

**May a scheduled task create a PENDING proposal?** It produces something awaiting his
decision, which is the correct shape — nothing happens without him.

> **Allowed, but it must be IDEMPOTENT: one open proposal per task, never one per run.**

Otherwise a daily task leaves 30 identical pending proposals in a month. We have already had
to clean residue by hand — `prop_80897e17` and the five before it — and that was from
occasional manual testing, not a daily loop.

## And make it structural, not a rule

Consistent with everything else this week: **the scheduled runner should be handed a
read-only capability handle**, not given a rule saying 「do not write」. If the runner cannot
reach a write path at all, 「reads only」 is a mechanism rather than an intention.

That is the same fence test: **「唔可能」,唔係「唔准」**.

---

# 5. Does the screen earn itself with one task?

> ## No. Build no screen yet.

One row is not a list. The greeting line works, it is in daily use as of tonight, and
**a working reminder beats a Scheduled tab with one row in it** — the Owner's own framing and
it is right.

## What the greeting line cannot do — and today it does not need to

The screen earns itself the moment 「did it actually run?」 becomes a question someone cannot
answer by looking. Today it is not a question, because:

- the check runs **when he opens her**, so if he is looking at the line, it just ran;
- if she is down, he sees no page at all — **nothing lies to him**;
- if Drive fails, the line **speaks** rather than going quiet.

**All three properties disappear the moment the check moves to a timer.** That is the real
trigger for building the screen — not a task count.

## The order this implies

| # | build | when |
|---|---|---|
| 1 | ✅ the greeting line | **done, tonight** |
| 2 | credential-health check | when a silent token failure has actually cost something, or before it can |
| 3 | the Windows-trigger + run-record shape | when the first genuinely unattended task exists |
| 4 | one extra line — 「上次查:X 分鐘前」 | the smallest honest step, and only once the check is no longer on-open |
| 5 | the Scheduled screen | **at three tasks, or at the first task that can fail silently — whichever comes first** |

**Step 5 is not a size threshold. It is the point at which absence becomes invisible**, and
that is the only thing a screen adds that a line cannot.
