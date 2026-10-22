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

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  existingCodes,
  fmtHours,
  keptByDefault,
  importVolunteers,
  foldIssuesIntoFiches,
  surveyForm,
  reconcileVolunteers,
  applyReconciliation,
  summariseReconciliation,
  EDITABLE_FIELDS,
  type AnswerKind,
  type EditableField,
  type FormMapping,
  type ImportOptions,
  type ImportResult,
  type Reconciliation,
  type Plan,
  type Volunteer,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { VolunteerEdit } from '../components/VolunteerEdit.tsx';
import { downloadText, today } from '../components/download.ts';
import { fetchSheetCsv, serviceAccountAddress } from '../import/sheet.ts';
import { rememberSheet, setFormMapping } from '../store/edits.ts';
import { FormMappingCard } from './FormMappingCard.tsx';
import { SetupFromFormCard } from './SetupFromFormCard.tsx';
import { OrganiserImportCard } from './OrganiserImportCard.tsx';
import { ImportReview } from './ImportReview.tsx';
import { photosAvailable, syncFormPhotos, type PhotoSyncReport } from '../photos/photoStore.ts';
import {
  loadImportSession,
  saveImportSession,
  type FicheFix,
  type ImportSession,
  type ImportSource as Source,
} from '../import/importSession.ts';

/** The nearest ancestor that scrolls, which is where « back to the list » has to go back in. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) return at;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** A fiche's corrections replayed on a fresh reading of it, exactly as `correct` first made them. */
function withFix(v: Volunteer, fix: FicheFix | undefined): Volunteer {
  if (!fix) return v;
  const fields = Object.keys(fix.changes).filter((field): field is EditableField =>
    (EDITABLE_FIELDS as readonly string[]).includes(field),
  );
  return {
    ...v,
    ...fix.changes,
    manualFields: [...new Set([...v.manualFields, ...fields])],
    ...(fix.validated ? { needsReview: false } : {}),
  };
}

export function ImportScreen() {
  const { plan, index, apply, id: eventId } = useLoadedPlan();

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
  /**
   * The import under review: the file, the correspondence being worked on, the removals flipped
   * and the fiches corrected. Kept outside the component since 2026-10-22, so a look at
   * Personnes in the middle of a review no longer throws it away; see `importSession.ts`.
   *
   * The correspondence starts from the one this event remembers and is saved with the import it
   * was made for (`onApply`), so abandoning an import abandons it too. A removal box flipped from
   * its default: the default is removal, except for somebody entered by hand (`keptByDefault`),
   * who never had a row in the export to lose.
   */
  const [session, setSessionState] = useState<ImportSession | null>(() => loadImportSession(eventId));
  const setSession = (next: ImportSession | null): void => {
    setSessionState(next);
    saveImportSession(eventId, next);
  };
  const updateSession = (change: (current: ImportSession) => ImportSession): void => {
    setSessionState((current) => {
      if (!current) return current;
      const next = change(current);
      saveImportSession(eventId, next);
      return next;
    });
  };
  const mapping: FormMapping = session?.mapping ?? plan.formMapping;
  const flipped = useMemo<ReadonlySet<string>>(() => new Set(session?.flipped ?? []), [session?.flipped]);
  /** Whose reading is being corrected, before any of it is applied. */
  const [correcting, setCorrecting] = useState<string | null>(null);
  /**
   * Where « Régler directement sur la fiche » was clicked, to come back to once the fiche is
   * saved: the scrolling box and how far down it was. `go` asks for the jump down to the fiche.
   */
  const [jump, setJump] = useState<{ key: string; scroller: HTMLElement; top: number; go: boolean } | null>(null);
  const [comeBack, setComeBack] = useState<{ scroller: HTMLElement; top: number } | null>(null);
  const ficheRefs = useRef(new Map<string, HTMLDivElement>());
  /**
   * What the last action did, said on the screen, since 2026-09-16: « Appliquer ces réglages » used
   * to change the plan without a word and leave the card as it was, which reads as nothing having
   * happened. Cleared by the next fetch.
   */
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  /** The form's photos being fetched after an applied import, then what came of it. */
  const [photoSync, setPhotoSync] = useState<
    { running: true; done: number; total: number } | { running: false; report: PhotoSyncReport; names: Map<string, string> } | null
  >(null);
  /** Bumped on each applied setup, so the card is rebuilt against the plan it just changed. */
  const [setupRound, setSetupRound] = useState(0);
  /**
   * The address a private sheet is shared with, asked of the `sheet-csv` function since 2026-10-22:
   * « le compte de service de l'outil » told the régisseur what to do but not with whom.
   */
  const [account, setAccount] = useState<string | null>(null);
  const [accountCopied, setAccountCopied] = useState<'ok' | 'manuel' | null>(null);
  useEffect(() => {
    let live = true;
    void serviceAccountAddress().then((address) => {
      if (live) setAccount(address);
    });
    return () => {
      live = false;
    };
  }, []);
  const copyAccount = (address: string): void => {
    navigator.clipboard
      ?.writeText(address)
      .then(() => setAccountCopied('ok'))
      .catch(() => setAccountCopied('manuel'));
    if (!navigator.clipboard) setAccountCopied('manuel');
  };

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
    updateSession((current) => {
      const fix = current.fixes[key] ?? { changes: {}, validated: false };
      return { ...current, fixes: { ...current.fixes, [key]: { ...fix, changes: { ...fix.changes, ...changes } } } };
    });
  };

  /** "J'ai lu, c'est bon": the doubt is cleared, the reasons stay as the record of it. */
  const validate = (key: string): void => {
    updateSession((current) => {
      const fix = current.fixes[key] ?? { changes: {}, validated: false };
      return { ...current, fixes: { ...current.fixes, [key]: { ...fix, validated: true } } };
    });
    closeFiche(key);
  };

  /** The fiche's editor closes; when the list sent the régisseur here, the list is where they go back. */
  const closeFiche = (key: string): void => {
    setCorrecting(null);
    if (jump?.key === key) {
      setComeBack({ scroller: jump.scroller, top: jump.top });
      setJump(null);
    }
  };

  const jumpTo = (key: string, from: HTMLElement): void => {
    const scroller = scrollParent(from);
    setCorrecting(key);
    setJump({ key, scroller, top: scroller.scrollTop, go: true });
  };

  useEffect(() => {
    if (!jump?.go) return;
    ficheRefs.current.get(jump.key)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setJump({ ...jump, go: false });
  }, [jump]);

  useEffect(() => {
    if (!comeBack) return;
    comeBack.scroller.scrollTo({ top: comeBack.top, behavior: 'smooth' });
    setComeBack(null);
  }, [comeBack]);

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
    // The days a form ticks for the montage and the démontage become windows of them.
    phases: { montage: plan.montage, demontage: plan.demontage },
    availabilityMode: plan.availabilityMode,
    // The competences the free-text answer is read for.
    skills: plan.skills,
    // The side activities, each read from a column whose header names it.
    sideActivities: plan.sideActivities,
  });

  /*
   * THE FILE IS READ FROM THE SESSION, against the plan as it is now, and the corrections are
   * replayed on top. So a correspondence changed, settings applied from the form or a pole added
   * meanwhile re-read the file without losing a single fiche already corrected. Every signalement
   * about somebody is folded into their fiche, which is what the « À régler » list promises: what
   * is left unsettled stays « à relire » in Personnes.
   */
  const reading = useMemo<{ result: ImportResult; error: null } | { result: null; error: string } | null>(() => {
    if (!session) return null;
    try {
      const raw = foldIssuesIntoFiches(importVolunteers(session.csv, importOptions(session.mapping)));
      return { result: { ...raw, volunteers: raw.volunteers.map((v) => withFix(v, session.fixes[v.key])) }, error: null };
    } catch (cause: unknown) {
      return { result: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, plan]);
  const imported = useMemo(
    () => (session && reading?.result ? { result: reading.result, source: session.source, csv: session.csv } : null),
    [session, reading],
  );

  const reconciliation = useMemo<Reconciliation | null>(
    () => (imported ? reconcileVolunteers(plan, imported.result) : null),
    [plan, imported],
  );

  /** Removals the régisseur has refused. Their answers and placements stay untouched. */
  const kept = useMemo<ReadonlySet<string>>(() => {
    const keep = reconciliation ? keptByDefault(reconciliation) : new Set<string>();
    for (const key of flipped) {
      if (keep.has(key)) keep.delete(key);
      else keep.add(key);
    }
    return keep;
  }, [reconciliation, flipped]);

  const survey = useMemo(
    () => (imported ? surveyForm(imported.csv, importOptions(mapping)) : null),
    [imported, mapping, plan],
  );

  /** A changed correspondence re-reads the file; the corrections already made are replayed on it. */
  const changeMapping = (next: FormMapping): void => {
    updateSession((current) => ({ ...current, mapping: next }));
  };

  /** One answer settled from « À régler »: an entry of the correspondence, for every fiche at once. */
  const decideAnswer = (kind: AnswerKind, answerKey: string, value: unknown): void => {
    changeMapping({
      ...mapping,
      answers: { ...mapping.answers, [kind]: { ...((mapping.answers[kind] as Record<string, unknown> | undefined) ?? {}), [answerKey]: value } },
    });
  };

  /** The form's proposed settings, applied as one edit; the answers they cover join the mapping. */
  const applyFormSetup = (next: Plan, summary: string): void => {
    const added = [
      next.poles.length > plan.poles.length ? `${next.poles.length - plan.poles.length} pôle(s)` : '',
      next.startISO !== plan.startISO || next.lengthHours !== plan.lengthHours ? "les dates de l'événement" : '',
      next.montage.enabled && !plan.montage.enabled ? 'le montage' : '',
      next.demontage.enabled && !plan.demontage.enabled ? 'le démontage' : '',
      next.slots !== plan.slots ? 'les tranches' : '',
      next.skills.length > plan.skills.length ? `${next.skills.length - plan.skills.length} compétence(s)` : '',
      next.sideActivities.length > plan.sideActivities.length ? `${next.sideActivities.length - plan.sideActivities.length} activité(s)` : '',
      next.applicationSteps.length > plan.applicationSteps.length ? `${next.applicationSteps.length - plan.applicationSteps.length} étape(s)` : '',
    ].filter(Boolean);
    try {
      apply(next, summary);
      // The plan arriving through the context re-reads the file on its own; see `reading`.
      changeMapping({ ...mapping, answers: { ...mapping.answers, pole: next.formMapping.answers.pole } });
      setSetupRound((n) => n + 1);
      setNotice({
        tone: 'ok',
        text:
          `Réglages appliqués${added.length > 0 ? `: ${added.join(', ')}` : ' (pôles déjà présents, réponses reliées)'}. ` +
          "Le fichier a été relu avec ces réglages: vérifiez ce que l'import changerait ci-dessous, puis appliquez-le. " +
          'Tout se corrige dans Réglages, et Ctrl+Z annule.',
      });
    } catch (cause) {
      setNotice({ tone: 'bad', text: `Les réglages n'ont pas pu être appliqués: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };

  /**
   * A new file starts a new review. The correspondence being worked on carries over, as it always
   * did; the corrections do not, since they were made against answers this file may have changed.
   */
  const read = (csv: string, source: Source): void => {
    try {
      importVolunteers(csv, importOptions(mapping));
      setSession({ csv, source, mapping, flipped: [], fixes: {} });
      setCorrecting(null);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const fromSheet = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setNotice(null);
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
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  const onApply = (): void => {
    if (!imported || !reconciliation) return;
    const summary = summariseReconciliation(reconciliation);
    try {
      apply(
        setFormMapping(applyReconciliation(plan, imported.result, reconciliation, { keep: kept }), mapping),
        `import: ${summary}`,
      );
      setSession(null);
      startPhotoSync(imported.result);
      const review = imported.result.volunteers.filter((v) => v.needsReview).length;
      setNotice({
        tone: 'ok',
        text:
          `Import appliqué: ${summary}.` +
          (review > 0 ? ` ${review} fiche(s) à relire, en rouge dans Personnes.` : '') +
          " L'enregistrement se fait tout seul (voir en haut à droite), et Ctrl+Z annule.",
      });
    } catch (cause) {
      setNotice({ tone: 'bad', text: `L'import n'a pas pu être appliqué: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };

  /**
   * The form's photos, fetched from Drive once the import is applied, never before: an import
   * the régisseur abandons fetches nothing. Runs on its
   * own: the import is applied whatever happens to the photos. A photo already held from the same
   * Drive file, or chosen by hand, is not fetched again.
   */
  const startPhotoSync = (result: ImportResult): void => {
    const links = result.photos ?? [];
    if (!photosAvailable || eventId === null || links.length === 0) return;
    const names = new Map(result.volunteers.map((v) => [v.key, `${v.firstName} ${v.lastName}`.trim()]));
    setPhotoSync({ running: true, done: 0, total: links.length });
    void syncFormPhotos(eventId, links, (done, total) => setPhotoSync({ running: true, done, total })).then((report) =>
      setPhotoSync({ running: false, report, names }),
    );
  };

  /** True when the field holds exactly the link this plan already imported from. */
  const isRemembered = plan.sheetUrl !== '' && sheetUrl.trim() === plan.sheetUrl;

  /** The fiches the importer was not sure of, which are the ones worth a human's eyes. */
  const toRead = imported?.result.volunteers.filter((v) => v.needsReview) ?? [];

  const blocking = imported?.result.issues.filter((i) => i.severity === 'error') ?? [];
  /** The signalements about nobody in particular; the others are on their fiche, see `ImportReview`. */
  const fileIssues = imported?.result.issues.filter((i) => i.key === undefined) ?? [];
  const shownError = error ?? reading?.error ?? null;

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
          {photoSync && <PhotoSyncNotice state={photoSync} onClose={() => setPhotoSync(null)} />}
          {notice && (
            <p className={`alert is-${notice.tone} import-notice`} role="status" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>
              {notice.text}{' '}
              <button type="button" className="btn is-small" onClick={() => setNotice(null)}>
                OK
              </button>
            </p>
          )}
          <section className="setup-group">
            <div className="setup-group-head">
              <span className="setup-group-title">Depuis Google Sheets</span>
              <span className="people-meta">
                {plan.sheetUrl !== '' ? (
                  'Lien mémorisé avec le planning. Rafraîchir relit la feuille et montre ce qui a changé.'
                ) : account !== null ? (
                  <>
                    Feuille privée: partagez-la en lecture (« Lecteur ») avec l’adresse de l’outil,{' '}
                    <code className="service-account">{account}</code>{' '}
                    <button type="button" className="btn is-small" onClick={() => copyAccount(account)}>
                      {accountCopied === 'ok' ? 'Copiée' : 'Copier'}
                    </button>
                    {accountCopied === 'manuel' && ' (copie refusée par le navigateur: sélectionnez l’adresse)'}, ou
                    rendez-la lisible par lien.
                  </>
                ) : (
                  'Feuille privée: partagez-la en lecture avec l’adresse Google de l’outil (elle finit par iam.gserviceaccount.com, voir la notice), ou rendez-la lisible par lien.'
                )}
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

            {shownError && <p className="alert is-bad import-error">{shownError}</p>}
          </section>

          {imported && (
            <SetupFromFormCard
              key={`${imported.csv.length}-${imported.source.kind}-${setupRound}`}
              plan={plan}
              csv={imported.csv}
              mapping={mapping}
              onApply={applyFormSetup}
            />
          )}

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
                      {/* Every row is imported, errors included: `importVolunteers` drops nobody. */}
                      {blocking.length} erreur(s) à corriger. Toutes les lignes sont importées
                      quand même: « À régler » dit ce que chaque erreur change.
                    </p>
                  )}

                  <div className="setup-regen-row">
                    <button className="btn is-primary" onClick={onApply}>
                      Appliquer cet import
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSession(null);
                        setCorrecting(null);
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

              <ImportReview
                plan={plan}
                survey={survey}
                volunteers={imported.result.volunteers}
                doubts={imported.result.doubts ?? []}
                fileIssues={fileIssues}
                onDecide={decideAnswer}
                onJump={jumpTo}
              />

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
                          onChange={() => {
                            const next = new Set(flipped);
                            if (next.has(entry.volunteer.key)) next.delete(entry.volunteer.key);
                            else next.add(entry.volunteer.key);
                            updateSession((current) => ({ ...current, flipped: [...next] }));
                          }}
                        />
                        <span className="import-removal-name">{entry.name}</span>
                        <span className={entry.assignments > 0 ? 'chip is-bad' : 'chip'}>
                          {entry.assignments > 0
                            ? `${entry.assignments} créneau(x), ${fmtHours(entry.hours)}`
                            : 'aucune affectation'}
                        </span>
                        {entry.onReserve && <span className="chip">en liste d'attente</span>}
                        {entry.volunteer.enteredByHand && (
                          <span
                            className="chip"
                            title="Ajouté·e à la main, jamais inscrit·e par le formulaire: son absence de l'export n'est pas un désistement"
                          >
                            saisi·e à la main
                          </span>
                        )}
                        {keep && <span className="chip is-warn">conservé</span>}
                      </label>
                    );
                  })}
                </section>
              )}

              {reconciliation.alreadyOrga.length > 0 && (
                <section className="setup-group">
                  <div className="setup-group-head">
                    <span className="setup-group-title">
                      Déjà orgas dans le planning ({reconciliation.alreadyOrga.length})
                    </span>
                    <span className="people-meta">Non ajoutés comme bénévoles</span>
                  </div>
                  <p className="panel-sub import-note">
                    Ces lignes nomment une personne qui est orga dans le planning, souvent un·e
                    bénévole passé·e orga depuis l'onglet Personnes. Une personne n'a qu'une fiche:
                    pour la refaire bénévole, utiliser sa fiche.
                  </p>
                  {reconciliation.alreadyOrga.map((volunteer) => (
                    <div key={volunteer.key} className="import-removal">
                      <span className="import-removal-name">
                        {`${volunteer.firstName} ${volunteer.lastName}`.trim()}
                      </span>
                      {volunteer.email !== '' && <span className="chip">{volunteer.email}</span>}
                    </div>
                  ))}
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
                      Fiches à relire ({toRead.length})
                    </span>
                    <span className="people-meta">
                      Ce que l'outil a lu, et la phrase à côté
                    </span>
                  </div>
                  <p className="panel-sub">
                    L'outil n'est pas sûr de ces fiches-là. Corrigez la lecture ici, avant
                    d'appliquer: une correction faite maintenant part avec l'import, et le
                    prochain export ne la défera pas. Une fiche validée ou corrigée quitte la liste.
                  </p>

                  {toRead.map((v) => (
                    <div
                      key={v.key}
                      className="import-review"
                      ref={(el) => {
                        if (el) ficheRefs.current.set(v.key, el);
                        else ficheRefs.current.delete(v.key);
                      }}
                    >
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
                          onCancel={() => closeFiche(v.key)}
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

/** Where the form's photos stand after an import: counting, then one sentence and the failures. */
function PhotoSyncNotice({
  state,
  onClose,
}: {
  state: { running: true; done: number; total: number } | { running: false; report: PhotoSyncReport; names: Map<string, string> };
  onClose(): void;
}) {
  if (state.running) {
    return (
      <p className="alert is-ok import-notice" role="status">
        Photos du formulaire: {state.done} / {state.total} récupérées…
      </p>
    );
  }
  const { report, names } = state;
  const parts = [
    report.fetched > 0 ? `${report.fetched} récupérée(s)` : '',
    report.kept > 0 ? `${report.kept} déjà là` : '',
    report.failed.length > 0 ? `${report.failed.length} en échec` : '',
  ].filter(Boolean);
  const bad = report.unavailable !== null || report.failed.length > 0;
  return (
    <div className={`alert is-${bad ? 'bad' : 'ok'} import-notice`} role="status">
      Photos du formulaire: {parts.length > 0 ? parts.join(', ') : 'aucune à récupérer'}.
      {report.unavailable && <> Récupération interrompue: {report.unavailable}</>}{' '}
      <button type="button" className="btn is-small" onClick={onClose}>
        OK
      </button>
      {report.failed.length > 0 && (
        <ul>
          {report.failed.map((f) => (
            <li key={f.volunteerKey}>
              {names.get(f.volunteerKey) ?? f.volunteerKey}: {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
