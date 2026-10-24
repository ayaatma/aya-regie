---
name: feature-fiche-folds
description: "2026-10-24, built, green, front only. Bénévole and Staff / Responsable fiches fold in categories on the Personnes tab (head left open); the grid panes show a reduced fiche per grid; status is two buttons, no dropdown."
metadata:
  type: project
---

Asked by the régisseur on 2026-10-24, after [[feature-fiche-edit-mode]].

**Head, never folded (Personnes):** photo (large), « Sur le planning: surnom », status banner
coloured (orange / green / red) with **Valider (green `.btn.is-ok`) + Annuler (red)** while
« Inscription », then one neutral « Remettre en inscription » (no mail). The dropdown is gone
(régisseur's choice). Pastilles Mineur·e and Réserve. `FicheWarning`: one line « Fiche à relire ·
N signalements », detail folded, « Valider la fiche » and `ReleasePlaces` (moved out of
`ApplicationSection`) never folded. « Mettre en liste d'attente ». No 📞 ✉️ icons, no allergy
pastille in the head (refused by the régisseur).

**Categories (`FicheFold`, native `<details>`, one open state shared by every fiche in
localStorage `aya-regie.fiche-folds`, `FoldAll`):** bénévole: Affectation, Souhaits, Contraintes,
Montage et démontage, Suivi (mails via `RegistrationSection part="mails"`, ApplicationSection,
Remettre à relire), Pratique et formulaire (contact, terrain, repas, Ce qui a été écrit, the door
via `practical`), Statut (PersonPanel's `trailing`). Orga: Rôle et compétences, Montage et
démontage, Suivi, Pratique et formulaire, Statut et code responsable; overlaps warned in the head.
Each closed head shows a summary in its tone.

**Grid panes (`FicheContext` exploit / phase, `InfoPanel grid="phase"` from PhaseGrid):** compact
photo, status read-only, warning, then open: exploit = Affectation + Souhaits + Contraintes;
phase = Montage et démontage + binômes + compétences. Pratique stays one fold below. No waiting
list, no Suivi there.

**Not built:** the per-person mini-frise (régisseur doubts a horizontal strip in a vertical fiche;
left for later).
