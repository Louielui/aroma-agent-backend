# Planning reasoning depth and latency

The sidebar planning run `ba24a422-5c5a-4300-a7e4-6307595ef158` used GPT-6.1 Sol
High despite Medium being selected in chat. Its persisted stages measure 70.456
seconds overall: 306 ms source acquisition, about 1.033 seconds preflight and
about 69.114 seconds planning plus post-result source verification. The two
preceding ordinary answer model calls measured 8.322 and 9.179 seconds. These
are component measurements, not entire chat HTTP latency or first-token latency.

New read-only planning runs now inherit the selected five-level chat effort,
defaulting to Medium. Legacy fast/standard/deep map to low/medium/high through
the existing chat profile resolver. Production composition creates a provider
per run using its recorded effort; it does not mutate a shared adapter. A replay
with a different effort conflicts rather than changing or repeating an old job.
Readback of old High jobs retains High. Model choice for this dedicated planner
remains GPT-6.1 Sol; coding and review work orders retain their own contracts.

Permissions, source validation, exact citations, result checks, deadlines and
coding/adoption approvals remain unchanged. Lower effort is a speed/quality
tradeoff, not proof of equal performance or equal speed with ChatGPT or Codex.

The subscription completion route currently returns complete validated JSON.
This change does not add streaming, bypass verification or expose partial model
text. Latency comparisons must name effort, prompt, source set, end-to-end time
and validated-result quality. A single live run is an observation, not a stable
latency distribution or a controlled cross-product benchmark.

Official reasoning guidance:
https://developers.openai.com/api/docs/guides/reasoning
