# Phase 1 — she tells me what is waiting

**RECON + DESIGN ONLY. No code, no scope change, nothing built.** 2026-08-05.

> **Owner's KPI for the whole project:** 「what manual work will Louie never do again?」
> Moving scanned files between two Drive folders is repetitive, mechanical, zero-judgement,
> and **it stalls the entire invoice pipeline the moment he skips it**.

---

# 1. Can the existing `drive.readonly` scope do this? — VERIFIED LIVE

**Yes for the scope. No for the adapter.** Both halves measured, not assumed.

## The scope: verified working

Read-only listing with the credentials 香香 already holds:

| folder | id | location |
|---|---|---|
| `Scanned by Franco` | `1-A2R1fTvCrPgIeDG3iq_U4wyV388qDGI` | **Shared Drive** `0AJApVuax7MarUk9PVA` |
| `00_Inbox` | `1Jmovov85L4vwvOUWZ1ffrUSw71JVBz4F` | same Shared Drive |

Found by name, children listed, **`createdTime` and `modifiedTime` both readable**. No new
permission is required.

## ⚠ The adapter: returns ZERO from both folders today

```
Scanned by Franco   WITH shared-drive flags:  7    WITHOUT (adapter today):  0
00_Inbox            WITH shared-drive flags:  2    WITHOUT (adapter today):  0
```

**Both folders live on a Shared Drive, and `driveRead.js` passes no shared-drive flags.**
Google returns My Drive items only, so every query against these folders returns an empty
list — **indistinguishable from 「the folder is empty」**, which is precisely the failure mode
this design has to avoid.

Three concrete gaps in `src/context/adapters/driveRead.js`:

| gap | consequence |
|---|---|
| no `supportsAllDrives` / `includeItemsFromAllDrives` | **0 results from a Shared Drive** |
| `fields` omits `createdTime` | 「how old is the oldest」 can only use `modifiedTime` |
| `pageSize` 25, **no `pageToken`** | cannot count past one page, and truncates silently |

The third is the `count: 50` defect class already living in 香香's own code.

---

# 2. What is actually in there — and it is not what the premise assumed

```
Scanned by Franco  →  7 BATCH FOLDERS, not loose files

  2026-06-13     0 files   Invoices_20260612      ← empty
  2026-06-16     0 files   Invoices_20260508      ← empty
  2026-06-26     0 files   Invoices_20260626      ← empty
  2026-07-04    18 files   Invoices_20260704
  2026-07-04     4 files   Smallbills_20260704
  2026-07-15    18 files   Invoices_20260715
  2026-07-28    24 files   Invoices_20260728
  ──────────────────────────────────────────────
                64 files   across 4 non-empty batches
  oldest batch folder: 53 days old

00_Inbox  →  2 items
  2026-06-13  pdf         20260601_Statements_Midland_202605.pdf
  2026-06-09  text/plain  使用說明.txt              ← an instructions file, not work
  oldest item: 57 days old
```

## Three things this changes

1. **The unit is a batch folder, not a file.** 「Move the files」 is really 「move 4 folders」.
2. **Three batches are empty** — consistent with processing emptying them, so *emptied* is
   plausibly the done-signal. **Not verified**, and 香香 must not assert it.
3. **`00_Inbox` is nearly empty and one of its two items is a readme.** Downstream *does*
   drain it. So the number worth surfacing is the **Franco side**, not the inbox side.

## ⚠ 291 is not visible from here — stated, not explained away

The Owner said 291 invoices are waiting. **What is measurable is 64 files.** Possible
reconciliations, none of them verified:

- **a scanned PDF can hold several invoices** — 64 files could easily be 291 invoices, and
  this is the most likely explanation;
- files nested deeper than one level (**checked: no sub-folders exist inside the batches**);
- the count came from somewhere else entirely — the system's own queue rather than Drive.

**This is exactly why item 4 below matters.** She can count files. She cannot count invoices,
and the gap between 64 and 291 is the demonstration.

---

# 3. Chat answer, or self-surfacing? — SELF-SURFACING, on a screen that already exists

> **Owner: 「the whole failure mode is that I forget, so an answer I have to ask for may
> inherit the same defect.」** Correct, and it settles it.

**Not a chat answer.** It would require him to remember to ask — the same defect wearing a
different hat — and it would route through the classifier, **measured as non-deterministic**
(M-5).

**Not a new notification system either.** Use the surface he already opens:
`GET /api/v1/demo/greeting` renders the empty-screen line. **Add one line beneath it.**

## Design constraints on that, and one is non-negotiable

| constraint | why |
|---|---|
| **The greeting must never fail or block because Drive is slow or down** | it is currently a pure function of the clock. Making it network-dependent trades a working screen for a feature. **The line is added if it resolves; the greeting renders regardless.** |
| **Say nothing when there is nothing to say** | a line that appears every day becomes furniture and stops being read |
| **Age, not just count** | 「4 batches waiting」 is background. 「oldest is 53 days」 is the thing that acts |
| **Cache, do not poll per render** | one read per session or per N minutes; Drive is not free and the number moves slowly |

**A threshold is a product decision, not mine.** 「Show when anything is waiting」 and 「show
when the oldest exceeds N days」 are both defensible; the second stays readable longer.

---

# 4. Empty versus unreadable — FIVE states, and they never merge

Same discipline as the read layer. **The 0-vs-0 measurement above is why this is not
theoretical**: today, an unmodified adapter would return zero from a folder holding 64 files.

| state | what she says |
|---|---|
| **files waiting** | 「Scanned by Franco 有 4 個批次、64 個檔案,最舊嗰個批次 53 日前。」 |
| **read OK, nothing there** | 「Scanned by Franco 係空嘅 —— 冇嘢要搬。」 |
| **folder not found by name** | 「我搵唔到叫『Scanned by Franco』嘅資料夾。」 ← **NOT 「it is empty」.** A rename is the likeliest real-world failure and it must never read as good news |
| **read failed** | 「我睇唔到嗰個資料夾 —— <reason>。個數字我而家答唔到。」 |
| **not looked** | 「呢一次冇查 Drive。」 (flag off / no credentials) |

**「Nothing to move」 and 「I could not look」 must never collapse into the same sentence** —
and with the shared-drive gap unfixed, the wrong one would be shown today.

---

# 5. What she must NOT claim

She sees **file metadata on a Shared Drive**: name, mimeType, createdTime, modifiedTime. From
that she can say how many files, how old, in which batch. **Nothing else.**

| she cannot know | why |
|---|---|
| **how many invoices** | one scanned PDF may hold several. **64 files vs the Owner's 291 is the proof, not a hypothetical** |
| **whether they are invoices at all** | `00_Inbox` currently holds a `使用說明.txt`. A PDF in a folder named Invoices is a strong hint and not a fact |
| **whether any were already processed** | three empty batches *suggest* processing empties them; she has not verified it and must not assert it |
| **whether any are duplicates** | she reads no content |
| **when Franco actually scanned it** | `createdTime` is when the Drive object appeared. Close, usually. Not the same claim |

## The honest sentence

> 「『Scanned by Franco』有 **4 個批次資料夾、共 64 個檔案**,最舊嗰個批次 **53 日前**建立。
> `00_Inbox` 有 2 項。
> 我只數到**檔案**,數唔到入面有幾多張發票,亦分唔到邊啲你已經處理過。」

Three sentences: **what she counted, how old, and what she did not look at.** The third is the
one that keeps it usable — without it, 「64」 gets read as 「64 invoices」 and the number becomes
another `count: 43`.

---

# 6. Phase 2 — NOT DESIGNED, per instruction

She moves the files herself. That needs **Drive write scope**, which is one of the two
structural walls in Birth v1, and it needs a fence:

> 「can only move between these two specific folder IDs, cannot delete, cannot touch anything
> else」

Recorded only, so the shape is not lost. **Phase 1 goes into daily use first.**

Note for whenever it is designed: the fence claim will need a **probe that can fail**
(`DESIGN-WORKER-ADAPTER.md`), and 「cannot delete」 is a property of the *scope granted*, not of
the code — `drive.file` versus `drive` is the difference between a mechanism and an intention.

---

# What would have to change for Phase 1 — smallest honest list

1. `driveRead.js`: add `supportsAllDrives` + `includeItemsFromAllDrives`; add `createdTime` to
   `fields`; add `pageToken` looping. **Without the first, the feature returns 0 and looks
   like 「nothing waiting」.**
2. A declared folder-id table (like `PATHS` in `aromaSystemRead.js`) — **ids, not names**, so a
   rename fails loudly instead of silently returning nothing.
3. The five-state answer above, and the greeting line that renders only when it resolves.

**Nothing built. No scope change. All measurement was read-only metadata listing with the
credentials already in place.**

---

## ✅ EVIDENCE THAT THIS TARGETS THE REAL CONSTRAINT — recorded on Owner instruction

> **Owner: 「your finding that 00_Inbox is nearly empty means downstream works and the
> bottleneck is confirmed to be me.」**

Measured 2026-08-05:

| | |
|---|---|
| `00_Inbox` | **2 items**, one of them a `使用說明.txt` readme — so **≈1 real document** |
| `Scanned by Franco` | **64 files** across 4 non-empty batches, oldest **53 days** |
| invoices ingested in the last 30 days | **1** |

**Downstream drains.** If classification, the approval queue or the dual-write were broken,
`00_Inbox` would be the folder filling up. It is not — it is nearly empty while the folder
*upstream of the manual step* holds 64 files and 53 days of age.

> ### The bottleneck is the one manual step between the two folders.

This matters because it is the difference between **a feature aimed at a measured constraint
and one aimed at a guessed one.** The obvious guess — 「the invoice pipeline is broken, 1
invoice in 30 days」 — was wrong, and building against it would have meant rewriting a
pipeline that works.

**It also sets the success condition for Phase 2 in advance:** if she ever moves the files,
the number that should change is `00_Inbox` filling and then draining. If `Scanned by Franco`
empties while `00_Inbox` stays flat, something is being lost rather than moved.
