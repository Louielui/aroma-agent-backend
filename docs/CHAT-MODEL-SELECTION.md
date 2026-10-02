# Subscription chat model selection

The Owner can choose GPT-6.1 Sol, GPT-6 Astra, GPT-6 Luna or GPT-6 Sol in the
chat composer. Astra remains the default for compatibility. Fast / Standard /
Deep continue to mean low / medium / high reasoning effort; all use the default
provider service tier, not the separately priced Fast priority tier.

`GET /api/v1/demo/models` is guarded like the chat UI. It reads the signed-in
ChatGPT account's visible model catalogue through the authenticated loopback
bridge. Missing choices remain visible but disabled. Reading the catalogue
does not start a model turn or spend credits. It never returns credentials or
account identity. Each completion checks the exact model, effort and current
usage limits again. Missing models, unsupported efforts and provider model
substitutions fail without silent fallback.

The validated `chatModel` is passed only into the chat lane and administrative
mail summaries requested from that lane. It does not change control-role models,
memory extraction/indexing, website search workers, code workers, draft-email
models, or approval policies. Source-only answers correctly have no model label.
Model-produced answers retain their actual provider model in conversation history.
Browser storage is not used; selection lasts in the current page.

`CODEX_CHAT_MODEL_EXECUTABLE` optionally points to a separate, updated official
Codex executable for conversational completions. It defaults to the existing
`CODEX_CHAT_EXECUTABLE`. Memory and work providers keep using that original
executable and their pinned models. A configured missing executable fails startup;
there is no automatic alternate provider. On 2026-10-02, the isolated chat runtime
was installed from `@openai/codex@0.160.0`; the prior runtime was 0.153.4.

Same ChatGPT authentication and Owner-approved credit policy apply to every
choice. No API key is provisioned and no credits are purchased. Spending caps,
individual caps and true subscription/credit exhaustion remain enforced.

Official Standard credit rates as checked on 2026-10-02: GPT-6.1 Sol ordinary
input/output use 50/250 credits per million tokens, versus Astra 250/1250.
Thus equal uncached input/output token counts use one fifth as many credits.
Actual totals depend on context, caching, reasoning and output length. Subscription
monthly fees are unchanged; included plan allowances do not follow this ratio
directly. See https://learn.chatgpt.com/docs/pricing .

Validation: model/effort matrix, exact provider model verification, rejected
arbitrary model/execution/credit settings, account catalogue pagination,
availability without generation, capacity enforcement and chat-only HTTP routing.
Delivery additionally checks running boot commit, the live account catalogue,
actual Sol completion, UI selection and the in-app architecture inventory.
