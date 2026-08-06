# The worker adapter — a fence contract, not an interface

<!-- record-status: ACTIVE 2026-08-05 -->

**Design only. No code.** 2026-08-05.
Downstream of `DESIGN-IDENTITY-DIMENSION.md` and `GOVERNANCE-BROWSER-VS-FILE.md`; identity
comes first, and the fence insight comes from the remote.

> **Owner's framing, which is the design:** it is not a uniform interface with a worker
> slotted in. **It is a contract that forces each worker to declare what makes the bad
> outcome IMPOSSIBLE in its environment — and refuses to dispatch if the answer is only a
> rule.**

---

# THE ENTRY RULE — Owner-accepted 2026-08-05, and it comes before everything below

> ## It is not about identity.
> ## **It is about whether the fence sits in an environment WE BUILD AND CAN VERIFY.**

Deployment is case 3 — acting as the Owner — and it **passes**. The browser is refused **not
because it spends money** but because its fence lives on someone else's side.

> **Owner: 「That reframing makes the rule teachable, which mine was not.」**

That is the test. Identity still selects the order body; it does not decide admission.

## And a permanent refusal is not a pending gap

`effect`-shaped work through an external worker is refused **permanently** — not 「until
something we cannot control changes」. The earlier wording was wrong and is retracted here,
for a specific reason the Owner named:

> **A permanent refusal must not read as a pending gap, or someone later treats it as a
> backlog item.**

Their side is theirs. That is a property of the arrangement, not an unfinished piece of work.
**Manus is admissible today for `assertion`-shaped work**, where the whole bad-outcome space
is bounded by what we transmit — which is on our side, and therefore verifiable.

## Scope, decided: ONE schema

> **Owner ruling: case 1 now; the case-3 deployment variant when deployment is actually
> built; case 2 never on spec.**
>
> **「A schema built to be refused is a schema built for nothing.」**

## The honest scope, recorded so it is not rediscovered later

> **A class of workers whose box we own, plus a wall, plus a mechanised refusal.**
> **Less than three workers — and worth having.**

---

# THREE PRINCIPLES — kept prominent because they are principles, not details

> ## 1. A fence is a property of the DISPATCH, not of the worker.
> The same Claude Code in a clone with no remote and in the real repo are two different risk
> objects. A fence therefore cannot be a column in a worker registry. **It is verified at
> dispatch, immediately before hand-off, and the verdict is sealed into the order.** A fence
> checked once and assumed thereafter is not a fence.

> ## 2. `probe_never_failed` is an entry condition.
> **A check that has never returned negative is not a check.** A fence probe is admitted only
> once it has demonstrated a refusal. This is 「earn the zero」 promoted from a reporting rule
> to an admission rule, and it exists because this project has repeatedly found *positive
> controls that could not have failed* — R6's gate script the Companion could not read, the
> UIA walk returning one node, the screenshot that succeeded and was black.

> ## 3. The Owner CANNOT override a fence refusal on the card.
> **Owner's own ruling: 「That constrains me, and it is right. A fence I can click past is a
> rule.」**
> The legitimate path is to **change the environment** — remove the remote, take the card out
> of the profile — and re-verify. Clicking is not a path. An override button would convert
> the entire contract back into the thing it was built to replace.

---

# 1. What every worker must declare

| field | who asserts | who verifies |
|---|---|---|
| `identityCase` — `none` / `own` / `owner` | worker | selects the order body (§3) |
| `fence { claim, probe, verdict, verifiedAt }` | worker states the claim | **we run the probe** |
| `forbiddenActions` — **split in two** | worker | contract checks the split |
| audit, both sides | | |
| `resultKind` | | determines where the gate is |

## The fence verdict is tri-state and the states never merge

| verdict | meaning | dispatch |
|---|---|---|
| `CAPABILITY_ABSENT` | verified: the capability is not present here | **permitted** |
| `UNVERIFIABLE` | we cannot check it | **refused** |
| `CAPABILITY_PRESENT` | verified: it is still there | **refused** |

`UNVERIFIABLE` is not a failure and is not a pass. Merging it with either is the same defect
as merging 「read succeeded, nothing found」 with 「read failed」.

## `forbiddenActions` becomes two lists

`structurallyImpossible[]` — each entry naming the fence that makes it so — and
`declaredOnly[]`. **Any `MUST_FORBID` item appearing in `declaredOnly` refuses the dispatch.**
That rule is the tooth in the contract.

## Audit, on both sides

Ours: `approvedBy` · `actedAs` · order hash · dispatch time · fence verdict.
Theirs: `principalId` · `externalJobId`.
Plus an explicit field stating **our record is one side of a two-sided event** — today's audit
assumes it is the whole account.

## What "result" means when it is not a diff

| `resultKind` | what it is | where the gate is |
|---|---|---|
| **artifact** | a patch we hold and can verify | **at apply time** — dispatch is not the last gate |
| **effect** | already happened (a click, a deploy) | **only before dispatch. There is no second gate.** |
| **assertion** | a claim, no side effect | none; must be marked attested-by-them, not observed-by-us |

`effect` results additionally declare reversibility: `reversible` / `compensable` /
`irreversible`. Every result the Agent Bridge has ever produced is an artifact, which is why
this distinction never had to exist — and it is exactly where the browser case broke.

---

# 2. How the dispatcher refuses

**Refusal is the default.** No verdict is not a pass — the same fail-closed shape as the
service-token resolver (B2-15): resolve first, and refuse everyone if nothing resolves.

Refusal reasons are distinct and audited, never merged into 「not allowed」:

`fence_unverifiable` · `fence_capability_present` · `fence_probe_missing` ·
`probe_never_failed` · `declared_only_overlap` · `identity_case_unsupported`

The refusal is **visible, not silent** — an audit event plus Owner-facing text naming which
fence failed and what would have to change in the environment to pass.

## The self-referential problem this solves

A fence the worker declares is still a declaration; it has only moved the intention up one
level. **So the fence must be verified by us, on our side, by a probe that can fail.** That
is the whole reason principles 1 and 2 exist.

---

# 3. What generalising Agent Bridge costs

**Carries over unchanged:** approvalId, order hash, TTL/nonce, the WYSIWYA card, `allowedFiles`,
the audit plumbing, the truth store, the four-flag matrix.

**Must change:** the order has no `worker`, no `targetRepo`, no `identityCase`, no fence block;
`costCapUsd` means something different per case; `MUST_FORBID = all, always` is calibrated for
case 1 and becomes a *false claim* for case 2 rather than a safety; the runner is Claude-Code
specific (spawns a child, reads output) so a transport abstraction is needed; `who` must split
into `approvedBy`/`actedAs`.

**The bulk of the work is tests**, because several pin the exact sentence the card renders and
the current single shape.

## One shape per identity case, or one shape with a dimension?

> ### One shared core, plus a body per identity case. Not a discriminator.

1. Required fields genuinely differ — case 2 needs a principal and an external job id; case 3
   needs an origin, a grant scope and reversibility; case 1 needs none of them.
2. `costCapUsd` is denominated differently, and a shared field invites carrying a number that
   is not a limit into a case where it is not one.
3. **A discriminator makes a valid-but-meaningless order constructible. Three bodies make it
   unconstructible** — the same 「impossible, not forbidden」 principle applied to our own data
   model.

**But see §5: probably only two bodies are ever worth building.**

---

# 4. Which worker is first — a PAIR, and the pairing is the point

> ## Admit Claude Code against `aroma-system` in a no-remote clone (case 1).
> ## Register the browser the SAME DAY, specifically to be REFUSED.

- The accepting half proves the fence is a dispatch-time verified object rather than an
  assumption, and delivers real work — the `DEFECT-001` fix candidate.
- **The refusing half is the proof.** The browser's fence (a profile with no payment method)
  **cannot be verified from our side** → `UNVERIFIABLE` → refused. The contract refuses the
  exact worker that nearly led us wrong.
- **Neither half proves anything alone.** An accept-only test cannot distinguish a working
  contract from one that accepts everything — 「positive controls that could not have failed」
  is the failure mode this project has hit repeatedly.

Second: **deployment** (not Manus) — case 3, but its fence *is* verifiable. Third, if ever:
Manus, and only in the narrow shape below.

---

# 5. WHAT THE OWNER WILL ACTUALLY BE ABLE TO DO

**His question, answered without softening.**

## The real admission rule is not the identity case

The simplification 「case 1 good, cases 2 and 3 out」 is wrong, and the correct rule is
sharper:

> ## A worker is admissible when the thing that makes the bad outcome impossible sits in an environment WE BUILD AND CAN INSPECT.
> ## It is refused when the fence lives on someone else's side.

That is why deployment — case 3, acting as the Owner — is **admissible**, while the browser —
also case 3 — is not. Deployment's fence is *the signing key is absent from the agent's
environment*, and we construct that environment. The browser's fence lives in a profile we
cannot introspect and on a retailer's side we do not own.

## REACHABLE

| | |
|---|---|
| **Case-1 workers against production repos** | Not one worker — **one class**, and we own the box. Claude Code in a no-remote clone today; the same shape covers a codemod worker, a test worker, a migration dry-run worker, a research worker with no network. **Most of the actual backlog lives here**: DEFECT-001, the restock list, per-page calm cleanup, invoice-intake polish. |
| **Deployment behind a signature** | Structurally, and off the Manus machine. The VPS pulls, deploys only a signed ref, and the key lives where the Owner types. Fence verifiable because both environments are his. |
| **A mechanical refusal** | The standing 「no」 to browser-shaped work stops depending on anyone remembering this month. That is a deliverable, not a side effect. |

## PERMANENTLY OUT OF REACH

Not 「until we build more」 — these follow from properties no engineering on our side changes:

- **Any worker acting as the Owner on a third party's system where the consequence is money
  or identity.** Costco, supplier portals, the bank, CRA. The fence would have to live on
  their side.
- **Verifying an external worker's own conduct.** We can record that our record is half. We
  can never make it whole.
- **「She fills a cart, I press the button.」** Dead twice over — the cart is session-bound,
  and the fence is unverifiable.

## THE CORRECTION TO THE OWNER'S OWN SENTENCE

He offered: 「Claude Code against aroma-system in a clone, and deployment behind a signature —
and Manus stays refused until something changes that we cannot control.」

**The first two clauses are right. The third is nearly right and worth sharpening:**

> **Manus is admissible only for `assertion`-shaped work** — where the deliverable is a claim
> with no effect, and the entire bad-outcome space is bounded by *what we transmit*, which is
> on our side and therefore verifiable.
>
> **For `effect`-shaped work it is refused permanently**, not pending a change. Their side is
> theirs; that is not a gap waiting to be closed.

## AND THE COST CORRECTION HE ASKED FOR

> **Three schemas is over-built for what is admissible.**

Build **case 1's body now**, and the **case-3 deploy variant** when deployment happens. Do
**not** build case 2's body speculatively — it would exist mainly to be refused, and it should
only be built if the Owner ever wants assertion-shaped external work.

**So: is the adapter's value 「one worker plus a wall」?** No — it is **one class of worker we
own the box for, plus a wall, plus a refusal that is mechanical rather than remembered.** But
it is honestly *less* than three workers, and knowing that now is worth more than discovering
it after three schemas.
