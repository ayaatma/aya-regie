---
name: feedback-git-commit-push
description: "In this project only, Claude commits and pushes to origin main on its own initiative whenever a coherent, green unit of work is done (since 2026-09-14)."
metadata:
  type: feedback
---

Since 2026-09-14, in AyaRégie (this repository) ONLY, Claude runs `git commit` and `git push`
without being asked, whenever it judges a unit of work finished. The original ground rule
(« never commit ») still holds in every other project.

**Why:** the developer said so explicitly when the project went public on
github.com/ayaatma/aya-regie (see [[project-open-source]]), and wants the remote to follow the
work rather than batch it by hand.

**How to apply:**
- Commit when a change is coherent and the relevant tests or typecheck are green: one feature
  round, one fix, one memory update tied to its work. Not mid-refactor, not on a red suite.
- Run `git status` before every `git add`: the repository is public, so no `.env*.local`, no
  hosting login, no real volunteer data, no generated output.
- Messages in English, short subject, attribution trailer. Push to `origin main` right after.
- Never amend a pushed commit, never force-push, never rewrite history, never skip hooks.
- A migration commit does not mean the migration is applied: say which, per
  [[feedback-migration-state-hook]].
