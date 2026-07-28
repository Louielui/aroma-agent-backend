# EVIDENCE-002 — containment re-run measured inside AromaOperator's own interactive session

**Date:** 2026-07-28
**Result:** 17 / 17 hold
**Supersedes nothing.** The Phase 3a run remains valid for what it measured; this run
measures the same assertions under a genuine interactive session, which 3a did not have.

## The measurement

Assertions are byte-identical to `deploy-companion.ps1` (verified line by line with `-ceq`,
17/17) — no assertion was changed, added or removed.

```json
{"readGoogleRefreshToken":false,"readGoogleOAuthClient":false,"readDotEnv":false,
"readClaudeCreds":false,"readLauncher":false,"writeLauncherDir":false,
"writeCRoot":false,"writeProgramData":false,"writeUsersPublic":false,
"listRepo":false,"writeAuditStore":false,"listSecrets":false,"listLogs":false,
"listBackup":false,"listOwnerProfile":false,"readStagedCompanion":true,
"writeEvidence":true,
"MEASURED_BY":"aromabrain\\aromaoperator",
"MEASURED_SID":"S-1-5-21-2042659270-2029498691-2127769412-1009",
"MEASURED_SESSIONID":5,"MEASURED_WINSTA":"WinSta0","MEASURED_DESKTOP":"Default",
"MEASURED_AT":"2026-07-28T09:03:16.9197718-05:00"}
```

Stored at `C:\Aroma\ComputerOperator-Evidence\containment-probe-rerun.out`.

Unlike the 3a probe, this record carries its own scope. The 3a probe emitted 17 booleans
and nothing else, so its results could be — and were — read as more definitive than the
identity behind them warranted.

All 17 targets were confirmed to EXIST before the run. `Try-Read`/`Try-List`/`Try-Write`
catch every exception, so a `false` could otherwise mean "not found" rather than "denied".
Every `false` here is a genuine access denial.

## Does the interactive token change any pass mechanism?

The question asked: this run used a real interactive logon, so the token carries
`S-1-5-4 INTERACTIVE`; do all 17 still hold under a token with strictly more group SIDs?

**Measured answer: 16 of the 17 targets carry no logon-type-dependent ACE at all.**

| Target | ACE granting to INTERACTIVE / BATCH / NETWORK |
|---|---|
| `C:\Aroma\secrets` (1, 2, 12) | none |
| `C:\Users\louis` (4, 15) | none |
| `C:\Aroma` (5, 6) | none |
| `C:\` (7) | none |
| `C:\ProgramData` (8) | none |
| `C:\ProgramData\AromaBackup` (14) | none |
| **`C:\Users\Public` (9)** | **`INTERACTIVE:(RX,WD,AD)` + `INTERACTIVE:(OI)(CI)(IO)(M,DC)`** |

For those 16, group-SID composition is irrelevant: nothing in their DACLs references a SID
that a logon type can add or remove. Their mechanism is unchanged.

### Assertion 9 is the exception, and its mechanism IS different

`C:\Users\Public` grants `INTERACTIVE:(RX,WD,AD)` on the container — `WD`+`AD` are
CreateFiles and AppendData. Under an interactive token that grant is **live**. The
assertion holds only because the explicit `AromaOperator` DENY is evaluated first in
canonical order (explicit DENY precedes explicit ALLOW).

So for assertion 9 the DENY is load-bearing. It is the single row where removing the DENY
would flip the result.

### Correction to the premise

It does not follow that the 3a token lacked `S-1-5-4`. `Start-Process -Credential` uses
`CreateProcessWithLogonW`, which performs a `LOGON32_LOGON_INTERACTIVE` logon — that logon
type normally *does* add the INTERACTIVE SID. The 3a token no longer exists and cannot be
inspected, so **this is not verifiable retroactively** and is recorded as unknown rather
than assumed either way.

What definitely changed is session attachment: a real SessionId, `WinSta0\Default`, a
loaded HKCU hive and an on-disk profile. Not necessarily the INTERACTIVE SID.

The robust statement, which does not depend on the unknown: **today's measurement was taken
under a token that certainly carries `S-1-5-4`, and all 17 still hold.** Containment is
therefore proven under a token at least as permissive as 3a's.

The Tier A probe dumps token group SIDs so this question is answerable by measurement from
now on instead of by inference.

## Collateral fact 1 — ExecutionPolicy is policy, not containment

The probe could not be launched with `& $f`; AromaOperator's default execution policy
blocked it, and it required `-ExecutionPolicy Bypass -File`.

**This must not be counted as containment.** An execution policy is a configuration
setting, not a security boundary: any user who can run PowerShell can bypass it
(`-ExecutionPolicy Bypass`, `-EncodedCommand`, piping to stdin, `.  { }` on file content).
It stops accidents, not an adversary.

Recorded here so no future report cites "the account could not run the script" as evidence
of restriction. Classification: **not a mechanism**. It belongs in neither the ACL,
session-isolation, nor privilege categories.

## Collateral fact 2 — C:\AromaOperator-Probe rests entirely on one explicit DENY

```
C:\AromaOperator-Probe
  AromaBrain\AromaOperator:(OI)(CI)(DENY)(DE,WDAC,WO,WD,AD,WEA,WA)
  AromaBrain\AromaOperator:(OI)(CI)(RX)
  NT AUTHORITY\Authenticated Users:(I)(M)
  NT AUTHORITY\Authenticated Users:(I)(OI)(CI)(IO)(M)
```

`C:\` grants `Authenticated Users:(OI)(CI)(IO)(M)` by Windows default, so **every** new
top-level directory inherits Modify for every authenticated account, AromaOperator
included. The probe directory is protected by exactly one thing: the explicit DENY, which
canonical ordering places ahead of the inherited ALLOW.

Remove or fail to apply that DENY and the account regains Modify on the script it executes
— the original TOCTOU exposure, relocated rather than removed.

**This is the same class of hole as `C:\Aroma`**, where an inherit-only deny-all
`(OI)(CI)(IO)(N)` is likewise the only thing standing between the account and the tree.
In both cases containment is a single ACE deep, with a permissive default underneath.

Consequences to carry forward:

- any future integrity check on the probe directory must assert the DENY ACE is **present**,
  not merely that the account currently cannot write — the second is a symptom, the first
  is the cause
- the same check belongs on `C:\Aroma`
- neither location should be treated as safe-by-default; both are safe-by-exception
