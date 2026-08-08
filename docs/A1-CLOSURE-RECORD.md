# A1 — EVIDENCE TRUTH CONTRACT — CLOSURE RECORD

**Owner decision, 2026-08-08: A1 Evidence Truth Contract — GO. APPROVED.**

This is a closure record. No code was written for it, and every operational HOLD listed at the
end remains in force.

---

## THE RECORD

| field | value |
|---|---|
| **A1 status** | **APPROVED** |
| **Approved SHA** | `1b91a6457d23710334c0df5e16f40d969583baca` (`1b91a64`) |
| **Base / main** | `63947dc95a1a6c5a506ce8bfa9a98a519a1bb7c5` (`63947dc`) |
| **Branch** | `feat/a1-evidence-truth-contract` |
| **Full canonical diff** | **24 files, +760 / −89** (GitHub canonical, `63947dc → 1b91a64`) |
| **Merged?** | **No** |
| **Deployed?** | **No** |
| **Runtime affected?** | **No** — 8090 remained on the pre-A1 build throughout |

### Regression evidence — LOCAL, NOT CI-ATTESTED

| environment | tests | pass | fail | skipped |
|---|---:|---:|---:|---:|
| clean shell | 2736 | 2732 | **0** | 4 |
| launcher flag set | 2736 | 2732 | **0** | 4 |

> **There are no GitHub CI status checks on this SHA.** These figures are recorded as **local
> regression evidence**, not as CI-attested results. Owner instruction, and it is the right
> distinction: a suite that passed on one machine is not a suite that a system verified.

### ⚠ One unreconciled number, recorded rather than smoothed over

The canonical figure above is the Owner's, from GitHub, and is the one that stands. **My local
`git diff --stat` reports 765 insertions / 93 deletions** for the same range — consistently
across three-dot, two-dot and `--ignore-cr-at-eol` variants, with the merge-base confirmed as
`63947dc`. I could not account for the 5 / 4 difference from this machine.

It is noted here so a later reader finding two numbers knows which was measured how, rather than
assuming one is a typo.

---

## WHAT WAS APPROVED, IN ONE PARAGRAPH

`totalCount` was removed rather than aliased, and the descriptor now carries a canonical field
set in which every semantic value is present and explicitly unknown when it is unknown.
`SCOPE_OF` became `rowShape` (what a row carries) and `queryScope` was added (which rows were
selected), so the word 「scope」 no longer means two things. `matchingTotal` is promoted from the
raw response count only once truncation has been ruled out. `sourceTotal` and `dataAsOf` are
`null` everywhere, because the server sends neither. The prompt no longer states or instructs an
existence claim.

---

## KNOWN LIMITATIONS — CARRIED FORWARD, NOT CLOSED

**1. `checkEvidence` still has NO production caller.**

> **Therefore A1 is a TESTED TRUTH CONTRACT, not yet a live runtime control.**

The gate refuses what it should refuse, and nothing in the running system asks it. Wiring it is
a separately authorized phase and was explicitly excluded from this closure step.

**2. `admitsLimitation` remains accepted but INERT.**

The blanket bypass — `if (admitsLimitation) return { ok: true }`, which sat before every
truncation, sample and coverage check — is removed. The parameter is still accepted so that no
caller breaks silently, does nothing, and is asserted to do nothing by test.

**3. The scoped-universal structural signal remains future work.**

An honestly-qualified claim is refused alongside a dishonest one whenever it trips `UNIVERSAL`.
The cost is accepted deliberately. The fix is a structurally claim-local scope signal — a claim
that carries which scope it is about, checkable against `queryScope` without reading a word of
it — and it was not invented here.

**4. No natural-language scope detection was introduced.**

Explicitly. Nothing in A1 reads a sentence to decide what it means. Every gate term is a
structural fact about the evidence: `completeWithinScope`, `matchingTotal`, `sourceTotal`,
`truncated`, `limitKnown`.

**5. `queryScope.declaredBy` is `'reader'` on all six endpoints.**

Every window and limit was audited by hand from `aroma-system/server/routes/aiIntegration.ts`.
The reader is asserting a property of a server it does not control, and that is recorded on
every descriptor as debt rather than as server truth. It becomes `'server'` only when the API
declares its own scope.

---

## THE TWO THINGS THIS PHASE GOT WRONG, KEPT ON THE RECORD

Both were found by the Owner in review, not by me, and both were the same shape as defects this
project has already named.

**I declared `order-planning` unbounded. It is `LIMIT 100`.** It is written in raw SQL inside a
template literal, twice, and my audit grepped for drizzle's `.limit(`. **Searching for one
spelling of a thing** — HR-56, the same defect as 「訂貨」 failing to match 「訂什麼貨」.

**I wrote a test that licensed a false claim.** It asserted that 14 purchase orders, complete
within a thirty-day window with `sourceTotal` unknown, supported 「所有採購單都已收貨」. Complete
within a slice is not complete.

> **A test that permits a false claim is worse than a missing test: it is a fence installed
> backwards, and it reports green while doing the opposite of its job.**

---

## OPERATIONAL HOLDS — ALL REMAIN IN FORCE

- **DO NOT merge**
- **DO NOT restart**
- **DO NOT deploy**
- **DO NOT modify `main`**
- **DO NOT wire `checkEvidence` into production in this closure step**

Also still held from earlier phases: Capability Map implementation, additional Aroma System
endpoints, multi-step enquiry, autonomous reasoning loop.

**Next phase:** a separately authorized production wiring phase for `checkEvidence`. **Not
begun, and not to be begun without that authorization.**
