/**
 * Somewhere to drop a box to take the person out of it.
 *
 * The pane on the right already accepts the drop, but it is a narrow strip on the far right and
 * finding it while holding a box across a wide grid is work. The bin appears only while a box
 * taken FROM a grid is in flight, sits where the pointer already is, and grows when the drop
 * would land, so the gesture is confirmed before the button is released. Dragging somebody out of
 * a pool shows nothing, because there is no placement to undo.
 *
 * ON ALL THREE GRIDS SINCE 2026-09-12. It was the exploit's, and the régisseur asked for the same
 * thing on the montage and the démontage in so many words: "l'affichage en pointillé dans le
 * volet de droite avec la poubelle en bas est très bien (comme c'est fait actuellement pour
 * l'exploit)". Which is why it left `GridScreen` and became a component.
 *
 * It removes ONE placement and nothing else: the person stays in the plan, unplaced, and the edit
 * is undoable like any other.
 */

import { useState } from 'react';

import { DRAG_MIME } from './drag.ts';

export function TrashTarget({ label, onDrop }: { label: string; onDrop(): void }) {
  const [hot, setHot] = useState(false);

  return (
    <div
      className={`trash ${hot ? 'is-hot' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setHot(true);
      }}
      onDragEnter={() => setHot(true)}
      onDragLeave={() => setHot(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        setHot(false);
        onDrop();
      }}
    >
      <span className="trash-icon" aria-hidden="true">
        🗑
      </span>
      <span className="trash-label">{label}</span>
    </div>
  );
}
