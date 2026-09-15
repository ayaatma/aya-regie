/**
 * What is still missing, and why.
 *
 * The "why" is the whole value of this screen, and it is not written here: `GapDiagnosis.raison`
 * is one ready-made French sentence per gap, built by the engine, which already tells apart
 * "nobody is free at that hour" from "this pole is shunned" from "everybody is already full",
 * and leads with the reserve whenever somebody on it could take the shift. Those three cases
 * call for three different actions, and a bare number of missing hours calls for none.
 *
 * No recruitment target is ever shown as a goal. This screen reports what is missing.
 */

import { useMemo, useState } from 'react';

import { fmtHours, type EventSlot, type ShiftReport } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';

/** The slot a shift belongs to, taken as the one its start falls in. */
const slotOf = (slots: readonly EventSlot[], shift: ShiftReport): EventSlot | null =>
  slots.find((s) => shift.start >= s.start && shift.start < s.end) ?? null;

type Grouping = 'pole' | 'tranche';

export function RecruitmentScreen() {
  const { plan, report } = useLoadedPlan();
  const [grouping, setGrouping] = useState<Grouping>('pole');
  const [reserveOnly, setReserveOnly] = useState(false);

  const gaps = useMemo(
    () =>
      report.shifts
        .filter((s) => s.gap !== null && s.missing > 0)
        .filter((s) => !reserveOnly || (s.gap?.enReserve ?? 0) > 0)
        .sort((a, b) => b.missing * (b.end - b.start) - a.missing * (a.end - a.start)),
    [report.shifts, reserveOnly],
  );

  const groups = useMemo(() => {
    const byKey = new Map<string, { title: string; hours: number; shifts: ShiftReport[] }>();
    for (const shift of gaps) {
      const slot = slotOf(plan.slots, shift);
      const key = grouping === 'pole' ? shift.polePath : (slot?.id ?? 'hors-tranche');
      const title =
        grouping === 'pole' ? shift.polePath : (slot?.label ?? 'Hors des tranches déclarées');
      const entry = byKey.get(key) ?? { title, hours: 0, shifts: [] };
      entry.hours += shift.missing * (shift.end - shift.start);
      entry.shifts.push(shift);
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => b.hours - a.hours);
  }, [gaps, grouping, plan.slots]);

  const totalGap = report.summary.gapHours;
  const callable = gaps.filter((s) => (s.gap?.enReserve ?? 0) > 0).length;

  if (totalGap === 0) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Rien ne manque</h1>
          <p>Tous les créneaux sont pourvus au nombre de personnes demandé.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>{fmtHours(totalGap)} à pourvoir</strong>
          <span className="toolbar-note">
            sur {gaps.length} créneaux
            {callable > 0 &&
              `, dont ${callable} qu'une personne en liste d'attente pourrait prendre dès maintenant`}
          </span>
          <div className="toolbar-sep" />
          <label className="checkline">
            Regrouper par
            <select
              className="select"
              value={grouping}
              onChange={(event) => setGrouping(event.target.value as Grouping)}
            >
              <option value="pole">pôle</option>
              <option value="tranche">tranche horaire</option>
            </select>
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={reserveOnly}
              onChange={(event) => setReserveOnly(event.target.checked)}
            />
            Seulement ce que la liste d'attente peut couvrir
          </label>
        </div>

        <div className="gap-list">
          {groups.map((group) => (
            <section key={group.title} className="gap-group">
              <h2>
                {group.title}
                <span className="gap-group-hours">{fmtHours(group.hours)}</span>
              </h2>
              {group.shifts.map((shift) => {
                const gap = shift.gap;
                if (!gap) return null;
                return (
                  <div key={shift.key} className="gap-row">
                    <div className="gap-when">
                      <strong>{shift.label}</strong>
                      <span className="people-meta">
                        {grouping === 'pole'
                          ? (slotOf(plan.slots, shift)?.label ?? 'hors tranche')
                          : shift.polePath}
                      </span>
                    </div>
                    <div className="gap-count">
                      <strong>{shift.missing}</strong>
                      <span className="people-meta">
                        manquant{shift.missing > 1 ? 's' : ''} sur {shift.headcount}
                      </span>
                    </div>
                    <div className="gap-why">
                      <p>{gap.raison}</p>
                      <span className={`chip ${gap.disponibles > 0 ? 'is-ok' : 'is-bad'}`}>
                        {gap.disponibles} disponible{gap.disponibles > 1 ? 's' : ''}
                      </span>
                      {gap.enReserve > 0 && (
                        <span className="chip is-ok">{gap.enReserve} en liste d'attente</span>
                      )}
                      {gap.enRenfort > 0 && (
                        <span className="chip is-ok">{gap.enRenfort} en renfort possible</span>
                      )}
                      {gap.satures > 0 && <span className="chip">{gap.satures} déjà pleins</span>}
                      {gap.refusentLePole > 0 && (
                        <span className="chip">{gap.refusentLePole} refusent le pôle</span>
                      )}
                      {gap.indisponibles > 0 && (
                        <span className="chip">{gap.indisponibles} indisponibles</span>
                      )}
                      {gap.artisteEnJeu > 0 && (
                        <span className="chip is-bad">
                          {gap.artisteEnJeu} manqueraient un set demandé
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
