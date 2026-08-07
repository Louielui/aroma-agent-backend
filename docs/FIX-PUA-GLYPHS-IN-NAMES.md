# Icon-font glyphs in accessible names — a general `read_page` fix

<!-- record-status: ACTIVE 2026-08-06 -->

> ## 「個字喺度，但個 name 唔係嗰個字。」

**Reported separately from payment, as instructed — this is not a payment fix.** No paid model
calls. `$0.00`.

---

# ⚠ TWO CORRECTIONS I OWE BEFORE THE FIX

## 1. 「silently present in every page we have measured」 — that was wrong

I wrote it, and the Owner repeated it back to me, which means a wrong claim had already
propagated into his understanding of the system. **Measured across every captured page:**

| | |
|---|---|
| pages carrying any glyph | **3 of 26** |
| surviving nodes affected | **36 of 36,669 (0.1%)** |

**Not every page. Three.** The right sentence is: **rare by count, and it landed on a commit
control** — Blender's donate button — **so the consequence is not proportional to the
frequency.**

## 2. And the two numbers in this document measure different populations

`glyphsStripped` on the Blender capture reports **143**. My corpus scan reported **20**.
Both are correct and they count different things:

| | Blender |
|---|---|
| raw AX nodes carrying a glyph | **143** |
| nodes that carry one **and survive pruning** | **20** |

**I quoted the smaller number as though it described the page.** The 0.1% above is the
surviving-node figure — the one that matters for what a model reads — and it is now labelled
as such rather than left to be read as 「how much of the page has this」.

---

# THE DEFECT

Icon fonts place their glyphs in the Unicode **Private Use Areas**, and Chrome puts those
glyphs **inside the accessible name**:

```
blender   link   " Donate"      first codepoint = U+E81C
```

**A rule anchored on `^donate$` fails. A model reading the tree sees a name beginning with a
character that means nothing outside one font.** The word is there; the name is not the word.

**Found while measuring L1** — a payment rule happened to be anchored, so it surfaced. It was
never a payment problem.

---

# THE FIX

**Three ranges, and nothing else:** BMP `U+E000–U+F8FF`, plane 15, plane 16.

```
[#r…] link "Donate"          was  " Donate"
[#r…] link "Donate Monthly"  was  " Donate Monthly"
[#r…] heading "Donate to Blender!"
```

## What it deliberately does not touch

**A test asserts that Chinese, accents, emoji, currency and symbols pass through unchanged** —
`付款`, `Tōkon`, `Café £5`, `★ Featured`. **A stripper that over-reaches would quietly delete
the names of the pages that matter most**, and it would do it silently, which is the whole
family of defect this project has been removing.

## And it is REPORTED, never silent

`readPage()` returns **`glyphsStripped`**. A transformation that changes the data a model reads
must state that it happened — the same rule as the truncation notice and the name-echo count.

## One consequence, handled rather than discovered

**Two names that differed only by a glyph become identical after stripping.** That is a *real*
ambiguity the page always had, and the existing machinery flags it: both nodes survive, and the
output tells the model **「⚠ indistinguishable — do NOT choose between them」**. **A test covers
it.**

**9 tests, written failing first.** Full suite **2701, 2694 pass**.

---

# ⚠ A FLAKE, RECORDED RATHER THAN SWALLOWED

One full-suite run reported **4 failures** — the three known `src/computer/` ones plus
`src/run/recovery.store.test.js`. **In isolation it passes 5/5, three times running, and the
next full run was back to 3.**

**It named itself**, unlike the earlier unnamed flake, so it is recorded here as a known
intermittent rather than left as a number that moved. **Not fixed — out of scope for this
round, and it is not in the browser code.**
