/**
 * The fiche in edit mode: correcting what the tool made of somebody's answers.
 *
 * WHAT IS EDITABLE HERE, AND WHAT IS NOT. Everything on this form is an INTERPRETATION: which
 * slots a sentence rules out, which pole an "Autre" answer names, what level, what volume. None
 * of it is the answer itself. The sentence the volunteer typed is shown above, unchanged and
 * uneditable, because it is the evidence the régisseur is correcting against and rewriting it
 * would destroy the only record of what was actually said.
 *
 * NOTHING IS SAVED UNTIL "Enregistrer". The form holds a draft, the fiche keeps showing the
 * stored answers underneath it, and leaving without saving changes nothing. That is deliberate:
 * an autosaving form beside a grid full of drag and drop would make a stray click into a silent
 * change of somebody's availability.
 *
 * Every field saved is recorded in `manualFields` by `correctVolunteer`, which is what stops the
 * next import from undoing it. See `mergeWithManual` in the engine.
 */

import { useState } from 'react';

import {
  type EditableField,
  type PlanIndex,
  type PoleChoice,
  type SkillLevel,
  type Volunteer,
} from '../engine.ts';
import { levelLabel, volumeText } from './layout.ts';

export interface VolunteerEditProps {
  index: PlanIndex;
  volunteer: Volunteer;
  onCancel(): void;
  onSave(patch: Partial<Pick<Volunteer, EditableField>>): void;
}

const LEVELS: SkillLevel[] = ['debutant', 'intermediaire', 'expert'];
/** The select's value for "peu importe": a select cannot hold null. */
const NO_PREFERENCE = '';

/** A value the draft holds, compared with the stored one to decide what is actually changing. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function VolunteerEdit({ index, volunteer, onCancel, onSave }: VolunteerEditProps) {
  const [draft, setDraft] = useState<Volunteer>(volunteer);

  const ranked = index.plan.poleChoicesRanked !== false;
  const setChoice = (at: number, patch: Partial<PoleChoice>): void =>
    set('choices', draft.choices.map((c, i) => (i === at ? { ...c, ...patch } : c)));
  const moveChoice = (at: number, by: -1 | 1): void => {
    const next = [...draft.choices];
    const [moved] = next.splice(at, 1);
    next.splice(at + by, 0, moved!);
    set('choices', next);
  };
  const roots = index.plan.poles.filter((pole) => !pole.parentKey);

  const set = <K extends EditableField>(field: K, value: Volunteer[K]): void =>
    setDraft((current) => ({ ...current, [field]: value }));

  const toggle = (list: readonly string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  /*
   * Only what actually differs is sent.
   *
   * `correctVolunteer` marks every field it receives as corrected by hand, and a field marked by
   * hand stops being updated by imports forever after. Sending the whole draft would freeze a
   * person's entire fiche the first time anybody opened this form and pressed Enregistrer, which
   * is the opposite of what a correction is for.
   */
  const save = (): void => {
    const patch: Partial<Pick<Volunteer, EditableField>> = {};
    const compare = <K extends EditableField>(field: K): void => {
      if (!same(draft[field], volunteer[field])) patch[field] = draft[field];
    };
    compare('refusedSlotIds');
    compare('avoidedSlotIds');
    compare('refusedPoleKeys');
    compare('choices');
    compare('requestedHours');
    compare('preferredSlotId');
    compare('firstName');
    compare('lastName');
    compare('nickname');
    compare('phone');
    compare('email');
    compare('diet');
    compare('allergies');
    compare('emergencyContact');
    compare('healthNote');
    compare('minor');
    compare('nicknameMatters');
    onSave(patch);
  };

  return (
    <div className="fiche-edit">
      <div className="panel-section">
        <p className="panel-section-title">Ne peut pas travailler</p>
        <p className="panel-sub">
          Cochez les tranches où la personne n'est pas disponible. C'est une règle dure: elle ne
          sera jamais placée dessus.
        </p>
        {index.slots.map((slot) => (
          <label className="checkline" key={slot.id}>
            <input
              type="checkbox"
              checked={draft.refusedSlotIds.includes(slot.id)}
              onChange={() => set('refusedSlotIds', toggle(draft.refusedSlotIds, slot.id))}
            />
            {slot.label}
          </label>
        ))}
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Préfère éviter</p>
        <p className="panel-sub">
          Possible, mais chaque heure dans ces tranches a un coût: le calcul les évite quand il le
          peut. Une tranche refusée au-dessus l'emporte.
        </p>
        {index.slots.map((slot) => (
          <label className="checkline" key={slot.id}>
            <input
              type="checkbox"
              name={`fiche-avoid-${slot.id}`}
              disabled={draft.refusedSlotIds.includes(slot.id)}
              checked={(draft.avoidedSlotIds ?? []).includes(slot.id)}
              onChange={() => set('avoidedSlotIds', toggle(draft.avoidedSlotIds ?? [], slot.id))}
            />
            {slot.label}
          </label>
        ))}
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Ses choix de pôle</p>
        <p className="panel-sub">
          {ranked
            ? "Dans l'ordre de préférence: le premier est le plus souhaité."
            : "À égalité sur cet événement: l'ordre n'a pas d'effet."}
        </p>
        {draft.choices.map((choice, at) => (
          <div className="choice-edit" key={at}>
            <span className="choice-edit-rank">{ranked ? `${at + 1}.` : '•'}</span>
            <select
              className="select"
              aria-label={`Pôle du choix ${at + 1}`}
              value={choice.poleKey}
              onChange={(event) => setChoice(at, { poleKey: event.target.value })}
            >
              <option value="">{choice.raw.trim() !== '' ? `Non reconnu: « ${choice.raw.trim()} »` : 'Aucun'}</option>
              {index.plan.poles.map((pole) => (
                <option key={pole.key} value={pole.key}>
                  {pole.path}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label={`Niveau du choix ${at + 1}`}
              value={choice.level}
              onChange={(event) => setChoice(at, { level: event.target.value as SkillLevel })}
            >
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {levelLabel(level)}
                </option>
              ))}
            </select>
            <button type="button" className="btn is-icon" disabled={at === 0} title="Monter" onClick={() => moveChoice(at, -1)}>↑</button>
            <button type="button" className="btn is-icon" disabled={at === draft.choices.length - 1} title="Descendre" onClick={() => moveChoice(at, 1)}>↓</button>
            <button type="button" className="btn is-icon" title="Retirer ce choix" onClick={() => set('choices', draft.choices.filter((_, i) => i !== at))}>✕</button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => set('choices', [...draft.choices, { poleKey: '', raw: '', level: 'debutant' }])}
        >
          Ajouter un choix
        </button>
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Pôles refusés</p>
        <p className="panel-sub">
          Refuser un pôle refuse aussi tout ce qui est dessous. Règle dure, elle aussi.
        </p>
        {roots.map((pole) => (
          <label className="checkline" key={pole.key}>
            <input
              type="checkbox"
              checked={draft.refusedPoleKeys.includes(pole.key)}
              onChange={() => set('refusedPoleKeys', toggle(draft.refusedPoleKeys, pole.key))}
            />
            {pole.name}
          </label>
        ))}
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Ce qui a été demandé</p>
        <label className="field">
          <span className="field-label">Volume</span>
          <select
            className="select"
            value={draft.requestedHours}
            onChange={(event) => set('requestedHours', Number(event.target.value))}
          >
            {/* The event's options, plus the person's own figure when it is not one of them: an
                option removed from Réglages never rewrites an answer. */}
            {[...new Set([...index.plan.volume.options, draft.requestedHours])]
              .sort((a, b) => a - b)
              .map((volume) => (
                <option key={volume} value={volume}>
                  {volumeText(volume, index.dayMode)}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Préférence</span>
          <select
            className="select"
            value={draft.preferredSlotId ?? NO_PREFERENCE}
            onChange={(event) =>
              set('preferredSlotId', event.target.value === NO_PREFERENCE ? null : event.target.value)
            }
          >
            <option value={NO_PREFERENCE}>Sans préférence</option>
            {index.plan.preferenceSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                Plutôt « {slot.label} »
              </option>
            ))}
            {/* An answer naming a tranche that has since been removed is kept as it was given. */}
            {draft.preferredSlotId !== null &&
              !index.plan.preferenceSlots.some((s) => s.id === draft.preferredSlotId) && (
                <option value={draft.preferredSlotId}>{draft.preferredSlotId} (tranche retirée)</option>
              )}
          </select>
        </label>
      </div>

      <div className="panel-section">
        <p className="panel-section-title">Identité et contact</p>
        {/*
          The name, since 2026-09-15: a typo in the form was the one thing a régisseur could not
          fix. Only the label changes; the key stays the identity the import found, so a re-import
          still recognises the person, and the correction is kept by `manualFields` like any other.
        */}
        <label className="field">
          <span className="field-label">Prénom</span>
          <input
            className="select"
            value={draft.firstName}
            onChange={(event) => set('firstName', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Nom</span>
          <input
            className="select"
            value={draft.lastName}
            onChange={(event) => set('lastName', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Surnom</span>
          <input
            className="select"
            value={draft.nickname}
            placeholder="aucun"
            onChange={(event) => set('nickname', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Téléphone</span>
          <input
            className="select"
            value={draft.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">E-mail</span>
          <input
            className="select"
            value={draft.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Surnom important</span>
          <select
            className="select"
            name="fiche-nickname-matters"
            value={draft.nicknameMatters === true ? 'oui' : draft.nicknameMatters === false ? 'non' : ''}
            onChange={(event) => set('nicknameMatters', event.target.value === '' ? null : event.target.value === 'oui')}
          >
            <option value="">Non renseigné (surnom affiché)</option>
            <option value="oui">Oui, surnom affiché</option>
            <option value="non">Non, prénom affiché</option>
          </select>
        </label>
      </div>

      {/*
        Field data, 2026-09-15. Read by the régie and the responsables only: the plan an orga
        without a pole opens has neither field (see get_organiser_planning).
      */}
      <div className="panel-section">
        <p className="panel-section-title">Sur le terrain</p>
        <label className="field">
          <span className="field-label">Contact d'urgence</span>
          <input
            className="select"
            name="fiche-emergency"
            value={draft.emergencyContact ?? ''}
            placeholder="nom et téléphone"
            onChange={(event) => set('emergencyContact', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Santé, besoins</span>
          <input
            className="select"
            name="fiche-health"
            value={draft.healthNote ?? ''}
            placeholder="rien de signalé"
            onChange={(event) => set('healthNote', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Mineur·e</span>
          <select
            className="select"
            name="fiche-minor"
            value={draft.minor === true ? 'oui' : draft.minor === false ? 'non' : ''}
            onChange={(event) => set('minor', event.target.value === '' ? null : event.target.value === 'oui')}
          >
            <option value="">Non renseigné</option>
            <option value="non">Non</option>
            <option value="oui">Oui</option>
          </select>
        </label>
      </div>

      {/*
        What the caterer reads. Correctable because a caterer ACTS on it: "végé", "vegetarien"
        and "pas de viande" are one plate, and the régisseur is the one who can say so. A
        ré-import never undoes what is corrected here; see `reconcile.ts`.
      */}
      <div className="panel-section">
        <p className="panel-section-title">Repas</p>
        <label className="field">
          <span className="field-label">Régime</span>
          <input
            className="select"
            value={draft.diet}
            placeholder="sans restriction"
            onChange={(event) => set('diet', event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Allergies</span>
          <input
            className="select"
            value={draft.allergies}
            placeholder="aucune"
            onChange={(event) => set('allergies', event.target.value)}
          />
        </label>
      </div>

      <div className="fiche-actions">
        <button className="btn is-primary" onClick={save}>
          Enregistrer
        </button>
        <button className="btn" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
