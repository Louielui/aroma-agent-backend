# DEFECT-011 — 「我未睇過 Drive」 with a timestamp. Three answers, and the third is the design defect.

<!-- record-status: OPEN 2026-08-07 — diagnosed, not fixed -->

---

# 1. WHAT STATE IS THE SERVER RETURNING, AND WHY

**Live:**

```json
"backlog": { "state": "NOT_CHECKED", "line": "我未睇過 Drive。", "checkedAt": …, "checkedAtLabel": "00:28" }
```

**Why:** `mountHomeRoutes` accepts a `backlogReader`. **The mount does not pass one.**

```js
mountHomeRoutes(app, {
  store: openErrandStore(…),
  profileDir: 'C:\Aroma\browser-profile'
})                                  // ← no backlogReader
```

```js
if (backlogReader) { … }            // undefined → never called
```

> ## ⛔ THE DRIVE READER IS WIRED TO NOTHING.
>
> **It is the fifth thing wired to nothing, and last round I wrote 「the fifth thing wired to
> nothing did not happen.」 That claim was false when I made it.**

**The reader itself is fine.** `sentenceFor` in `invoiceBacklog.js` works, is used by
`demoRouter`, and even returns its own `checkedAt`. Nothing about Drive changed. **Nothing
called it.**

## ⚠ And my own wiring smoke test did not catch it

```js
assert.ok(r.json[k].checkedAt, k + ' has no checkedAt')
assert.ok(r.json[k].state, k + ' has no state')
```

**`NOT_CHECKED` satisfies both.** The test asserted that the section **had a shape**, not that
anything **filled it** — **HR-6 exactly: assert the VALUE, not that the key was mentioned.** I
wrote a wiring test that a missing wire passes.

---

# 2. IS 「我未睇過」 THE WRONG LABEL FOR A FAILURE?

**It did not check and fail. It never checked**, so for that state the label is accurate.

> ### But the state should not have been reachable in production, and that is the more useful finding.

If `NOT_CHECKED` did not exist, an unwired reader would have produced **an error, a crash, or a
missing section** — something visibly wrong. Instead it produced **a calm, grammatical,
timestamped sentence.**

**The state made the bug look like information.** A defect that renders as a plausible line is
strictly worse than one that renders as an error, and this is the second time this week: a
correct refusal with a wrong reason (`NO_PREFERENCES` when Chrome held the file) had the same
shape.

---

# 3. ⛔ WHY DOES `NOT_CHECKED` CARRY A `checkedAt` AT ALL — THE DESIGN DEFECT

**Because every section stamps `Date.now()` at briefing-build time, regardless of whether any
read happened:**

```js
if (!backlog) back = { state: 'NOT_CHECKED', …, checkedAt: t }     // t = when the BRIEFING was built
```

> ## A timestamp on 「I have not looked」 is a claim about an event that did not happen.

**And it breaks two of the three rulings at once:**

| ruling | how it breaks |
|---|---|
| **timestamped** — 「nothing waiting」 without a time is not a claim | **inverted.** A NON-claim *with* a time is worse than one without: the time manufactures credibility for a check that never ran |
| **never blank / the two emptinesses never collapse** | 「我未睇過 Drive。 00:28」 is visually indistinguishable from 「我睇過,冇嘢等緊。 00:28」. **A tired reader reads 「checked at 00:28, nothing there」** — the `count: 43` shape, in the line built to prevent it |

## The same defect is present on the branches that DO work

```js
checkedAt: backlog.checkedAt || t
```

**A reader that returns no timestamp silently inherits the briefing-build time** — and that
substitution is invisible, because the result is a plausible clock either way.

> ### The timestamp must come FROM THE READ, and be ABSENT when there was no read. `|| t` is the same defect with a fallback wearing it.

**`errands` and `waiting` are honest today** only because the store really is read at `t` —
**by luck of ordering, not by design.** The rule they follow is 「stamp now」, which happens to
be true for them and is false for backlog.

---

# NOT FIXED

**Three things, and the third is the one that matters beyond this line:**

1. Pass the `backlogReader` at the mount.
2. Make the smoke test assert the **value** — that the Drive section reaches a state only a
   real read can produce — so an unwired reader fails it.
3. **Take the timestamp from the read, never from the briefing**, and **omit it entirely when
   there was no read.**

**The Owner's layout verdict is recorded: the errand list and 「冇嘢等你決定」 with a time read
exactly as intended. It is this one line.**
