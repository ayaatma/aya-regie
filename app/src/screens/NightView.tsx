/**
 * The phone view, for the night itself.
 *
 * The grid is a desktop instrument: eighteen hours across, fifteen rows down, drag and drop.
 * None of that survives a 5-inch screen at 03h, and pretending otherwise would give the régisseur
 * a version of the tool that looks usable and is not. So the phone gets a different thing
 * entirely, answering the one question anybody asks on the night: who is on right now, and who
 * comes next.
 *
 * READ ONLY, and it says so at the top before anything else. Nothing here can move a person, and
 * that is deliberate rather than unfinished: an accidental drag at arm's length in the dark, on
 * a plan somebody else is editing on a laptop, is exactly the kind of silent change this tool
 * must never make.
 *
 * The hour is the only control. It starts at the real time when the event is running and at the
 * start otherwise, and it steps by half hours, so the same screen works the night before as a
 * rehearsal and at 04h as a lifeline.
 */

import { useEffect, useMemo, useState } from 'react';

import { fmtHours, toClock, type Shift } from '../engine.ts';
import { poleColours } from '../components/poleColours.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from '../components/labels.ts';

/** Where the event's clock stands right now, or null when it is not running. */
function hoursIntoEvent(startISO: string, lengthHours: number): number | null {
  const start = new Date(startISO).getTime();
  if (Number.isNaN(start)) return null;
  const hours = (Date.now() - start) / 3600_000;
  return hours >= 0 && hours <= lengthHours ? hours : null;
}

const covers = (shift: Shift, at: number): boolean => shift.start <= at && at < shift.end;

export function NightView({ onLeave }: { onLeave(): void }) {
  const { plan, index, report } = useLoadedPlan();

  const live = hoursIntoEvent(plan.startISO, plan.lengthHours);
  const [at, setAt] = useState<number>(live ?? 0);
  const [showAll, setShowAll] = useState(false);

  // While the event is running the hour follows the clock on its own, until somebody scrolls it
  // themselves. Standing on a stale hour at 03h is the one failure this screen cannot afford.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    const tick = () => {
      const now = hoursIntoEvent(plan.startISO, plan.lengthHours);
      if (now !== null) setAt(now);
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [pinned, plan.startISO, plan.lengthHours]);

  const colours = useMemo(() => poleColours(plan.poles), [plan.poles]);
  const shiftReports = useMemo(() => new Map(report.shifts.map((s) => [s.key, s])), [report.shifts]);

  const groups = useMemo(
    () =>
      plan.poles
        .filter((p) => p.parentKey === null)
        .map((root) => ({
          root,
          colour: colours.get(root.key) ?? 'var(--line-strong)',
          organisers: index.leadersOn(root.key),
          lanes: plan.poles
            .filter((p) => index.isLeaf(p.key) && index.isUnder(p.key, root.key))
            .map((pole) => ({
              pole,
              shifts: plan.shifts
                .filter((s) => s.poleKey === pole.key)
                .sort((a, b) => a.start - b.start),
            })),
        })),
    [plan.poles, plan.shifts, index, colours],
  );

  const step = (by: number) => {
    setPinned(true);
    setAt((current) => Math.min(plan.lengthHours, Math.max(0, current + by)));
  };

  return (
    <div className="night">
      {/*
        The first thing on the screen, before the event's own name. Somebody handed this link at
        23h has to know in one glance that what they are looking at cannot be changed here.
      */}
      <div className="night-banner">
        <strong>Lecture seule</strong>
        <span>
          Cette page sert à consulter le planning pendant la soirée. Aucune modification n'est
          possible ici: l'édition se fait sur un ordinateur.
        </span>
      </div>

      <header className="night-head">
        <h1>{plan.name}</h1>
        <div className="night-clock">
          <button className="btn is-icon" onClick={() => step(-0.5)} aria-label="Une demi-heure plus tôt">
            ‹
          </button>
          <span className="night-hour">{toClock(plan.startISO, at)}</span>
          <button className="btn is-icon" onClick={() => step(0.5)} aria-label="Une demi-heure plus tard">
            ›
          </button>
          {live !== null && pinned && (
            <button
              className="btn"
              onClick={() => {
                setPinned(false);
                setAt(live);
              }}
            >
              Maintenant
            </button>
          )}
          {live === null && <span className="night-note">L'événement n'est pas en cours.</span>}
        </div>

        <label className="checkline">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Voir toute la soirée
        </label>
      </header>

      <div className="night-body">
        {groups.map((group) => (
          <section
            key={group.root.key}
            className="night-pole"
            style={{ '--pole': group.colour } as React.CSSProperties}
          >
            <h2>{group.root.name}</h2>

            {group.organisers.length > 0 && (
              <p className="night-organisers">
                {group.organisers.map(({ organiser, role }) => {
                  const onDuty =
                    role.start !== null && role.end !== null
                      ? role.start <= at && at < role.end
                      : null;
                  const name = organiserName(organiser);
                  return (
                    // Keyed on the role: one person can hold two windows on the same pole, and
                    // at 3 a.m. both of them are worth showing.
                    <span key={role.key} className={`night-organiser ${onDuty === false ? 'is-off' : ''}`}>
                      {organiser.phone.trim() === '' ? (
                        name
                      ) : (
                        <a href={`tel:${organiser.phone.replace(/\s+/g, '')}`}>{name}</a>
                      )}
                      {role.start !== null && role.end !== null && role.end > role.start
                        ? ` ${toClock(plan.startISO, role.start)} à ${toClock(plan.startISO, role.end)}`
                        : ''}
                    </span>
                  );
                })}
              </p>
            )}

            {group.lanes.map((lane) => {
              const shifts = showAll ? lane.shifts : lane.shifts.filter((s) => covers(s, at));
              if (shifts.length === 0) {
                return (
                  <div key={lane.pole.key} className="night-lane">
                    <h3>{lane.pole.name}</h3>
                    <p className="night-empty">Personne n'est prévu à cette heure.</p>
                  </div>
                );
              }
              return (
                <div key={lane.pole.key} className="night-lane">
                  <h3>{lane.pole.name}</h3>
                  {shifts.map((shift) => {
                    const shiftReport = shiftReports.get(shift.key);
                    const missing = shiftReport?.missing ?? 0;
                    return (
                      <div
                        key={shift.key}
                        className={`night-shift ${covers(shift, at) ? 'is-now' : ''}`}
                      >
                        <div className="night-shift-head">
                          <span className="night-when">
                            {toClock(plan.startISO, shift.start)} à {toClock(plan.startISO, shift.end)}
                          </span>
                          <span className={`night-count ${missing > 0 ? 'is-gap' : ''}`}>
                            {shiftReport?.assigned ?? 0}/{shift.headcount}
                            {missing > 0 ? ` · manque ${missing}` : ''}
                          </span>
                        </div>
                        <div className="night-people">
                          {(shiftReport?.stars ?? []).length === 0 ? (
                            <span className="night-empty">personne</span>
                          ) : (
                            (shiftReport?.stars ?? []).map((entry) => (
                              <span key={entry.volunteerKey} className="night-person">
                                {entry.name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        ))}

        <p className="night-foot">
          {fmtHours(report.summary.gapHours)} restent à pourvoir sur l'ensemble de la soirée.
        </p>

        {/*
          A width is a guess, not a fact. Somebody on a tablet, or holding a phone sideways next
          to a keyboard, is entitled to the real tool rather than to our reading of their screen.
        */}
        <button className="btn night-leave" onClick={onLeave}>
          Ouvrir quand même l'outil complet
        </button>
      </div>
    </div>
  );
}
