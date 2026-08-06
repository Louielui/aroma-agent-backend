# DEFECT-007 — every query parameter the adapter sends is ignored server-side

<!-- record-status: ACTIVE 2026-08-06 -->

**Repo: `aroma-system` (production). Recorded, NOT fixed.**
**Found 2026-08-06, INCIDENTALLY, while answering a question about `totalCount`.**

---

## One line

**None of the six `GET` handlers in `server/routes/aiIntegration.ts` reads `req.query` at
all**, so every value 香香's adapter forwards through `ALLOWED_QUERY` — `limit`, `q`, `from`,
`to`, `status`, `supplierId` — is silently discarded by the server.

## Why this is bigger than the note already on file

`aromaSystemRead.js` carries this comment:

> *「The API ignores `limit`, so the whole table arrives and something must choose.」*

**That note is true and it is one sixth of the truth.** It named one parameter, and the
adapter has been sending six. `limit` was noticed because its effect was visible — 199 rows
arriving when 25 were asked for. The other five fail invisibly: a `q` that filters nothing
still returns rows, so nothing looks wrong.

| parameter | sent by the adapter | read by the server |
|---|---|---|
| `limit` | yes | **no** — already noted |
| `q` | yes | **no** |
| `from` / `to` | yes | **no** |
| `status` | yes | **no** |
| `supplierId` | yes | **no** |

## What it costs today

Nothing visibly, which is the problem. The adapter's `ALLOWED_QUERY` list reads as a
capability — a caller may reasonably build a narrower query believing it will be applied, and
receive a wider answer that looks like a correct one. **The parameters are a promise the
server never agreed to.**

## Suggested direction — NOT APPLIED

Either honour them or stop sending them. **Sending a parameter that is ignored is the worse
of the two**, because it makes the client's intent invisible in the result.

If they are honoured, note that `limit` interacts with `DEFECT-001`'s neighbourhood: a
server-side `limit` must be reported alongside a total, or it recreates the `count: 43`
problem at the caller's request rather than the server's default.

## How to verify

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://system.aromabistro741.com/api/v1/ai/inventory?limit=5" | head -c 200
```

Today that returns 199 rows.
