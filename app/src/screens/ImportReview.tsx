/**
 * « À régler »: every doubt of an import in one list, above the fiches, since 2026-10-22.
 *
 * The fiches used to be the only way in: forty people who ticked « 🛠️ VOLANTE (Bénévole
 * polyvalent) » were forty fiches to open, each saying the same thing about the same answer. So
 * the list is by DOUBT rather than by person:
 *
 *   - an answer of a closed question read with a doubt is ONE line for everybody who gave it,
 *     and deciding what it means writes the form's correspondence (`FormMapping.answers`), so the
 *     file is read again and every fiche carrying it is cleared at once, on this export and on the
 *     next ones;
 *   - any other line of a fiche (a sentence to interpret, a contradiction, a volume to confirm)
 *     is grouped with the identical lines of other fiches, and each person on it is a button that
 *     opens their fiche for correction below.
 *
 * A fiche validated or corrected leaves every line here; a line nobody is left on disappears.
 */

import { useState, type ReactNode } from 'react';

import { normalise, type AnswerDoubt, type AnswerKind, type FormSurvey, type ImportIssue, type Plan, type Volunteer } from '../engine.ts';
import { answerOptions } from './FormMappingCard.tsx';

const KIND_LABEL: Record<AnswerKind, string> = {
  pole: 'Pôle',
  volume: 'Volume horaire',
  level: 'Niveau',
  preferredSlot: 'Tranche préférée',
  refusedSlots: 'Tranches refusées',
  slotComfort: 'Tranche refusée ou à éviter',
  artist: 'Artiste à ne pas manquer',
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

interface AnswerGroup {
  id: string;
  kind: AnswerKind;
  answer: string;
  read: unknown;
  keys: string[];
}

export function ImportReview({
  plan,
  survey,
  volunteers,
  doubts,
  fileIssues,
  onDecide,
  onJump,
}: {
  plan: Plan;
  survey: FormSurvey | null;
  volunteers: readonly Volunteer[];
  doubts: readonly AnswerDoubt[];
  /** The signalements about the file rather than about anybody. */
  fileIssues: readonly ImportIssue[];
  onDecide(kind: AnswerKind, answerKey: string, value: unknown): void;
  onJump(key: string, from: HTMLElement): void;
}) {
  const open = new Map(volunteers.filter((v) => v.needsReview).map((v) => [v.key, v]));

  // The closed answers still in doubt on a fiche still to read, one group per answer.
  const groups = new Map<string, AnswerGroup>();
  const covered = new Map<string, Set<string>>();
  for (const doubt of doubts) {
    const v = open.get(doubt.key);
    if (!v || !doubt.messages.some((m) => v.reviewReasons.includes(m))) continue;
    const id = `${doubt.kind}\u0000${normalise(doubt.answer)}`;
    const group = groups.get(id) ?? { id, kind: doubt.kind, answer: doubt.answer, read: doubt.read, keys: [] };
    if (!group.keys.includes(doubt.key)) group.keys.push(doubt.key);
    groups.set(id, group);
    const lines = covered.get(doubt.key) ?? new Set<string>();
    for (const m of doubt.messages) lines.add(m);
    covered.set(doubt.key, lines);
  }

  // Every other line, the same words on several fiches being one line.
  const lines = new Map<string, string[]>();
  for (const v of open.values()) {
    for (const reason of v.reviewReasons) {
      if (covered.get(v.key)?.has(reason)) continue;
      const keys = lines.get(reason) ?? [];
      if (!keys.includes(v.key)) keys.push(v.key);
      lines.set(reason, keys);
    }
  }

  const sortedGroups = [...groups.values()].sort((a, b) => b.keys.length - a.keys.length || a.answer.localeCompare(b.answer, 'fr'));
  const sortedLines = [...lines].sort((a, b) => b[1].length - a[1].length);
  const count = fileIssues.length + sortedGroups.length + sortedLines.length;
  if (count === 0) return null;

  const nameOf = (key: string): string => {
    const v = open.get(key);
    if (!v) return key;
    return `${v.firstName} ${v.lastName}`.trim() + (v.nickname.trim() !== '' ? ` (${v.nickname.trim()})` : '');
  };
  const people = (keys: string[]) => <People keys={keys} nameOf={nameOf} onJump={onJump} />;

  return (
    <section className="setup-group import-todo">
      <div className="setup-group-head">
        <span className="setup-group-title">À régler ({count})</span>
        <span className="people-meta">
          {open.size} fiche(s) à relire
        </span>
      </div>
      <p className="panel-sub import-note">
        Rien ici n'empêche d'appliquer l'import. Ce qui n'est pas réglé maintenant reste signalé
        « À relire » sur la fiche de la personne, dans l'onglet Personnes, avec la réponse
        d'origine à côté: tout peut se régler plus tard depuis là.
      </p>

      {fileIssues.map((issue, i) => (
        <div key={`f${i}`} className="import-todo-item">
          <span className={`issue ${issue.severity === 'error' ? '' : 'is-tier2'}`}>
            {issue.message}
            {issue.suggestions && issue.suggestions.length > 0 && (
              <span className="people-meta"> Suggestions: {issue.suggestions.join(', ')}</span>
            )}
          </span>
        </div>
      ))}

      {sortedGroups.map((group) => (
        <AnswerGroupRow
          key={group.id}
          group={group}
          options={survey ? answerOptions(plan, group.kind, survey) : []}
          onDecide={onDecide}
          people={people(group.keys)}
        />
      ))}

      {sortedLines.map(([reason, keys]) => (
        <div key={reason} className="import-todo-item">
          <span className="issue is-tier2">{reason}</span>
          {people(keys)}
        </div>
      ))}
    </section>
  );
}

/** One answer, what the tool read, and the decision that settles it on every fiche at once. */
function AnswerGroupRow({
  group,
  options,
  onDecide,
  people,
}: {
  group: AnswerGroup;
  options: Array<{ value: unknown; label: string }>;
  onDecide(kind: AnswerKind, answerKey: string, value: unknown): void;
  people: ReactNode;
}) {
  const readAt = group.read === null ? -1 : options.findIndex((o) => same(o.value, group.read));
  const [chosen, setChosen] = useState(readAt);
  const n = group.keys.length;
  return (
    <div className="import-todo-item">
      <span className="issue is-tier2">
        {KIND_LABEL[group.kind]}: « {group.answer} »{' '}
        {readAt >= 0 ? `lu comme ${options[readAt]!.label}, sans certitude.` : 'non reconnu.'}
      </span>
      <span className="import-todo-decide">
        <select
          className="select"
          aria-label={`Valeur de la réponse ${group.answer}`}
          value={String(chosen)}
          onChange={(event) => setChosen(Number(event.target.value))}
        >
          <option value="-1">Choisir ce que veut dire cette réponse…</option>
          {options.map((o, i) => (
            <option key={i} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn is-primary"
          disabled={chosen < 0}
          title="Retenu dans la correspondance du formulaire: les prochains exports liront cette réponse de la même façon"
          onClick={() => onDecide(group.kind, normalise(group.answer), options[chosen]!.value)}
        >
          {n > 1 ? `Retenir pour les ${n} fiches` : 'Retenir pour cette fiche'}
        </button>
      </span>
      {people}
    </div>
  );
}

/** The people a line is about, each a way to their fiche. */
function People({
  keys,
  nameOf,
  onJump,
}: {
  keys: string[];
  nameOf(key: string): string;
  onJump(key: string, from: HTMLElement): void;
}) {
  if (keys.length === 1) {
    return (
      <span className="import-todo-people">
        {nameOf(keys[0]!)}{' '}
        <button type="button" className="btn is-small" onClick={(event) => onJump(keys[0]!, event.currentTarget)}>
          Régler directement sur la fiche
        </button>
      </span>
    );
  }
  return (
    <span className="import-todo-people">
      <span className="people-meta">Régler directement sur la fiche de:</span>
      {keys.map((key) => (
        <button key={key} type="button" className="btn is-small" onClick={(event) => onJump(key, event.currentTarget)}>
          {nameOf(key)}
        </button>
      ))}
    </span>
  );
}
