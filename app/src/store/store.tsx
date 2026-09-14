/**
 * The working copy: the whole plan, in memory, immutable, with an undo stack.
 *
 * Decided 2026-09-07. Every edit produces a new plan and revalidates, which costs 4 ms on the
 * real event size, so the red and orange codes are always the truth about what is on screen
 * with no debouncing anywhere. Saving happens on its own, shortly after the last edit, against
 * the version the working copy was built on. A store that has moved on refuses the write and
 * the conflict surfaces as a banner rather than as a silent overwrite.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';

import { PLAN_FORMAT, PlanIndex, validate, type Plan, type ValidationResult } from '../engine.ts';
import { log } from '../log/logger.ts';
import type { PlanStore, StoredPlan } from '../persistence/types.ts';

/** How long the working copy waits after the last edit before saving. */
const AUTOSAVE_DELAY_MS = 1200;

/** Undo depth. Deep enough to walk back out of a bad idea, shallow enough to stay small. */
const HISTORY_LIMIT = 100;

interface Snapshot {
  plan: Plan;
  /** French, shown in the undo tooltip: "Annuler: deplacement de Marie Perrin". */
  label: string;
}

export interface PlanState {
  id: string | null;
  plan: Plan | null;
  past: Snapshot[];
  future: Snapshot[];
  /** Label of the edit that produced the current plan, for the redo tooltip. */
  lastLabel: string | null;
  baseVersion: number;
  savedAt: string | null;
  dirty: boolean;
  saving: boolean;
  /** Set when another writer got there first. Blocks autosave until the régisseur decides. */
  conflict: StoredPlan | null;
  /**
   * Set when this page is too old to be allowed to write, with the format the store requires.
   *
   * A DIFFERENT THING FROM A CONFLICT, and shown differently. A conflict is a negotiation about
   * whose version wins. This is a build that does not know about a field somebody else's build
   * writes: letting it save would strip that field for everybody. There is nothing to choose,
   * only a page to reload.
   */
  outdated: number | null;
  /**
   * Bumped whenever the kept versions change without the plan changing.
   *
   * Naming a version happens in the shell and is read on the history screen, which are two
   * different components with nothing else between them. The screen already re-reads its list
   * when `baseVersion` moves; this is the same signal for the case where it does not.
   */
  historyRevision: number;
  /**
   * Nothing can be shown: the load itself failed, so there is no plan on screen.
   *
   * The id of the plan somebody tried to open is kept alongside it, which is what makes the
   * error screen offer a retry rather than a dead end.
   */
  error: string | null;
  /**
   * A write was refused while the plan IS on screen, and the working copy is untouched.
   *
   * This must never be the same field as the one above. A refused save used to reset the whole
   * state, which showed the régisseur an error card where their afternoon of work had been: the
   * plan was still in the database, but every unsaved edit was gone from the only place it
   * existed.
   */
  saveError: string | null;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; stored: StoredPlan }
  | { type: 'load-failed'; id: string; message: string }
  | { type: 'save-failed'; message: string }
  | { type: 'retry-save' }
  | { type: 'closed' }
  | { type: 'edit'; plan: Plan; label: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saving' }
  | { type: 'saved'; version: number; savedAt: string }
  | { type: 'conflict'; stored: StoredPlan }
  | { type: 'outdated'; required: number }
  | { type: 'overwrite'; version: number }
  | { type: 'history-changed' };

/**
 * Exported for the tests, alongside the reducer below.
 *
 * What they check is not a screen but a rule: which actions are allowed to throw the working
 * copy away. Only one is, and getting that wrong once already cost an afternoon of edits.
 */
export const INITIAL: PlanState = {
  id: null,
  plan: null,
  past: [],
  future: [],
  lastLabel: null,
  baseVersion: 0,
  savedAt: null,
  dirty: false,
  saving: false,
  conflict: null,
  outdated: null,
  historyRevision: 0,
  error: null,
  saveError: null,
};

export type PlanAction = Action;

export function reducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case 'loading':
      return { ...INITIAL };

    case 'loaded':
      return {
        ...INITIAL,
        id: action.stored.id,
        plan: action.stored.plan,
        baseVersion: action.stored.version,
        savedAt: action.stored.savedAt,
      };

    // The id survives, so the error screen knows what to retry.
    case 'load-failed':
      return { ...INITIAL, id: action.id, error: action.message };

    // Everything survives. The plan, the undo stack and the dirty flag are the only copy of
    // what was typed since the last successful save.
    case 'save-failed':
      return { ...state, saving: false, saveError: action.message };

    case 'retry-save':
      return { ...state, saveError: null };

    case 'closed':
      return { ...INITIAL };

    case 'edit': {
      if (!state.plan || action.plan === state.plan) return state;
      const past = [...state.past, { plan: state.plan, label: state.lastLabel ?? action.label }];
      return {
        ...state,
        plan: action.plan,
        past: past.slice(-HISTORY_LIMIT),
        future: [],
        lastLabel: action.label,
        dirty: true,
      };
    }

    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.plan) return state;
      return {
        ...state,
        plan: previous.plan,
        past: state.past.slice(0, -1),
        future: [{ plan: state.plan, label: state.lastLabel ?? '' }, ...state.future],
        lastLabel: previous.label,
        dirty: true,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next || !state.plan) return state;
      return {
        ...state,
        plan: next.plan,
        past: [...state.past, { plan: state.plan, label: state.lastLabel ?? '' }].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        lastLabel: next.label,
        dirty: true,
      };
    }

    case 'saving':
      return { ...state, saving: true };

    case 'saved':
      return {
        ...state,
        saving: false,
        baseVersion: action.version,
        savedAt: action.savedAt,
        dirty: false,
      };

    case 'conflict':
      return { ...state, saving: false, conflict: action.stored };

    /**
     * No way out of this one from inside the reducer, on purpose: only reloading the page can
     * clear it, because only a newer build can write again. The working copy is left untouched
     * so that whatever is on screen can still be read and copied out before the reload.
     */
    case 'outdated':
      return { ...state, saving: false, outdated: action.required };

    case 'history-changed':
      return { ...state, historyRevision: state.historyRevision + 1 };

    /**
     * Rebasing the working copy onto the version the store actually holds, so the next autosave
     * writes over it. The plan itself is untouched; only the version the save will be built on
     * changes. Reached solely from "Garder la mienne et écraser", never on its own.
     */
    case 'overwrite':
      return { ...state, conflict: null, saving: false, baseVersion: action.version, dirty: true };

    default:
      return state;
  }
}

export interface PlanContextValue extends PlanState {
  index: PlanIndex | null;
  report: ValidationResult | null;
  canUndo: boolean;
  canRedo: boolean;
  /** The only way a screen changes anything: hand in the new plan and say what happened. */
  apply(next: Plan, label: string): void;
  /** Same, but computed from the current plan so callers do not have to read it first. */
  edit(fn: (plan: Plan) => Plan, label: string): void;
  undo(): void;
  redo(): void;
  open(id: string): void;
  reset(): void;
  /** Tries the refused save again, keeping the working copy exactly as it is. */
  retrySave(): void;
  /** Puts the plan down and goes back to the picker. The only way out of a failed load. */
  close(): void;
  /** Takes the other writer's plan, discarding the local working copy. */
  acceptTheirs(): void;
  /** Keeps the local working copy and saves it over theirs. Deliberate, never automatic. */
  keepMine(): void;
  /**
   * Goes back to a version the store kept, which lands as a NEW version rather than a rewind.
   *
   * The working copy is replaced by whatever the store hands back, undo stack included: the
   * stack describes edits made to a plan that is no longer the one on screen, and offering to
   * step back into it would be offering a plan that never existed. Rejects if the store refuses,
   * so the screen can say why.
   */
  restore(version: number): Promise<void>;
  /**
   * Names the stored version so it is kept until somebody deletes it.
   *
   * Nothing about the plan changes, so nothing here replaces the working copy. Rejects when the
   * store has moved on, because the version that would be named is then somebody else's.
   */
  checkpoint(name: string): Promise<number>;
  /** Says the kept versions changed, for a screen listing them elsewhere. */
  historyChanged(): void;
}

/** Exported so the smoke tests can render a screen against a plan loaded from a fixture. */
export const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ store, children }: { store: PlanStore; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const planRef = useRef<Plan | null>(null);
  planRef.current = state.plan;

  const open = useCallback(
    (id: string) => {
      dispatch({ type: 'loading' });
      // From here on, every entry belongs to this plan. Set before the load, so a load that
      // fails is filed against the plan somebody tried to open rather than against no plan.
      log.setEvent(id);
      store
        .load(id)
        .then((stored) => {
          log.info('planning', `Planning ouvert: "${stored.plan.name}" (version ${stored.version}).`, {
            benevoles: stored.plan.volunteers.length,
            creneaux: stored.plan.shifts.length,
            affectations: stored.plan.assignments.length,
          });
          dispatch({ type: 'loaded', stored });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log.error('planning', `Impossible d'ouvrir le planning: ${message}`);
          dispatch({ type: 'load-failed', id, message });
        });
    },
    [store],
  );

  const currentId = state.id;
  const reset = useCallback(() => {
    if (!currentId) return;
    log.warn('planning', 'Retour au planning enregistré, modifications locales abandonnées.');
    store
      .reset(currentId)
      .then((stored) => dispatch({ type: 'loaded', stored }))
      // A reset that fails changes nothing: the working copy is still on screen, and throwing it
      // away here would lose exactly the edits the régisseur asked to drop, plus the plan.
      .catch((error: unknown) =>
        dispatch({
          type: 'save-failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [store, currentId]);

  /*
   * Every edit is journalled, with the same French the undo tooltip shows.
   *
   * It happens here and not in the reducer, because a reducer must stay pure and React calls it
   * twice in development, which would double every line. These two callbacks are the only doors
   * into an edit, so covering them covers the drag, the keyboard, Réglages, the import and the
   * accepted proposals without a line in any of those.
   */
  const apply = useCallback((next: Plan, label: string) => {
    log.info('edition', label);
    dispatch({ type: 'edit', plan: next, label });
  }, []);

  const edit = useCallback((fn: (plan: Plan) => Plan, label: string) => {
    const current = planRef.current;
    if (!current) return;
    log.info('edition', label);
    dispatch({ type: 'edit', plan: fn(current), label });
  }, []);

  // Autosave. Held back while a conflict is open, because writing again would either fail
  // uselessly or, if forced, do exactly the silent overwrite this design exists to prevent.
  //
  // A refused save holds it back too, and that is deliberate: a database that has just rejected
  // this document will reject it again in 1.2 s, and again, filling the journal with the same
  // line until somebody notices. It waits for the régisseur to press Réessayer.
  const { plan, dirty, saving, conflict, outdated, baseVersion, lastLabel, saveError } = state;
  useEffect(() => {
    if (!currentId || !plan || !dirty || saving || conflict || outdated !== null) return;
    if (saveError) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: 'saving' });
      store
        // The label of the last edit travels with the save, and the history screen reads it back
        // against the version this save creates. It is the same French the undo tooltip shows.
        .save(currentId, plan, baseVersion, lastLabel)
        .then((result) => {
          if (result.ok) {
            log.info('enregistrement', `Enregistré en version ${result.version}.`, {
              apres: lastLabel ?? 'modification non décrite',
            });
            dispatch({ type: 'saved', version: result.version, savedAt: result.savedAt });
          } else if ('outdated' in result) {
            log.error(
              'enregistrement',
              `Enregistrement refusé: cette page utilise le format de document ${PLAN_FORMAT}, ` +
                `la base en exige au moins ${result.outdated.required}. Page à recharger.`,
            );
            dispatch({ type: 'outdated', required: result.outdated.required });
          } else {
            log.warn(
              'enregistrement',
              `Enregistrement refusé: la copie de travail est en version ${baseVersion}, ` +
                `la base en est à la version ${result.conflict.version}.`,
            );
            dispatch({ type: 'conflict', stored: result.conflict });
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // THE ONE THAT MATTERS MOST. A save that never lands is invisible on screen apart from
          // a line of grey text, and it is the failure somebody will describe as "j'ai tout perdu".
          // So it raises a banner of its own, and it keeps the working copy: this branch used to
          // reset the whole state, which really did lose everything unsaved.
          log.error('enregistrement', `Échec de l'enregistrement: ${message}`);
          dispatch({ type: 'save-failed', message });
        });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [store, currentId, plan, dirty, saving, conflict, outdated, baseVersion, lastLabel, saveError]);

  const acceptTheirs = useCallback(() => {
    if (!state.conflict) return;
    log.warn('enregistrement', 'Conflit résolu en reprenant la version de la base.', {
      version: state.conflict.version,
    });
    dispatch({ type: 'loaded', stored: state.conflict });
  }, [state.conflict]);

  const restore = useCallback(
    async (version: number) => {
      if (!currentId || !store.restore) {
        throw new Error("Ce planning ne conserve pas d'historique.");
      }
      log.info('historique', `Restauration demandée de la version ${version}.`);
      const result = await store.restore(currentId, version, baseVersion);
      // Both branches replace the working copy: on success with the restored plan, on refusal
      // with nothing, since the conflict banner is what asks the régisseur to decide.
      if (result.ok) {
        log.info('historique', `Version ${version} restaurée, en version ${result.stored.version}.`);
        dispatch({ type: 'loaded', stored: result.stored });
      } else {
        log.warn('historique', 'Restauration refusée: le planning a changé entre-temps.');
        dispatch({ type: 'conflict', stored: result.conflict });
      }
    },
    [store, currentId, baseVersion],
  );

  const checkpoint = useCallback(
    async (name: string) => {
      if (!currentId || !store.checkpoint) {
        throw new Error("Ce planning ne conserve pas d'historique.");
      }
      const result = await store.checkpoint(currentId, name, baseVersion);
      if (!result.ok) {
        throw new Error(
          `Le planning a changé entre-temps: vous regardez la version ${baseVersion}, ` +
            `la base en est à la version ${result.version}. Rechargez avant d'enregistrer.`,
        );
      }
      log.info('historique', `Point de sauvegarde "${name}" posé sur la version ${result.version}.`);
      dispatch({ type: 'history-changed' });
      return result.version;
    },
    [store, currentId, baseVersion],
  );

  const historyChanged = useCallback(() => dispatch({ type: 'history-changed' }), []);

  // Clearing the refusal is what lets the autosave fire again: the plan is still dirty, so the
  // effect above picks it straight back up. Nothing else about the working copy moves.
  const retrySave = useCallback(() => {
    log.info('enregistrement', 'Nouvel essai après un enregistrement refusé.');
    dispatch({ type: 'retry-save' });
  }, []);

  const close = useCallback(() => dispatch({ type: 'closed' }), []);

  const keepMine = useCallback(() => {
    // Adopting their version number is what makes the next autosave land: the working copy is
    // now built on what the store actually holds, and the local plan is written over it. The
    // régisseur asked for that in so many words, which is the only way it ever happens.
    if (!state.conflict) return;
    log.warn('enregistrement', 'Conflit résolu en écrasant la version de la base.', {
      version: state.conflict.version,
    });
    dispatch({ type: 'overwrite', version: state.conflict.version });
  }, [state.conflict]);

  // One index and one validation per plan, shared by every screen. Both are pure functions of
  // the plan, so identity is a sufficient cache key.
  const index = useMemo(() => (state.plan ? new PlanIndex(state.plan) : null), [state.plan]);
  const report = useMemo(() => (state.plan ? validate(state.plan) : null), [state.plan]);

  const value = useMemo<PlanContextValue>(
    () => ({
      ...state,
      index,
      report,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      apply,
      edit,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      open,
      reset,
      retrySave,
      close,
      acceptTheirs,
      keepMine,
      restore,
      checkpoint,
      historyChanged,
    }),
    [
      state,
      index,
      report,
      apply,
      edit,
      open,
      reset,
      retrySave,
      close,
      acceptTheirs,
      keepMine,
      restore,
      checkpoint,
      historyChanged,
    ],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const value = useContext(PlanContext);
  if (!value) throw new Error('usePlan doit être appelé dans un PlanProvider');
  return value;
}

/** Narrowed to a loaded plan, for the screens that only ever render once one exists. */
export interface LoadedPlan extends PlanContextValue {
  plan: Plan;
  index: PlanIndex;
  report: ValidationResult;
}

export function useLoadedPlan(): LoadedPlan {
  const value = usePlan();
  if (!value.plan || !value.index || !value.report) {
    throw new Error('useLoadedPlan doit être appelé sous un plan chargé');
  }
  return value as LoadedPlan;
}
