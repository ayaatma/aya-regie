# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ground Rules

- **Commit and push on your own initiative, in this project only.** Since 2026-09-14 the
  developer wants Claude to `git commit` and `git push` to `origin main` whenever a coherent,
  green unit of work is done, without being asked. See `.claude/memory/feedback_git_commit_push.md`.
  Never amend a pushed commit, never force-push, never rewrite history, and run `git status`
  before every commit: the repository is public.
- **French is the product language.** Every string a volunteer, a pole leader or the regisseur
  can read is written in French. Code, identifiers, comments and internal notes stay in English.
- **Never use the em dash character in anything a user could see.** See
  `.claude/memory/feedback_no_em_dash.md`. Rephrase, do not swap it for a hyphen.
- **This tool runs against a real event with real people.** Never write code that silently
  drops or reassigns a volunteer. Any change to an existing assignment is a proposal the
  regisseur validates, never a silent mutation.

## Persistent Memory

Canonical, cross-session memory for this project lives in `.claude/memory/`, tracked with the
project so it survives losing this machine. This mirrors how the CrossFlow repo works.

- At the start of any non-trivial task, read `.claude/memory/MEMORY.md` first, then read
  whichever linked files are relevant to the task at hand.
- When something worth remembering comes up (a multi-session feature's progress, a decision and
  its rationale, feedback on how to work on this project), write or update files under
  `.claude/memory/` directly, not just the default global memory location.
- Update relevant files proactively, without being asked, whenever real progress happens. See
  `.claude/memory/feedback_proactive_progress_memory.md`.
- File naming follows CrossFlow: `project_*.md`, `feature_*.md`, `fix_*.md`, `feedback_*.md`,
  `user_*.md`. Each has YAML frontmatter (`name`, `description`, `metadata.type`), and every
  file gets one line in `MEMORY.md` as `- [Title](file.md): hook`.
- Cross-link related memories with `[[kebab-case-name]]`.
- These are normal project files: create and edit them freely, but per the ground rule above,
  commit them with the work they describe.

## What This Project Is

**AyaRégie**, an open-source (MIT) event production tool by the Aya Atma association, public at
https://github.com/ayaatma/aya-regie. It started as the volunteer planning of the Loto Tekno
event and now also covers set-up and tear-down, organisers, catering, artists and ticketing,
for any event. Loto Tekno is the first event it serves, never its spec.

**The repository is public.** Never write a secret, a hosting login, a server name or real
personal data into a tracked file, memory files included.

The full brief, the constraint list and the state of the build live in
`.claude/memory/project_brief.md`. Read it before touching anything.

Stack and hosting are settled (React + Supabase, deployed on an OVH subdomain); the brief and
`.claude/memory/MEMORY.md` carry the current state.
