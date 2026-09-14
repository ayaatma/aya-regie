---
name: feedback-proactive-progress-memory
description: "Update project progress memory files proactively, without being told a step is done. The user wants full recovery after an unplanned session loss (e.g. power outage)."
metadata:
  type: feedback
---

Proactively keep the relevant project memory files up to date at the end of any work that
changes the state of a multi-step feature. Do this unprompted, without waiting for the user to
say "this step is done" or to report test results.

**Why:** The user explicitly does not want to have to narrate status changes. Their stated
scenario: if their PC loses power mid-work and they start a brand new session, that fresh
session must be able to recover full context (what was done, what is left, what to watch out
for) purely from memory, because there is no guarantee the user will be present or able to
re-explain. Rule originally given on the CrossFlow project, carried here at the user's request.

**How to apply:** For any feature spanning multiple sessions or requests, after making real
progress in a turn (writing code, running a test, hitting a blocker, the user reporting
something works or breaks), check whether a project memory file already tracks that feature. If
yes, update it before the turn ends: append to the step history, update the "state as of" date,
note test outcomes, flag blockers. If no such file exists yet but the work looks like it will
span multiple sessions, create one. Do this even with no explicit "remember this" instruction.
Keep entries factual and dated. Do not wait for confirmation that a step is officially finished.

Related: [[project-brief]].
