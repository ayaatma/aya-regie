/**
 * The one mark that says which file a name on the grid comes from: orga, or bénévole.
 *
 * WHY IT EXISTS. On the night the two are read the same way, side by side in the same box, and
 * they are not the same thing at all: a bénévole is scheduled under every rule this tool has, an
 * orga under none. "Qui est cette personne" was answerable only by opening a fiche, and the
 * answer changes what the régisseur does with them.
 *
 * AN EMOJI AND NOT A GLYPH, since 2026-09-11, and the régisseur chose this one. It was a ◆,
 * picked because stars already mean the level a volunteer declared in their pole and a second
 * meaning for the same shape would have made both unreadable. A diamond read as decoration; a
 * face is seen without being looked for, which is what a mark on a crowded grid has to do.
 * The mark appears on orgas only, because they are the exception: marking both kinds would put
 * a symbol in front of every name on the screen and say nothing.
 *
 * Hidden from screen readers on purpose. The `title` on the box already names the person, and
 * their kind is in the panel that opens; a lone glyph announced before every name is noise.
 */

import type { MealPersonKind } from '../engine.ts';

/** The orga mark itself, for the rare place that needs it outside a React tree. */
export const ORGA_MARK = '🤩';

/**
 * A member of an act, since 2026-09-13, on the one screen where the three kinds sit in one
 * list: the catering. An artist is never on a grid, so the mark is never on a box.
 */
export const ARTIST_MARK = '🎤';

export function PersonMark({ kind }: { kind: MealPersonKind }) {
  if (kind === 'benevole') return null;
  return (
    <span className="person-mark" aria-hidden="true" title={kind === 'orga' ? 'Orga' : 'Artiste'}>
      {kind === 'orga' ? ORGA_MARK : ARTIST_MARK}
    </span>
  );
}
