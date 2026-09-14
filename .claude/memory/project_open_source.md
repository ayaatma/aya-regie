---
name: project-open-source
description: "The tool is named AyaRégie and is public and MIT on github.com/ayaatma/aya-regie since 2026-09-14; what that changes for every tracked file."
metadata:
  type: project
---

**Decided 2026-09-14.** The tool is named **AyaRégie** (repository `ayaatma/aya-regie`, under
the Aya Atma GitHub account, collaborators Nablast and CrossFlow-Nico). Public, MIT licence.
The name replaced « outil de planning » because the scope drifted past planning: phases,
orgas, catering, artists, ticketing, any event (see [[feature-generic-event]],
[[feedback-generic-event-thinking]]).

**Why:** the association wants it open source, so everything tracked is world-readable,
`.claude/memory/` included.

**How to apply:**
- Never write a secret, a hosting login, a server host name or real personal data into a
  tracked file. Before the first push, `/home/<account>` and the OVH cluster number were
  redacted from README.md, [[feature-supabase]] and `tools/src/deploy-cli.ts`.
- Test data stays fictional (`@example.org`, `06 00 00 00 00`, Camille Dubois).
- Ignored and must stay ignored: `.env.local`, `.env.deploy.local`, `tools/out/`, `app/dist/`,
  `app/shots/`, `app/public/fixtures/`, `db/.migration-state.json` (machine-local state read by
  the hook, see [[feedback-migration-state-hook]]).
- Internal identifiers, the schema and migrations were NOT renamed; the subdomain
  `planning.ayaatma.fr` was not changed as of this date.
