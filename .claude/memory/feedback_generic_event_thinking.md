---
name: feedback-generic-event-thinking
description: "Standing rule since 2026-09-13: the tool must serve any event. An example taken from the Loto Tekno is an example, never a spec; model the general event notion and make the specific figure a per-event setting."
metadata:
  type: feedback
---

The developer wants the planning tool usable for any event, not only the Loto Tekno. Even when a
request is phrased with a Loto Tekno example (the loto, the concerts, 6 h / 8 h, "choix 1 / choix 2",
the artists), reason about the problem at the level of event management in general and do not bake
the example's notions into types, rules, labels or defaults.

**Why.** Said explicitly on 2026-09-13 ("même si je te donne des exemples pour un événement précis,
réfléchis au problème d'un point de vue global événementiel"). Earlier rounds had to undo exactly
that: `halfPreference` and the loto / soirée rules ([[feature-event-abstraction]]), then nine
hard-coded tier 1 rules and seventeen solver constants ([[feature-advanced-settings]]).

**How to apply.**
- A number or a rule that another event could want differently is a per-event setting with the
  Loto Tekno figure as its default, never a constant.
- Name things generically in code and UI ("tranche préférée", "moment de la programmation",
  "journée longue") and keep the event's own words in data (labels the régisseur types).
- When building something from an example, say in the reply which parts were generalised and list
  any Loto-specific assumption still left elsewhere.
