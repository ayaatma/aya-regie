/**
 * One phase's presence as a régisseur corrects it: present or not, and the days ticked.
 *
 * Shared since 2026-10-22 by the fiche (which writes at once) and « Corriger la lecture » (which
 * holds a draft until Enregistrer), so the two never disagree on what « all days ticked » means:
 * stored as `[]`, the whole bénévole opening, and none ticked as not present.
 */

import { phaseDayTicks, type Phase, type PhaseId, type PhasePresence } from '../engine.ts';

export interface PhaseDaysEditProps {
  id: PhaseId;
  phase: Phase;
  answer: PhasePresence;
  onChange(presence: Pick<PhasePresence, 'present' | 'windows'>): void;
  /** Distinguishes the inputs when the same phase is drawn twice on a page. */
  namePrefix: string;
  /** The fiche out of its mode édition: the same reading, as words. */
  readOnly?: boolean;
}

/** The phases a bénévole can be asked about: open, and open to bénévoles. */
export function volunteerPhases(plan: { montage: Phase; demontage: Phase }): PhaseId[] {
  return (['montage', 'demontage'] as const).filter((id) => {
    const phase = id === 'montage' ? plan.montage : plan.demontage;
    return phase.enabled && phase.volunteersAllowed;
  });
}

export function PhaseDaysEdit({ id, phase, answer, onChange, namePrefix, readOnly = false }: PhaseDaysEditProps) {
  const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
  // The days the bénévoles may come, ticked from the answer's windows (none = all of them).
  const opening = { start: phase.volunteersFrom, end: phase.volunteersUntil };
  const ticks = phaseDayTicks(phase, answer.windows).filter((t) =>
    t.segments.some((s) => s.end > opening.start && s.start < opening.end),
  );
  const toggleDay = (index: number) => {
    const next = ticks.map((t) => (t.index === index ? { ...t, ticked: !t.ticked } : t));
    const all = next.every((t) => t.ticked);
    const windows = all ? [] : next.filter((t) => t.ticked).flatMap((t) => t.segments);
    onChange({ present: all || windows.length > 0, windows });
  };

  if (readOnly) {
    const days = ticks.filter((t) => t.ticked);
    return (
      <>
        {label}: {!answer.present ? 'pas là' : days.length === ticks.length ? 'présent·e' : `présent·e, ${days.map((t) => t.label).join(', ')}`}
      </>
    );
  }

  return (
    <>
      {label}:{' '}
      <select
        className="select is-inline"
        value={answer.present ? 'oui' : 'non'}
        aria-label={`${label}: présence`}
        onChange={(event) =>
          onChange({
            present: event.target.value === 'oui',
            windows: event.target.value === 'oui' ? answer.windows : [],
          })
        }
      >
        <option value="non">pas là</option>
        <option value="oui">présent·e</option>
      </select>

      {answer.present && ticks.length > 0 && (
        <span className="phase-day-ticks">
          {ticks.map((t) => (
            <label key={t.index} className="checkline">
              <input
                type="checkbox"
                name={`${namePrefix}-${id}-day-${t.index}`}
                checked={t.ticked}
                onChange={() => toggleDay(t.index)}
              />
              {t.label}
            </label>
          ))}
        </span>
      )}
    </>
  );
}
