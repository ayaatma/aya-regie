/**
 * « Candidature » on a bénévole's fiche, 2026-09-15: the status, the steps ticked, the régisseur's
 * note, and the two answers that go with them (the Réserve, the stamina).
 *
 * At the top of the fiche because it is what the régisseur works through first, person by person,
 * in the weeks before an event: who is in, who was told, who withdrew.
 *
 * The note is a draft committed on blur: an edit per keystroke would fill the undo stack and the
 * journal with one line per letter.
 */

import { useEffect, useState } from 'react';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  ENERGY_LABEL,
  ENERGY_PROFILES,
  fmtHours,
  statusOf,
  type EnergyProfile,
  type Volunteer,
  type VolunteerReport,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { correctVolunteer } from '../store/edits.ts';
import { setVolunteerTeam } from '../store/teamEdits.ts';
import {
  placesHeld,
  releasePlaces,
  setApplicationStatus,
  setApplicationStep,
  setRegieNote,
} from '../store/applicationEdits.ts';

export function ApplicationSection({
  volunteer,
  detail,
  readOnly,
}: {
  volunteer: Volunteer;
  detail: VolunteerReport;
  readOnly: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const name = index.volunteerName(volunteer.key);
  const status = statusOf(volunteer);
  const [note, setNote] = useState(volunteer.regieNote ?? '');
  // Another person selected, or the note changed by an undo: the draft follows the fiche.
  useEffect(() => setNote(volunteer.regieNote ?? ''), [volunteer.key, volunteer.regieNote]);

  const ticked = new Set(volunteer.statusSteps ?? []);
  const held = placesHeld(plan, volunteer.key);
  const holding = held.shifts + held.phaseBoxes;

  if (readOnly) {
    return (
      <div className="panel-section">
        <p className="panel-section-title">Candidature</p>
        <p>
          <span className={`chip ${status === 'annule' ? 'is-bad' : status === 'valide' ? 'is-ok' : ''}`}>
            {APPLICATION_STATUS_LABEL[status]}
          </span>
          {detail.reserve && <span className="chip">Liste d'attente</span>}
          {volunteer.backup && <span className="chip is-ok">Réserve</span>}
          {volunteer.energy && <span className="chip">{ENERGY_LABEL[volunteer.energy]}</span>}
          {volunteer.teamKey && (
            <span className="chip">{plan.teams.find((t) => t.key === volunteer.teamKey)?.name ?? 'Équipe'}</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="panel-section fiche-edit">
      <p className="panel-section-title">Candidature</p>

      <label className="field">
        <span className="field-label">Statut</span>
        <select
          className="select"
          name="fiche-status"
          value={status}
          onChange={(event) => {
            const next = event.target.value as typeof status;
            edit((p) => setApplicationStatus(p, volunteer.key, next), `candidature de ${name}: ${APPLICATION_STATUS_LABEL[next].toLowerCase()}`);
          }}
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>{APPLICATION_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>

      {status === 'annule' && holding > 0 && (
        <div className="fiche-review">
          <p className="fiche-review-reason">
            Occupe encore{' '}
            {[
              held.shifts > 0 ? `${held.shifts} créneau${held.shifts > 1 ? 'x' : ''} (${fmtHours(detail.assignedHours)})` : '',
              held.phaseBoxes > 0 ? `${held.phaseBoxes} case${held.phaseBoxes > 1 ? 's' : ''} de montage ou démontage` : '',
            ].filter(Boolean).join(' et ')}
            {held.locked > 0 ? `, dont ${held.locked} verrouillé${held.locked > 1 ? 's' : ''}` : ''}.
          </p>
          <button
            type="button"
            className="btn is-danger"
            onClick={() => edit((p) => releasePlaces(p, volunteer.key), `places de ${name} libérées (annulation)`)}
          >
            Libérer ses places
          </button>
        </div>
      )}

      {plan.teams.length > 0 && (
        <label className="field">
          <span className="field-label">Équipe</span>
          <select
            className="select"
            name="fiche-team"
            value={volunteer.teamKey ?? ''}
            onChange={(event) => {
              const teamKey = event.target.value === '' ? null : event.target.value;
              edit((p) => setVolunteerTeam(p, volunteer.key, teamKey), `équipe de ${name}`);
            }}
          >
            <option value="">Aucune</option>
            {plan.teams.map((t) => (
              <option key={t.key} value={t.key}>{t.name}</option>
            ))}
          </select>
        </label>
      )}

      {detail.reserve && <p className="people-meta">En liste d'attente.</p>}
      {(volunteer.registeredAt ?? '') !== '' && (
        <p className="people-meta">Inscription: {volunteer.registeredAt}</p>
      )}

      <label className="field">
        <span className="field-label">Réserve (renfort)</span>
        <input
          type="checkbox"
          name="fiche-backup"
          checked={volunteer.backup === true}
          onChange={(event) => {
            const backup = event.target.checked;
            edit((p) => correctVolunteer(p, volunteer.key, { backup }), backup ? `${name} dans la réserve` : `${name} hors de la réserve`);
          }}
        />
      </label>

      <label className="field">
        <span className="field-label">Énergie</span>
        <select
          className="select"
          name="fiche-energy"
          value={volunteer.energy ?? ''}
          onChange={(event) => {
            const energy = event.target.value === '' ? null : (event.target.value as EnergyProfile);
            edit((p) => correctVolunteer(p, volunteer.key, { energy }), `profil d'énergie de ${name}`);
          }}
        >
          <option value="">Non renseigné</option>
          {ENERGY_PROFILES.map((e) => (
            <option key={e} value={e}>{ENERGY_LABEL[e]}</option>
          ))}
        </select>
      </label>
      {volunteer.energy === 'fatigable' && detail.assignedHours > 0 && (
        <p className="people-meta is-bad">
          Fatigue vite: {fmtHours(detail.assignedHours)} affectées pour {fmtHours(detail.requestedTotalHours)} demandées.
        </p>
      )}

      {plan.applicationSteps.length > 0 && (
        <div className="fiche-steps">
          {plan.applicationSteps.map((step) => (
            <label key={step.key} className="fiche-step">
              <input
                type="checkbox"
                name={`fiche-step-${step.key}`}
                checked={ticked.has(step.key)}
                onChange={(event) => {
                  const done = event.target.checked;
                  edit((p) => setApplicationStep(p, volunteer.key, step.key, done), `${step.label}: ${name}`);
                }}
              />
              <span>{step.label}</span>
            </label>
          ))}
        </div>
      )}

      <textarea
        className="select"
        name="fiche-regie-note"
        rows={2}
        placeholder="Note de la régie"
        aria-label={`Note de la régie sur ${name}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          if (note !== (volunteer.regieNote ?? '')) edit((p) => setRegieNote(p, volunteer.key, note), `note sur ${name}`);
        }}
      />
    </div>
  );
}
