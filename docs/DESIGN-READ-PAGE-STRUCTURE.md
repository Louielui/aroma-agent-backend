# `read_page` — structure, so 21 identical buttons stop being 21 identical buttons

<!-- record-status: ACTIVE 2026-08-06 -->

**DESIGN ONLY. Nothing built.**

> **Owner: 「building click on a read_page that cannot distinguish them means the first real
> errand fails on the first page… It is the difference between 『she can operate a browser』 and
> 『she can operate a browser on pages simple enough to have one of everything』.」**

---

# 1. DOES THE AX TREE ALREADY CARRY CONTAINMENT? — **YES. Measured, not reasoned.**

All numbers from the **frozen `real-costco-search` capture** (3565 raw nodes, real page,
headed) and the three other real captures.

## The tree is a tree, and we were throwing that away

| | |
|---|---|
| fields on a CDP `AXNode` | `nodeId, parentId, childIds, role, name, backendDOMNodeId, properties, description, value, ignored, ignoredReasons, chromeRole, frameId` |
| nodes carrying `parentId` | **3564 / 3565** |
| nodes carrying `childIds` | 2430 / 3565 |

> ### Structure does NOT have to come from anywhere else. It was in the payload the whole time, and `readPage` discards it on the first line by treating `rawNodes` as a flat array.

## Does containment actually disambiguate the 21 buttons?

Climbing from each `button "Add to Cart"`:

| | |
|---|---|
| resolved to a container naming a product | **21 / 21** |
| depth at which it resolved | **3, for every one of them** |
| role of that container | `group` — **unnamed**, which is why the current pruner drops it |
| distinct product titles recovered | **21 / 21** |

```
depth 3  <group>  "Kirkland Signature 2-ply Paper Towels, 12-pack"
depth 3  <group>  "SpongeTowels Premium Paper Towels, 12 x 106 sheets"
depth 3  <group>  "Bounty Plus Paper Towel, 12 x 91 Sheets"
```

## And it is not a Costco artefact

Across all four real pages, every duplicate-name interactive set, asking at what depth the
ancestors become **distinct**:

| page | duplicate-name sets | separated by an ancestor | depth |
|---|---|---|---|
| `real-costco-search` | 9 | **9** | 1 |
| `real-wikipedia-costco` | 121 | **119** | 1 |
| `real-wikipedia-portal` | 165 | **165** | 1 |
| `real-mdn-css` | 21 | **21** | 1 |

**314 of 316 duplicate sets are separable, almost all at the immediate parent.**

### ⚠ But separation is NOT the same as a usable label, and this is the trap

Depth 1 says 「different parent node」. It does not say 「a parent a model can name」 — those
parents are unnamed `group`s. Asking instead for the nearest ancestor whose subtree contains a
**distinctive name**:

| page | duplicates needing a label | got one | depth range |
|---|---|---|---|
| `real-costco-search` | 82 | **82** | **1–5** |
| `real-wikipedia-portal` | 517 | **516** | **1–6** |
| `real-mdn-css` | 47 | **47** | **1–4** |

> ## The label depth is 1–6 and varies WITHIN a single page. Any fixed-depth rule is wrong, and the Costco 「always 3」 would have produced exactly that wrong rule.

### The 2 that cannot be separated at all

Two Wikipedia sets share their entire ancestor chain to depth 8 — **genuinely identical
siblings in the same container.** They must be reported as *ambiguous*, not resolved by
picking one. That is finding 2 of this round: **ambiguity that exists on the page must reach
the model as ambiguity.**

---

# 2. WHAT SERIALISATION LOOKS LIKE — and how it stays bounded

## ⛔ FIRST, THE MEASUREMENT THAT KILLS THE OBVIOUS DESIGN

The obvious design is 「append the container name to every line」. Measured cost against the
current flat output:

| page | flat output | labels would add |
|---|---|---|
| `real-mdn-css` | 7921 chars | **+22%** |
| `real-costco-search` | 7909 chars | **+47%** |
| **`real-wikipedia-portal`** | 7895 chars | **+228%** |

> ### On the portal page, labelling triples the output — so the budget cuts more nodes, so more of the page becomes invisible.
>
> **That is the truncation problem back in a new shape, exactly as the Owner predicted.** A
> design that pays for context everywhere buys ambiguity-resolution with page-coverage, and
> page-coverage is what `read_page` exists for.

## THE PRINCIPLE — context is EARNED, never universal

> ## A node whose (role, name) is unique in the output needs no context, and must not be given any.

`link "Skip to Main Content"` is unambiguous on its own. Every character spent labelling it is
a character not spent on a node the model cannot otherwise reach. **Only duplicates pay.**

On Costco that is **82 of 548** surviving nodes; the other 466 stay exactly as they are today.

## The shape — a container line, emitted ONCE, with its members under it

```
[#r4f2a9c1b] group "Kirkland Signature 2-ply Paper Towels, 12-pack"
  [#r7b31c0de] link "Kirkland Signature 2-ply Paper Towels, 12-pack"
  [#r9c14aa02] button "Add to Cart"

[#r22de81f7] group "Bounty Plus Paper Towel, 12 x 91 Sheets"
  [#r5a0b93c1] link "Bounty Plus Paper Towel, 12 x 91 Sheets"
  [#rc8e77b40] button "Add to Cart"
```

**Not a suffix per line.** A suffix pays the label cost once per *member*; a container line
pays it once per *group*. Where several duplicates share a container — which is the Wikipedia
portal case, and the reason it measured +228% — that is the difference between linear and
constant cost.

### Four rules that keep the nesting from becoming the new problem

1. **Only ambiguity creates a level.** The container is emitted **only** when it resolves a
   duplicate. No group appears because it exists in the DOM.
2. **Collapse the chain to the ONE ancestor that resolves it.** Depth is 1–6; intermediate
   levels that add no disambiguation are never emitted. **Nesting depth in the output is at
   most 1**, regardless of DOM depth.
3. **The budget is unchanged and still binds.** Structure is a way of *spending* the existing
   character budget, never a reason to raise it. If context does not fit, **nodes are cut and
   the cut is stated** — the current rule, unchanged.
4. **⚠ TRUNCATION MUST STATE ITSELF INSIDE A GROUP, NOT ONLY GLOBALLY.** This is the genuinely
   new failure this design creates:

   > Cutting flat list items looks like a shorter list. **Cutting inside a group looks like a
   > COMPLETE group with fewer members** — 「3 products」 when there are 21. The reader cannot
   > see the difference, which is HR-13 in a new costume.

   So a partially-emitted group carries its own count (`group "…" — 2 of 7 shown`), and a
   group dropped entirely is counted in the global notice. **This is the part of the design
   most likely to be skipped and it is the part that must not be.**

## What it does NOT do — stated because the shape invites the opposite reading

- **It does not decide which product the Owner wants.** It makes the 21 buttons
  *distinguishable*; choosing between them is the judgement `read_page` has never claimed and
  `click` will not have either. **The Costco measurement stands: four actions against six
  classes of judgement a selector cannot make.**
- **It does not resolve the 2 genuinely-identical Wikipedia siblings.** Those are reported as
  ambiguous. **A design that returned one of them would be the pruner lying about the page.**
- **It does not change the ref.** Refs stay opaque hashes of `backendDOMNodeId`; a container
  gets one too, so `click` can never be pointed at a group by mistake — it resolves or it
  refuses.

---

# 3. HOW IT WOULD BE PROVEN — before it is kept

**Non-negotiable, given this round's record: 「應該會有幫助」 has failed measurement once and
succeeded once, and only the A/B told them apart.**

1. **New corpus questions on the 21-button case**, frozen before the change — 「which ref adds
   the *Bounty* paper towels to the cart?」 Today there is no correct answer to grade; with
   containers there is exactly one.
2. **A/B interleaved, flat versus structured**, on the whole V2 set — because the risk worth
   measuring is not 「does it fix the 21 buttons」 but 「what does spending 47% more characters
   cost on the twelve questions that were already passing」.
3. **The bounding claim measured, not asserted**: output size per page before and after, and
   the count of nodes that stopped being visible.
4. **The in-group truncation notice tested against a page where a group IS cut** — a page that
   is not in the corpus today and must be captured for it.

> ### The acceptance condition is that structure costs nothing on the questions that already pass, and fixes the one that has never had an answer.
