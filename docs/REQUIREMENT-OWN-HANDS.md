# STANDING REQUIREMENT — 香香 operates a computer HERSELF

<!-- record-status: ACTIVE 2026-08-06 -->

**Owner decision, 2026-08-06. This is a REQUIREMENT, not a preference, and it survives every
future conversation.**

---

# The requirement

> ## 香香 MUST have her own ability to operate a computer — online and browser, and offline and desktop.
> ## **Not by dispatching to another product.**
>
> **Writing code she may delegate. Operating a computer she may not.**

# The reasoning, recorded so nobody later reads it as taste

> **Operating a computer is a BODY, not a skill.** Delegating it means renting hands.
>
> A worker that can be **withdrawn, deprecated, or repriced** is not a capability she has —
> it is a capability she **borrows**. And the whole architecture says invest in capabilities,
> not vendors.

The distinction is not about quality or convenience. A borrowed body is one commercial
decision away from being gone, and everything built on top of it goes with it.

---

# ⚠ HOW THIS CONSTRAINS DESIGN — read this before proposing anything

> ### Any proposal that satisfies 「she can operate a computer」 by dispatching to Cowork, Claude in Chrome, or any other product **satisfies a DIFFERENT requirement**.
>
> It must **say so plainly** rather than reading as completion.

A design document, a plan, or a working demo that routes through another product is not
progress against this requirement. It may be valuable — see Track A — but it must be labelled
as what it is, in its own first paragraph, and must never be recorded as 「done」 against this
page.

**The test:** if the other product disappeared tomorrow, does she still have hands? If no,
this requirement is untouched no matter what was built.

---

# TWO TRACKS, IN PARALLEL

## TRACK B — THE REQUIREMENT. The destination.

Her own action set:

| online | offline |
|---|---|
| `navigate` · `click` · `type` · `read_page` · `wait_for` · `screenshot` | files · windows · applications |

**Estimated in months.**

> ### It does not get dropped because the bridge works.
> A working Track A is the single most likely reason Track B quietly stops being funded, and
> that is exactly the outcome this page exists to prevent.

## TRACK A — A BRIDGE. Scaffolding, with a removal condition.

So the Owner is not idle for months. **If** a dispatch path into Cowork exists, she uses it
for real work now — starting with IG posts through Canva.

**It is explicitly temporary.**

| | |
|---|---|
| **status** | scaffolding, never architecture |
| **removal condition** | **replaced by Track B when Track B lands** — removed, not left beside it |
| **how it must be described** | 「a bridge into another product」, never 「she can operate a computer」 |

Recording it as scaffolding is not a formality. Scaffolding that is never labelled becomes
load-bearing by default, and then removing it is a project of its own.

---

# The first step, and only this

**Measure whether Track A is even possible.** Nothing is designed past that answer.

See `DESIGN-VISUAL-OPERATION.md` for what has already been measured about the action set and
the fence, and for the step-0 result on the headless CLI (`TOOL_NOT_AVAILABLE`).

---
---

# TRACK A FEASIBILITY — MEASURED 2026-08-06. Answer: NOT POSSIBLE TODAY.

Config and process reality, read-only. No documentation was consulted.

## 1. Where the browser tools come from — NOT the MCP mechanism

```
Claude desktop app   (MSIX  Claude_1.24012.11.0_x64__pzs8sxrjxfjjc)
        ↕ stdio native messaging
chrome-native-host.exe   1,018,704 bytes
        …\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\ChromeNativeHost\
        registered HKCU\…\NativeMessagingHosts\com.anthropic.claude_browser_extension
        ↕
Chrome extension 「Claude」 v1.0.84   (fcoeoabgfenejglbffodgkkbkcdhcgfn)
        permissions: debugger, scripting, tabs, tabGroups, webNavigation,
                     nativeMessaging, offscreen, downloads, <all_urls>
        externally_connectable: https://claude.ai/* ONLY
        ↕
the browser
```

**`claude mcp list` reports four servers — Microsoft 365, Google Calendar, Gmail, Drive.
Zero browser.** The browser capability does not travel over MCP at all.

> ### It is a DESKTOP-APP capability delivered through a native host into an extension.
> That is why the headless CLI answered `TOOL_NOT_AVAILABLE`: the CLI is not the desktop app
> and has no native-host connection to it.

## 2. Dispatch surface — four candidates, measured

| candidate | result |
|---|---|
| MCP server | **no** — not the mechanism, per above |
| a local listening port | **no** — nothing listening belongs to Claude. `7768` Spotify, `8081` the A6 service, `8090` hers; the four `claude.exe` PIDs own none |
| **URL scheme** | **EXISTS** — `claude://` → the desktop app, `claude-cli://` → `claude.exe --handle-uri "%1"`, both with the `URL Protocol` marker |
| **the native host binary** | **EXISTS** — a real stdio executable at a known path |

### ⚠ But neither invocable surface is a dispatch path

**`claude://` is a LAUNCH mechanism, not an API.** It opens the app with a payload. Crucially:

> **There is no return channel.** A URL scheme is fire-and-forget. Her backend would get no
> result, no cost, no turns — which is the entire basis of the enquiry design.

**`chrome-native-host.exe`** could in principle be spawned and spoken to over length-prefixed
JSON. Against that: `allowed_origins` names three extension IDs and the host will expect one;
the protocol is undocumented; and any app update may change it without notice.

> **And it is exactly 「renting hands」 with extra steps.** Per the requirement above, a
> proposal of that shape must say so plainly — it would be a reverse-engineered integration
> with a vendor's private channel, which is a *weaker* form of borrowing than the supported
> one, not a stronger one.

## 3. What she could do through it today — NOTHING, and the reason is structural

Not 「it is hard」. **There is no request/response surface at all.** The only invocable entry
point cannot return an answer.

## 4. The honest number for Track B

**Stated as an estimate, not a measurement, and separated so the weak half is visible.**

### Online / browser — **1 to 2 months**

The six verbs are the small part. What the estimate is actually carrying:
- **no automation dependency exists** (`package.json`: octokit, axios, dotenv, express,
  express-validator, googleapis, uuid) and this repo's standing rule is **no new
  dependencies** — so either that rule gets an exception, or it is Chrome DevTools Protocol
  over a WebSocket, written here. **That is an Owner decision, and it is on the critical
  path.**
- `read_page` producing something a model can *act* on — an accessibility tree, not a DOM
  dump — is the real work, not `click`.
- the governance is already designed (fence, audit fields, redaction, screenshot policy).

### Offline / desktop — **3 to 6 months, and the evidence supports the HIGH end**

This is the half with real data, and it is not encouraging:
- `aroma-3b` has **24 modules** and, after that work, **3 actions**: `open_app`, `type_text`,
  `save`.
- **`BACKLOG-002` — targeted Notepad save — is closed as 「evidence not sufficient」.** One
  save. Unsolved.

> **Anyone estimating the offline side from the online side will be wrong.** Windows UIA is
> where this project has already spent effort and has three verbs to show for it.

### And the part no action set fixes

The Costco measurement stands: **four actions to Add to Cart against six classes of judgement
a selector cannot make.** Track B buys hands. It does not buy the judgement, and the judgement
was always the larger share.
