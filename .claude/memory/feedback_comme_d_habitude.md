---
name: feedback-comme-d-habitude
description: "What « fais ça comme d'habitude » means on this project: think through every limit and implication, generalise beyond the event, ask the developer the real decisions before building."
metadata:
  type: feedback
---

When the developer says « comme d'habitude » about a batch of work (typically the ToDo's « A
CORRIGER / AMELIORER » list), it means, stated explicitly on 2026-10-23:

1. **Think every item through before building**: its limits, edge cases, what it implies for the
   rest of the tool (other screens, the solver, persistence, migrations, PLAN_FORMAT), and, since
   real people are in the plan, how it reaches the fiches already imported
   ([[feedback-real-people-imported]]).
2. **Build it so the tool serves as many different events as possible**: abstract any notion too
   tied to the Loto Tekno into a general one, with the event's figure as a per-event setting
   ([[feedback-generic-event-thinking]]).
3. **Ask the developer every real decision** (numbered, with a recommendation) before building
   the part that depends on it; build the parts that need no decision.
4. Then the usual finish: tests, build, checks, headless-Chrome shots where the change is visual
   ([[feedback-visual-check-with-headless-chrome]]), memory updated, commit and push
   ([[feedback-git-commit-push]]), migration and deploy order reported
   ([[feedback-report-migration-and-deploy]]).

**Why:** the developer's standing way of handing over a batch; restated so it survives sessions.

**How to apply:** any batch handed over with « comme d'habitude », or any ToDo list without
further instructions.
