/**
 * The event's competences as toggles: who holds which, or which ones a pole asks for. One control
 * for four places (a bénévole's fiche, an orga's, a pole of the exploit, a pole of a phase), so a
 * competence looks and behaves the same wherever it is ticked.
 *
 * Nothing to show while the event names no competence: the hint says where they are declared.
 */

import type { SkillTag } from '../engine.ts';

export function SkillPicker({
  skills,
  value,
  onChange,
  readOnly = false,
  name,
  emptyHint = 'Aucune compétence déclarée pour cet événement (Réglages > Compétences).',
}: {
  skills: readonly SkillTag[];
  value: readonly string[];
  onChange(next: string[], changed: SkillTag, on: boolean): void;
  readOnly?: boolean;
  /** Prefix of each checkbox's name, unique on the page. */
  name: string;
  emptyHint?: string;
}) {
  if (skills.length === 0) return <p className="people-meta">{emptyHint}</p>;
  if (readOnly) {
    const held = skills.filter((s) => value.includes(s.key));
    return (
      <p>
        {held.length === 0 ? <span className="people-meta">Aucune.</span> : held.map((s) => <span key={s.key} className="chip">{s.label}</span>)}
      </p>
    );
  }
  return (
    <span className="skill-picker">
      {skills.map((skill) => {
        const on = value.includes(skill.key);
        return (
          <label key={skill.key} className={`chip skill-toggle${on ? ' is-ok' : ''}`}>
            <input
              type="checkbox"
              name={`${name}-${skill.key}`}
              checked={on}
              onChange={() =>
                onChange(on ? value.filter((k) => k !== skill.key) : [...value, skill.key], skill, !on)
              }
            />
            {skill.label}
          </label>
        );
      })}
    </span>
  );
}
