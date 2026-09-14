/**
 * Import: bringing the plan up to date with a fresh export of the form.
 *
 * The form is not filled in once. It collects answers for months, people correct what they said,
 * a duplicate row gets deleted, somebody withdraws. So this screen is used many times, and each
 * time it answers the same three questions: who is new, what changed, and who is gone.
 *
 * NOTHING IS APPLIED UNTIL THE RÉGISSEUR SAYS SO, and the removals, which are the half that
 * costs somebody their evening, are listed one by one with what each one would lose and can be
 * refused individually. A row missing from an export usually means a withdrawal. It can also
 * mean a filtered view was exported by mistake, and the difference between those two is a person
 * turning up to a shift that no longer exists.
 */

import { useMemo, useState } from 'react';

import {
  existingCodes,
  fmtHours,
  importVolunteers,
  surveyForm,
  reconcileVolunteers,
  applyReconciliation,
  summariseReconciliation,
  EDITABLE_FIELDS,
  type EditableField,
  type FormMapping,
  type ImportOptions,
  type ImportResult,
  type Reconciliation,
  type Volunteer,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { VolunteerEdit } from '../components/VolunteerEdit.tsx';
import { downloadText, today } from '../components/download.ts';
import { fetchSheetCsv } from '../import/sheet.ts';
import { rememberSheet, setFormMapping } from '../store/edits.ts';
import { FormMappingCard } from './FormMappingCard.tsx';
import { OrganiserImportCard } from './OrganiserImportCard.tsx';

type Source = { kind: 'sheet'; url: string } | { kind: 'file'; name: string };

export function ImportScreen() {
  const { plan, index, apply } = useLoadedPlan();

  /*
   * The field starts on the link this plan already knows, so the common case is one click.
   *
   * `useState` and not a derived value: the régisseur may be in the middle of typing a
   * different one, and an autosave landing from another tab must not snatch the field back.
   * The remembered link itself stays on the plan, and the two are compared below to decide
   * whether the button says "Rafraîchir" or "Récupérer".
   */
  const [sheetUrl, setSheetUrl] = useState(plan.sheetUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ result: ImportResult; source: Source; csv: string } | null>(null);
  /**
   * The correspondence being worked on, started from the one this event remembers. Saved with
   * the import it was made for (`onApply`), so abandoning an import abandons it too.
   */
  const [mapping, setMapping] = useState<FormMapping>(plan.formMapping);
  /** Removals the régisseur has refused. Their answers and placements stay untouched. */
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  /** Whose reading is being corrected, before any of it is applied. */
  const [correcting, setCorrecting] = useState<string | null>(null);

  /**
   * Correcting a reading BEFORE the import is applied.
   *
   * The reading is a guess about a sentence, and the moment to check it is when the sentence is
   * on screen: making the régisseur apply first, then hunt the fiche down on the grid, is how a
   * doubt becomes a fiche nobody ever looked at. So the correction is made on the imported rows
   * themselves and everything downstream, the reconciliation included, is recomputed from them.
   *
   * Marked in `manualFields`, exactly as `correctVolunteer` does on a saved plan, so the NEXT
   * export does not quietly put the tool's own guess back.
   */
  const correct = (key: string, changes: Partial<Volunteer>): void => {
    setImported((current) => {
      if (!current) return current;
      return {
        ...current,
        result: {
          ...current.result,
          volunteers: current.result.volunteers.map((v) => {
            if (v.key !== key) return v;
            const fields = Object.keys(changes).filter((field): field is EditableField =>
              (EDITABLE_FIELDS as readonly string[]).includes(field),
            );
            return {
              ...v,
              ...changes,
              manualFields: [...new Set([...v.manualFields, ...fields])],
            };
          }),
        },
      };
    });
  };

  /** "J'ai lu, c'est bon": the doubt is cleared, the reasons stay as the record of it. */
  const validate = (key: string): void => {
    setImported((current) =>
      current
        ? {
            ...current,
            result: {
              ...current.result,
              volunteers: current.result.volunteers.map((v) =>
                v.key === key ? { ...v, needsReview: false } : v,
              ),
            },
          }
        : current,
    );
    setCorrecting(null);
  };

  const reconciliation = useMemo<Reconciliation | null>(
    () => (imported ? reconcileVolunteers(plan, imported.result) : null),
    [plan, imported],
  );

  const importOptions = (withMapping: FormMapping): ImportOptions => ({
    poles: plan.poles,
    artists: plan.artists,
    slots: plan.slots,
    preferenceSlots: plan.preferenceSlots,
    rules: plan.rules,
    lengthHours: plan.lengthHours,
    // The free-text time constraint is written on the clock, so reading it needs this
    // event's own start. See `answers.ts`.
    startISO: plan.startISO,
    existingCodes: existingCodes(plan),
    mapping: withMapping,
    volume: plan.volume,
    constraints: plan.constraints,
  });

  const survey = useMemo(
    () => (imported ? surveyForm(imported.csv, importOptions(mapping)) : null),
    [imported, mapping, plan],
  );

  /** A changed correspondence re-reads the file, dropping corrections made on the old reading. */
  const changeMapping = (next: FormMapping): void => {
    setMapping(next);
    if (imported) read(imported.csv, imported.source, next);
  };

  const read = (csv: string, source: Source, withMapping: FormMapping = mapping): void => {
    try {
      const result = importVolunteers(csv, importOptions(withMapping));
      setImported({ result, source, csv });
      setKept(new Set());
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const fromSheet = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const csv = await fetchSheetCsv(sheetUrl);
      read(csv, { kind: 'sheet', url: sheetUrl });
      /*
       * Remembered here, on a fetch that worked, and NOT when the import is applied.
       * Fetching is what proves the link is a real, readable sheet; applying is a separate
       * decision the régisseur may well answer with "Abandonner", and a link that brought back
       * an export nobody wanted is still the right link.
       */
      const remembered = rememberSheet(plan, sheetUrl);
      if (remembered !== plan) apply(remembered, 'lien du Google Sheet mémorisé');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setImported(null);
    } finally {
      setBusy(false);
    }
  };

  const onApply = (): void => {
    if (!imported || !reconciliation) return;
    apply(
      setFormMapping(applyReconciliation(plan, imported.result, reconciliation, { keep: kept }), mapping),
      `import: ${summariseReconciliation(reconciliation)}`,
    );
    setImported(null);
    setKept(new Set());
  };

  /** True when the field holds exactly the link this plan already imported from. */
  const isRemembered = plan.sheetUrl !== '' && sheetUrl.trim() === plan.sheetUrl;

  /** The fiches the importer was not sure of, which are the ones worth a human's eyes. */
  const toRead = imported?.result.volunteers.filter((v) => v.needsReview) ?? [];

  const blocking = imported?.result.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = imported?.result.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>{plan.volunteers.length} bénévoles dans le planning</strong>
          <div className="toolbar-sep" />
          {/*
            THE PLAN AS A FILE, and the only way to get one out of the tool.
            Two uses, and both matter. It is a backup that lives on somebody's disk rather than
            in a database nobody in the association administers; and it is what
            `npm run form-csv` reads to write a test export whose people are THESE people, which
            is the only way to try an import out on a plan that is already full.
          */}
          <button
            className="btn"
            title="Enregistre le planning entier dans un fichier, tel qu'il est à cet instant"
            onClick={() =>
              downloadText(
                `planning-${today()}.json`,
                JSON.stringify(plan, null, 2),
                'application/json;charset=utf-8',
              )
            }
          >
            Télécharger le plan
          </button>
          <span className="toolbar-note">
            Les colonnes sont reconnues automatiquement, et la correspondance se règle à la
            main dès qu'un fichier est lu. Aucune ligne n'est jamais écartée, une réponse
            incohérente est importée et signalée.
          </span>
        </div>

        <div className="import-body">
          <section className="setup-group">
            <div className="setup-group-head">
              <span className="setup-group-title">Depuis Google Sheets</span>
              <span className="people-meta">
                {plan.sheetUrl !== ''
                  ? 'Lien mémorisé avec le planning. Rafraîchir relit la feuille et montre ce qui a changé.'
                  : 'La feuille doit être partagée avec « tous les utilisateurs disposant du lien »'}
              </span>
            </div>

            <div className="import-source">
              <input
                className="select import-url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                name="sheet-url"
                autoComplete="off"
                value={sheetUrl}
                onChange={(event) => setSheetUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && sheetUrl.trim() !== '') void fromSheet();
                }}
              />
              {/*
                One button, two words. "Rafraîchir" when the field still holds the link this
                plan came from, which after the first import is every time; "Récupérer" when it
                holds something else, because fetching a different sheet is not a refresh and
                the word should not pretend otherwise.
              */}
              <button
                className="btn is-primary"
                disabled={busy || sheetUrl.trim() === ''}
                onClick={() => void fromSheet()}
                title={
                  isRemembered
                    ? 'Relit la feuille et affiche ce qui a changé depuis le dernier import'
                    : 'Lit cette feuille et la retient pour les prochains imports'
                }
              >
                {busy ? <span className="spinner" /> : null}{' '}
                {isRemembered ? 'Rafraîchir' : 'Récupérer'}
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
                    void file.text().then((text) => read(text, { kind: 'file', name: file.name }));
                  }}
                />
              </label>
            </div>

            {error && <p className="alert is-bad import-error">{error}</p>}
          </section>

          {survey && (
            <FormMappingCard plan={plan} survey={survey} mapping={mapping} onChange={changeMapping} />
          )}

          {reconciliation && imported && (
            <>
              <section className="setup-group">
                <div className="setup-group-head">
                  <span className="setup-group-title">Ce que cet export changerait</span>
                  <span className="people-meta">
                    {imported.source.kind === 'file'
                      ? imported.source.name
                      : 'depuis la feuille Google'}
                    {' · '}
                    {imported.result.volunteers.length} lignes lues
                  </span>
                </div>

                <div className="import-summary">
                  <p>
                    <strong>{summariseReconciliation(reconciliation)}</strong>
                    {reconciliation.unchanged > 0 && (
                      <span className="people-meta">
                        {' '}
                        · {reconciliation.unchanged} inchangés
                      </span>
                    )}
                  </p>

                  {blocking.length > 0 && (
                    <p className="alert is-bad">
                      {blocking.length} ligne(s) illisible(s). Elles ne seront pas importées, mais
                      le reste le sera. Voir le détail plus bas.
                    </p>
                  )}

                  <div className="setup-regen-row">
                    <button className="btn is-primary" onClick={onApply}>
                      Appliquer cet import
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setImported(null);
                        setKept(new Set());
                      }}
                    >
                      Abandonner
                    </button>
                    <span className="people-meta">
                      Les affectations déjà faites ne bougent pas. Seules les réponses au
                      formulaire sont écrasées.
                    </span>
                  </div>
                </div>
              </section>

              {reconciliation.removed.length > 0 && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Absents de l'export ({reconciliation.removed.length})
                    </span>
                    <span className="people-meta">
                      Décochez pour garder quelqu'un malgré son absence
                    </span>
                  </div>

                  <p className="panel-sub import-note">
                    Une ligne manquante veut souvent dire un désistement. Elle peut aussi vouloir
                    dire qu'une vue filtrée a été exportée par erreur, et la différence entre les
                    deux est quelqu'un qui se présente à un créneau qui n'existe plus.
                  </p>

                  {reconciliation.removed.map((entry) => {
                    const keep = kept.has(entry.volunteer.key);
                    return (
                      <label key={entry.volunteer.key} className="import-removal">
                        <input
                          type="checkbox"
                          checked={!keep}
                          onChange={(event) => {
                            const next = new Set(kept);
                            if (event.target.checked) next.delete(entry.volunteer.key);
                            else next.add(entry.volunteer.key);
                            setKept(next);
                          }}
                        />
                        <span className="import-removal-name">{entry.name}</span>
                        <span className={entry.assignments > 0 ? 'chip is-bad' : 'chip'}>
                          {entry.assignments > 0
                            ? `${entry.assignments} créneau(x), ${fmtHours(entry.hours)}`
                            : 'aucune affectation'}
                        </span>
                        {entry.onReserve && <span className="chip">en réserve</span>}
                        {keep && <span className="chip is-warn">conservé</span>}
                      </label>
                    );
                  })}
                </section>
              )}

              {reconciliation.updated.length > 0 && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Réponses modifiées ({reconciliation.updated.length})
                    </span>
                  </div>
                  {reconciliation.updated.map((update) => (
                    <div key={update.key} className="import-update">
                      <span className="import-removal-name">{update.name}</span>
                      {update.changes.map((change) => (
                        <span key={change.label} className="import-change">
                          {change.label}: <s>{change.before || 'vide'}</s>{' '}
                          <strong>{change.after || 'vide'}</strong>
                        </span>
                      ))}
                    </div>
                  ))}
                </section>
              )}

              {reconciliation.added.length > 0 && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Nouveaux ({reconciliation.added.length})
                    </span>
                  </div>
                  <div className="import-added">
                    {reconciliation.added.map((v) => (
                      <span key={v.key} className="chip">
                        {v.firstName} {v.lastName}
                        {/*
                          Shown because the tool is about to call this person by it on every
                          screen where the whole name does not fit, and a surname read out of the
                          wrong column would otherwise only turn up on the grid.
                        */}
                        {v.nickname.trim() !== '' && ` (${v.nickname})`}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {toRead.length > 0 && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Réponses à interpréter ({toRead.length})
                    </span>
                    <span className="people-meta">
                      Ce que l'outil a lu, et la phrase à côté
                    </span>
                  </div>
                  <p className="panel-sub">
                    L'outil a dû interpréter ces réponses-là et n'en est pas sûr. Corrigez la
                    lecture ici, avant d'appliquer: une correction faite maintenant part avec
                    l'import, et le prochain export ne la défera pas.
                  </p>

                  {toRead.map((v) => (
                    <div key={v.key} className="import-review">
                      <div className="setup-organiser-who">
                        <strong>
                          {v.firstName} {v.lastName}
                          {v.nickname.trim() !== '' && ` (${v.nickname})`}
                        </strong>
                        {v.reviewReasons.map((reason, i) => (
                          <span key={i} className="issue is-tier2">
                            {reason}
                          </span>
                        ))}
                      </div>

                      <RawAnswer label="Contrainte horaire" value={v.availabilityNote} />
                      {v.choices.map((c, i) => (
                        <RawAnswer key={i} label={`Choix ${i + 1}`} value={c.raw} />
                      ))}
                      <RawAnswer label="Montage" value={v.montage.note} />
                      <RawAnswer label="Démontage" value={v.demontage.note} />

                      {correcting === v.key ? (
                        <VolunteerEdit
                          index={index}
                          volunteer={v}
                          onCancel={() => setCorrecting(null)}
                          onSave={(changes) => {
                            correct(v.key, changes);
                            validate(v.key);
                          }}
                        />
                      ) : (
                        <span className="setup-confirm">
                          <button className="btn" onClick={() => setCorrecting(v.key)}>
                            Corriger la lecture
                          </button>
                          <button className="btn" onClick={() => validate(v.key)}>
                            La lecture est bonne
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {(blocking.length > 0 || warnings.length > 0) && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Anomalies ({blocking.length} erreurs, {warnings.length} avertissements)
                    </span>
                  </div>
                  <div className="import-issues">
                    {[...blocking, ...warnings].map((issue, i) => (
                      <div key={i} className={`issue ${issue.severity === 'error' ? '' : 'is-tier2'}`}>
                        <span className="issue-code">
                          {issue.code}
                          {issue.row !== null && ` · ligne ${issue.row}`}
                          {issue.person && ` · ${issue.person}`}
                        </span>
                        {issue.message}
                        {issue.suggestions && issue.suggestions.length > 0 && (
                          <span className="people-meta"> Suggestions: {issue.suggestions.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {/*
            Last, and always visible rather than hidden behind a tab. The organisers' file arrives
            once or twice in a season against the volunteers' file arriving weekly, so it must be
            findable without being in the way: a card below the work rather than a mode above it.
          */}
          <OrganiserImportCard />
        </div>
      </div>
    </div>
  );
}

/**
 * One answer as it was typed, above the reading of it.
 *
 * NEVER EDITABLE, here as everywhere else: it is the evidence the correction is made against,
 * and the only record of what the person actually wrote. Absent answers draw nothing rather than
 * an empty line, so a fiche flagged for one doubt does not show five blanks.
 */
function RawAnswer({ label, value }: { label: string; value: string }) {
  if (value.trim() === '') return null;
  return (
    <p className="fiche-raw-answer">
      <span className="fiche-raw-label">{label}</span>
      {value.trim()}
    </p>
  );
}
