---
name: feature-trombinoscope
description: 2026-10-24, the printable trombinoscope (Export tab, section « Trombinoscope »): Responsables first, then Staff and bénévoles by pole, exploit and phase poles; one document or one per part / per pole. Built, tested, NOT SEEN IN A BROWSER.
metadata:
  type: project
---

# Trombinoscope (2026-10-24)

**State: built, green (435 engine, 471 app, build). Not looked at in a browser (Chrome extension
not connected), print layout unverified. Needs the front deployed.**

Decisions (the developer, 2026-10-24):

1. Order of the whole document: ALL Responsables first (caption: poles held, or « Général »),
   then Staff pole by pole, then bénévoles pole by pole.
2. A Staff's pole is BOTH: exploit (an `OrganiserShift` on a créneau) and phase poles (a box in
   `phase.assignments`). Bénévoles follow the same rule. A Staff on no pole: « Sans pôle ».
3. Somebody on several poles appears on each.
4. Separate documents: a selector (Tout / Responsables / Staff / Bénévoles / tous les pôles un
   par page / un seul pôle) then « Imprimer » to PDF, one at a time. No PDF library.
5. A pole's page: its Responsables (LeaderRole) on top, then Staff, then bénévoles.

Where: `tools/src/trombinoscope.ts` (pure, `poleTeams`, `trombinoscope`, `trombiPoles`; exploit
pole = ROOT pole), `app/src/screens/TrombinoscopeScreen.tsx`, `components/printOnly.ts` (sets
`html[data-print-only]` so only one of the two printable sections of Export prints; PrintScreen
uses it too), CSS `.trombi-*` at the end of `styles.css`. No phone numbers on it. No photo means
initials. Photos come from [[feature-photos]] via `usePhoto`.
