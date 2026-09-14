---
name: feedback-verify-root-cause-before-fixing
description: "Do not ship a fix for a plausible timing/race/cache theory without isolating reproduction first, and say so explicitly when a diagnosis is unconfirmed."
metadata:
  type: feedback
---

Before shipping a fix built on a "probably a timing, race or cache issue" theory, test or ask
whether the bug reproduces in complete isolation (just this one operation, nothing chained
before it) versus only in a specific sequence. If a fix changes behavior based on an unconfirmed
theory, flag it as unconfirmed rather than presenting it as diagnosed.

**Why:** On the CrossFlow project this happened twice. In 2026-07-31 a plausible
conform-lag theory produced two rounds of shipped fixes; the user then ran the same test in
isolation, could not reproduce it at all, and the real cause turned out to be a stale media
cache. In 2026-08-26 an "async indexing race" diagnosis was stated as fact; when the user asked
"are you 100% sure", a re-check found a structurally wrong database relationship one branch
away, provably inconsistent with the sibling code path. In both cases the mechanism was
plausible and well precedented, which is exactly why it went unchallenged.

**How to apply:** A plausible mechanism is not a confirmed one. Look for the falsifying test
before the fix, not after. This user reliably runs the isolation test himself when a diagnosis
looks shaky, so ask for it proactively instead of waiting for the correction. When uncertain,
say "I found X, but I am not certain it is the Y you meant" rather than shipping confidently.

Related: [[feedback-dont-reinterpret-reported-symptom]].
