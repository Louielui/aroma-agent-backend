# EVIDENCE-001 — physical residue of the Phase 3a `writeLauncherDir` containment failure

**Status:** preserved, do not delete (Owner ruling, 2026-07-28)
**Subject:** `C:\Aroma\w-8cee440baa53492980e9fcbb29b1f1cc.tmp`

## Why this record exists

During Phase 3a deployment the containment probe reported
`*** CONTAINMENT FAILED on writeLauncherDir = True ***` — the Companion account
successfully wrote into `C:\Aroma`, the directory holding the launcher. The ACL was then
corrected and a later run reported `writeLauncherDir = False`.

What nobody noticed at the time is that the failing write **left a file behind**. The
probe's `Try-Write` helper creates a marker, deletes it, and returns `$true`; the delete
was denied, the helper ignored that (`-ErrorAction SilentlyContinue`), and the marker
persisted. It was found on 2026-07-28 while checking for side effects of an unrelated run.

This file is therefore the only physical artifact proving the 3a write actually landed on
disk, rather than merely being reported as landed. The Owner ruled it preserved.

## The artifact

| Field | Value |
|---|---|
| Path | `C:\Aroma\w-8cee440baa53492980e9fcbb29b1f1cc.tmp` |
| Owner | `AromaBrain\AromaOperator` |
| Created (UTC) | `2026-07-28T05:32:42.5706183Z` |
| Modified (UTC) | `2026-07-28T05:32:42.5706183Z` |
| SHA-256 | `B35E09FA2CED9EBCAD9D16336FB961146FE34BFBEBC562679DA85F8A314C9DCA` |
| Content length | 3 bytes |
| Content (hex) | `78 0D 0A` |
| Content (text) | `x\r\n` |

The owner SID being the Companion account — not `louis`, not `Administrators` — is what
makes this evidential. A file in `C:\Aroma` owned by `AromaOperator` cannot have been
created by anything except that account writing there.

The creation time corresponds to roughly 01:32 local, which falls inside the 3a
deployment window (the account's first logon is recorded at 01:39 local).

## The contrast fact

The same account writing to the same location today is refused.

**Provenance — this is NOT a measurement taken by the assistant.** It is the Owner's
reported result, supplied as an established environment fact on 2026-07-28:

> 由帳戶自己實測:3 個讀取 + 5 個寫入全部 PermissionDenied

The assistant's own independent re-measurement of `writeLauncherDir` under the Companion
account, in session 5, has **not** been performed — it requires executing as that account,
which was blocked at the time of writing. See the note on measurement scope below.

So the pair reads:

| | Then | Now |
|---|---|---|
| Date | 2026-07-28 ~05:32 UTC | 2026-07-28, later |
| Result | write **succeeded** (residue on disk) | write **PermissionDenied** |
| Source | probe output + this artifact | Owner-reported measurement |
| Independently re-measured by assistant | n/a | **no** |

## Measurement-scope caution

The 3a probe emitted 17 booleans and nothing else — no `whoami`, no SID, no SessionId, no
window station. A result carrying no scope can be relabelled after the fact. Any future
citation of this record must state the identity and session the measurement came from.

This defect is corrected in the Containment Set v2 design, where every row carries
`MEASURED_BY` / `MEASURED_SID` / `MEASURED_SESSIONID` / `MEASURED_WINSTA` /
`MEASURED_DESKTOP` / `MEASURED_AT`, plus `residueLeft` and `residuePath` — the field whose
absence is the reason this artifact went unnoticed for a day.

## Handling

- Do **not** delete.
- Do **not** overwrite or touch the timestamps.
- If `C:\Aroma` is ever cleaned, this file is excluded by name.
- Any tooling that sweeps `w-*.tmp` markers must exclude this hash.
