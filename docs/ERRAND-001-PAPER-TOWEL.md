# ERRAND-001 — 「去 costco.ca，搵 paper towel，讀返頭五件貨嘅名同價錢」

<!-- record-status: ACTIVE 2026-08-06 -->

**The Owner's errand, not a test.** Read-only, no cart, no login. Six verbs as they are;
nothing built for it. **Caps: 15 browser actions, 180s, and zero paid model calls.** Used: 3
actions, 21.6s, **`$0.00`**.

---

# 1. DOES IT WORK WITHOUT NEW CODE? — **YES. No seventh verb was needed.**

```
 1. navigate     ARRIVED      https://www.costco.ca/
 2. read_page    READ         252 of 252 shown
 3. observed     NOTED        heading "Locations & Services" | region "Cookie banner" |
                              alertdialog "Privacy"
 4. found        OK           combobox "Search Costco"
 5. type         TYPED        11 chars, shape text
 6. read_page    READ         254 shown
 7. looking for  FOUND        button "Search"
 8. click        CLICKED      button "Search"
 9. read_page    READ         5 of 5 shown
```

**Every verb did its job.** `navigate` → `read_page` → `type` → `read_page` → `click` →
`read_page`, with the session guard enforcing `read → act → read → act` throughout.

> ### ⚠ AND THE THING I EXPECTED TO STOP IT DID NOT.
>
> I predicted the errand would die at the submit: **`type` never presses Enter and there is no
> submit verb.** It did not matter — the read surfaced `button "Search"` and `click` ran it.
> **The no-submit rule cost nothing on a real errand.**

## The interstitials the Owner predicted were all present — and none of them blocked anything

`region "Cookie banner"`, `alertdialog "Privacy"`, `heading "Locations & Services"` were all in
the first read. **The verbs walked past every one.** A cookie banner that does not physically
cover the search box is not an obstacle, and `read_page` reported it without treating it as one.

---

# 2. WHAT STOPPED IT — **Akamai. And it is not what either of us guessed.**

The click succeeded, the page changed, and `read_page` came back with **five nodes**:

```
[#rc0a55b62] heading "Access Denied"
[#r2a1f9163] StaticText "You don't have permission to access "http://www.costco.ca/s?" on this server."
[#r8f0121b8] StaticText "Reference #18.a8182117.1786061611.cc93031d"
[#re5c9a1fb] StaticText "https://errors.edgesuite.net/18.a8182117.1786061611.cc93031d"
```

`errors.edgesuite.net` is **Akamai**. DOM elements on the page: **8.**

## ⚠ A CORRECTION TO MY OWN INTERMEDIATE CONCLUSION

I was one paragraph from reporting: **「the block is on the INTERACTION, not the endpoint」** —
because navigating directly to the same URL returned **HTTP 200 with 3622 nodes** while the
click-driven request was denied.

**Two minutes later the same direct navigation returned Access Denied.**

| attempt | same URL | result |
|---|---|---|
| via the search button | `/s?…keyword=paper%20towel` | **Access Denied** |
| direct navigate, minutes later | identical URL | **HTTP 200, 3622 raw nodes** |
| direct navigate, minutes later again | identical URL | **Access Denied** |

> ## The block is ADAPTIVE. It escalated as we made more requests.
>
> It is not 「the interaction is defended and the URL is not」. **I would have stated that as a
> property from a single observation** — HR-14, in the round whose whole point was watching
> where things stop.

**The same corpus capture succeeded on this URL earlier today** (3565 nodes, real results, now
frozen in `test/fixtures/axcorpus/real-costco-search.json`). Nothing about our code changed
between then and now.

---

# 3. WHAT THIS MEANS — and it is a bigger finding than a missing verb

> ### The browser half works. **The destination is the constraint, and the constraint gets worse with use.**

| | |
|---|---|
| what we built | did everything asked of it, in 3 actions and 21 seconds |
| what stopped it | the site defending itself, adaptively, against repeated automated access |
| what that costs | **an errand that works in testing can fail in production for reasons unrelated to our code** — and fail *later*, after it has been trusted |

And the safety property held in the one way that matters:

> **`read_page` reported 「Access Denied」 plainly, in five lines.** It did not hallucinate
> products, did not hang, did not return a partial page that read as a result. **The errand
> failed honestly**, which is the whole design.

## ⛔ NOT FIXED, per the Owner's instruction

Options exist and **none was built**:

1. **Rate and pace** — space requests, reuse one session, stop hammering. Cheapest, least
   certain, and it makes the system slower for a reason the report will have to explain.
2. **A logged-in session** — the Owner's own account, which changes the risk class entirely
   (credentials, and a session that can buy things). **This is a governance decision, not a
   technical one.**
3. **Ask the site properly** — Costco has no public API worth the name; this is the honest
   long answer and it is not ours to grant.
4. **Accept the ceiling** — she reads what she can reach, and says so when she cannot. Which
   is what she did today.

**Which of these is worth building is the Owner's call.** My reading: **(1) is worth an hour,
(2) should not be done, and (4) is already true and is not a failure.**

---

# WHAT I WOULD USE THIS FOR TOMORROW, HONESTLY

Not Costco. **The verbs work; the defended retail front-end is the worst possible first
destination** — it is the one place on the web actively investing in stopping exactly this.

The same six verbs against a supplier portal the Owner has an account on, a Drive folder, or an
internal page would meet none of this. **The capability is real. Today's target was the hard
case, and it was the Owner's to choose.**

---
---

# THE ADAPTIVE BLOCK — the finding, with its evidence, and the sentence to keep

<!-- Owner ruling 2026-08-06: record this with the three-observation table -->

**Same URL. Same code. Nothing changed between attempts but time and request count.**

| # | how it was reached | result |
|---|---|---|
| 1 | via the search button, after typing | **Access Denied** — 5 AX nodes, 8 DOM elements |
| 2 | direct `navigate`, minutes later | **HTTP 200 — 3622 raw nodes** |
| 3 | direct `navigate`, minutes later again | **Access Denied** |

**And a fourth observation from earlier the same day:** the frozen corpus capture
(`test/fixtures/axcorpus/real-costco-search.json`, 3565 raw nodes of real results) came from
this same URL and succeeded.

> ## 一單喺測試度行得通嘅差事，可以喺實際運作時因為同我哋段 code 完全無關嘅原因而失敗 —— 而且係遲啲先失敗，喺佢已經被信任之後。
>
> **Owner's ruling: this sentence is kept, and it applies to ANYTHING we ever point at a
> protected site.**

**It is not a Costco fact. It is a property of defended sites**, and it has a shape worth
naming: the failure mode is *not* 「it does not work」 — it is 「it works, until it has been
relied on」. Nothing in our tests can catch that, because the thing that changes is on the
other side.

---

# RULINGS — settled 2026-08-06, not to be re-litigated

| | path | ruling |
|---|---|---|
| ① | **throttling / pacing** | **worth an hour, but NOT NOW** — only after we know how often this actually bites on sites the Owner uses |
| ② | **the Owner's logged-in session** | ⛔ **NO.** 「Credentials plus a session that can spend is the thing every fence this month exists to prevent.」 |
| ③ | **formal permission from the site** | correct, and **out of our hands** |
| ④ | **accept the ceiling** | ✅ **This is the answer** — and it is not failure |

**① is explicitly conditional on evidence we do not have yet**, and that evidence comes from
pointing the verbs at sites the Owner actually uses. Which is the next errand.
