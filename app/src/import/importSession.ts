/**
 * An import being reviewed, kept while the régisseur looks elsewhere, since 2026-10-22.
 *
 * The import screen used to hold the file, the correspondence being worked on and every fiche
 * corrected in React state, so switching to Personnes to check somebody unmounted it and threw
 * an hour of corrections away. This is the same state outside the component: in memory for the
 * tab switch, and in `sessionStorage` for a reload, keyed by event.
 *
 * WHAT IS KEPT IS THE RÉGISSEUR'S WORK, NEVER THE READING. The file is read again from `csv`
 * against the plan as it is when the screen comes back, so a pole added in Réglages meanwhile is
 * used; the corrections are replayed on top of that reading. `sessionStorage` dies with the
 * browser tab, which is the life an unapplied import should have; applying or abandoning clears
 * it at once. Every access is guarded: a private window may refuse storage, and then the import
 * simply lives as long as the page.
 */

import type { FormMapping, Volunteer } from '../engine.ts';

export type ImportSource = { kind: 'sheet'; url: string } | { kind: 'file'; name: string };

/** What the régisseur did to one fiche before applying: the fields corrected, and the doubt cleared. */
export interface FicheFix {
  changes: Partial<Volunteer>;
  validated: boolean;
}

export interface ImportSession {
  csv: string;
  source: ImportSource;
  mapping: FormMapping;
  /** The absent people whose removal box was flipped from its default. */
  flipped: string[];
  fixes: Record<string, FicheFix>;
}

const held = new Map<string, ImportSession>();
const storageKey = (eventId: string | null): string => `aya-regie:import:${eventId ?? 'local'}`;

export function loadImportSession(eventId: string | null): ImportSession | null {
  const key = storageKey(eventId);
  const inMemory = held.get(key);
  if (inMemory) return inMemory;
  try {
    const stored = globalThis.sessionStorage?.getItem(key);
    if (!stored) return null;
    const session = JSON.parse(stored) as ImportSession;
    held.set(key, session);
    return session;
  } catch {
    return null;
  }
}

export function saveImportSession(eventId: string | null, session: ImportSession | null): void {
  const key = storageKey(eventId);
  if (session) held.set(key, session);
  else held.delete(key);
  try {
    if (session) globalThis.sessionStorage?.setItem(key, JSON.stringify(session));
    else globalThis.sessionStorage?.removeItem(key);
  } catch {
    // Full or refused: the copy in memory still covers the tab switch.
  }
}
