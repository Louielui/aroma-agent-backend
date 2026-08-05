# Owner Language Policy — Round 2 re-audit

**Audit only. No string was rewritten to produce this file.** Owner ruling: the corrected list
lands before any wording changes, and the rewriting order is ruled on separately.

Date: 2026-08-05. Scanned at commit `171143e`.

---

## 0. WHY THIS FILE EXISTS — the first audit was WRONG, not merely short

The original Round 2 audit scanned **only `.js`**. It missed 11 Cantonese lines in
`index.html` and `settings.html`, and — more importantly — it missed two entire *categories*:
the backup scripts (§B-9) and the red-line regexes (§SECURITY).

A list that is short gets extended. A list that is wrong gets **inherited**. That is the reason
this is a file and not a message.

**Scope of the corrected scan:** every tracked file (413 files, 9 file types), not just `.js`.
Cantonese detected by particle markers; comment-only lines excluded.

**Headline: 120 Cantonese-bearing lines** in runtime strings or data tables across 24 non-test
files — 110 by the first particle set, +10 found by the manual pass (§10a).

**But the more important number is in §10b:** the audit was indexed by *contains Cantonese*,
while Category B is defined by *makes a promise*. Those are different sets. The governance list
in §5 is therefore a floor for a second, unrelated reason, and at least 14 governance strings
already in written Chinese were missing from it entirely.

---

## 1. FILE TYPES — including the ones that were a surprise

| Type | Cantonese lines | Note |
|---|---|---|
| `.js` | 87 | the original audit's only scope |
| `.ps1` | **13** | **entirely missed before.** Backup scripts — see §B-9 |
| `.html` | **11** | missed before. Owner said "at least 10"; the real count is 11 |
| `.md` | 5 | dev docs only — **no `.md` renders to the screen** (verified in `app.js` and the routers) |
| `.css` | **0** | verified negative, not skipped |
| `.json` / `.svg` / `.gitignore` / `.example` | **0** | verified negative |

**Two things outside the repo, checked and clear:**
- The live launcher `C:\Aroma\xiangxiang.ps1` — **zero Cantonese**, and it is not in the repo.
- The ACL-locked backup scripts in `C:\ProgramData\AromaBackup\scripts` — **zero Cantonese**.
  They are read-only for `louis` by design. **Do not touch them, do not propose touching them.**

---

## 2. SECURITY — the red-line regexes. Read this before anything else in this file.

`src/persona/ownerSettings.js` lines **99, 103, 105**.

> **They match the Cantonese someone impersonating the Owner would type.**

That sentence is the clearest statement of why input-matching Cantonese is not a style
question, and it is recorded here verbatim so it cannot be missed.

| Line | Matches | What it stops |
|---|---|---|
| 99 | 「唔係香香」/「你係另一個 agent」 | a settings-box instruction telling her she is a different agent |
| 103 | 「假裝／當作／扮作…冇限制／規則／守衛」 | an instruction to pretend the guards are absent |
| 105 | 「唔使確認／批准／授權／審批」 | an instruction to drop the approval gate |

**Treating any of these as copy silently dismantles a red line.** They are input patterns for
hostile text. They do not appear on any screen. **They must not be rewritten, tidied,
"modernised", or converted to written Chinese** — the attacker writes Cantonese, so the
matcher must read Cantonese.

The same reasoning applies to every entry in §C, but this is the one with a security
consequence rather than a comprehension one.

---

## 3. MY OWN CORRECTION — the original list contained an entry that was simply wrong

The original audit listed **"MockAdapter greetings"** as input-matching Cantonese that must not
change. That is **false**. `src/adapters/MockAdapter.js:4` is:

```js
const GREET = ['你好','哈囉','嗨','早安','午安','晚安','hi','hello','謝謝']
```

**Not one Cantonese word.** All standard written Chinese. The entry should be struck from the
protected list, and no one should spend time protecting it.

Recorded rather than quietly dropped, so the next reader does not inherit it.

---

## 4. CATEGORY A — presentation strings (~38 lines)

Ordinary Owner-facing copy. Style pass, low risk.

| File | Lines | Example |
|---|---|---|
| `src/demo/assets/app.js` | 395, 418, 424, 433, 501, 503, 504, 710, 761, 771 | 「讀唔到呢個對話，可以再撳一次。」「複製唔到」「睇錯咗？直接打多句話講清楚就得，唔使填表。」 |
| `src/demo/assets/index.html` | 56, 83, 90 | 「揀邊個香香」「你想她點樣講嘢。例如：『講嘢簡短啲…』」 |
| `src/demo/assets/settings.html` | 19, 26 | duplicates of the two hints above |
| `src/intake/readResultView.js` | 64, 152, 202 | 「香香睇法」「冇日期」「暫時搵唔到同「X」直接相符嘅記錄。」 |
| `src/context/adapters/aromaSystemRead.js` | 111, 115, 116, 120 | 「應該保持嘅水平」「系統計出嘅補貨量」「點咗幾多項」 |
| `src/agent/requestInference.js` | 129, 131, 132 | 「你想改邊個檔？」 |
| `scripts/backup/Install-MonthlyBackupShortcut.ps1` | 58 | 「佢唔會自動行，亦冇排程任務。」 |

**Duplication hazard:** `index.html` and `settings.html` contain two pairs of **byte-identical**
sentences (the style hint and the memory hint). Change them together or the two screens diverge.

---

## 5. CATEGORY B — governance strings (~46 lines), each with the promise it makes

**These are not copy.** The "promises" column is what must survive rewording exactly. Check the
promise, not the grammar.

### B-1 Identity and guards — `index.html:101-102`, `settings.html:42-43`
> 「呢頁只改風格、記憶同開關。身分（PERSONA_IDENTITY）係凍結嘅，唔喺呢度改。」
> 「誠實守則、紅線政策、讀取狀態守衛係程式碼，唔係文字——寫喺呢度嘅嘢改變唔到佢哋。」

**Promises:** (1) this screen cannot change identity; (2) the three guards are **code**, so text
typed into the settings box **cannot inject them**. The second is an anti-injection statement,
not an explanation.

### B-2 Read states — `readResultView.js:218-220, 223`, `readStateGuard.js:231-236`
> 「讀唔到」/「讀到，但冇相關結果」/「搵唔到直接相符嘅 X（最近項目 N 項未列出）」/
> 「部分項目因長度上限未顯示 —— 見唔到唔代表冇。」
> 「〔系統更正 — 依實際讀取紀錄〕上面講「讀唔到」係唔啱嘅…以呢個紀錄為準。」

**Promises:** the read states are **distinct and must never collapse into each other**; the
correction must assert it derives from the **actual read record**, not from another opinion.

> ⚠️ **`readStateGuard.js:34` (`UNREADABLE_CLAIM`) MUST BE WIDENED IN THE SAME ROUND that any
> read-failure wording changes.** Standing Owner instruction, 2026-08-04 — that exact trap has
> already been hit once, when a negative regex kept passing while protecting nothing.

### B-3 Approval gates execution — `app.js:919, 922`, `intakeService.js:716`
> 「已批准。香香開始喺丟棄式副本入面做。」
> 「已批准：工作單已確認，但執行通道未開啟，所以甚麼都冇跑過。」
> 「我未有建立提案 —— 呢句我當咗係傾偈。」

**Promises:** approved ≠ executed; with the channel closed **nothing ran at all**; conversation
creates no proposal. 「甚麼都冇跑過」 is a factual assertion and must not soften to "may not
have run".

### B-4 Refusal reasons — `credentialHealth.js:58-60, 93, 94, 109, 134, 144, 153`
> 「搵唔到／讀唔到／格式唔認得／唔完整／睇唔到幾時到期／已經過期 …所以冇派工。」

**Promises:** every one states **no dispatch happened** and the exact reason.
「狀態未知就當唔可用」 is a **fail-closed** declaration and must not become vague.

### B-5 Work order and audit surfaces — `agentResultView.js:182, 184, 185, 195`, `patchStore.js:77`
> 「冇改動，所以冇 patch。」「patch 太大，冇寫入 —— 改動範圍超出咗預期。」
> 「改動已經隨副本刪除，要重新跑。」「改動去咗邊」

**Promises:** where the change went, whether it was written to disk, and that deleting the copy
destroyed it.

### B-6 Data egress — `app.js:55` ⚠️
> 「一樣睇到 …—— 但呢啲資料會送去 OpenAI」

**Promise:** choosing GPT means the data leaves this machine. **The original audit filed this
under presentation, which was wrong** — it is the only sentence in the interface that says data
leaves.

### B-7 Data scope limits — `aromaSystemRead.js:61`, `readResultView.js:219`
> 「每項有一個存量數字，但冇分地點、亦冇記錄係幾時嘅」

**Promise:** these numbers **do not carry** location or a timestamp. Any rewording that reads as
"the data is complete" has broken it.

### B-8 香香睇法 rules — `conversationContract.js:134, 136`

**Promise:** the opinion section **may contain no numbers** and no facts beyond the evidence.
This is an instruction constraining the model, not interface copy.

### B-9 BACKUP RESULTS — `scripts/backup/Monthly-OfflineBackup.ps1:53, 67, 71-73, 76, 124, 145, 153, 171, 172, 175`

> **OWNER RULING 2026-08-05: HIGHEST CARE ON THIS LIST, above the conversational governance
> strings. Rewrite these LAST, ALONE, with the promise stated beside each.**
>
> Owner's reasoning, recorded because it sets the priority: 「未成功嗰啲唔可以當有備份」 protects
> him from reading a failed backup as a successful one, **on a screen he looks at once a month
> while tired**. A conversational string that degrades costs one confusing answer. This one
> costs **a backup he thinks he has**.

| Line | String | Promise |
|---|---|---|
| 175 | 「未成功嗰啲唔可以當有備份。睇返上面紅色嗰幾行。」 | a red line is **not** a backup — stops a partial run reading as success |
| 171 | 「而家有三份：呢部機、Backblaze / GitHub、同你手上呢個碟。」 | the 3-2-1 assertion — only true if every leg verified |
| 172 | 「可以安全咁拔出個碟。」 | it is safe to unplug **now** |
| 53 | 「❌ 冇備份到。」 | nothing was written |
| 67 | 「搵唔到 X: 磁碟機…」 | the drive was never found — no partial write happened |
| 71-73 | 「認到個碟，但讀唔到入面嘅檔案系統 —— 幾乎肯定係 BitLocker 仲鎖住。」 | names the cause and the fix, and that **no admin rights are needed** |
| 76 | 「掛載咗但入唔到。」 | mounted ≠ writable |
| 124 | 「N 個檔，全部 sha256 對得上」/「N 個對唔上」 | **per-file hash verification**, not a file count |
| 145 | 「bundle 驗證唔過」 | the git bundle exists but did not verify — worse than absent |
| 153 | 「搵唔到 git」 | the check could not run at all — distinct from failing |

**These were entirely absent from the original audit.**

---

## 6. CATEGORY C — input-matching Cantonese. MUST NOT CHANGE. (25 lines)

She must keep understanding Cantonese; only her **output** changes. Anything here is a matcher
against what the Owner (or an attacker) types.

| File | Lines | What it matches | In the original list? |
|---|---|---|---|
| `persona/ownerSettings.js` | 99, 103, 105 | **red lines — see §2 SECURITY** | ❌ **new** |
| `context/readContext.js` | 167, 169, 171 | `CJK_NOISE`, `INSTRUCTION_MARKERS`, `CJK_PARTICLES` | ✅ (2 of 3) |
| `context/readContext.js` | 274-280 | `INTENTS[].cjk` — 約咗, 點存, 數貨, 貨存 … | ❌ **new** |
| `intake/laneRouter.js` | 45, 52, 64, 75, 128 | capability question, recipient, interrogative, short confirmation, read verb | ❌ **new (5)** |
| `intake/readStateGuard.js` | 34 | `UNREADABLE_CLAIM`, Cantonese half | ✅ |
| `intake/scopeNotes.js` | 65, 73, 81 | the three keyword tables | ✅ |
| `intake/utilityAnswer.js` | 46, 50, 53 | 而家／依家／家陣, date-question forms | ❌ **new** |
| `lab/redaction.js` | 108 | `/唔好記錄/` — the Owner asking not to record | ❌ **new** |
| `agent/requestInference.js` | 47 | politeness-prefix stripping | ✅ |

**Struck from the original list:** "MockAdapter greetings" — see §3, it contains no Cantonese.

> Widening `INTENTS[].cjk` is the sanctioned fix for the Route/Evidence Guard's blind spot
> (TURN-ROUTER-MIGRATION.md O-1). That is an **addition** of vocabulary, not a rewrite of it —
> the two must not be confused.

---

## 7. CATEGORY D — tests

| Side | Lines | Rule |
|---|---|---|
| **Assertions** on output | **106**, across 36 files | **Change in the SAME COMMIT as the strings they pin.** Owner ruling: "a round of red with no visible cause is how a test gets 'fixed' by deleting it." |
| Fixtures (input) and test titles | ~315 | **Do not change.** Fixtures are input; titles are the record. |

Densest assertion files: `readResultView.test.js` (16), `routeEvidenceGuard.test.js` (6),
`scopeNotes.test.js` (6), `answerPlanEvidence.test.js` (5), `readStateGuard.test.js` (5).

**Known imprecision:** the ~315 figure merges fixtures and titles; they were not separated
line-by-line. Say so rather than quoting it as a fixture count.

---

## 8. THE SCANNER'S BLIND SPOT — why 111 is a floor

Detection is **particle-based** (唔嘅咗冇嗰咩喺哋…). **Cantonese written with only shared
characters is invisible to it.**

Proven case: `src/demo/greeting.js:35` uses 「**早晨**」 (written Chinese would be 早安). It is
server-generated output and the scan **missed it entirely**.

> **OWNER RULING 2026-08-05: the manual pass happens BEFORE any rewriting.** Rewriting from a
> list known to be incomplete means a second pass later, over strings everyone will assume were
> already done.

Manual pass scope: every output string in `app.js`, `index.html`, `settings.html`,
`greeting.js`. **Results in §10.**

---

## 9. RETIRED BY THE INTENT ROUTER — so the old list is stale as well as wrong

1. `app.js:1195` 「我係香香。有咩想傾…」 — **deleted** in Step 2d; the ACTION-path affordance
   moved into the composer placeholder.
2. `minimalAnswer`'s 「砌唔出」/「讀唔到」 — rewritten to 「組不出」/「讀不到」. The 3 remaining
   `砌唔出` occurrences are **all in tests**, two of them negative assertions proving the
   Cantonese form is gone. **They guard the change and must not be deleted.**
3. `SOURCE_NAME_REWRITES` — now empty.
4. The guard's `generic` correction branch — removed entirely, with its Cantonese sentence.

---

## 10. MANUAL PASS RESULTS

Hand-read of every output string in `app.js` (121 CJK strings), `index.html` (43),
`settings.html` (15), `greeting.js` (3).

### 10a. Cantonese the scanner missed: **+10 lines (110 → 120), about 9%**

The particle set was missing `呢`, `佢`, `撳`, `尋日`, `早晨`. Re-running with those added:

| File | Line | String |
|---|---|---|
| `demo/greeting.js` | 35 | 「早晨」 — the case that started this. Server-generated output |
| `demo/assets/app.js` | 353 | 「尋日」 (written Chinese: 昨天) |
| `demo/assets/app.js` | 490 | 「複製呢個回覆」 — an `aria-label`, i.e. **screen-reader-only text** |
| `demo/assets/app.js` | 565 | 「（撳一下取消）」 |
| `backup/Install-MonthlyBackupShortcut.ps1` | 57 | 「每月插好個 Seagate、解鎖，然後撳一下佢。」 |
| `backup/Monthly-OfflineBackup.ps1` | 56, 180 | 「撳 Enter 關閉」 |
| `agent/requestInference.js` | 66 | input-stripping — **Category C, do not change** |
| `intake/utilityAnswer.js` | 45 | 琴日／尋日 matcher — **Category C, do not change** |
| `persona/conversationContract.js` | 104 | see §10c — **do not change** |

**Verdict on the 111:** it holds as a Cantonese count. The delta is ~9%, not a different order
of magnitude, so §4–§6 can be trusted for what they claim to be.

### 10b. THE REAL FINDING — Category B was indexed the wrong way

`app.js` holds **121 CJK output strings. Only 15 lines carry Cantonese.** The other ~106 are
**already written Chinese** — and among them sit governance strings that §5 never listed.

**The audit indexed by "contains Cantonese". Category B is defined by "makes a promise".
Those are different sets, and I conflated them.** A governance string already in written
Chinese needs no style pass — but it still belongs on the list the Owner checks, because the
list's purpose is *the promise survives rewording*, and a rewrite can reach it via a
neighbouring string, a component refactor, or a copy-consistency pass.

**Governance strings absent from §5 entirely, all already in written Chinese:**

| Location | String | Promise |
|---|---|---|
| `app.js:694` | 「未送外部模型，未執行任何動作」 | **nothing left the machine AND nothing ran** — two promises in one line |
| `app.js:729` | 「SHADOW_ONLY · 未寄出 · 未寫入記憶」 | not sent, not persisted, shadow-only — three |
| `app.js:897` | 「你拒絕了這張工作單。甚麼都沒有執行。」 | rejection executed nothing |
| `app.js:742` | 「提案 X · 只是提案，未執行」 | a proposal is not an action |
| `app.js:737` | 「尚未建立任何提案」 | nothing was created |
| `app.js:726` | 「草稿（未寄出）」 | drafted ≠ sent |
| `app.js:926, 927` | 「（這張單已作廢，請重新產生）」 | the work order is void — it cannot be re-approved |
| `app.js:557` | 「講明改哪個檔案、改什麼；批准後才執行」 | approval gates execution |
| `app.js:996` | 「超過時限仍未收到結果 —— 請查伺服器記錄」 | a timeout is **not** a success and not a failure |
| `app.js:960` | 「未成功」 | — |
| `index.html:16` | placeholder 「跟香香說…改檔案要你批准才會執行」 | **the ACTION-path affordance relocated in Step 2d.** Deleting it as a placeholder tidy-up would undo an explicit Owner decision |
| `index.html:27` | 「本機示範 · 任何動作都要你批准」 | approval gates execution |
| `index.html:11` | 「本機 · 127.0.0.1」 | loopback only |
| `settings.html:3` | 「改完儲存，下次對話即時生效。不需要重啟。」 | when the setting takes effect |

**Consequence: §5's ~46 lines is not the governance surface.** It is the governance surface
*that happens to contain Cantonese*. The true Category B is at least 14 lines larger, and only
`app.js` / the two `.html` files have been hand-checked — `agentResultView.js`,
`credentialHealth.js`, `intakeService.js` and the routers have **not** been re-indexed this way.

### 10c. Pronoun inconsistency — and a possible policy breach

On the **same screen**, referring to 香香:

- `index.html:33`, `36` and `settings.html:5`, `8` use **「她」** (「你想**她**點樣講嘢」, 「要**她**記住的事」)
- `index.html:37`, `41`, `97` and `settings.html:9`, `13` use **「佢」** (「你寫低要**佢**長期記住嘅嘢」)

Two problems, and the second is not cosmetic:

1. **Inconsistent** — same referent, adjacent lines, two pronouns.
2. **「她」 is gender-specific.** The Owner Language Policy says **never guess gender**. 「佢」 is
   gender-neutral; 「她」 is a guess. On that reading the four 「她」 instances are already a
   policy breach, independent of the Cantonese question.

Directly related, and it must not be swept into a style pass:

> `src/persona/conversationContract.js:104` — 「不要機械地把「佢」換成「他」「她」「它」。」

This **instructs her not to make exactly that substitution**. A style pass that "regularises"
the HTML pronouns to 「她」 would put the interface in direct contradiction with the contract
the model is given. **Owner ruling required:** the neutral 「佢」 throughout, or something else.

### 10d. What the manual pass did NOT cover

`agentResultView.js`, `credentialHealth.js`, `patchStore.js`, `intakeService.js`,
`readResultView.js`, `readStateGuard.js` and the `.ps1` scripts were scanned for Cantonese but
**not re-indexed for promises** (§10b). Until that is done, §5 must be read as a floor, exactly
as §7 says of §4.

---

## 11. CATEGORY B, RE-INDEXED BY PROMISE — the surface is roughly **twice** what §5 said

Owner instruction 2026-08-05: index by *"does this state what the system will or will not do"*,
regardless of the language it is already in.

**Result: ~46 lines → ~102 Owner-facing lines.** §5 was not 20% short; it was **half**.

Method: all 818 CJK-bearing string literals across 45 non-test files were enumerated, then each
was read for a promise. §5's nine sections stand unchanged. Everything below is **new** — and
almost all of it is **already written Chinese**, which is exactly why a Cantonese index could
not see it.

### B-10 THE WORK-ORDER CARD — `src/agent/workOrderView.js` (12 lines) ⚠️

**The approval screen itself.** The densest governance surface in the product, and it was
absent from the audit entirely.

| Line | String | Promise |
|---|---|---|
| 79 | 「不會提交、不會上傳、不會合併、不會部署。」 | **four explicit negatives** — no commit, push, merge, deploy |
| 63 | 「只在丟棄式副本內操作，真實程式庫不會被改動。」 | isolation |
| 112 | 「隔離方式：丟棄式副本，已移除所有 remote，改動無法回到 main」 | isolation, mechanically — remotes removed |
| 69 | 「香香打算改成（這是香香的打算，不是已完成的結果 —— 它仍未執行，實際結果可能不同）」 | **intent ≠ result** |
| 77 | 「改壞了？只改副本，你的程式庫不受影響。」 | blast radius |
| 62 | 「只修改 X 一個檔案。」 | scope is one file |
| 111 | 「如需改第二個檔案：必須重新建立一張新的工作單（沒有中途加檔案的機制）」 | **no mid-flight scope growth** |
| 107 | 「工作單有效時間 …（逾時自動失效，需重新產生）」 | approval expires |
| 83 | 「最長 X · 最多 $Y」 | time and cost caps |
| 68, 108 | 「（讀自真實檔案，已截斷…）」/「現時內容是否截斷」 | **what you are shown may be partial** |
| 144 | 「不會發生」 (section heading) | the negatives have their own section |

### B-11 WORK-ORDER REFUSALS — `src/agent/workOrderProducer.js` (15 lines) ⚠️

Every one states **no work order was created**, and why.

| Line | Promise |
|---|---|
| 169 | 「未在對話中提及過。我不會自行搜尋或推測檔案路徑」 — **will not infer paths** |
| 161 | protected scope (credentials/env/auth gate/audit/governance) is unmodifiable |
| 67 | will not create a work order for a file that does not exist |
| 68, 69, 70 | not a file / unreadable / outside the repo |
| 144, 145 | exactly one file — 「一次只可以改一個檔案」 |
| 150–154 | no wildcards, no folders, must have an extension, relative only, no `..` |
| 120 | 「未能建立工作單：…」 — the umbrella statement that nothing was created |
| 135, 187 | empty goal / malformed approvalId |

### B-12 PROPOSAL GROUNDING — `src/intake/groundedReply.js` (4 lines)

All four end in 「尚未執行」 or 「目前尚未建立任何提案」.
Line 41: 「尚未執行，也尚未派給任何 Worker；等你批准我才會往下走。」

**Promise:** approval gates execution, and nothing was dispatched.

### B-13 DATA-EGRESS REFUSAL — `dispatcher.js:54`, `intakeService.js:150` (2 lines)

> 「含敏感資訊，需人工處理，未送外部模型」
> 「這句話含敏感資訊（可能涉及銀行、報稅或密鑰）。依政策，我不會把它送給外部模型，只在本機記錄。」

**Promise:** the red line held and **the text did not leave the machine.** Sibling of B-6 —
B-6 warns egress *will* happen; these assert it *did not*.

### B-14 ROUTE/EVIDENCE WITHHOLDING — `routeEvidenceGuard.js:155-156` (2 lines)

> 「有 N 句講到營運狀況，但這一輪沒有查任何來源，所以我沒有顯示它。」

**Promise:** something was withheld, how much, and that **no source was consulted**. Written
2026-08-05 in Step 4 — new since the original audit.

### B-15 UI GOVERNANCE ALREADY IN WRITTEN CHINESE (16 lines)

The §10b list, now formally part of Category B: `app.js` 557, 694, 726, 729, 737, 742, 897,
926, 927, 960, 996; `index.html` 11, 16, 27; `settings.html` 3; `settings.js` 110.

### B-16 AUTHENTICATION STATE — `ownerAuthRouter.js:58, 122` (2 lines)

> 「尚未設定登入密碼。請在 .env 設定 AROMA_OWNER_PASSWORD 後重啟。」

**Promise:** why the gate is not protecting anything yet. Must never read as "logged in".

### B-17 INCONCLUSIVE OUTCOMES — `intakeDiagnostics.js:26-28` (3 lines, borderline)

「香香未能產生有效回應」/「暫時無法連接服務」/「系統暫時無法處理這個請求」. Classified as
governance because each must stay **distinguishable from a completed turn**, but they are the
weakest members of the category. Owner may rule them into A.

### B-MODEL — a class that was never categorised at all

These state what the system will or will not do, but are addressed **to the model**, not to the
Owner. Not a style pass under any reading. Listed so nobody treats them as copy:

| File | Scale | Note |
|---|---|---|
| `src/persona/xiangxiang.js` | 6 | **PERSONA_IDENTITY — FROZEN. Do not touch.** |
| `src/context/readContext.js` | 112 | `SAFETY_HEADER` + the intent table; the read-state vocabulary lives here |
| `src/persona/conversationContract.js` | 47 | includes the pronoun instruction — see §13 |
| `src/intake/answerPlan.js` | 46 | schema descriptions, rewritten to written Chinese in an earlier round |
| `src/intake/distillPrompt.js` | 20 | 「不得在尚未發生時宣稱它們已經發生」 |

### Addition to CATEGORY C

`src/lab/citationDetector.js:51` — a CJK noise-word list used for **detection**, not display.
Input-matching. **Must not change.** Missed by the Cantonese index because every word in it is
standard written Chinese.

---

## 12. `index.html:16` — AN OWNER DECISION, RECORDED SO IT CANNOT BE DELETED BY ACCIDENT

The composer placeholder: 「跟香香說…改檔案要你批准才會執行」

**This placeholder carries a ruling. It is not decoration.**

- **Decided:** 2026-08-04, ruled again 2026-08-05 (Turn Router Step 2d).
- **What it replaced:** the second paragraph of the empty-screen bubble at the old
  `app.js:1195` —
  > 「想我改嘢，直接講明改邊個檔案同改乜就得 —— 我會出一張工作單畀你過目，**你批准咗我先會做**。」
- **The ruling, in the Owner's words:** "Do NOT delete the ACTION-path explanation outright",
  and "Do not silently delete a governance statement to tidy a screen." When the empty screen
  was redesigned the affordance was **relocated to the composer placeholder**, not removed.
- **What it promises:** it is the only remaining place on the empty screen that tells the Owner
  (a) the ACTION path exists and (b) **approval gates execution**.

> **It nearly vanished from this audit's own list**, because it contains no Cantonese and reads
> like placeholder text. A "tidy the placeholder" change would silently undo an explicit ruling.
> **Do not shorten, merge, or remove it without a fresh Owner decision.**

---

## 13. PRONOUNS — OWNER RULING 2026-08-05: use 「佢」 throughout for 香香

Neutral, no gender claim, and consistent with the contract that forbids mechanical substitution.

### The violation — fixed in the presentation round, flagged now so nobody tidies it wrong

**Four instances of 「她」 referring to 香香**, all in the settings copy:

| File | Lines |
|---|---|
| `src/demo/assets/index.html` | 83 「你想**她**點樣講嘢」 · 89 「要**她**記住的事」 |
| `src/demo/assets/settings.html` | 19 (same) · 25 (same) |

They sit **beside** 「佢」 on the same screens (`index.html` 90, 97; `settings.html` 26, 33) —
inconsistent as well as gendered.

> ⚠️ `src/routes/settingsRouter.test.js:69` asserts `/要她記住的事/`. **Same commit**, per the
> standing rule on assertions.

> ⚠️ **THE WRONG FIX IS TO REGULARISE TO 「她」.**
> `src/persona/conversationContract.js:104` instructs: 「不要機械地把「佢」換成「他」「她」「它」。」
> Standardising the interface on 「她」 would put it in direct contradiction with the contract
> the model is given. **The ruling is 「佢」.**

### Everything else with a gendered pronoun — full scan, reported not changed

**Nothing else in the codebase refers to 香香 with a gendered pronoun.**

- **`PERSONA_IDENTITY` (`src/persona/xiangxiang.js`) assigns her NO gender.** She is addressed
  throughout as 「你」. The frozen constant is already neutral, which means the four 「她」 in the
  HTML contradict the identity as well as the policy. **Reported only — not changed.**
- 「他」 appears in `xiangxiang.js` (36, 38, 51, 56), `conversationContract.js:78` and
  `distillPrompt.js` (45, 49) — **all referring to Louie, not to 香香.** Outside this ruling's
  scope; flagged in case the Owner wants a separate ruling. `xiangxiang.js` is frozen either way.
- 「它」 appears in `workOrderView.js:69`, `workOrderProducer.js:69`, `groundedReply.js`,
  `routeEvidenceGuard.js`, `intakeService.js:150`, `xiangxiang.js` — **all referring to files,
  changes, sentences or the Aroma System.** Correct usage; no change needed.
- `MockAdapter.js:57` 「它是後續其他工作的資料來源」 — refers to a task. Demo fixture.
