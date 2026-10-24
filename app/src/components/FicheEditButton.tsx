/**
 * The 🖍️ at the top right of a fiche, 2026-10-24: the planning's own switch, so the two modes read
 * alike everywhere. Out of it the fiche is read; in it every section is its own fields, in place.
 * Replaced the « Modifier la fiche » button at the bottom of the bénévole's fiche.
 */

import { EditModeButton } from './EditModeButton.tsx';

export function FicheEditButton({ editing, onToggle }: { editing: boolean; onToggle(): void }) {
  return (
    <EditModeButton
      editing={editing}
      onToggle={onToggle}
      hint="Modifier la fiche: chaque champ se corrige à sa place"
      leaveHint="Revenir à la lecture de la fiche"
    />
  );
}
