/**
 * La correspondance du formulaire: which column answers what, and what each closed answer means.
 *
 * Shown on the import screen as soon as a file is read, above what the import would change,
 * because that is where a wrong binding shows: a volume column bound to a quiz question makes a
 * hundred lines "illisibles" below, and the fix is here. See `form-mapping.ts` in the engine.
 *
 * EVERY SELECT STARTS ON « AUTOMATIQUE », and says what the automatic reading found. Choosing
 * anything else is a decision, stored on the event with the import it was made for; choosing
 * « Automatique » again forgets it. The Loto Tekno's form needs no decision at all: the detection
 * was written for it, and this card is what another event's form needs instead of a developer.
 *
 * A CHANGE RE-READS THE FILE, so the import below always shows the file read the way this card
 * says. Corrections made to individual fiches are replayed on the new reading since 2026-10-22
 * (`importSession.ts`), so settling an answer here no longer costs the fiches already corrected.
 */

import { useMemo } from 'react';

import {
  MAPPED_FIELDS,
  MAPPED_FIELD_LABEL,
  bindForm,
  type AnswerKind,
  type ChoiceColumns,
  type FormMapping,
  type FormSurvey,
  type MappedField,
  type Plan,
  type SkillLevel,
  type SurveyAnswer,
} from '../engine.ts';
import { levelLabel, volumeText } from '../components/layout.ts';
import { SetupSection } from './SetupSection.tsx';

const AUTO = '__auto__';
const NONE = '__none__';

const shorten = (text: string, max = 70): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function FormMappingCard({
  plan,
  survey,
  mapping,
  onChange,
}: {
  plan: Plan;
  survey: FormSurvey;
  mapping: FormMapping;
  onChange(next: FormMapping): void;
}) {
  const detected = useMemo(() => bindForm(survey.headers), [survey.headers]);
  const header = (index: number | null | undefined): string | null =>
    index === null || index === undefined ? null : (survey.headers[index] ?? null);
  const decisions =
    Object.keys(mapping.columns).length +
    (mapping.choices === undefined ? 0 : 1) +
    Object.values(mapping.answers).reduce((n, map) => n + Object.keys(map ?? {}).length, 0);

  const setColumn = (field: MappedField, value: string): void => {
    const columns = { ...mapping.columns };
    if (value === AUTO) delete columns[field];
    else columns[field] = value === NONE ? '' : value;
    onChange({ ...mapping, columns });
  };

  const setChoices = (choices: ChoiceColumns[] | undefined): void => {
    const next: FormMapping = { columns: mapping.columns, answers: mapping.answers };
    if (choices !== undefined) next.choices = choices;
    onChange(next);
  };

  const setAnswer = (kind: AnswerKind, key: string, value: unknown): void => {
    const current = { ...((mapping.answers[kind] as Record<string, unknown> | undefined) ?? {}) };
    if (value === undefined) delete current[key];
    else current[key] = value;
    const answers = { ...mapping.answers, [kind]: current };
    if (Object.keys(current).length === 0) delete answers[kind];
    onChange({ ...mapping, answers });
  };

  const detectedChoices: ChoiceColumns[] = detected.choices.map((c) => ({
    pole: survey.headers[c.pole] ?? '',
    level: c.level === null ? null : (survey.headers[c.level] ?? null),
  }));

  return (
    <SetupSection
      className="import-mapping"
      title="Correspondance du formulaire"
      meta={`${survey.headers.length} colonnes, ${survey.rows} réponses · ${decisions === 0 ? 'tout est détecté automatiquement' : `${decisions} décision(s) retenue(s)`}`}
      defaultOpen={survey.binding.stale.length > 0}
    >
      <p className="people-meta setup-orgas-note">
        Chaque champ de l'outil lit une colonne du fichier, et chaque réponse d'une question
        fermée est reliée à une valeur. « Automatique » garde la détection de l'outil. Ce qui est
        choisi ici est retenu avec l'import, pour les prochains exports du même formulaire.
        Changer une correspondance relit le fichier, et les corrections déjà faites sur les
        fiches ci-dessous sont gardées.
      </p>

      <div className="mapping-group">
        <span className="panel-section-title">Colonnes</span>
        {MAPPED_FIELDS.map((field) => {
          const decided = mapping.columns[field];
          const bound = header(survey.binding.map[field]);
          const auto = header(detected.map[field]);
          const samples = survey.binding.map[field] === undefined ? [] : survey.samples[survey.binding.map[field]!] ?? [];
          return (
            <div key={field} className={`mapping-row${decided !== undefined ? ' is-changed' : ''}`}>
              <span className="rule-label">{MAPPED_FIELD_LABEL[field]}</span>
              <select
                className="select"
                aria-label={`Colonne du champ ${MAPPED_FIELD_LABEL[field]}`}
                value={decided === undefined ? AUTO : decided === '' ? NONE : decided}
                onChange={(event) => setColumn(field, event.target.value)}
              >
                <option value={AUTO}>Automatique: {auto ? `« ${shorten(auto, 50)} »` : 'rien trouvé'}</option>
                <option value={NONE}>Pas dans ce formulaire</option>
                {survey.headers.map((h, i) => (
                  <option key={i} value={h}>
                    {i + 1}. {shorten(h)}
                  </option>
                ))}
              </select>
              <span className="rule-hint">
                {bound === null ? 'Aucune colonne lue.' : samples.length === 0 ? 'Colonne vide.' : samples.map((s) => shorten(s, 40)).join(' · ')}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mapping-group">
        <span className="panel-section-title">Choix de pôles</span>
        {mapping.choices === undefined ? (
          <>
            <p className="panel-sub">
              {detectedChoices.length === 0
                ? 'Aucune colonne de choix détectée.'
                : `Détectés automatiquement: ${detectedChoices.map((c, i) => `${i + 1}. « ${shorten(c.pole, 40)} »${c.level ? ` (niveau « ${shorten(c.level, 30)} »)` : ''}`).join(', ')}.`}
            </p>
            <button type="button" className="btn" onClick={() => setChoices(detectedChoices)}>
              Définir les colonnes de choix à la main
            </button>
          </>
        ) : (
          <>
            <p className="panel-sub">
              Une colonne par choix, dans l'ordre de préférence. Une colonne de cases à cocher
              peut porter plusieurs pôles à elle seule.
            </p>
            {mapping.choices.map((choice, at) => (
              <div key={at} className="mapping-choice is-changed">
                <span className="choice-edit-rank">{at + 1}.</span>
                <select
                  className="select"
                  aria-label={`Colonne du choix ${at + 1}`}
                  value={choice.pole}
                  onChange={(event) =>
                    setChoices(mapping.choices!.map((c, i) => (i === at ? { ...c, pole: event.target.value } : c)))
                  }
                >
                  {!survey.headers.includes(choice.pole) && <option value={choice.pole}>{shorten(choice.pole)} (absente)</option>}
                  {survey.headers.map((h, i) => (
                    <option key={i} value={h}>{i + 1}. {shorten(h)}</option>
                  ))}
                </select>
                <select
                  className="select"
                  aria-label={`Colonne du niveau du choix ${at + 1}`}
                  value={choice.level ?? NONE}
                  onChange={(event) =>
                    setChoices(
                      mapping.choices!.map((c, i) =>
                        i === at ? { ...c, level: event.target.value === NONE ? null : event.target.value } : c,
                      ),
                    )
                  }
                >
                  <option value={NONE}>Sans question de niveau</option>
                  {survey.headers.map((h, i) => (
                    <option key={i} value={h}>{i + 1}. {shorten(h)}</option>
                  ))}
                </select>
                <button type="button" className="btn is-icon" title="Retirer" onClick={() => setChoices(mapping.choices!.filter((_, i) => i !== at))}>✕</button>
              </div>
            ))}
            <div className="setup-regen-row">
              <button
                type="button"
                className="btn"
                onClick={() => setChoices([...mapping.choices!, { pole: survey.headers[0] ?? '', level: null }])}
              >
                Ajouter une colonne de choix
              </button>
              <button type="button" className="btn" onClick={() => setChoices(undefined)}>
                Revenir à la détection automatique
              </button>
            </div>
          </>
        )}
      </div>

      {ANSWER_TABLES.map(([kind, title]) => (
        <AnswerTable
          key={kind}
          title={title}
          kind={kind}
          entries={survey.answers[kind] as SurveyAnswer<unknown>[]}
          mapping={mapping}
          options={answerOptions(plan, kind, survey)}
          onSet={setAnswer}
        />
      ))}
    </SetupSection>
  );
}

/** The answer tables, in the order the card lists them. */
const ANSWER_TABLES: ReadonlyArray<[AnswerKind, string]> = [
  ['volume', 'Réponses: volume horaire'],
  ['level', 'Réponses: niveau'],
  ['preferredSlot', 'Réponses: tranche préférée'],
  ['refusedSlots', 'Réponses: tranches refusées'],
  ['slotComfort', 'Réponses: tranche refusée ou à éviter'],
  ['pole', 'Réponses: pôles'],
];

/**
 * What an answer of each closed question may be decided to mean. Shared with the review list of
 * the import screen, which settles one answer for every fiche carrying it with the same values.
 */
export function answerOptions(plan: Plan, kind: AnswerKind, survey: FormSurvey): Array<{ value: unknown; label: string }> {
  switch (kind) {
    case 'volume':
      return [
        ...[...new Set([...plan.volume.options, ...survey.answers.volume.flatMap((a) => (typeof a.auto?.value === 'number' ? [a.auto.value] : []))])]
          .sort((a, b) => a - b)
          .map((h) => ({ value: h, label: volumeText(h, plan.volume.scope === 'day') })),
        { value: 'a-confirmer', label: 'À confirmer (aucun volume dans la réponse)' },
      ];
    case 'level':
      return (['debutant', 'intermediaire', 'expert'] as SkillLevel[]).map((l) => ({ value: l, label: levelLabel(l) }));
    case 'preferredSlot':
      return [
        { value: null, label: 'Sans préférence' },
        ...plan.preferenceSlots.map((s) => ({ value: s.id, label: `Plutôt « ${s.label} »` })),
      ];
    case 'refusedSlots':
      return [
        { value: [], label: 'Aucune tranche refusée' },
        ...plan.slots.map((s) => ({ value: [s.id], label: `Refuse « ${s.label} »` })),
      ];
    case 'slotComfort':
      return [
        { value: { refused: [], avoided: [] }, label: 'Aucune contrainte' },
        ...plan.slots.flatMap((s) => [
          { value: { refused: [s.id], avoided: [] }, label: `Refuse « ${s.label} »` },
          { value: { refused: [], avoided: [s.id] }, label: `Préfère éviter « ${s.label} »` },
        ]),
      ];
    case 'pole':
      return [
        // An answer naming no pole: every pole as a choice, nothing as a refusal.
        { value: '', label: 'Aucun pôle précis (tous acceptés)' },
        ...plan.poles.map((p) => ({ value: p.key, label: p.path })),
      ];
  }
}

function AnswerTable<V>({
  title,
  kind,
  entries,
  mapping,
  options,
  onSet,
}: {
  title: string;
  kind: AnswerKind;
  entries: SurveyAnswer<V>[];
  mapping: FormMapping;
  options: Array<{ value: V; label: string }>;
  onSet(kind: AnswerKind, key: string, value: unknown): void;
}) {
  if (entries.length === 0) return null;
  const decided = (mapping.answers[kind] as Record<string, unknown> | undefined) ?? {};
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const labelOf = (value: unknown): string => options.find((o) => same(o.value, value))?.label ?? String(value);

  return (
    <div className="mapping-group">
      <span className="panel-section-title">{title}</span>
      <div className="setup-table-wrap">
        <table className="setup-table mapping-answers">
          <tbody>
            {entries.map((entry) => {
              const has = entry.key in decided;
              const index = has ? options.findIndex((o) => same(o.value, decided[entry.key])) : -1;
              return (
                <tr key={entry.key} className={has ? 'is-changed' : ''}>
                  <td className="mapping-answer">{shorten(entry.answer, 90)}</td>
                  <td className="people-meta">{entry.count}×</td>
                  <td>
                    <select
                      className="select"
                      aria-label={`Valeur de la réponse ${shorten(entry.answer, 40)}`}
                      value={has ? String(index) : AUTO}
                      onChange={(event) =>
                        onSet(kind, entry.key, event.target.value === AUTO ? undefined : options[Number(event.target.value)]!.value)
                      }
                    >
                      <option value={AUTO}>
                        Automatique: {entry.auto === null ? 'non reconnue' : labelOf(entry.auto.value)}
                      </option>
                      {options.map((o, i) => (
                        <option key={i} value={String(i)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
