/**
 * The journal, read back.
 *
 * This screen exists for one conversation: somebody who is not the developer says "ça a planté
 * hier soir", and the answer has to be better than a shrug. They come here, press "Copier pour
 * diagnostic", and paste the block into a message. That block is the whole point of the screen,
 * and everything else on it is there to make pressing that button obvious.
 *
 * Two decisions.
 *
 * THE EXPORT IS PLAIN TEXT, not JSON and not a file. It has to survive being pasted into a
 * message by somebody in a hurry, and it has to be readable by a person as well as by a machine.
 * A downloaded file is one more thing to find, attach and lose.
 *
 * THE FILTER DEFAULTS TO EVERYTHING. The instinct is to show only the errors, and it is wrong:
 * what explains a failure is almost never the failure itself, it is the ten ordinary things that
 * happened just before it.
 */

import { useCallback, useEffect, useState } from 'react';

import { useLoadedPlan } from '../store/store.tsx';
import { useStore } from '../storeContext.ts';
import { log } from '../log/logger.ts';
import type { LogRow } from '../persistence/types.ts';

/** How many entries are read at once. The database keeps far more; nobody reads far more. */
const PAGE = 300;

const LEVEL_LABEL: Record<LogRow['level'], string> = {
  info: 'info',
  warn: 'alerte',
  error: 'erreur',
};

/** "08/09 14:05:12", which is what somebody compares against "c'était vers deux heures". */
const stamp = (iso: string): string => {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '??/?? ??:??:??';
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${pad(when.getDate())}/${pad(when.getMonth() + 1)} ` +
    `${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  );
};

/**
 * The block that gets pasted into a message.
 *
 * Oldest first, deliberately, against the screen's own order: a listing is read newest first
 * because the question is "what just happened", and a transcript is read in the order things
 * occurred because the question is "how did it get there".
 */
export function formatLog(rows: readonly LogRow[], header: Record<string, string>): string {
  const lines = [
    'Journal du planning',
    ...Object.entries(header).map(([key, value]) => `${key}: ${value}`),
    `entrées: ${rows.length}`,
    '',
  ];

  for (const row of [...rows].reverse()) {
    lines.push(
      `${stamp(row.at)}  ${LEVEL_LABEL[row.level].toUpperCase().padEnd(6)} ${row.kind.padEnd(15)} ${
        row.message
      }`,
    );
    if (row.detail) lines.push(`    détail: ${JSON.stringify(row.detail)}`);
  }

  if (rows.length === 0) lines.push('(aucune entrée)');
  return lines.join('\n');
}

export function JournalScreen() {
  const { id, plan, baseVersion } = useLoadedPlan();
  const store = useStore();
  const [rows, setRows] = useState<readonly LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'manuel' | null>(null);

  const supported = typeof store.readLog === 'function';

  const load = useCallback(() => {
    if (!id || !store.readLog) return;
    // Anything still buffered is sent first, so pressing "Actualiser" after a problem shows the
    // entries that describe it rather than the ones from before it.
    void log
      .flush()
      .then(() => store.readLog!(id, PAGE))
      .then((found) => {
        setRows(found);
        setError(null);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [store, id]);

  useEffect(load, [load]);

  if (!supported) {
    return (
      <div className="screen is-wide">
        <div className="screen-main">
          <div className="card">
            <h2>Journal</h2>
            <p>Ce mode de stockage ne tient pas de journal.</p>
          </div>
        </div>
      </div>
    );
  }

  const shown = (rows ?? []).filter((row) => !onlyProblems || row.level !== 'info');
  const text = formatLog(shown, {
    planning: `${plan.name} (version ${baseVersion})`,
    identifiant: id ?? 'inconnu',
    extrait: new Date().toLocaleString('fr-FR'),
    filtre: onlyProblems ? 'alertes et erreurs seulement' : 'tout',
  });

  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied('ok'))
      .catch(() => setCopied('manuel'));
    if (!navigator.clipboard) setCopied('manuel');
  };

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <span className="toolbar-note">
            Tout ce que l'outil a fait sur ce planning, du plus récent au plus ancien.
          </span>
          <div className="toolbar-sep" />
          <label className="checkline">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(event) => setOnlyProblems(event.target.checked)}
            />
            Alertes et erreurs seulement
          </label>
          <div className="toolbar-sep" />
          <button className="btn" onClick={load}>
            Actualiser
          </button>
          <button className="btn is-primary" onClick={copy}>
            Copier pour diagnostic
          </button>
        </div>

        <div className="journal">
          {error && <p className="alert is-bad">{error}</p>}

          {!rows && !error && (
            <p>
              <span className="spinner" /> Chargement…
            </p>
          )}

          {copied === 'ok' && (
            <p className="alert is-ok">
              Journal copié. Collez-le dans un message pour qu'il soit analysé.
            </p>
          )}
          {copied === 'manuel' && (
            <p className="alert">
              Le navigateur a refusé le presse-papier. Sélectionnez le texte ci-dessous et copiez-le
              à la main.
            </p>
          )}

          {rows && (
            <>
              <p className="journal-note">
                {shown.length} entrée(s) affichée(s). Les plus anciennes sont effacées
                automatiquement: les 5000 dernières de ce planning sont conservées, et rien au-delà
                de 90 jours. Un point de sauvegarde, lui, ne s'efface jamais tout seul.
              </p>

              <table className="setup-table journal-table">
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Niveau</th>
                    <th>Quoi</th>
                    <th>Ce qui s'est passé</th>
                    <th>Qui</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.id} className={`journal-${row.level}`}>
                      <td>{stamp(row.at)}</td>
                      <td>{LEVEL_LABEL[row.level]}</td>
                      <td>{row.kind}</td>
                      <td>
                        {row.message}
                        {row.detail && (
                          <div className="journal-detail">{JSON.stringify(row.detail)}</div>
                        )}
                      </td>
                      <td className="journal-who">
                        {row.actor ?? 'inconnu'}
                        <span className="journal-session"> · {row.session}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/*
                Always rendered, never only as a fallback: a browser that refuses the clipboard
                does so at the moment of the press, and by then somebody is already stuck.
              */}
              <details className="journal-raw">
                <summary>Voir le texte qui sera copié</summary>
                <textarea className="journal-text" readOnly value={text} rows={16} />
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
