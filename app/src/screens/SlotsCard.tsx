/**
 * The tranches horaires the form asks about: the ones a volunteer can refuse, and the ones a
 * volunteer can prefer.
 *
 * These are not display settings. They are the wording of two questions the volunteers have
 * already answered, and they are the vocabulary those answers are written in. Changing them
 * changes what a stored answer means, which is why this card says so out loud rather than
 * looking like a preferences panel.
 *
 * TWO LISTS, ONE PER QUESTION, since 2026-09-13. "Quelle tranche ne peux-tu pas faire" is a
 * refusal and a hard rule, and its tranches tile the event. "Qu'est ce que tu préfères ?" is a
 * preference and a price, and its tranches carry a "débordement accepté" on either side, which is
 * where the old "La soirée commence à" and "Débordement loto accepté jusqu'à" went: the loto and
 * the concerts are two rows the régisseur can rename, move or replace for an event that has
 * neither, rather than two words in the code.
 *
 * A label is free to change: the answers store the id. Removing a tranche is not free, and the
 * count of people whose answer names it is shown before the second click. Their answer is kept as
 * they gave it and simply stops applying, because rewriting what somebody said so the data looks
 * tidy is the one thing this tool must not do.
 */

import { useState } from 'react';

import { fmtHours, type EventSlot, type PreferenceSlot } from '../engine.ts';
import {
  addPreferenceSlot,
  addSlot,
  deletePreferenceSlot,
  deleteSlot,
  preferenceSlotCount,
  setPreferenceSlot,
  setSlot,
  slotRefusalCount,
} from '../store/setupEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { ClockField } from '../components/ClockField.tsx';
import { slideEnd } from '../components/clock.ts';
import { SetupSection } from './SetupSection.tsx';

export function SlotsCard() {
  const { plan, edit } = useLoadedPlan();
  const [newSlot, setNewSlot] = useState('');
  const [newPreference, setNewPreference] = useState('');

  const slots = [...plan.slots].sort((a, b) => a.start - b.start);
  const preferences = [...plan.preferenceSlots].sort((a, b) => a.start - b.start);

  return (
    <SetupSection
      className="setup-slots"
      title="Tranches horaires du formulaire"
      meta={`${plan.slots.length} tranches refusables · ${plan.preferenceSlots.length} tranches préférables`}
    >

      <p className="panel-sub import-note">
        Ce sont les intitulés de deux questions du formulaire, pas des réglages d'affichage. Si
        vous reformulez une question, reformulez ses tranches ici à l'identique: c'est comme ça que
        le ré-import continue de reconnaître les réponses déjà collectées.
      </p>

      <div className="setup-lineup">
        <span className="panel-section-title">Tranches qu'on peut refuser ({slots.length})</span>
        <p className="panel-sub">
          « Quelle tranche ne peux-tu absolument pas faire ? » Une tranche refusée est une règle
          dure: personne n'y est placé contre sa réponse. Ensemble, elles couvrent l'événement.
        </p>

        {slots.map((slot) => (
          <SlotRow key={slot.id} slot={slot} />
        ))}

        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Intitulé d'une tranche"
            name="new-slot"
            autoComplete="off"
            value={newSlot}
            onChange={(event) => setNewSlot(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || newSlot.trim() === '') return;
              edit((p) => addSlot(p, newSlot), `tranche ${newSlot.trim()}`);
              setNewSlot('');
            }}
          />
          <button
            className="btn"
            disabled={newSlot.trim() === ''}
            onClick={() => {
              edit((p) => addSlot(p, newSlot), `tranche ${newSlot.trim()}`);
              setNewSlot('');
            }}
          >
            Ajouter une tranche
          </button>
        </span>
      </div>

      <div className="setup-lineup">
        <span className="panel-section-title">
          Tranches qu'on peut préférer ({preferences.length})
        </span>
        <p className="panel-sub">
          « Qu'est-ce que tu préfères ? » Une préférence n'est jamais une règle: le planning peut
          passer outre pour combler un créneau, et le signale au lieu de l'interdire. Le
          débordement accepté est la marge, avant comme après la tranche, où un placement compte
          comme un simple étirement et n'est pas signalé.
        </p>

        {preferences.map((slot) => (
          <PreferenceRow key={slot.id} slot={slot} />
        ))}

        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Intitulé d'une tranche"
            name="new-preference-slot"
            autoComplete="off"
            value={newPreference}
            onChange={(event) => setNewPreference(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || newPreference.trim() === '') return;
              edit((p) => addPreferenceSlot(p, newPreference), `tranche ${newPreference.trim()}`);
              setNewPreference('');
            }}
          />
          <button
            className="btn"
            disabled={newPreference.trim() === ''}
            onClick={() => {
              edit((p) => addPreferenceSlot(p, newPreference), `tranche ${newPreference.trim()}`);
              setNewPreference('');
            }}
          >
            Ajouter une tranche
          </button>
        </span>
      </div>
    </SetupSection>
  );
}

function SlotRow({ slot }: { slot: EventSlot }) {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const refusals = slotRefusalCount(plan, slot.id);
  const coherent = slot.end > slot.start;

  return (
    <div className="setup-organiser">
      <input
        className="setup-name"
        name={`slot-label-${slot.id}`}
        autoComplete="off"
        value={slot.label}
        aria-label="Intitulé de la tranche"
        onChange={(event) =>
          edit((p) => setSlot(p, slot.id, { label: event.target.value }), `tranche ${slot.label}`)
        }
      />

      <span className="clock-range">
        <ClockField
          value={slot.start}
          maxHours={plan.lengthHours}
          startISO={plan.startISO}
          ariaLabel={`Début de ${slot.label}`}
          hint="Déplacer le début déplace la tranche entière: la fin suit, la durée ne change pas."
          name={`slot-start-${slot.id}`}
          onChange={(value) => {
            if (value === null) return;
            // The tranche moves, it does not stretch. See `slideEnd`.
            const end = slideEnd(slot.start, slot.end, value);
            edit((p) => setSlot(p, slot.id, { start: value, end }), `horaires de ${slot.label}`);
          }}
        />
        <span className="clock-range-sep">→</span>
        <ClockField
          value={slot.end}
          maxHours={plan.lengthHours}
          startISO={plan.startISO}
          ariaLabel={`Fin de ${slot.label}`}
          hint="Déplacer la fin change la durée de la tranche. Le début ne bouge pas."
          name={`slot-end-${slot.id}`}
          onChange={(value) => {
            if (value === null) return;
            edit((p) => setSlot(p, slot.id, { end: value }), `horaires de ${slot.label}`);
          }}
        />
        <span className={`rule-suffix ${coherent ? '' : 'is-bad'}`}>
          {coherent ? fmtHours(slot.end - slot.start) : 'la fin doit être après le début'}
        </span>
      </span>

      <span className="people-meta">
        {refusals > 0 ? `${refusals} l'ont refusée` : 'personne ne l\'a refusée'} · id{' '}
        <code>{slot.id}</code>
      </span>

      {armed ? (
        <span className="setup-confirm">
          <span className="setup-confirm-text">
            {refusals > 0
              ? `${refusals} bénévole(s) ont répondu qu'ils ne pouvaient pas faire cette tranche. Leur réponse est conservée telle quelle et cessera simplement de s'appliquer.`
              : 'Personne ne l\'a refusée: aucune réponse n\'est touchée.'}
          </span>
          <button
            className="btn is-danger"
            onClick={() => edit((p) => deleteSlot(p, slot.id), `retrait de la tranche ${slot.label}`)}
          >
            Retirer
          </button>
          <button className="btn" onClick={() => setArmed(false)}>
            Annuler
          </button>
        </span>
      ) : (
        <button
          className="btn is-icon is-danger"
          title={`Retirer la tranche ${slot.label}`}
          onClick={() => setArmed(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function PreferenceRow({ slot }: { slot: PreferenceSlot }) {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const named = preferenceSlotCount(plan, slot.id);
  const coherent = slot.end > slot.start;

  return (
    <div className="setup-organiser">
      <input
        className="setup-name"
        name={`preference-label-${slot.id}`}
        autoComplete="off"
        value={slot.label}
        aria-label="Intitulé de la tranche"
        onChange={(event) =>
          edit(
            (p) => setPreferenceSlot(p, slot.id, { label: event.target.value }),
            `tranche ${slot.label}`,
          )
        }
      />

      <span className="clock-range">
        <ClockField
          value={slot.start}
          maxHours={plan.lengthHours}
          startISO={plan.startISO}
          ariaLabel={`Début de ${slot.label}`}
          hint="Déplacer le début déplace la tranche entière: la fin suit, la durée ne change pas."
          name={`preference-start-${slot.id}`}
          onChange={(value) => {
            if (value === null) return;
            const end = slideEnd(slot.start, slot.end, value);
            edit(
              (p) => setPreferenceSlot(p, slot.id, { start: value, end }),
              `horaires de ${slot.label}`,
            );
          }}
        />
        <span className="clock-range-sep">→</span>
        <ClockField
          value={slot.end}
          maxHours={plan.lengthHours}
          startISO={plan.startISO}
          ariaLabel={`Fin de ${slot.label}`}
          hint="Déplacer la fin change la durée de la tranche. Le début ne bouge pas."
          name={`preference-end-${slot.id}`}
          onChange={(value) => {
            if (value === null) return;
            edit((p) => setPreferenceSlot(p, slot.id, { end: value }), `horaires de ${slot.label}`);
          }}
        />
        <span className={`rule-suffix ${coherent ? '' : 'is-bad'}`}>
          {coherent ? fmtHours(slot.end - slot.start) : 'la fin doit être après le début'}
        </span>
      </span>

      <label className="rule-input setup-overflow">
        <span className="rule-suffix">débordement accepté</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={slot.overflowHours}
          aria-label={`Débordement accepté autour de ${slot.label}`}
          title="Avant comme après la tranche. Au-delà, un placement compte comme allant contre la réponse."
          onChange={(event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            edit(
              (p) => setPreferenceSlot(p, slot.id, { overflowHours: value }),
              `débordement de ${slot.label}`,
            );
          }}
        />
        <span className="rule-suffix">h</span>
      </label>

      <span className="people-meta">
        {named > 0 ? `${named} la préfèrent` : 'personne ne la préfère'} · id{' '}
        <code>{slot.id}</code>
      </span>

      {armed ? (
        <span className="setup-confirm">
          <span className="setup-confirm-text">
            {named > 0
              ? `${named} bénévole(s) ont répondu préférer cette tranche. Leur réponse est conservée telle quelle et cessera simplement de compter.`
              : 'Personne ne la préfère: aucune réponse n\'est touchée.'}
          </span>
          <button
            className="btn is-danger"
            onClick={() =>
              edit((p) => deletePreferenceSlot(p, slot.id), `retrait de la tranche ${slot.label}`)
            }
          >
            Retirer
          </button>
          <button className="btn" onClick={() => setArmed(false)}>
            Annuler
          </button>
        </span>
      ) : (
        <button
          className="btn is-icon is-danger"
          title={`Retirer la tranche ${slot.label}`}
          onClick={() => setArmed(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}
