/**
 * « Disponibilités par jour » on a bénévole's fiche, 2026-09-15: for each day of the event, present
 * or not, and from which hour to which. Edits `Volunteer.unavailable` as a correction of the
 * answers (it marks the field, so a re-import keeps it). The refused tranches stay where they were,
 * in « Ne veut pas »: this is the arrival, the departure and the days off.
 *
 * Hours are typed on the clock of that day (`PlainClockField`): an event day may cross midnight,
 * so « 02h00 » on the Saturday of an event that runs to 06h is the Sunday morning, and the
 * conversion below puts it there.
 */

import { dayAvailability, fmtHours, windowHours, withDayAvailability, type Volunteer, type Window } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { correctVolunteer } from '../store/edits.ts';
import { PlainClockField } from './ClockField.tsx';

/** The clock hour of an offset of the event, 0 to 24. */
function clockAt(startISO: string, hours: number): number {
  const at = new Date(new Date(startISO).getTime() + hours * 3600_000);
  return at.getHours() + at.getMinutes() / 60;
}

/** The offset inside `day` a clock hour means; `end` reads 24h as the day's own end. */
function offsetIn(startISO: string, day: Window, clock: number, end: boolean): number {
  const first = clockAt(startISO, day.start);
  let delta = (((clock - first) % 24) + 24) % 24;
  if (end && delta < 1e-9) delta = 24;
  return Math.min(day.end, day.start + delta);
}

export function AvailabilityDays({ volunteer, readOnly }: { volunteer: Volunteer; readOnly: boolean }) {
  const { plan, index, edit } = useLoadedPlan();
  const unavailable = volunteer.unavailable ?? [];
  const name = index.volunteerName(volunteer.key);
  if (index.days.length === 0) return null;
  const free = windowHours(index.windowsOf(volunteer.key));

  const change = (day: Window, value: { from: number; to: number } | null, what: string) =>
    edit(
      (p) => correctVolunteer(p, volunteer.key, { unavailable: withDayAvailability(unavailable, day, value) }),
      `${what} de ${name}`,
    );

  return (
    <div className="panel-section">
      <p className="panel-section-title">Disponibilités par jour</p>
      <p className="people-meta">
        {fmtHours(free)} disponibles sur l'événement, tranches refusées déduites
        {volunteer.manualFields.includes('unavailable') ? ' · corrigé à la main' : ''}.
      </p>
      {index.days.map((day, i) => {
        const state = dayAvailability(unavailable, day);
        const label = index.dayLabel(i);
        return (
          <p key={i} className="people-meta availability-day">
            <span className="availability-day-label">{label}</span>
            {readOnly ? (
              state.present ? (
                <span>
                  {fmtClockOf(plan.startISO, state.from)} à {fmtClockOf(plan.startISO, state.to)}
                </span>
              ) : (
                <span className="is-bad">absent·e</span>
              )
            ) : (
              <>
                <label className="checkline">
                  <input
                    type="checkbox"
                    name={`fiche-day-${i}`}
                    checked={state.present}
                    onChange={(event) =>
                      change(day, event.target.checked ? { from: day.start, to: day.end } : null, `présence le ${label}`)
                    }
                  />
                  présent·e
                </label>
                {state.present && (
                  <>
                    {' de '}
                    <PlainClockField
                      narrow
                      value={clockAt(plan.startISO, state.from)}
                      ariaLabel={`Arrivée le ${label}`}
                      name={`fiche-day-${i}-from`}
                      onChange={(clock) =>
                        change(day, { from: offsetIn(plan.startISO, day, clock, false), to: state.to }, `arrivée le ${label}`)
                      }
                    />
                    {' à '}
                    <PlainClockField
                      narrow
                      value={clockAt(plan.startISO, state.to)}
                      ariaLabel={`Départ le ${label}`}
                      name={`fiche-day-${i}-to`}
                      onChange={(clock) =>
                        change(day, { from: state.from, to: offsetIn(plan.startISO, day, clock, true) }, `départ le ${label}`)
                      }
                    />
                  </>
                )}
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}

function fmtClockOf(startISO: string, hours: number): string {
  const clock = clockAt(startISO, hours);
  const h = Math.floor(clock);
  return `${String(h).padStart(2, '0')}h${String(Math.round((clock - h) * 60)).padStart(2, '0')}`;
}
