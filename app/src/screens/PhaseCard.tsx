/**
 * Réglages for one phase: the montage, or the démontage.
 *
 * Two cards of the same component, because the two phases are the same object seen from either
 * side of the event. What differs is written down rather than duplicated: the montage asks
 * "à partir de quel jour les bénévoles peuvent venir", the démontage asks "jusqu'à quel jour",
 * and only the démontage offers to copy the montage's poles.
 *
 * ONE EDGE OF EACH PHASE IS THE EVENT'S, since 2026-09-13, and it is shown rather than asked:
 * the montage ends the moment the event starts, the démontage starts the moment it ends. So the
 * montage card asks for a start and states its end, the démontage card states its start and
 * asks for an end, and the bénévole window has one edge to set on each, the other being the
 * phase's own. `alignPhase` in the engine is what keeps the stored fields true to this.
 *
 * A PHASE IS OFF UNTIL IT IS CONFIGURED. Turning it off hides it from the grid and keeps every
 * row it holds, so a régisseur who turns it on again finds their poles, their événements and
 * their placements exactly where they left them.
 *
 * Nothing here deletes quietly. Removing a pole says how many placements go with it, removing an
 * événement does the same, and shortening the phase deletes nothing at all: what falls past the
 * end stays and is reported.
 */

import { useState } from 'react';

import {
  fmtHours,
  phaseDayParts,
  phaseDays,
  toLabel,
  type Phase,
  type PhaseId,
  type PhasePole,
} from '../engine.ts';
import {
  addPhaseEvent,
  addPhasePole,
  copyMontagePoles,
  deletePhaseEvent,
  deletePhasePole,
  movePhasePole,
  phaseEventRemoval,
  phasePoleRemoval,
  setPhase,
  setPhaseEnabled,
  setPhaseEvent,
  setPhasePole,
} from '../store/phaseEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { ClockField, TimeOfDayField } from '../components/ClockField.tsx';
import { isColour } from '../components/poleColours.ts';
import type { ClockTime } from '../components/clock.ts';
import { SetupSection } from './SetupSection.tsx';

const pad = (n: number): string => String(n).padStart(2, '0');

const toLocalDate = (iso: string): string => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? ''
    : `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
};

const toLocalClock = (iso: string): ClockTime => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? { hour: 0, minute: 0 }
    : { hour: when.getHours(), minute: when.getMinutes() };
};

/** A clock hour held as a decimal (8.5) shown as a time of day, and back. */
const asClock = (hour: number): ClockTime => ({
  hour: Math.floor(hour),
  minute: Math.round((hour - Math.floor(hour)) * 60),
});
const asHour = (clock: ClockTime): number => clock.hour + clock.minute / 60;

/** The instant an hour of the phase falls on, as ISO, for `readable` below. */
const atPhaseHour = (phase: Phase, hours: number): string =>
  new Date(new Date(phase.startISO).getTime() + hours * 3600_000).toISOString();

const readable = (iso: string): string => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? '?'
    : when.toLocaleString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      });
};

export function PhaseCard({ id }: { id: PhaseId }) {
  const { plan, edit } = useLoadedPlan();
  const phase = id === 'montage' ? plan.montage : plan.demontage;
  const [newPole, setNewPole] = useState('');
  const [newEvent, setNewEvent] = useState('');

  const days = phaseDays(phase);
  const parts = phaseDayParts(phase);
  const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
  const endISO = new Date(new Date(phase.startISO).getTime() + phase.lengthHours * 3600_000)
    .toISOString();

  const change = (over: Partial<Phase>, what: string) =>
    edit((p) => setPhase(p, id, over), `${label.toLowerCase()}: ${what}`);

  return (
    <SetupSection
      className="setup-phase"
      title={label}
      meta={
        phase.enabled
          ? `${days.length} jour${days.length > 1 ? 's' : ''}, ${phase.poles.length} pôle${phase.poles.length > 1 ? 's' : ''}, ${phase.events.length} événement${phase.events.length > 1 ? 's' : ''}`
          : 'désactivé'
      }
      /* On the head rather than inside the fold: turning a phase on is the one decision worth
         taking without opening anything, and it is what the meta beside it reports. */
      actions={
        <div className="setup-group-actions">
          <label className="setup-toggle">
            <input
              type="checkbox"
              checked={phase.enabled}
              onChange={(event) =>
                edit(
                  (p) => setPhaseEnabled(p, id, event.target.checked),
                  `${label.toLowerCase()} ${event.target.checked ? 'activé' : 'désactivé'}`,
                )
              }
            />
            <span>Activer</span>
          </label>
        </div>
      }
    >

      {!phase.enabled && (
        <p className="panel-sub">
          Activez cette phase pour lui donner des dates, des pôles et des événements. Tant qu'elle
          est désactivée, elle n'apparaît nulle part et rien de ce qu'elle contient n'est perdu.
        </p>
      )}

      {phase.enabled && (
        <>
          <div className="rules-grid">
            {id === 'montage' ? (
              <label className="rule">
                <span className="rule-label">Début</span>
                <span className="rule-input">
                  <input
                    className="select"
                    type="date"
                    aria-label={`Date de début du ${label.toLowerCase()}`}
                    value={toLocalDate(phase.startISO)}
                    onChange={(event) => {
                      if (event.target.value === '') return;
                      const clock = toLocalClock(phase.startISO);
                      change(
                        { startISO: `${event.target.value}T${pad(clock.hour)}:${pad(clock.minute)}` },
                        'date de début',
                      );
                    }}
                  />
                  <TimeOfDayField
                    value={toLocalClock(phase.startISO)}
                    ariaLabel={`Heure de début du ${label.toLowerCase()}`}
                    onChange={(clock) => {
                      const date = toLocalDate(phase.startISO);
                      if (date === '') return;
                      change(
                        { startISO: `${date}T${pad(clock.hour)}:${pad(clock.minute)}` },
                        'heure de début',
                      );
                    }}
                  />
                </span>
                <span className="rule-hint">
                  Les heures de cette phase se comptent à partir d'ici, pas à partir de
                  l'événement. Déplacer le début fait glisser toute la phase.
                </span>
              </label>
            ) : (
              <div className="rule">
                <span className="rule-label">Début</span>
                <span className="rule-input">{readable(phase.startISO)}</span>
                <span className="rule-hint">
                  Le démontage commence toujours à la fin de l'événement. Pour le déplacer,
                  changez la durée de l'événement dans la carte du haut.
                </span>
              </div>
            )}

            {id === 'montage' ? (
              <div className="rule">
                <span className="rule-label">Fin</span>
                <span className="rule-input">{readable(endISO)}</span>
                <span className="rule-hint">
                  Le montage se termine toujours au début de l'événement, soit{' '}
                  {fmtHours(phase.lengthHours)} au total. Pour le déplacer, changez le début de
                  l'événement dans la carte du haut.
                </span>
              </div>
            ) : (
              <label className="rule">
                <span className="rule-label">Fin</span>
                <span className="rule-input">
                  <input
                    className="select"
                    type="date"
                    aria-label={`Date de fin du ${label.toLowerCase()}`}
                    value={toLocalDate(endISO)}
                    onChange={(event) => {
                      if (event.target.value === '') return;
                      const clock = toLocalClock(endISO);
                      const end = new Date(
                        `${event.target.value}T${pad(clock.hour)}:${pad(clock.minute)}`,
                      ).getTime();
                      const hours = (end - new Date(phase.startISO).getTime()) / 3600_000;
                      if (hours > 0) change({ lengthHours: hours }, 'date de fin');
                    }}
                  />
                  <TimeOfDayField
                    value={toLocalClock(endISO)}
                    ariaLabel={`Heure de fin du ${label.toLowerCase()}`}
                    onChange={(clock) => {
                      const date = toLocalDate(endISO);
                      if (date === '') return;
                      const end = new Date(
                        `${date}T${pad(clock.hour)}:${pad(clock.minute)}`,
                      ).getTime();
                      const hours = (end - new Date(phase.startISO).getTime()) / 3600_000;
                      if (hours > 0) change({ lengthHours: hours }, 'heure de fin');
                    }}
                  />
                </span>
                <span className="rule-hint">
                  {readable(phase.startISO)} → {readable(endISO)}, soit{' '}
                  {fmtHours(phase.lengthHours)} au total. Raccourcir ne supprime rien.
                </span>
              </label>
            )}

            <label className="rule">
              <span className="rule-label">Heures non travaillées</span>
              <span className="rule-input">
                <TimeOfDayField
                  value={asClock(phase.offStartHour)}
                  ariaLabel="Début des heures non travaillées"
                  onChange={(clock) => change({ offStartHour: asHour(clock) }, 'nuit')}
                />
                <span className="rule-suffix">à</span>
                <TimeOfDayField
                  value={asClock(phase.offEndHour)}
                  ariaLabel="Fin des heures non travaillées"
                  onChange={(clock) => change({ offEndHour: asHour(clock) }, 'nuit')}
                />
              </span>
              <span className="rule-hint">
                Ces heures-là sont retirées de la grille tous les jours. Deux heures identiques
                veulent dire qu'on travaille jour et nuit.
              </span>
            </label>

            <label className="rule">
              <span className="rule-label">Coupure midi</span>
              <span className="rule-input">
                <TimeOfDayField
                  value={asClock(phase.dayPartSplitHour)}
                  ariaLabel="Heure de coupure entre matin et après-midi"
                  onChange={(clock) =>
                    change({ dayPartSplitHour: asHour(clock) }, 'coupure matin / après-midi')
                  }
                />
              </span>
              <span className="rule-hint">
                Où la journée se coupe en matin et après-midi. C'est la case que crée un clic sur
                la grille, jamais une règle: un bord se rattrape ensuite.
              </span>
            </label>
          </div>

          <div className="setup-lineup">
            <span className="panel-section-title">Bénévoles</span>
            <p className="panel-sub">
              Les orgas sont là dès qu'ils l'ont dit. Les bénévoles, eux, ne viennent que sur les
              jours ouverts ici, et celui qui a répondu « oui » sans donner d'horaire est placé
              sur toute cette fenêtre.
            </p>

            <label className="setup-toggle">
              <input
                type="checkbox"
                checked={phase.volunteersAllowed}
                onChange={(event) =>
                  change(
                    { volunteersAllowed: event.target.checked },
                    event.target.checked ? 'ouvert aux bénévoles' : 'fermé aux bénévoles',
                  )
                }
              />
              <span>Des bénévoles peuvent venir</span>
            </label>

            {phase.volunteersAllowed && (
              <div className="rules-grid">
                {/*
                  ONE EDGE TO SET, since 2026-09-13. Bénévoles can always stay to the end of a
                  montage and always come from the start of a démontage, so the montage asks
                  from which day and the démontage until which day, and the other edge is the
                  phase's own. `alignPhase` pins it.
                */}
                <label className="rule">
                  <span className="rule-label">{id === 'montage' ? 'À partir du' : "Jusqu'au"}</span>
                  {id === 'montage' ? (
                    <select
                      className="select"
                      value={String(phase.volunteersFrom)}
                      onChange={(event) =>
                        change({ volunteersFrom: Number(event.target.value) }, 'ouverture bénévoles')
                      }
                    >
                      {days.map((day) => (
                        <option key={day.index} value={String(day.segments[0]!.start)}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="select"
                      value={String(phase.volunteersUntil)}
                      onChange={(event) =>
                        change({ volunteersUntil: Number(event.target.value) }, 'fin bénévoles')
                      }
                    >
                      {days.map((day) => (
                        <option
                          key={day.index}
                          value={String(day.segments[day.segments.length - 1]!.end)}
                        >
                          {day.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {/*
                    THE RESULTING WINDOW, SPELLED OUT, since 2026-09-13. A day picker does not
                    tell anybody what it adds up to, and the régisseur spent an afternoon on it:
                    "j'ai indiqué certains bénévoles comme disponibles au montage, je ne comprends
                    pas pourquoi ils sont mis du jeudi 9h au vendredi 12h seulement". That is this
                    window. A bénévole who answers "oui" without giving an hour is held to it and
                    to nothing else, so it is the number to read before going to look at anybody's
                    form.
                  */}
                  <span className="rule-hint">
                    Du {readable(atPhaseHour(phase, phase.volunteersFrom))} au{' '}
                    {readable(atPhaseHour(phase, phase.volunteersUntil))}
                    {id === 'montage'
                      ? ", jusqu'à la fin du montage."
                      : ', dès le début du démontage.'}{' '}
                    Un bénévole qui a répondu « oui » sans donner d'horaire est placé sur toute
                    cette fenêtre, et une case tirée au-delà passe en rouge.
                  </span>
                </label>
              </div>
            )}
          </div>

          <div className="setup-lineup">
            <span className="panel-section-title">Pôles ({phase.poles.length})</span>
            <p className="panel-sub">
              Ceux du montage n'ont rien à voir avec ceux de l'exploit. « Général » ne se supprime
              pas: c'est là que se retrouve toute personne présente pour qui rien n'a été décidé.
            </p>

            {phase.poles.map((pole, position) => (
              <PhasePoleRow
                key={pole.key}
                id={id}
                pole={pole}
                first={position === 0}
                second={position === 1}
                last={position === phase.poles.length - 1}
              />
            ))}

            <span className="setup-confirm">
              <input
                className="select"
                placeholder="Nom d'un pôle"
                autoComplete="off"
                value={newPole}
                onChange={(event) => setNewPole(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || newPole.trim() === '') return;
                  edit((p) => addPhasePole(p, id, newPole), `pôle ${newPole.trim()}`);
                  setNewPole('');
                }}
              />
              <button
                className="btn"
                disabled={newPole.trim() === ''}
                onClick={() => {
                  edit((p) => addPhasePole(p, id, newPole), `pôle ${newPole.trim()}`);
                  setNewPole('');
                }}
              >
                Ajouter un pôle
              </button>

              {id === 'demontage' && (
                <button
                  className="btn"
                  title="Ajoute les pôles du montage qui manquent ici, sans toucher aux autres"
                  onClick={() => edit((p) => copyMontagePoles(p), 'pôles repris du montage')}
                >
                  Reprendre les pôles du montage
                </button>
              )}
            </span>
          </div>

          <div className="setup-lineup">
            <span className="panel-section-title">Événements ({phase.events.length})</span>
            <p className="panel-sub">
              Un déchargement de camion, un montage de bar: une tranche horaire précise et un
              nombre de personnes, prises dans n'importe quel pôle. C'est la seule chose ici qui
              puisse manquer de monde, et elle le dit.
            </p>

            {[...phase.events]
              .sort((a, b) => a.start - b.start)
              .map((event) => (
                <div key={event.key} className="setup-organiser">
                  <input
                    className="setup-name"
                    autoComplete="off"
                    value={event.label}
                    aria-label={`Nom de l'événement ${event.label}`}
                    onChange={(change2) =>
                      edit(
                        (p) => setPhaseEvent(p, id, event.key, { label: change2.target.value }),
                        `événement ${event.label}`,
                      )
                    }
                  />
                  <ClockField
                    value={event.start}
                    startISO={phase.startISO}
                    maxHours={phase.lengthHours}
                    ariaLabel={`Début de ${event.label}`}
                    narrow
                    onChange={(value) => {
                      if (value === null) return;
                      edit(
                        (p) =>
                          setPhaseEvent(p, id, event.key, {
                            start: value,
                            end: value + (event.end - event.start),
                          }),
                        `événement ${event.label}`,
                      );
                    }}
                  />
                  <ClockField
                    value={event.end}
                    startISO={phase.startISO}
                    maxHours={phase.lengthHours}
                    ariaLabel={`Fin de ${event.label}`}
                    narrow
                    onChange={(value) => {
                      if (value === null || value <= event.start) return;
                      edit(
                        (p) => setPhaseEvent(p, id, event.key, { end: value }),
                        `événement ${event.label}`,
                      );
                    }}
                  />
                  <span className="rule-input">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={event.headcount}
                      aria-label={`Nombre de personnes pour ${event.label}`}
                      onChange={(change2) => {
                        const value = Number(change2.target.value);
                        if (!Number.isFinite(value)) return;
                        edit(
                          (p) => setPhaseEvent(p, id, event.key, { headcount: value }),
                          `effectif de ${event.label}`,
                        );
                      }}
                    />
                    <span className="rule-suffix">pers.</span>
                  </span>
                  <button
                    className="btn is-icon is-danger"
                    title={
                      phaseEventRemoval(plan, id, event.key) === 0
                        ? 'Supprimer cet événement'
                        : `Supprimer: ${phaseEventRemoval(plan, id, event.key)} affectation(s) partiraient avec`
                    }
                    onClick={() =>
                      edit((p) => deletePhaseEvent(p, id, event.key), `événement ${event.label} supprimé`)
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}

            <span className="setup-confirm">
              <input
                className="select"
                placeholder="Déchargement du camion"
                autoComplete="off"
                value={newEvent}
                onChange={(event) => setNewEvent(event.target.value)}
              />
              <button
                className="btn"
                disabled={newEvent.trim() === '' || parts.length === 0}
                onClick={() => {
                  // Two hours at the start of the first half-day: a shape to drag, not a guess
                  // at what the régisseur meant.
                  const first = parts[0]!;
                  edit(
                    (p) =>
                      addPhaseEvent(
                        p,
                        id,
                        newEvent,
                        first.start,
                        Math.min(first.start + 2, first.end),
                        2,
                      ),
                    `événement ${newEvent.trim()}`,
                  );
                  setNewEvent('');
                }}
              >
                Ajouter un événement
              </button>
              {parts.length > 0 && (
                <span className="rule-hint">
                  Créé au début de {parts[0]!.label}, à déplacer ensuite.{' '}
                  {toLabel(phase.startISO, parts[0]!.start)}
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </SetupSection>
  );
}

function PhasePoleRow({
  id,
  pole,
  first,
  second,
  last,
}: {
  id: PhaseId;
  pole: PhasePole;
  first: boolean;
  second: boolean;
  last: boolean;
}) {
  const { plan, edit } = useLoadedPlan();
  const removal = phasePoleRemoval(plan, id, pole.key);

  return (
    <div className="setup-organiser">
      <label className="setup-colour" title={`Couleur du pôle ${pole.name}`}>
        <input
          type="color"
          value={pole.colour ?? '#8a8a8a'}
          onChange={(event) => {
            const value = event.target.value;
            if (!isColour(value)) return;
            edit((p) => setPhasePole(p, id, pole.key, { colour: value }), `couleur de ${pole.name}`);
          }}
        />
      </label>

      <input
        className="setup-name"
        autoComplete="off"
        value={pole.name}
        aria-label={`Nom du pôle ${pole.name}`}
        disabled={!removal.deletable}
        onChange={(event) =>
          edit((p) => setPhasePole(p, id, pole.key, { name: event.target.value }), `pôle ${pole.name}`)
        }
      />

      <span className="people-meta">
        {removal.placements === 0
          ? 'personne de placé'
          : `${removal.placements} affectation${removal.placements > 1 ? 's' : ''}`}
      </span>

      <div className="setup-group-actions">
        <button
          className="btn is-icon"
          // Général holds the first row and the row under it has nowhere to go: it would have to
          // displace Général, which is where everybody unplaced is drawn.
          disabled={first || second}
          title="Monter"
          onClick={() => edit((p) => movePhasePole(p, id, pole.key, -1), `ordre des pôles`)}
        >
          ▲
        </button>
        <button
          className="btn is-icon"
          disabled={last || first}
          title="Descendre"
          onClick={() => edit((p) => movePhasePole(p, id, pole.key, 1), `ordre des pôles`)}
        >
          ▼
        </button>
        {removal.deletable && (
          <button
            className="btn is-icon is-danger"
            title={
              removal.placements === 0
                ? `Supprimer ${pole.name}`
                : `Supprimer ${pole.name}: ${removal.placements} affectation(s) partiraient avec`
            }
            onClick={() => edit((p) => deletePhasePole(p, id, pole.key), `pôle ${pole.name} supprimé`)}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
