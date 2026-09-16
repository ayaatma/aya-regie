---
name: feature-tabs-and-pole-filter
description: "2026-09-13, five remarks after the Artistes deploy: a « Pôle demandé » filter on the pool of the three moments (choix 1 / choix 2 / responsable chips), the choice-2 solver weight raised from 20 to 100 with the measurement, and the ten tabs folded to seven through StackedScreen (Tableau de bord + Recrutement, Import/Export, Historique + Journal folded). Built, green, no schema, no plan format."
metadata:
  type: project
---

**State 2026-09-13: BUILT and green. 286 engine tests, 387 app tests, both typechecks, build.**
No migration, no PLAN_FORMAT change: code and CSS only. Checked in headless Chrome
(`npm run shots`): the stacked tabs, the pole filter's chips. One bug found by the shots:
`StackedScreen`'s toggle (and `ArtistsScreen`'s) built the next set from the closure's state,
so two toggles in one tick kept only the second; both read the previous state now.

## The five remarks (ToDo.txt, lines 1 to 5 of the day) and what each became

**1. « Filtrer les bénévoles / orgas ayant leur choix 1 ou choix 2 sur un pôle choisi, avec une
indication si c'est leur choix 1 ou leur choix 2. »** A second select « Pôle demandé » in the
pool's « Disponibles » tab, in the THREE moments (`PoolPanel`, `.pool-filters` back to two
columns). The poles offered are the EXPLOIT's on the phases too: a phase has no choices and what
the régisseur wants on a montage is « les gens du bar » to set the bar up. The rule is
`poleMatchOf(index, kind, personKey, poleKey)` in `poolRows.ts`: a bénévole through
`choice1PoleKey` then `choice2PoleKey`, a choice on a parent covering its sub-poles AND the
reverse (`isUnder` both ways); an orga has no choice and matches through `polesLedBy`. The chip
(`.chip.is-choice.is-choix1 / .is-choix2 / .is-responsable`) is drawn ONLY while the filter is
on. Empty list under the filter says « Personne n'a demandé ce pôle parmi les personnes
disponibles ».

**2. « Le choix 2 doit avoir moins de poids que le choix 1. »** It always had (`choice2` is a
cost per hour), but at 20 it sat BELOW `volume` (60), rank 4 under rank 5. **Now 100**, above
volume and eight times under `outsideChoice` (800). Measured over four seeds, 6000 iterations
(choix1 / choix2 / hors / gap / binômes): balanced 20 → 200/154/237/3.0/18.0, 100 →
199/156/237/2.3/19.8; shortage-moderate 20 → 138/149/186/121.5/17.8, 100 → 160/151/161/121.5/15.5.
200 cost binômes and the floor on balanced for nothing. The lever is small: which choice somebody
lands in is mostly decided by the hours on offer in the poles they asked for. The table is in
the comment over `DEFAULT_WEIGHTS` in `solver.ts`.

**3, 4, 5. Ten tabs to seven.** `app/src/screens/StackedScreen.tsx`: a shell around the existing
shells, `sections: [{id, title, children, foldable?, printable?}]`, one scrolling `.stack-body`,
and CSS that turns an inner `.screen` / `.screen-main` into blocks and stops the inner bodies
(`.screen-body`, `.board`, `.import-body`, `.print-body`, `.journal`) scrolling on their own.
The six screens are UNCHANGED and keep their toolbars, which read as the head of their part.
- « Tableau de bord » = `DashboardScreen` then `RecruitmentScreen`; the dashboard's « Voir le
  détail du recrutement » now scrolls to `#stack-recrutement` (`scrollToSection`) instead of
  switching tab.
- « Import/Export » = `ImportScreen` then `PrintScreen` under the title « Export »; the Export
  section is `printable`, every other section is `.no-print`, and `.stack-head` is hidden on
  paper, so printing the tab still prints the sheet alone.
- « Historique » = `HistoryScreen` and `JournalScreen`, both `foldable` and FOLDED by default.
  A folded section is `hidden`, not unmounted (the `SetupSection` doctrine): the Journal still
  fetches on mount, as it did with a tab of its own.
The `Screen` union lost `recrutement`, `impression` and `journal`.

## Where the code lives

`app/src/components/PoolPanel.tsx`, `poolRows.ts` (`poleMatchOf`, `PoleMatch`),
`app/src/screens/StackedScreen.tsx`, `App.tsx` (TABS, the three stacked renders),
`tools/src/solver.ts` (`choice2: 100` and the measurement), `styles.css` (`.chip.is-choice`,
`.stack-*` at the end). Tests: `screens.test.tsx` (the filter in the three moments, the match
rule, the stacked shell folded and unfolded).

## 2026-09-16: tabs grouped, top bar buttons in a « ⋯ » menu

Ten tabs plus seven buttons ran off the régisseur's window. Three HTML mock-ups were shown (one
line with a menu, two lines, grouped tabs); the régisseur chose **grouped tabs**. `App.tsx`:
`GROUPS` = Planning (Grille, Propositions), Personnes, Logistique (Artistes, Catering, Magasin),
Suivi (Tableau de bord, Historique), Réglages (Réglages, Import/Export). A group of several
screens shows a `.subtabs` line under the top bar (`.app.has-subtabs`, four grid rows; the
organiser view keeps three). Clicking a group reopens the screen last shown in it
(`lastInGroup`). Group tabs carry their screens' badges. Only ↶ ↷, the save state and Point de
sauvegarde stay visible; Vue bénévole, Vue responsable, Changer d'événement, Mon compte and Se
déconnecter are in the `.topbar-menu` (closes on outside click and Escape). `shoot.cjs`'s `tab()`
opens the group then the sub-tab.

## 2026-09-16: Liste d'attente on the grid, Réglages slimmed

Four requests from the régisseur, one commit, no schema.

- **The grid pane's « À relire » tab is « Liste d'attente ».** Proofreading moved to Personnes
  (red lines). `PanelTab` = `'disponibles' | 'attente'`; the tab is the exploit's only (a phase
  has no waiting list, `shown` falls back to Disponibles there). Rows drag like Disponibles, and
  the drop is plain `assign`, which already takes the person off `Plan.reserve` in the same edit.
  A box dropped on that tab does nothing: joining the list stays the fiche's button.
- **Logistique gains « Équipes » and « Activités annexes »** (`TeamsScreen`,
  `SideActivitiesScreen`), out of Réglages. Each team or activity is a `screen-card` with a table
  of people, the name opening the fiche in Personnes through `useNavigation`.
- **No Orgas card in Réglages.** The code responsable (generate, regenerate with confirm, revoke)
  and « Retirer du planning » are `AccessSection` in `PersonPanel`, on an orga's fiche in
  Personnes. Poles and their responsables stay in Réglages.
- **« la porte » is « l'entrée » / « la liste des entrées »** in every visible string.
