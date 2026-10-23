---
name: project-todo-2026-10-23
description: "The developer's ToDo of 2026-10-23 (« A CORRIGER / AMELIORER »): fiche layout, import side fiche, date-less exploit labels, timeline repères, photo crop and retry, Staff / Responsable. All in MIGRATION 39, NOT APPLIED, PLAN_FORMAT 30."
metadata:
  type: project
---

Asked « comme d'habitude » ([[feedback-comme-d-habitude]]) on 2026-10-23. Decisions asked first.

**State: built and pushed item by item. MIGRATION 39 (`2026-10-23_form_answers.sql`) carries
everything of this batch and of [[feature-import-review]]'s raw answers: volunteer.form_answers,
event.markers, organiser.role, event.organiser_meals_fixed, event.responsables_get_staff_bracelets,
load_plan / write_plan_body / get_volunteer_schedule replaced; min_plan_format 30. Apply it, then
deploy the front, then `npx supabase functions deploy drive-photo` (it takes a `size` now).**

1. **Fiche layout**: `.panel .field` / `.fiche-edit .field` are a 7.5rem label column with the
   value right after (no more `space-between`); `.kv.is-near` for a fiche's figures.
2. **Import review**: no per-person list at the bottom any more; a name in « À régler » opens the
   fiche on the right, level with its line (`import-side-fiche`, absolute; a drawer under 1520 px).
   A fiche to read with no reason gets a line « Fiche à relire, sans raison précise. ».
3. **Exploit labels without the date** when `lengthHours <= 24` (`PlanIndex.label` →
   `toTimeOfDay`). Screens only: the volunteer page and the mails keep the day, because the
   `{planning}` list mixes montage days with the exploit and a bare hour would be ambiguous there.
   CSV exports keep `toLabel`. Told to the developer.
4. **Repères** (`Plan.markers`, `TimelineMarker {key, label, moment, start, end|null}`): card
   « Repères de la timeline » in Réglages; drawn under the line-up on the exploit ruler
   (`MarkerRow`), a « Repères » lane on the phase grids, a line on the printed planning, « À
   savoir » on the bénévole page (exploit's, and a phase's for those placed on it).
5. **Photos**: `PhotoCropper` (zoom 1..5, drag, wheel; `clampFraming` / `framedSquare` in
   `tools/src/photos.ts`), source re-read from Drive at 1600 px (`cropSource`), result stored under
   the SAME source so an import does not refetch it. `formAnswers.photo` keeps the upload answer;
   the fiche offers « Récupérer la photo du formulaire » when it is missing. A sync no longer stops
   at a network error or a gateway 5xx (only « not deployed » / 503 stop it); each read is tried
   twice. Why the developer's photos failed is NOT known (no access to the live logs).
6. **Staff / Responsable**: `Organiser.role` (absent = Responsable; every existing orga became
   one, the developer's choice). The word « orga » left every visible string (code identifiers and
   stored keys unchanged: `PersonKind 'orga'`, status and audience key `orga` now LABELLED
   « Staff »). A Responsable's status is `responsable`; for default bracelets it also counts as
   `orga` unless `TicketingSettings.responsablesGetStaffBracelets` is off (asked: parametrable).
   `CateringRules.organiserMealsFixed` (exploit meals fixed, phases by presence, asked).
   `convertPerson(plan, kind, key, role)`, `setOrganiserRole` (to Staff drops the poles held,
   listed). Giving a pole to a Staff (drag on a frise) makes them Responsable (`withLeaderRole`).
   Fiche « Statut »: Passer bénévole / Staff / Responsable, previewed.

Deferred by the developer to « à voir »: live updates of a fiche edited by somebody else, the
info shown to orgas/responsables only. « Bar Fixe renforts » dropped.
