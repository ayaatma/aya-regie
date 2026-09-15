/**
 * Opening somebody's fiche on the Personnes tab from anywhere in the tool.
 *
 * A CONTEXT RATHER THAN A PROP, because the places a name is clicked are deep: the info pane of
 * three grids, inside screens that know nothing about tabs. Threading a callback through each of
 * them would be five props to arrive at one `setScreen`. The shell provides it; a screen rendered
 * without the shell (a test, the read-only orga view) gets null and simply shows no link.
 */

import { createContext, useContext } from 'react';

import type { TicketPersonKind } from '../engine.ts';

/** One person the tool knows, whichever of the five lists holds them. */
export interface PersonRef {
  kind: TicketPersonKind;
  key: string;
}

export interface Navigation {
  openPerson(person: PersonRef): void;
  openArtists(): void;
}

export const NavigationContext = createContext<Navigation | null>(null);

export const useNavigation = (): Navigation | null => useContext(NavigationContext);

export const samePerson = (a: PersonRef | null, b: PersonRef | null): boolean =>
  a !== null && b !== null && a.kind === b.kind && a.key === b.key;
