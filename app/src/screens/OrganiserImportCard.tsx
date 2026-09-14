/**
 * Importing the pole organisers' form, next to the volunteers' one.
 *
 * A card of its own rather than a second mode of the volunteers' import, because the two answer
 * different questions and share almost nothing. The volunteers' import is a negotiation: who is
 * new, what changed, and above all who is GONE, listed one by one because a missing row can mean
 * a withdrawal or an export mistake and the difference is somebody turning up to a shift that no
 * longer exists.
 *
 * NONE OF THAT APPLIES HERE. A organiser absent from the file is kept exactly as they were: they
 * did not resign, they just did not fill the form in twice, and removing them would silently cut
 * every pole they run. So there is nothing to negotiate, and the preview is a count plus the
 * rows worth looking at.
 *
 * The poles are not in this file and never will be. Which poles somebody runs is decided in
 * Réglages, against the shape of the event, long after the form closes.
 */

import { useState } from 'react';

import { importOrganisers, type OrganiserImportResult } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from '../components/labels.ts';
import { fetchSheetCsv } from '../import/sheet.ts';

type Source = { kind: 'sheet'; url: string } | { kind: 'file'; name: string };

export function OrganiserImportCard() {
  const { plan, apply } = useLoadedPlan();

  const [sheetUrl, setSheetUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<{ result: OrganiserImportResult; source: Source } | null>(null);

  const parse = (csv: string, source: Source): void => {
    try {
      setRead({
        result: importOrganisers(csv, {
          existing: plan.organisers,
          // The phases, so that « à partir du 10/03 8h » becomes an arrival rather than a note.
          phases: { montage: plan.montage, demontage: plan.demontage },
        }),
        source,
      });
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const fromSheet = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      parse(await fetchSheetCsv(sheetUrl), { kind: 'sheet', url: sheetUrl });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRead(null);
    } finally {
      setBusy(false);
    }
  };

  const onApply = (): void => {
    if (!read) return;
    const { created, updated } = read.result;
    apply(
      { ...plan, organisers: read.result.organisers },
      `import responsables: ${created} nouveau(x), ${updated} mis à jour`,
    );
    setRead(null);
  };

  const blocking = read?.result.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = read?.result.issues.filter((i) => i.severity === 'warning') ?? [];
  // A blocking issue means a column could not be bound, so nothing was read at all. Offering
  // "Appliquer" then would replace the organisers with an empty list.
  const applicable = read !== null && blocking.length === 0;

  return (
    <section className="setup-group">
      <div className="setup-group-head">
        <span className="setup-group-title">Responsables de pôle</span>
        <span className="people-meta">
          {plan.organisers.length} enregistré(s) · formulaire distinct de celui des bénévoles
        </span>
      </div>

      <p className="people-meta import-note">
        Cet import n'apporte que des personnes. Les pôles dont ils sont responsables, et leurs
        horaires, se règlent dans Réglages: ils changent bien après la fermeture du formulaire.
        Un responsable absent du fichier est conservé tel quel, jamais retiré.
      </p>

      <div className="import-source">
        <input
          className="select import-url"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          name="organiser-sheet-url"
          autoComplete="off"
          value={sheetUrl}
          onChange={(event) => setSheetUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && sheetUrl.trim() !== '') void fromSheet();
          }}
        />
        <button
          className="btn is-primary"
          disabled={busy || sheetUrl.trim() === ''}
          onClick={() => void fromSheet()}
        >
          {busy ? <span className="spinner" /> : null} Récupérer
        </button>

        <span className="toolbar-sep" />

        <label className="btn">
          Ou choisir un fichier CSV
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => parse(text, { kind: 'file', name: file.name }));
            }}
          />
        </label>
      </div>

      {error && <p className="alert is-bad import-error">{error}</p>}

      {read && (
        <div className="import-summary">
          <p>
            <strong>
              {read.result.created} nouveau(x), {read.result.updated} mis à jour
            </strong>
            <span className="people-meta">
              {' · '}
              {read.source.kind === 'file' ? read.source.name : 'depuis la feuille Google'}
            </span>
          </p>

          {blocking.length > 0 ? (
            <p className="alert is-bad">
              {blocking.map((issue) => issue.message).join(' ')} Rien n'a été lu: corrigez les
              intitulés du formulaire, ou dites-le pour que les mots-clés soient ajustés.
            </p>
          ) : (
            <p className="people-meta">
              Les codes d'accès déjà envoyés sont conservés, et les pôles de chacun aussi.
            </p>
          )}

          {/* Same markup as the volunteers' issue list, so the two read as one screen. */}
          {warnings.length > 0 && (
            <div className="import-issues">
              {warnings.map((issue, at) => (
                <div key={at} className="issue is-tier2">
                  <span className="issue-code">
                    {issue.code}
                    {issue.row !== null && ` · ligne ${issue.row}`}
                    {issue.person && ` · ${issue.person}`}
                  </span>
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          {applicable && read.result.created > 0 && (
            <p className="people-meta">
              Nouveaux: {read.result.organisers
                .filter((person) => !plan.organisers.some((l) => l.key === person.key))
                .map(organiserName)
                .join(', ')}
            </p>
          )}

          <div className="setup-regen-row">
            <button className="btn is-primary" onClick={onApply} disabled={!applicable}>
              Appliquer cet import
            </button>
            <button className="btn" onClick={() => setRead(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
