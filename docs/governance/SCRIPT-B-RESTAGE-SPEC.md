# SCRIPT B — Companion re-stage. **SPECIFICATION ONLY. NO EXECUTABLE EXISTS.**

No file implements this. Nothing has been staged, deleted, backed up or permissioned. This
document is what Script B would have to do; writing it is a separate Owner GO, and running it is
another one after that.

## 0. The fact stated first

**This work cannot meet the "only touch the new child" rule, by definition.** Re-staging means
deleting and rebuilding `C:\Aroma\ComputerOperator-Companion`, which is an existing child of
`C:\Aroma`. That is why it is not bundled with Script A and must not inherit A's approval.

Script A's guarantee — zero ACL writes outside the new child — is real precisely because B was
taken out of it.

---

## 1. Backup and restore

The current `deploy-companion.ps1` does `Remove-Item -Recurse -Force` and then rebuilds
(lines 215–229). If anything fails between those two points, the old staging is simply gone and
the Companion cannot load. Rejected.

**Required sequence:**

1. **Back up first, verify the backup, and only then delete anything.**
   - Backup root: `C:\Aroma\ComputerOperator-Backups\companion-<UTC timestamp>\`
   - The timestamp comes from the run, so a backup never overwrites a previous one.
   - Permissions on the backup root: inheritance PROTECTED, and **only**
     `BUILTIN\Administrators` FullControl and `NT AUTHORITY\SYSTEM` FullControl.
     **No ACE for AromaOperator at all** — it must not be able to read, alter or delete its own
     prior code. This is elevated-only by construction, not by convention.
   - **Note:** creating that root is itself a new child of `C:\Aroma` and would need the same
     treatment Script A gives its directory. It is a second new child, and it belongs to B's
     approval, not A's.
2. Copy every file from the staging directory to the backup, then **verify by hash**: every
   source file's SHA-256 must equal its copy's. A backup that was not read back is not a backup.
3. Record a manifest at `<backup>\BACKUP-MANIFEST.txt`: each filename, its SHA-256, the source
   ACL as SDDL, the directory owner, and the UTC time.
4. Only after all of the above succeeds may the staging directory be removed.

**Restore, exactly:**

```powershell
# 1. remove the failed rebuild (if any)
Remove-Item -LiteralPath 'C:\Aroma\ComputerOperator-Companion' -Recurse -Force

# 2. recreate and restore the files
New-Item -ItemType Directory -Path 'C:\Aroma\ComputerOperator-Companion' | Out-Null
Copy-Item -Path 'C:\Aroma\ComputerOperator-Backups\companion-<STAMP>\*.js' `
          -Destination 'C:\Aroma\ComputerOperator-Companion'

# 3. re-apply the recorded SDDL from BACKUP-MANIFEST.txt
$acl = Get-Acl -LiteralPath 'C:\Aroma\ComputerOperator-Companion'
$acl.SetSecurityDescriptorSddlForm('<SDDL recorded in the manifest>')
Set-Acl -LiteralPath 'C:\Aroma\ComputerOperator-Companion' -AclObject $acl

# 4. verify every restored file against the manifest hashes before declaring success
```

**Automatic rollback:** any failure at any step — copy, hash mismatch, ACL read-back, closure
check — triggers the restore above and then `exit 1`. The script must not leave a half-built
staging directory behind, and must not report success it cannot evidence.

## 2. Undeclared files — reported, never deleted

I could not read `C:\Aroma\ComputerOperator-Companion` from a non-elevated session: both
`Get-Acl` and `Get-ChildItem` returned Access Denied, because its ACL grants only AromaOperator
`ReadAndExecute` and Administrators `FullControl`. **So I do not know what is in it**, and any
claim about its contents would be a guess.

**Required:** the first elevated action is a **read-only inventory** — every filename, size and
SHA-256, plus the directory's owner and SDDL — printed and **reported to the Owner**. The script
then stops if anything is present that is not one of the seven closure files. It does **not**
decide to delete. The Owner rules on each undeclared file.

This is not caution for its own sake: a re-stage once silently destroyed `session-identity.ps1`,
the script the SessionGate task points at, and only one Tier A row ever noticed.

## 3. Closure

- **Source: `C:\Aroma\aroma-3b`** (worktree of `feat/computer-3b-observation`).
- **Never** `C:\Aroma\aroma-agent-backend` — verified on `main` @ `1a6d7bd`, with no
  `sealedOrderGate.js`. Staging from there yields the old five-file Companion **with no error**.
- The closure must be **exactly** these seven names and seven hashes. One extra or one missing
  is a stop, not a warning.
- **No `-ForceRestage`, and no other parameter that skips a check.** The existing switch exists
  in `deploy-companion.ps1`; Script B must not have one. If a check is wrong, fix the check.

| SHA-256 | File |
|---|---|
| `1edf466f76adab982e7b17e39953f4b0867fd65e9f29ece03e419f916294bef2` | `scripts/computer/companion-entry.js` |
| `b6c4ae49895686ab2bae31832f256929b1bb759f26dc1fc3b86d53733168709a` | `src/computer/companion.js` |
| `1d748ae2e7fd770fb973849bd3281e239c7ff86d127205001312afd2a60e06bf` | `src/computer/ipcChannel.js` |
| `3ade684cd16e58556780dec0f2bf9b7f7cbce811726e72cb806d6c840dbeea28` | `src/computer/sessionBoundary.js` |
| `c7c7d78dbd0a88ecedcb494f9790a58d61f8c961db7d5d9b59f9bda45eaac4b3` | `src/computer/sealedOrderGate.js` |
| `7041ab939688e167c3d417a022988171be5cbc8b5f2dfcf6886fd5ced8f5644b` | `src/computer/computerOperatorFlag.js` |
| `942dabf0ba653ff36afc47abd74763caa358d7fd9456254c5592043705d02b17` | `src/computer/observation.js` |

Source commit: `feb4170ad4246ccdf592456f7cfac8072f370304`.

Hashes are checked **before** the delete (source side) and **again after** the copy (staged
side). Both sets must match the table; a mismatch after copying triggers the restore.

## 4. ACL on the rebuilt staging directory

| # | Principal | SID | Type | FileSystemRights | Mask | Inheritance | Propagation | Inherited | Applies to |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `AROMABRAIN\AromaOperator` | `S-1-5-21-…-1009` | Allow | `ReadAndExecute` | `0x1200A9` | ContainerInherit, ObjectInherit | None | false | This folder, subfolders, files |
| 2 | `BUILTIN\Administrators` | `S-1-5-32-544` | Allow | `FullControl` | `0x1F01FF` | ContainerInherit, ObjectInherit | None | false | This folder, subfolders, files |
| 3 | `NT AUTHORITY\SYSTEM` | `S-1-5-18` | Allow | `FullControl` | `0x1F01FF` | ContainerInherit, ObjectInherit | None | false | This folder, subfolders, files |

`SetAccessRuleProtection($true, $false)` — protect, discard inherited ACEs, same reason as
Script A: the parent's inherit-only Deny would otherwise survive and beat the Allow.

**AromaOperator gets `ReadAndExecute` only** — not even `Write`. It runs this code; it has no
reason to alter it. No `Delete`, `ChangePermissions`, `TakeOwnership` or `FullControl`, asserted
right by right with `-band` and printed, as in Script A. **No justification for anything wider
is offered, because none is needed.**

This is narrower than the existing `deploy-companion.ps1` behaviour in one respect: that script
grants the same `ReadAndExecute` but does **not** grant SYSTEM, so the current staging directory
may have no SYSTEM ACE at all. The inventory in §2 will show what is actually there.

Predicted SDDL after:
```
D:PAI(A;OICI;0x1200a9;;;S-1-5-21-2042659270-2029498691-2127769412-1009)(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)
```

## 5. Blast radius

Written by Script B:

| Path | Written | Why |
|---|---|---|
| `C:\Aroma\ComputerOperator-Companion` | **YES** — delete, recreate, `Set-Acl` | the purpose of the script |
| `C:\Aroma\ComputerOperator-Backups\…` | **YES** — create, copy, `Set-Acl` | the backup required by §1 |
| `C:\Aroma` | NO — `Get-Acl` read only | never relaxed to make a child writable |
| `C:\`, `C:\ProgramData`, `C:\Users\Public` | NO | not referenced |
| `ComputerOperator-Evidence`, `ComputerOperator-Test` | NO | not referenced |
| `secrets`, `aroma-agent-backend`, `.env`, any credential path | NO | not referenced; source is read-only from `aroma-3b` |
| every other existing child of `C:\Aroma` | NO | not enumerated, not iterated |

**It is not zero, and it cannot be.** Two paths are written: the staging directory, which is the
point, and the backup directory, which exists because deleting without one was rejected. Both are
stated here rather than discovered at run time.

`deploy-companion.ps1` must **not** be used — it writes ACLs on `C:\Aroma` (L119), on `C:\`,
`C:\ProgramData` and `C:\Users\Public` (L146), and on every existing child (L170–176).

## 6. Not in scope

`$KeepReachable` (`deploy-companion.ps1` L101) does not include the canary test directory, so a
future run of that script will Deny it again. Recorded on the hygiene list; **not fixed here and
not widened into this scope.**
