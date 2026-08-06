# DEFECT-009 — 「Chrome cannot reach the internet」

<!-- record-status: CLOSED 2026-08-06 — NOT A DEFECT. Two separate causes, both external to us. -->

> **Owner: 「diagnosed, not worked around… Node resolves the host, Chrome does not, on the same
> machine. If it is a proxy, a policy, or the profile, say which.」**

## ⛔ FIRST — MY OWN REPORT WAS WRONG, AND IT IS THE INTERESTING PART

I reported: **「node reached the same host fine」** for `example.com`. **It does not.**

```
node dns.resolve4('example.com')  ->  ERR ENOTFOUND     <-- node fails too
node dns.resolve4('www.costco.ca')->  23.53.170.213     <-- node succeeds
```

I had run `fetch` against a host that worked and `chromium.goto` against a host that did not,
and **attributed the difference to the browser** — the one variable I had changed alongside
the one I was testing. That is HR-12 again: **the comparison was confounded, and it was
confounded in the direction of my conclusion.**

There was never one defect. There were two, and neither is a browser that cannot reach the
internet.

---

## CAUSE 1 — `example.com` is blocked by the ROUTER'S DNS, machine-wide

| resolver | result |
|---|---|
| the machine's own (`192.168.0.1` / `192.168.255.1`) | **DNS name does not exist** |
| public `8.8.8.8`, same machine, same moment | `104.20.23.154`, `172.66.147.243` |
| control — `en.wikipedia.org` via the local resolver | resolves fine |

**Not a proxy, not a policy, not the profile — the LAN resolver.** It answers NXDOMAIN for
`example.com` and correctly for everything else tried. It hits node and Chrome identically.

> **`example.com` was a bad canary and it produced a false diagnosis.** Nothing about the
> browser was ever measured by it.

## CAUSE 2 — `costco.ca` fails **headless**, and works **headed**

Same machine, same Chrome build (150.0.7871.188), same code, seconds apart:

| | wikipedia | google | **costco.ca** |
|---|---|---|---|
| `headless: true` | 200 | 200 | **ERR_HTTP2_PROTOCOL_ERROR** |
| `headless: false` | 200 | 200 | **200** |

**Chrome's network is fine.** Two of three sites work headless. What fails is one site, and
only when headless.

`23.53.170.213` is **Akamai**. The signature — connection accepted then broken at the HTTP/2
layer, `--disable-http2` converting it into a hang rather than fixing it — is **bot
mitigation refusing a headless client**, not a network fault.

### Ruled out by measurement, not by argument

| hypothesis | how it died |
|---|---|
| a proxy | `ProxyEnable = 0`, no `AutoConfigURL`, no proxy env var, and playwright only emits `--proxy-server` when one is configured (grepped the source) |
| Chrome enterprise policy | `HKLM` and `HKCU\Software\Policies\Google\Chrome` — **both absent** |
| a firewall rule against `chrome.exe` | only an **inbound Allow**; `DefaultOutboundAction` NotConfigured on all three profiles |
| TLS interception / MITM | node sees a genuine **DigiCert Global G3** chain, `CN=costco.ca`. Nobody is in the middle |
| **the Claude Code Bash sandbox** | **re-run with the sandbox off — identical failure.** Not us |
| Chrome has no network at all | it reached her own server on `127.0.0.1:8090` (HTTP 404 — the server answered), and google and wikipedia externally |
| a playwright launch flag | `ignoreDefaultArgs` and a source grep: no resolver or proxy flag is injected |

---

# ⚠ WHAT THIS ACTUALLY MEANS FOR TRACK B — and it is a design constraint, not a footnote

> ## The browser must run HEADED. That is now a requirement, not a preference.

Not for realism or for screenshots. Because **the sites the Owner would actually send her to
are exactly the sites that refuse a headless client** — retail and supplier portals sit behind
the same mitigation Costco does.

Two consequences that must not be discovered later:

1. **A headless corpus capture would have silently produced a corpus of the easy half of the
   web** — every bot-protected site failing to capture, and the resulting benchmark scoring
   well on what remained. **The absence would not have announced itself.** (HR-13.)
2. **Headed means a visible window on the Owner's machine**, which changes the fence design:
   the profile, the display, and 「is she using it while he is」 are now real questions.
   `DESIGN-VISUAL-OPERATION.md` §3 assumed a browser we construct; it did not assume one he
   can see moving.

**And the corpus gap is now fixable.** The reason given for it — 「Chrome cannot resolve DNS」 —
was false. A headed capture on this machine can take real pages, and that is a future round,
**not a mid-build addition to a frozen corpus.**
