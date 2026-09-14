---
name: feedback-migration-state-hook
description: "The developer applies migrations from VS Code (« BDD update ») without saying so. Since 2026-09-13 a UserPromptSubmit hook injects the last known migration state (applied, pending, applied-but-edited) at every message; trust it, and refresh it with `npm run migrate` (dry) before editing any recent migration."
metadata:
  type: feedback
---

**Never assume a migration is still pending, never edit one without checking.** The developer
runs « BDD update (migrations Supabase) » in VS Code whenever told to, usually without a word.

**How it works.** Every connected run of `tools/src/migrate-cli.ts` (dry or apply, VS Code launch
included) writes `db/.migration-state.json`: when, which mode, applied, pending, missing objects,
and the sha256 of each applied file AS FIRST SEEN APPLIED (never refreshed, so a later edit
shows). `.claude/settings.json` runs `tools/scripts/migration-status.cjs` on UserPromptSubmit; it
reads that file (no network) and injects « Migrations, dernier contrôle …: N appliquées, EN
ATTENTE: … », files written since the check, and an ATTENTION line for an applied migration whose
content changed.

**Why:** on 2026-09-13 migration 18 was extended after the developer had applied it; only the
migrator's post-check caught it, and 18 had to be rebuilt and the additions moved to 19. The
developer asked for "un moyen sûr que tu saches et que tu checks si ça a été fait".

**How to apply:** read the injected line before telling the developer to run a migration or
before touching a migration file. If a migration was written in this session after the last
check, run `npm run migrate` (dry, in tools/) first: it refreshes the state. When reporting,
say "migration N reste à appliquer" only if the state says so.
