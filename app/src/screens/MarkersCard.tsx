/**
 * « Repères de la timeline », since 2026-10-23: what is worth seeing above a grid and that nobody
 * is placed on. « Pause entre le loto et les concerts », « Ouverture des portes ».
 *
 * A band with a start and an end, or an instant with no end. Each one sits on one moment's clock,
 * the exploit's or a phase's, because that is the grid it is drawn above. Informative only: the
 * solver, the rules and the créneaux never read one. Drawn on the grids, on the printed planning
 * and on the personal page of the bénévoles (a phase's only for those placed on it).
 */

import { useState } from 'react';

import { fmtHours, type MarkerMoment } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { addMarker, deleteMarker, markersIn, setMarker } from '../store/markerEdits.ts';
import { ClockField } from '../components/ClockField.tsx';
import { SetupSection } from './SetupSection.tsx';

export const MARKER_MOMENT_LABEL: Record<MarkerMoment, string> = {
  exploit: "L'événement",
  montage: 'Montage',
  demontage: 'Démontage',
};

export function MarkersCard() {
  const { plan, edit } = useLoadedPlan();
  const [label, setLabel] = useState('');
  const [moment, setMoment] = useState<MarkerMoment>('exploit');
  const moments: MarkerMoment[] = [
    'exploit',
    ...(plan.montage.enabled ? (['montage'] as const) : []),
    ...(plan.demontage.enabled ? (['demontage'] as const) : []),
  ];
  const clockOf = (m: MarkerMoment): { startISO: string; hours: number } =>
    m === 'exploit'
      ? { startISO: plan.startISO, hours: plan.lengthHours }
      : { startISO: plan[m].startISO, hours: plan[m].lengthHours };
  const all = (['exploit', 'montage', 'demontage'] as const).flatMap((m) => markersIn(plan, m));

  const add = (): void => {
    if (label.trim() === '') return;
    edit((p) => addMarker(p, label, moment), `repère ${label.trim()}`);
    setLabel('');
  };

  return (
    <SetupSection title="Repères de la timeline" meta={`${all.length} repère(s)`}>
      <p className="people-meta setup-orgas-note">
        Des informations affichées au-dessus de la grille, sans personne dessus: une pause, une
        ouverture des portes. Avec une fin, c'est une plage; sans fin, un instant. Ils sont aussi
        sur le planning imprimable et sur la page personnelle des bénévoles. Ils ne changent
        aucun calcul.
      </p>

      <div className="setup-lineup">
        {all.map((marker) => {
          const clock = clockOf(marker.moment);
          return (
            <div key={marker.key} className="setup-ticket-row setup-marker-row">
              <input
                className="select"
                name={`marker-label-${marker.key}`}
                autoComplete="off"
                value={marker.label}
                aria-label="Nom du repère"
                onChange={(event) => edit((p) => setMarker(p, marker.key, { label: event.target.value }), `repère ${marker.label}`)}
              />
              <select
                className="select is-narrow"
                name={`marker-moment-${marker.key}`}
                aria-label={`Moment du repère ${marker.label}`}
                value={marker.moment}
                onChange={(event) =>
                  edit((p) => setMarker(p, marker.key, { moment: event.target.value as MarkerMoment }), `moment du repère ${marker.label}`)
                }
              >
                {(['exploit', 'montage', 'demontage'] as const)
                  .filter((m) => moments.includes(m) || m === marker.moment)
                  .map((m) => (
                    <option key={m} value={m}>
                      {MARKER_MOMENT_LABEL[m]}
                    </option>
                  ))}
              </select>
              <span className="clock-range">
                <ClockField
                  value={marker.start}
                  startISO={clock.startISO}
                  maxHours={clock.hours}
                  ariaLabel={`Début du repère ${marker.label}`}
                  name={`marker-start-${marker.key}`}
                  onChange={(value) => {
                    if (value === null) return;
                    const end = marker.end === null ? null : value + (marker.end - marker.start);
                    edit((p) => setMarker(p, marker.key, { start: value, end }), `heure du repère ${marker.label}`);
                  }}
                />
                <span className="clock-range-sep">→</span>
                <ClockField
                  value={marker.end}
                  allowEmpty
                  placeholder="instant"
                  startISO={clock.startISO}
                  maxHours={clock.hours}
                  ariaLabel={`Fin du repère ${marker.label}, vide pour un instant`}
                  name={`marker-end-${marker.key}`}
                  onChange={(value) => edit((p) => setMarker(p, marker.key, { end: value }), `heure du repère ${marker.label}`)}
                />
                <span className="rule-suffix">{marker.end === null ? 'instant' : fmtHours(marker.end - marker.start)}</span>
              </span>
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${marker.label}`}
                aria-label={`Retirer le repère ${marker.label}`}
                onClick={() => edit((p) => deleteMarker(p, marker.key), `retrait du repère ${marker.label}`)}
              >
                ✕
              </button>
            </div>
          );
        })}

        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Nom d'un repère (ex. Pause)"
            name="new-marker"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          {moments.length > 1 && (
            <select
              className="select is-narrow"
              name="new-marker-moment"
              aria-label="Moment du nouveau repère"
              value={moment}
              onChange={(event) => setMoment(event.target.value as MarkerMoment)}
            >
              {moments.map((m) => (
                <option key={m} value={m}>
                  {MARKER_MOMENT_LABEL[m]}
                </option>
              ))}
            </select>
          )}
          <button className="btn" disabled={label.trim() === ''} onClick={add}>
            Ajouter un repère
          </button>
        </span>
      </div>
    </SetupSection>
  );
}
