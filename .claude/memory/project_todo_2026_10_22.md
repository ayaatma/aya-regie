---
name: project-todo-2026-10-22
description: The developer's ToDo.txt of 2026-10-22, item by item - which are done, which wait for answers to framing questions asked that day.
metadata:
  type: project
---

The developer asked (2026-10-22) to do everything in `ToDo.txt`, framing each item with questions
first and keeping the tool generic. Commit `Stack événements at the same hours...` did the items
that needed no framing; the rest wait for the developer's answers.

**Done, app deploy only, no migration:**
- Preferable tranche row: the « N la préfèrent » count removed beside the overflow field.
- Événements at the same hours stack in lines on the phase grid (`packRows`, `EVENT_LINE_GAP`).
- Réglages > Montage/Démontage: half-day picker on creation (default length `eventShiftHours`),
  day picker on each événement row (moves it with its people, `slidePhaseEvent`).
- « Billet d'entrée » for the entry everywhere (door CSV header « Billet d'entrée »); « ticket »
  is only for meals and drinks now. Identifiers (`TicketType`, `ticketTypeKey`) unchanged.
- Import and Export are two tabs of the Réglages group (`'export'` screen).

**Waiting for answers (questions asked 2026-10-22):** cancelled person remembered on re-sync +
cancellation mail; validation mails per kind of person / several kinds per mail; confirmation
popup before every send; planning confirmation by link (confirm the exact planning seen, notify
changes, remind); automatic distinct colours for phase poles; phase default length apart from
the exploit's; mirror a montage événement onto the démontage; orga flat drink tickets; guest
types; cumulative bracelets; a separate poles tab.

Finding behind the planning question: most of it exists ([[feature-follow-up-mails]]): step
`planning` with reply `confirmer`, link `/?code=`, batches premier / relance / modifié. Missing:
the answer is tied to the last MAIL, not to the planning the person actually saw on the page.
