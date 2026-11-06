# Chat latency candidate

The retained PR142 memory-recall turn took 49.005 seconds with four successful
Claude Opus 5.5 / Medium calls. Control calls took 25.928 seconds; the answer
call took 11.510 seconds. This single sample does not establish a median or prove
that reasoning effort is the bottleneck. Native provider timing is not pure
thinking time. No runtime model or reasoning setting changes in this candidate.

## Changes and boundaries

- The goal helper receives a dedicated short planning system contract instead of
  the answer persona, classifier and response-writing instructions. The complete
  catalogue is compact JSON. Its schema, ordered working context, memory blocks,
  approved preferences, trusted host description and host plan validation remain.
- Preference, general recall and optional mail recall start independently and
  join before composing. Each existing gateway retains its before/after access
  and canonical-record checks. No cross-turn cache, new query, credential or
  permission is introduced. Each failure retains its unavailable status.
- The existing latency emitter records each memory stage, including failures.
  These are nested inside prompt_build and overlap: do not add them to the parent
  or assume that their sum equals wall time. No query or error text is logged.
- Claude auth/catalogue metadata cannot invoke the completion onDispatch hook.
  The actual completion still needs the existing native run permit and counts
  dispatch at process spawn. Auth and catalogue validation are not cached or
  removed. Reservations, retries and hard ceilings are unchanged.

This candidate does not remove semantic routing, goal planning, final obligation
verification, evidence guards or review. The retained four-call case still makes
four calls. Smaller input and concurrent I/O are structural improvements, not a
measured promise of a particular speedup or better model output.

## Verification and delivery

New regressions fail on the old behavior and check context/schema preservation,
parallel reads, partial failure, opt-out boundaries and actual-send attribution.
Saved native outputs also traverse the existing complete intake regression.
Offline replay proves deterministic host behavior only; it cannot prove the
model will return the same answer to the shorter planning instructions.

Before live acceptance, independently review the complete SHA, run the isolated
suite and PR checks, then obtain exact-version deployment and bounded new-use
approval. Previous learning turns are exhausted; unused helpers cannot be moved.
Use the existing subscription and unchanged Opus 5.5 / Medium for comparison.
Verify approved preferences, referents, unavailable memory and source guards as
well as stage timings. Report original and candidate observations separately,
stop on a substantive failure, and do not infer a multi-turn median from one turn.
