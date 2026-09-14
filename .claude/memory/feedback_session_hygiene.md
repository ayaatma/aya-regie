---
name: feedback-session-hygiene
description: "Proactively tell the user when a conversation has reached a natural cut point and a fresh session would cost less. He asked for this reminder unprompted, in this project and in future ones."
metadata:
  type: feedback
---

Tell the user, without being asked, when the current conversation has reached a natural cut
point and starting a fresh session would cost fewer tokens. He asked for this on 2026-09-06 and
explicitly extended it to future conversations, so treat it as a standing rule, not a one-off.

**Why:** every request resends the whole conversation, so cost per turn grows with conversation
length. He is cost-conscious and would rather be told than have to guess. He cannot see the
token accounting, so the call has to come from me.

**How to apply.** Say it in one line at the end of a turn, never as a separate interruption, and
never mid-task. The judgement is not "is this long" but "is the accumulated context still doing
work for the next thing".

Cut when:
- a phase ends and the next task uses different files (design finished, implementation starts;
  one feature finished, another begins),
- the subject changes materially,
- a long exploration or debugging thread has concluded and its content is now written down.

Do not cut when:
- mid-task, or when the next step depends on details only present in the conversation,
- a build, test or review is still pending on work from this session.

**The precondition is memory.** A cut is only cheap if `.claude/memory/` already holds what the
next session needs. So before suggesting one, make sure the relevant memory files are current.
That is the same discipline as [[feedback-proactive-progress-memory]], applied at a different
moment: that rule says write it down as you go, this one says a fresh session must be able to
pick up from what was written.

Phrase it as a recommendation with the reason, for example "le contexte de conception est
entièrement en mémoire, une nouvelle conversation repartira plus légère". Never make it a
condition for continuing: if he keeps going in the same session, just keep going.
