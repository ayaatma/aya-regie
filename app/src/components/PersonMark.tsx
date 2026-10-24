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
 * TWO MARKS SINCE 2026-10-24, the régisseur having asked for a Responsable told from a Staff
 * at a glance, and for something else than 🤩: 📣 for a Responsable (the one who coordinates a
 * pôle), 👕 for the Staff (the team T-shirt). Neither was used anywhere else in the tool. An
 * orga whose key is not given or not found reads as a Responsable, the role's default.
 *
 * The mark appears on orgas only, because they are the exception: marking both kinds would put
 * a symbol in front of every name on the screen and say nothing.
 *
 * Hidden from screen readers on purpose. The `title` on the box already names the person, and
 * their kind is in the panel that opens; a lone glyph announced before every name is noise.
 */

import { useContext } from 'react';

import { applicationStatusOf, organiserRoleOf, statusOf, type MealPersonKind, type OrganiserRole, type Plan } from '../engine.ts';
import { PlanContext } from '../store/store.tsx';

/** The orga marks themselves, for the rare place that needs one outside a React tree. */
export const ORGA_MARK: Record<OrganiserRole, string> = { responsable: '📣', staff: '👕' };

/**
 * A member of an act, since 2026-09-13, on the one screen where the three kinds sit in one
 * list: the catering. An artist is never on a grid, so the mark is never on a box.
 */
export const ARTIST_MARK = '🎤';

/** `personKey`: the orga, to tell a Responsable from a Staff. Read from the plan in context. */
export function PersonMark({ kind, personKey }: { kind: MealPersonKind; personKey?: string }) {
  const plan = useContext(PlanContext)?.plan;
  if (kind === 'benevole') return null;
  if (kind === 'artiste') {
    return (
      <span className="person-mark" aria-hidden="true" title="Artiste">
        {ARTIST_MARK}
      </span>
    );
  }
  const organiser = personKey === undefined ? undefined : plan?.organisers.find((o) => o.key === personKey);
  const role: OrganiserRole = organiser ? organiserRoleOf(organiser) : 'responsable';
  return (
    <span className="person-mark" aria-hidden="true" title={role === 'staff' ? 'Staff' : 'Responsable'}>
      {ORGA_MARK[role]}
    </span>
  );
}

/**
 * « Inscription », not validated yet, since 2026-10-22: a ⏳ before the name, on every grid and in
 * the pool. The régisseur chose it over a dashed box: the box's own border already speaks for the
 * rules (red, orange, blue), and a person still to validate is a fact about the person, like 📣 or 👕.
 * Validated people carry nothing, being the normal case once the recruitment is done.
 */
export const PENDING_MARK = '⏳';

/** `kind|key` of every bénévole and orga still in « Inscription », for the grids to look up. */
export function pendingPeople(plan: Pick<Plan, 'volunteers' | 'organisers'>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const v of plan.volunteers) if (statusOf(v) === 'candidature') keys.add(`benevole|${v.key}`);
  for (const o of plan.organisers) if (applicationStatusOf(o) === 'candidature') keys.add(`orga|${o.key}`);
  return keys;
}

export function PendingMark({ pending }: { pending: boolean | undefined }) {
  if (!pending) return null;
  return (
    <span className="pending-mark" aria-hidden="true" title="Inscription, pas encore validée">
      {PENDING_MARK}
    </span>
  );
}
