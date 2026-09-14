/**
 * The versions this plan kept, and the way back to one.
 *
 * A save rewrites the plan whole: the store deletes the event's contents and re-inserts them
 * from the document it is handed. Ctrl+Z covers the mistake noticed in the same breath, in one
 * browser, and nothing covered yesterday, another tab, or the other organiser. This screen does.
 *
 * Three decisions worth not rediscovering.
 *
 * A RESTORE IS A SAVE. Going back writes the old body as a new version, so the state it replaces
 * is kept too and a restore can itself be undone. Nothing on this screen destroys anything, and
 * that is what makes the button pressable without a paragraph of warning next to it.
 *
 * COUNTS, NOT A DIFF. What a régisseur recognises a version by is its shape ("avant l'import il
 * y en avait 78") plus the label of the edit that produced it. A field by field comparison of two
 * whole plans is a build of its own, and shipping it first would have delayed the part that
 * actually stops work being lost.
 *
 * NOT EVERY VERSION IS KEPT, and the screen says so rather than letting the gaps look like a
 * bug. The autosave fires about a second after the last edit, so an afternoon of dragging boxes
 * is hundreds of versions; the store keeps about one every ten minutes plus every restore.
 *
 * TWO KINDS OF ROW, and the difference is the point of the screen. An automatic version lives
 * under a clock and will eventually go; a named one was kept on purpose and stays until somebody
 * removes it. Both are drawn here, and the named ones say so in words rather than by a shade of
 * grey somebody has to learn.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLoadedPlan } from '../store/store.tsx';
import { useStore } from '../storeContext.ts';
import type { PlanVersionRef } from '../persistence/types.ts';

/** "12 septembre à 14:05", which is how somebody talks about when they did something. */
const whenLabel = (iso: string): string => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'date inconnue';
  return when.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** The shape of a plan, in the three numbers that say what a version held. */
export interface PlanShape {
  volunteers: number;
  shifts: number;
  assignments: number;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count > 1 ? many : one}`;

const shapeLabel = (shape: PlanShape): string =>
  `${plural(shape.volunteers, 'bénévole', 'bénévoles')}, ${plural(
    shape.shifts,
    'créneau',
    'créneaux',
  )}, ${plural(shape.assignments, 'affectation', 'affectations')}`;

/**
 * What changed between a kept version and the state that followed it.
 *
 * The state that followed is the next newer kept version, or the working copy for the newest row.
 * Versions in between were not kept, so this is "what happened between these two restore points"
 * and never "what that one save did". Saying nothing when nothing moved is deliberate: a row of
 * three zeroes reads as information and is not.
 */
function deltaLabel(from: PlanShape, to: PlanShape): string | null {
  const parts: string[] = [];
  const add = (before: number, after: number, one: string, many: string) => {
    const change = after - before;
    if (change === 0) return;
    parts.push(`${change > 0 ? '+' : '−'}${Math.abs(change)} ${Math.abs(change) > 1 ? many : one}`);
  };
  add(from.volunteers, to.volunteers, 'bénévole', 'bénévoles');
  add(from.shifts, to.shifts, 'créneau', 'créneaux');
  add(from.assignments, to.assignments, 'affectation', 'affectations');
  return parts.length > 0 ? parts.join(', ') : null;
}

export interface HistoryTableProps {
  rows: readonly PlanVersionRef[];
  /** The working copy, which is the state that follows the newest kept version. */
  live: PlanShape;
  liveVersion: number;
  /** Null while nothing may be restored, with the reason, which the row shows instead of a button. */
  blocked: string | null;
  busy: number | null;
  armed: number | null;
  onArm(version: number | null): void;
  onRestore(version: number): void;
  onForget(version: number): void;
}

/**
 * The table on its own, taking what it draws.
 *
 * Split out from the screen so a test can render it against known rows. The screen around it is
 * a fetch and three pieces of local state, which a server render would only ever catch mid-load.
 */
export function HistoryTable({
  rows,
  live,
  liveVersion,
  blocked,
  busy,
  armed,
  onArm,
  onRestore,
  onForget,
}: HistoryTableProps) {
  return (
    <table className="setup-table history-table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Quand</th>
          <th>Ce qui a été fait</th>
          <th>Conservation</th>
          <th>Contenu</th>
          <th>Écart avec la suite</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr className="history-live">
          <td>{liveVersion}</td>
          <td>maintenant</td>
          <td>version en cours</td>
          <td />
          <td>{shapeLabel(live)}</td>
          <td />
          <td />
        </tr>
        {rows.map((row, position) => {
          const next = position === 0 ? live : rows[position - 1]!;
          const delta = deltaLabel(row, next);
          return (
            <tr key={row.version}>
              <td>{row.version}</td>
              <td>{whenLabel(row.savedAt)}</td>
              <td>{row.label ?? 'modification non décrite'}</td>
              <td>
                {row.pinned ? (
                  <span className="chip is-ok">point de sauvegarde</span>
                ) : (
                  <span className="history-auto">automatique</span>
                )}
              </td>
              <td>{shapeLabel(row)}</td>
              <td>{delta ?? 'aucun changement de volume'}</td>
              <td>
                {blocked ? (
                  <span className="history-blocked">{blocked}</span>
                ) : armed === row.version ? (
                  <span className="setup-confirm">
                    <span className="setup-confirm-text">
                      Remplace le planning affiché par celui-ci. La version {liveVersion} est
                      conservée, vous pourrez y revenir.
                    </span>
                    <button
                      className="btn is-danger"
                      disabled={busy !== null}
                      onClick={() => onRestore(row.version)}
                    >
                      {busy === row.version ? 'Restauration…' : 'Restaurer'}
                    </button>
                    <button className="btn" onClick={() => onArm(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <span className="history-actions">
                    <button className="btn" onClick={() => onArm(row.version)}>
                      Revenir à cette version
                    </button>
                    <ForgetButton row={row} onForget={onForget} />
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Forgetting one kept version, behind the same two-step press as everything destructive here.
 *
 * It exists because naming a version is otherwise a one-way door: a checkpoint made by mistake
 * would sit there for the life of the plan. This is the only thing on this screen that destroys
 * anything.
 */
function ForgetButton({
  row,
  onForget,
}: {
  row: PlanVersionRef;
  onForget(version: number): void;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        className="btn is-icon is-danger"
        title={`Oublier la version ${row.version}`}
        onClick={() => setArmed(true)}
      >
        ✕
      </button>
    );
  }

  return (
    <span className="setup-confirm">
      <span className="setup-confirm-text">
        {row.pinned
          ? 'Ce point de sauvegarde sera définitivement oublié.'
          : 'Cette version sera définitivement oubliée.'}
      </span>
      <button className="btn is-danger" onClick={() => onForget(row.version)}>
        Oublier
      </button>
      <button className="btn" onClick={() => setArmed(false)}>
        Annuler
      </button>
    </span>
  );
}

export function HistoryScreen() {
  const { id, plan, baseVersion, dirty, saving, restore, historyRevision, historyChanged } =
    useLoadedPlan();
  const store = useStore();
  const [rows, setRows] = useState<readonly PlanVersionRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);

  const supported = typeof store.history === 'function' && typeof store.restore === 'function';

  // Re-read on every accepted save, since baseVersion is what moves when one lands. That is also
  // what refreshes the list after a restore, without a second code path for it.
  const load = useCallback(() => {
    if (!id || !store.history) return;
    store
      .history(id)
      .then((found) => {
        setRows(found);
        setError(null);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [store, id]);

  // baseVersion moves on every accepted save and on a restore; historyRevision moves when the
  // kept versions change without the plan changing, which is what naming one does.
  useEffect(load, [load, baseVersion, historyRevision]);

  const onForget = (version: number) => {
    if (!id || !store.forgetVersion) return;
    setError(null);
    store
      .forgetVersion(id, version)
      .then(() => {
        historyChanged();
        load();
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  };

  const onRestore = (version: number) => {
    setBusy(version);
    setError(null);
    restore(version)
      .then(() => {
        setArmed(null);
        setBusy(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(null);
      });
  };

  if (!supported) {
    return (
      <div className="screen is-wide">
        <div className="screen-main">
          <div className="screen-body">
            <div className="card">
              <h2>Historique</h2>
              <p>Ce mode de stockage ne conserve pas les versions précédentes.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const live: PlanShape = {
    volunteers: plan.volunteers.length,
    shifts: plan.shifts.length,
    assignments: plan.assignments.length,
  };

  // Restoring while an edit is still on its way to the store would throw that edit away without
  // ever having kept it. The autosave lands about a second after the last change, so this clears
  // on its own and the row says what it is waiting for.
  const blocked =
    dirty || saving ? 'enregistrement en cours' : busy !== null ? 'restauration en cours' : null;

  /*
   * THE WIDE SHELL, since 2026-09-13: "l'onglet Historique s'affiche très mal", and it did, for
   * two reasons that are both about the box it was in rather than about anything on it.
   *
   * It was a `.screen`, which is a grid reserving 330 px for a pane this screen does not have, so
   * a third of the width was blank. And its whole contents were inside a `.card`, which is capped
   * at 520 px because a card is meant to hold a paragraph: a table of dates, labels, plan shapes
   * and two buttons a row was being squeezed into half a laptop.
   *
   * It also could not scroll. `.screen-main` is a two-row grid, a toolbar and one body; with a
   * single child the card sat in the `auto` row and simply ran off the bottom of the window. Same
   * shape as every other wide screen now: one body that scrolls, cards that take the width.
   */
  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="screen-body">
          <section className="screen-card">
            <div className="setup-group-head">
              <span className="setup-group-title">Historique</span>
              <span className="people-meta">
                {rows === null ? 'chargement…' : `${rows.length} version(s) conservée(s)`}
              </span>
            </div>

            <p className="screen-card-note">
              Chaque enregistrement réécrit le planning en entier. Les versions ci-dessous sont
              celles qui ont été conservées avant d'être remplacées. Revenir à l'une d'elles n'en
              efface aucune, celle d'aujourd'hui comprise.
            </p>
            <p className="screen-card-note">
              Les versions <strong>automatiques</strong> sont gardées environ une toutes les dix
              minutes de travail, les cinquante plus récentes, et pas au-delà de soixante jours. Un{' '}
              <strong>point de sauvegarde</strong> est une version que vous avez nommée avec le
              bouton du même nom, en haut à droite: elle est conservée tant que vous ne la
              supprimez pas. C'est ce qu'il faut poser avant un import ou avant une grosse reprise.
            </p>

            {error && <p className="alert is-bad screen-card-note">{error}</p>}

            {!rows && !error && (
              <p className="screen-card-note">
                <span className="spinner" /> Chargement…
              </p>
            )}

            {rows && rows.length === 0 && (
              <p className="screen-card-note">
                Aucune version conservée pour le moment. La première apparaîtra au prochain
                enregistrement qui remplace celui-ci.
              </p>
            )}

            {rows && rows.length > 0 && (
              <div className="screen-scroll">
                <HistoryTable
                  rows={rows}
                  live={live}
                  liveVersion={baseVersion}
                  blocked={blocked}
                  busy={busy}
                  armed={armed}
                  onArm={setArmed}
                  onRestore={onRestore}
                  onForget={onForget}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
