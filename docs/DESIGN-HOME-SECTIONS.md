# 首頁 sections — conclusions that open

<!-- record-status: ACTIVE 2026-08-07 -->

Written to `docs/DESIGN-DOC-CONVENTION.md`: every requirement carries `⛔ ENFORCED BY:`.

> **Owner: 「首頁 shows the conclusions as it does now, and each section is CLICKABLE — opening
> it gives history, detail, and a composer that knows which section I came from. That solves the
> context problem by making it structural: the context is which card I opened, not something
> inferred from what I typed.」**

---

# 0. Why this is not Claude's Projects

Projects are places you return to, each holding many conversations. **This briefing has three
things and two of them are one line of conclusion per day.** Making each a card you must open
turns 「see everything at once」 into 「click three times」.

> ## So the conclusions stay on 首頁. The card is a DOOR, not a container.

---

# 1. ⛔ WHICH SECTIONS EARN A CARD — and it is one of three

Measured before designing, not assumed:

| section | what is behind the door | card? |
|---|---|---|
| **回收檢查** | six ingredients with their own results, day-to-day change, two witnesses, blocked reasons | ✅ |
| **Franco** | **measured:** the reader returns four aggregate numbers (`fileCount`, `batchCount`, `nonEmptyBatchCount`, `oldestBatchAgeDays`) and **no file list**. The door opens onto the same four numbers already on the line. | ⛔ |
| **等你決定** | a queue, usually empty, whose items are already complete inline | ⛔ |

> **Owner: 「Franco's door opening onto the same four numbers is the one I would have built and
> been annoyed by.」**

**Applying the pattern to all three would be a layout decision nobody made (HR-28) — made by us,
together, which is the version that is hardest to notice.**

## THE RULE THAT DECIDES IT

> ## 「一條隊唔係持續狀態。」 — Owner, 2026-08-07
>
> A section earns a card when it has **standing state with history**. A QUEUE is not standing
> state, and **the thing that must not be one click away is precisely the thing with a deadline.**

> **R1.1** 等你決定 renders inline on 首頁 and is never a card.
> ### ⛔ ENFORCED BY: `src/demo/homeSections.test.js` → 「the waiting section is not openable」.

> **R1.2** The Drive backlog is not a card while its reader returns only aggregates.
> ### ⛔ ENFORCED BY: `src/home/briefing.test.js` → 「backlog is never openable」.

---

# 2. ⛔ 冇門好過一道假門

> ## A grey, unclickable card is worse than a plain line. It PROMISES something is there and
> ## then has nothing.

> **Owner: 「I would have specified the grey card.」**

So **clickability follows CONTENT, not category**:

- a kind that has run and has rows → a door
- a kind in `NEVER_RUN` → **a line, with no door** — and the absence of the door is the honest
  statement that there is nothing behind it
- the line itself is never hidden: `NEVER_RUN` is sayable precisely because the section is driven
  by the registry rather than by the rows

> **R2.1** `openable` is computed from whether a detail view would have content, and a section
> that is not openable renders as a plain line with no affordance at all.
> ### ⛔ ENFORCED BY: `src/home/errandConclusion.test.js` → 「NEVER_RUN is not openable」 and `src/demo/homeSections.test.js` → 「a non-openable section renders no button」.

---

# 3. What is inside 回收檢查

> ## The inside is the SAME CONCLUSION AT HIGHER RESOLUTION. It is not the execution history.

**Shown:**

| | |
|---|---|
| per ingredient, today | how many the site returned, the top hits with dates, or — for a blocked one — why |
| freshness | when it last ran, whether it is scheduled, and **both witnesses** separately |
| history | **what CHANGED on which day**, using the same diff that computes 「新」 |

**Not shown — the transcript nobody reads:**

- the step log of each run (navigate / read / type / click)
- AX node counts, fence statistics, timing
- every historical row verbatim

> **R3.1** The detail view contains no per-step execution trace.
> ### ⛔ ENFORCED BY: `src/home/sectionDetail.test.js` → 「the detail carries no step log」.

> **R3.2** History is expressed as change, not as occurrence: a day with nothing new says so
> rather than repeating the same list.
> ### ⛔ ENFORCED BY: `src/home/sectionDetail.test.js` → 「a day with no change says 冇變」.

> **R3.3** The detail read is NOT capped at six rows the way the briefing is.
> ### ⛔ ENFORCED BY: `src/home/sectionDetail.test.js` → 「every row for the kind is returned」.

---

# 4. The composer — ROUND B, NOT NOW

Recorded here so the requirement exists before the build does.

> **R4.1** The composer attaches the section as CONTEXT; it does not police the topic. Restricting
> what may be asked would require judging whether a question belongs to a section — which is M-5
> with a new surface.
> ### ⛔ ENFORCED BY: `NOTHING YET` — Round B.

> **R4.2** It opens an ORDINARY conversation that appears in the conversation list. Not a hidden
> per-section thread, or he will have conversations he cannot find again.
> ### ⛔ ENFORCED BY: `NOTHING YET` — Round B.

> **R4.3 ⛔ 附上咗乜要睇得見。**
> **Owner: 「If she carries context I cannot see, I am back to guessing what she knows — which is
> the thing this whole shape was meant to remove.」** What is attached must be visible on screen
> before and after sending.
> ### ⛔ ENFORCED BY: `NOTHING YET` — Round B. **This is the requirement Round B exists to meet; a Round B that ships without it has missed its purpose.**

---

# 5. Round C — the Franco detail view. **DO NOT BUILD.**

**Recorded with its reason so it does not read as an oversight later.**

The Drive reader returns aggregates only; a detail view would need new file-level reads. And the
action it would support — processing the invoices — **happens in Drive, not here.** A door onto a
list he cannot act on from this screen is a door onto the same four numbers with more scrolling.

> ### Revisit ONLY if Phase 2 ever moves files. At that point the system would be doing something
> ### with those files, and a detail view would have an action behind it rather than a longer read.

---

# 6. Round A — what is being built now

| in | out |
|---|---|
| 回收檢查 is a door | any composer (Round B) |
| an uncapped per-section read | Franco's door (Round C, never unless Phase 2) |
| clickability follows content | 等你決定 as a card (never) |
| back to 首頁 | per-section conversation threads (never) |

**Nothing else on 首頁 changes.** The conclusions render exactly as they do today.
