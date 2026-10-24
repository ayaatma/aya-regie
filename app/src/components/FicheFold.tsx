/**
 * A category of a fiche, folded by default, 2026-10-24.
 *
 * A bénévole's fiche had grown to some twenty sections in one column, and the régisseur asked for
 * them gathered under a handful of categories, folded, with what decides a reading (the photo,
 * the status, a doubt, the waiting list) left open above them. See `VolunteerFiche`.
 *
 * WHAT IS FOLDED STILL SPEAKS. The head of a category carries a one-line summary in its tone
 * (« 2 refus », « Allergie: arachide »), so a closed fiche still says where to look.
 *
 * ONE STATE FOR EVERY FICHE, remembered. Opening « Pratique » on one person opens it on the next:
 * walking a hundred fiches with the arrow keys to check the meals is one gesture, not a hundred.
 * Kept in the browser only, a per-viewer convenience; a blocked storage folds everything again.
 *
 * A NATIVE <details>, so what is folded is still in the page: the fields of the mode édition stay
 * mounted (a `FicheText` commits on unmount, which a fold must not trigger), and the browser's
 * find-in-page reaches into a closed category.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

export type FoldTone = 'bad' | 'warn' | 'ok' | '';

const STORAGE_KEY = 'aya-regie.fiche-folds';
const listeners = new Set<() => void>();
let opened: ReadonlySet<string> = readStored();

function readStored(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Opens or closes the categories named, on every fiche. */
export function setFolds(ids: readonly string[], open: boolean): void {
  const next = new Set(opened);
  for (const id of ids) {
    if (open) next.add(id);
    else next.delete(id);
  }
  opened = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Private window or blocked storage: the categories still fold, they just forget on reload.
  }
  for (const listener of listeners) listener();
}

function useOpened(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => opened,
    () => opened,
  );
}

export function FicheFold({
  id,
  title,
  summary,
  tone = '',
  children,
}: {
  /** The category, shared by every fiche: the same id opens and closes together. */
  id: string;
  title: string;
  /** What the category holds, in a few words, read while it is closed. */
  summary?: ReactNode;
  tone?: FoldTone;
  children: ReactNode;
}) {
  const open = useOpened().has(id);
  return (
    <details
      className={`fiche-fold${tone ? ` is-${tone}` : ''}`}
      open={open}
      onToggle={(event) => {
        const now = event.currentTarget.open;
        if (now !== open) setFolds([id], now);
      }}
    >
      <summary className="fiche-fold-head">
        <span className="fiche-fold-title">{title}</span>
        {summary !== undefined && summary !== '' && <span className="fiche-fold-summary">{summary}</span>}
      </summary>
      <div className="fiche-fold-body">{children}</div>
    </details>
  );
}

/** « Tout déplier » / « Tout replier », over the categories of one fiche. */
export function FoldAll({ ids }: { ids: readonly string[] }) {
  const open = useOpened();
  const all = ids.length > 0 && ids.every((id) => open.has(id));
  return (
    <p className="fiche-fold-all">
      <button type="button" className="btn is-link is-small" onClick={() => setFolds(ids, !all)}>
        {all ? 'Tout replier' : 'Tout déplier'}
      </button>
    </p>
  );
}

/** The categories' ids, so a « Tout déplier » covers the ones drawn outside the fiche itself. */
export const FOLD_IDS = {
  affectation: 'affectation',
  souhaits: 'souhaits',
  contraintes: 'contraintes',
  phases: 'phases',
  role: 'role',
  suivi: 'suivi',
  pratique: 'pratique',
  statut: 'statut',
} as const;
