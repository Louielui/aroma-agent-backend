# Writing a design doc here — one rule, and it exists because of a specific failure

<!-- record-status: ACTIVE 2026-08-07 -->

**Read this before writing a `DESIGN-*.md`. It is one page and it is not a style guide.**

---

## The rule

> ## Every REQUIREMENT in a design doc carries an `⛔ ENFORCED BY:` line naming the test that
> ## makes it fail. Without one it is decoration, and worse than decoration.

```markdown
> **Scheduled work must be IDEMPOTENT: one row per task, never one per run.**

> ### ⛔ ENFORCED BY: `src/home/errandStore.test.js` → 「one id, one row」
```

If the requirement is not yet enforceable — the code does not exist — the line still goes in,
as `⛔ ENFORCED BY: NOTHING YET`. **An honest gap is auditable; an unmarked requirement is
indistinguishable from an enforced one**, which is the whole failure below.

---

## Why — and this is the part that matters more than the format

**A design document is where a requirement gets decided, and deciding feels like doing.**

Measured, 2026-08-07. Three artefacts, same author, same week:

| | |
|---|---|
| **the rule** | `DESIGN-SCHEDULED-SURFACE.md §4` — 「it must be IDEMPOTENT: one open proposal per task, never one per run」 |
| **the claim** | `runRecallErrand.js` — 「re-running today **updates** today's row instead of stacking duplicates」 |
| **the code** | `errandStore.record()` — `rows.push(...)`. No key. No lookup. |

Result: 44 rows, 10 distinct ids, and 首頁 grew until it pushed the composer off the screen.

> ## 份設計文件冇當過個 code 嘅檢查 —— 佢當咗檢查嘅替代品。

The comment was not a lie told to the reader. **It was a lie told to the author first**, and it
was convincing precisely because the requirement had been reasoned through in another file.

**This inverts the usual reason for writing designs.** We write them to make requirements
explicit so they get enforced. What actually happened is that writing it supplied the FEELING of
enforcement — and the feeling is the thing that stops you looking.

It explains four separate defects in one week, all the same shape: a property that was
established in a document, assumed in a comment, and never present in the code.

---

## The corollary for comments

A comment describing BEHAVIOUR — 「this updates rather than appends」, 「this is idempotent」,
「this never writes」 — **is an assertion**. If no test fails when it stops being true, it is
decoration.

> **Prefer DELETING such a comment to leaving it.** A wrong comment is worse than no comment,
> because it stops the next reader from checking.

---

## What this does NOT ask for

Not more process, and not a template with sections to fill. One line per requirement, naming one
test. **The check is that a reader can go from any requirement to the thing that would fail** —
and, where nothing would, see that stated.

See `docs/HOUSE-RULES.md` → HR-40.
