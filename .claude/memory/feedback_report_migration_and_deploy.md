---
name: feedback-report-migration-and-deploy
description: "Standing rule since 2026-09-15: end every piece of work by saying whether the developer must apply a migration and/or deploy, and in which order."
metadata:
  type: feedback
---

At the end of every unit of work, say explicitly whether a migration must be applied, whether a
deploy is needed, or neither, and the order when both (a migration raising `min_plan_format`
ships together with its deploy, migration first).

**Why:** the developer applies migrations from VS Code and deploys by hand (`npm run deploy` in
tools); a change that silently needs one of them leaves the live tool broken or stale. Asked in so
many words on 2026-09-15: « Pense à me dire à chaque fois si il faut que je relance une migration
et/ou un déploiement. »

**How to apply:** any change under `app/` or `tools/src/` that the browser runs needs a deploy; a
new file in `db/migrations/` needs a migration. Check the migration state hook before stating what
is pending (see [[feedback-migration-state-hook]]). `npm run migrate` touches the live database
and may be blocked for Claude: then say it was not run.
