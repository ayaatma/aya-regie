/**
 * « Suivi » on a bénévole's fiche, 2026-09-15: the steps ticked, the régisseur's note, and the two
 * answers that go with them (the Réserve, the stamina). The status itself moved to
 * `RegistrationSection` on 2026-10-22, one block for every kind of person, with the validation
 * mail; what stays here is what only a bénévole has. Since 2026-10-24 it is the body of the
 * « Suivi » category of the fiche, and freeing the places of a cancelled one is `ReleasePlaces`,
 * in the warning at the top of the fiche.
 *
 * At the top of the fiche because it is what the régisseur works through first, person by person,
 * in the weeks before an event: who is in, who was told, who withdrew.
 *
 * The note is a draft committed on blur: an edit per keystroke would fill the undo stack and the
 * journal with one line per letter.
 */

import { useEffect, useState } from 'react';

import {
  ENERGY_LABEL,
  ENERGY_PROFILES,
  fmtHours,
  statusOf,
  type EnergyProfile,
  type Plan,
  type Volunteer,
  type VolunteerReport,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { correctVolunteer } from '../store/edits.ts';
import { setVolunteerTeam } from '../store/teamEdits.ts';
import { FollowUpSteps } from './FollowUpSteps.tsx';
import {
  placesHeld,
  releasePlaces,
  setRegieNote,
} from '../store/applicationEdits.ts';

export function ApplicationSection({
  volunteer,
  detail,
  readOnly,
  editing = true,
}: {
  volunteer: Volunteer;
  detail: VolunteerReport;
  readOnly: boolean;
  /**
   * The fiche's mode édition, since 2026-10-24. Out of it the équipe and the énergie are read, not
   * chosen; what the régisseur works through every day stays live in both: « Placer en réserve »,
   * the steps ticked, the note, and freeing the places of somebody who cancelled.
   */
  editing?: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const name = index.volunteerName(volunteer.key);
  const [note, setNote] = useState(volunteer.regieNote ?? '');
  // Another person selected, or the note changed by an undo: the draft follows the fiche.
  useEffect(() => setNote(volunteer.regieNote ?? ''), [volunteer.key, volunteer.regieNote]);

  if (readOnly) {
    return (
      <div className="panel-section">
        <p className="panel-section-title">Suivi</p>
        <p>
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

      {!editing && (volunteer.teamKey || volunteer.energy) && (
        <p>
          {volunteer.teamKey && (
            <span className="chip">{plan.teams.find((t) => t.key === volunteer.teamKey)?.name ?? 'Équipe'}</span>
          )}
          {volunteer.energy && <span className="chip">{ENERGY_LABEL[volunteer.energy]}</span>}
        </p>
      )}

      {editing && plan.teams.length > 0 && (
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
        <span className="field-label">Placer en réserve</span>
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

      {editing && (
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
      )}
      {volunteer.energy === 'fatigable' && detail.assignedHours > 0 && (
        <p className="people-meta is-bad">
          Fatigue vite: {fmtHours(detail.assignedHours)} affectées pour {fmtHours(detail.requestedTotalHours)} demandées.
        </p>
      )}

      <FollowUpSteps volunteer={volunteer} />

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

/** Whether a cancelled bénévole still holds places: the warning at the top of the fiche says so. */
export function holdsPlacesCancelled(plan: Plan, volunteer: Volunteer): boolean {
  const held = placesHeld(plan, volunteer.key);
  return statusOf(volunteer) === 'annule' && held.shifts + held.phaseBoxes > 0;
}

/**
 * « Libérer ses places », for a cancelled bénévole still holding some, 2026-09-15. In the warning
 * at the top of the fiche since 2026-10-24: folded under « Suivi » it would be missed, and a
 * cancelled person still on the grid is exactly what must not be missed.
 */
export function ReleasePlaces({ volunteer, detail }: { volunteer: Volunteer; detail: VolunteerReport }) {
  const { plan, index, edit } = useLoadedPlan();
  if (!holdsPlacesCancelled(plan, volunteer)) return null;
  const held = placesHeld(plan, volunteer.key);
  const name = index.volunteerName(volunteer.key);
  return (
    <>
      <p className="fiche-review-reason">
        Annulé·e, occupe encore{' '}
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
    </>
  );
}
