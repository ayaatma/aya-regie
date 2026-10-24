/**
 * Correcting what the tool made of somebody's answers: the import's « Corriger la lecture » form,
 * and since 2026-10-24 the pieces the fiche shows in place in its mode édition.
 *
 * WHAT IS EDITABLE HERE, AND WHAT IS NOT. Everything on this form is an INTERPRETATION: which
 * slots a sentence rules out, which pole an "Autre" answer names, what level, what volume. None
 * of it is the answer itself. The sentence the volunteer typed is shown above, unchanged and
 * uneditable, because it is the evidence the régisseur is correcting against and rewriting it
 * would destroy the only record of what was actually said.
 *
 * ONE SET OF SECTIONS, TWO WAYS OF KEEPING WHAT IS TYPED. Each section takes the person and a
 * `set(field, value)`. `VolunteerEdit` (the import) hands it a draft that nothing reads until
 * « Enregistrer »: there, a reading is reviewed before it is applied. The fiche hands it
 * `correctVolunteer` itself: its mode édition is already the explicit "I am changing this person",
 * and every field saved lands in the undo stack. Text fields are `FicheText`, saved once when
 * left, so neither way gets one change per keystroke.
 *
 * Every field saved is recorded in `manualFields` by `correctVolunteer`, which is what stops the
 * next import from undoing it. See `mergeWithManual` in the engine.
 */

import { useState } from 'react';

import {
  ANY_POLE_LABEL,
  type EditableField,
  type PlanIndex,
  type PoleChoice,
  type SkillLevel,
  type Volunteer,
} from '../engine.ts';
import { FicheText } from './FicheText.tsx';
import { levelLabel, volumeText } from './layout.ts';
import { PhaseDaysEdit, volunteerPhases } from './PhaseDaysEdit.tsx';
import { UnavailableRanges } from './UnavailableRanges.tsx';

export interface VolunteerEditProps {
  index: PlanIndex;
  volunteer: Volunteer;
  onCancel(): void;
  onSave(patch: Partial<Pick<Volunteer, EditableField>>): void;
}

/** What every section writes through: a draft for the import, the plan itself for the fiche. */
export type SetField = <K extends EditableField>(field: K, value: Volunteer[K]) => void;

/** What every section is handed. `prefix` keeps the form names of two forms on one page apart. */
export interface SectionProps {
  index: PlanIndex;
  volunteer: Volunteer;
  set: SetField;
  prefix: string;
}

const LEVELS: SkillLevel[] = ['debutant', 'intermediaire', 'expert'];
/** The select's value for "peu importe": a select cannot hold null. */
const NO_PREFERENCE = '';
/** The pole select's value for « Tous les pôles acceptés », which no pole key can be. */
const ANY_POLE = '*';

/** A value the draft holds, compared with the stored one to decide what is actually changing. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const toggle = (list: readonly string[], value: string): string[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export function VolunteerEdit({ index, volunteer, onCancel, onSave }: VolunteerEditProps) {
  const [draft, setDraft] = useState<Volunteer>(volunteer);
  const set: SetField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const props: SectionProps = { index, volunteer: draft, set, prefix: `edit-${volunteer.key}` };

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
    compare('unavailable');
    compare('avoidedSlotIds');
    compare('refusedPoleKeys');
    compare('artistKeys');
    compare('choices');
    compare('requestedHours');
    compare('montage');
    compare('demontage');
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
      <RefusedSlotsEdit {...props} />
      <AvoidedSlotsEdit {...props} />
      <div className="panel-section">
        <p className="panel-section-title">Ses choix de pôle</p>
        <ChoicesEdit {...props} />
      </div>
      <RefusedPolesEdit {...props} />
      <ArtistsEdit {...props} />
      <PhasesEdit {...props} />
      <div className="panel-section">
        <p className="panel-section-title">Ce qui a été demandé</p>
        <RequestEdit {...props} />
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Identité et contact</p>
        <IdentityEdit {...props} />
        <ContactEdit {...props} />
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Sur le terrain</p>
        <FieldDataEdit {...props} />
      </div>
      <div className="panel-section">
        <p className="panel-section-title">Repas</p>
        <MealsEdit {...props} />
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

/**
 * « Ne peut pas travailler »: the stretches in plages libres, then the form's tranches. The fiche
 * passes `withRanges={false}`: it draws the stretches lower, where it reads them.
 */
export function RefusedSlotsEdit({
  index,
  volunteer,
  set,
  prefix,
  withRanges = true,
}: SectionProps & { withRanges?: boolean }) {
  const ranges = index.plan.availabilityMode === 'plages';
  return (
    <>
      {/* « Plages libres », 2026-10-22: the exact stretches first, the form's tranches still under them. */}
      {ranges && withRanges && (
        <div className="panel-section">
          <p className="panel-section-title">Ne peut pas travailler</p>
          <p className="panel-sub">
            Les plages où la personne n'est pas disponible, autant qu'il en faut. Règle dure: elle
            ne sera jamais placée dessus.
          </p>
          <UnavailableRanges
            index={index}
            windows={volunteer.unavailable ?? []}
            namePrefix={prefix}
            onChange={(windows) => set('unavailable', windows)}
          />
        </div>
      )}

      <div className="panel-section">
        <p className="panel-section-title">{ranges ? 'Tranches refusées' : 'Ne peut pas travailler'}</p>
        <p className="panel-sub">
          {ranges
            ? "Les tranches entières refusées, quand le formulaire pose la question fermée. Elles s'ajoutent aux plages."
            : "Cochez les tranches où la personne n'est pas disponible. C'est une règle dure: elle ne sera jamais placée dessus."}
        </p>
        {index.slots.map((slot) => (
          <label className="checkline" key={slot.id}>
            <input
              type="checkbox"
              name={`${prefix}-refuse-${slot.id}`}
              checked={volunteer.refusedSlotIds.includes(slot.id)}
              onChange={() => set('refusedSlotIds', toggle(volunteer.refusedSlotIds, slot.id))}
            />
            {slot.label}
          </label>
        ))}
      </div>
    </>
  );
}

export function AvoidedSlotsEdit({ index, volunteer, set, prefix }: SectionProps) {
  return (
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
            name={`${prefix}-avoid-${slot.id}`}
            disabled={volunteer.refusedSlotIds.includes(slot.id)}
            checked={(volunteer.avoidedSlotIds ?? []).includes(slot.id)}
            onChange={() => set('avoidedSlotIds', toggle(volunteer.avoidedSlotIds ?? [], slot.id))}
          />
          {slot.label}
        </label>
      ))}
    </div>
  );
}

/** The pole choices, in order, each with its level. No section title: the caller has one. */
export function ChoicesEdit({ index, volunteer, set }: SectionProps) {
  const ranked = index.plan.poleChoicesRanked !== false;
  const setChoice = (at: number, patch: Partial<PoleChoice>): void =>
    set('choices', volunteer.choices.map((c, i) => (i === at ? { ...c, ...patch } : c)));
  const moveChoice = (at: number, by: -1 | 1): void => {
    const next = [...volunteer.choices];
    const [moved] = next.splice(at, 1);
    next.splice(at + by, 0, moved!);
    set('choices', next);
  };

  return (
    <>
      <p className="panel-sub">
        {ranked
          ? "Dans l'ordre de préférence: le premier est le plus souhaité."
          : "À égalité sur cet événement: l'ordre n'a pas d'effet."}
      </p>
      {volunteer.choices.map((choice, at) => (
        <div className="choice-edit" key={at}>
          <span className="choice-edit-rank">{ranked ? `${at + 1}.` : '•'}</span>
          <select
            className="select"
            aria-label={`Pôle du choix ${at + 1}`}
            value={choice.anyPole ? ANY_POLE : choice.poleKey}
            onChange={(event) =>
              setChoice(at, event.target.value === ANY_POLE
                ? { poleKey: '', anyPole: true }
                : { poleKey: event.target.value, anyPole: false })
            }
          >
            <option value="">{choice.raw.trim() !== '' ? `Non reconnu: « ${choice.raw.trim()} »` : 'Aucun'}</option>
            <option value={ANY_POLE}>{ANY_POLE_LABEL}</option>
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
          <button type="button" className="btn is-icon" disabled={at === volunteer.choices.length - 1} title="Descendre" onClick={() => moveChoice(at, 1)}>↓</button>
          <button type="button" className="btn is-icon" title="Retirer ce choix" onClick={() => set('choices', volunteer.choices.filter((_, i) => i !== at))}>✕</button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => set('choices', [...volunteer.choices, { poleKey: '', raw: '', level: 'debutant' }])}
      >
        Ajouter un choix
      </button>
    </>
  );
}

export function RefusedPolesEdit({ index, volunteer, set, prefix }: SectionProps) {
  const roots = index.plan.poles.filter((pole) => !pole.parentKey);
  return (
    <div className="panel-section">
      <p className="panel-section-title">Pôles refusés</p>
      <p className="panel-sub">
        Refuser un pôle refuse aussi tout ce qui est dessous. Règle dure, elle aussi.
      </p>
      {roots.map((pole) => (
        <label className="checkline" key={pole.key}>
          <input
            type="checkbox"
            name={`${prefix}-refuse-pole-${pole.key}`}
            checked={volunteer.refusedPoleKeys.includes(pole.key)}
            onChange={() => set('refusedPoleKeys', toggle(volunteer.refusedPoleKeys, pole.key))}
          />
          {pole.name}
        </label>
      ))}
    </div>
  );
}

/** Since 2026-10-23: an act the form words unlike its fiche had nothing to correct it with. */
export function ArtistsEdit({ index, volunteer, set, prefix }: SectionProps) {
  if (index.plan.artists.length === 0) return null;
  return (
    <div className="panel-section">
      <p className="panel-section-title">Artistes à ne pas manquer</p>
      <p className="panel-sub">La personne ne sera pas placée pendant ces passages, autant que possible.</p>
      {index.plan.artists.map((artist) => (
        <label className="checkline" key={artist.key}>
          <input
            type="checkbox"
            name={`${prefix}-artist-${artist.key}`}
            checked={volunteer.artistKeys.includes(artist.key)}
            onChange={() => set('artistKeys', toggle(volunteer.artistKeys, artist.key))}
          />
          {artist.name}
        </label>
      ))}
    </div>
  );
}

/** The montage and démontage reading, since 2026-10-22: a doubt on it had nothing to correct it with. */
export function PhasesEdit({ index, volunteer, set, prefix }: SectionProps) {
  const phases = volunteerPhases(index.plan);
  if (phases.length === 0) return null;
  return (
    <div className="panel-section">
      <p className="panel-section-title">Montage et démontage</p>
      {phases.map((id) => (
        <p key={id} className="people-meta">
          <PhaseDaysEdit
            id={id}
            phase={id === 'montage' ? index.plan.montage : index.plan.demontage}
            answer={volunteer[id]}
            namePrefix={prefix}
            onChange={(presence) => set(id, { ...volunteer[id], ...presence })}
          />
          {volunteer.manualFields.includes(id) && ' · corrigé à la main'}
        </p>
      ))}
    </div>
  );
}

/** The volume asked for and the preferred tranche. */
export function RequestEdit({ index, volunteer, set, prefix }: SectionProps) {
  return (
    <>
      <label className="field">
        <span className="field-label">Volume</span>
        <select
          className="select"
          name={`${prefix}-volume`}
          value={volunteer.requestedHours}
          onChange={(event) => set('requestedHours', Number(event.target.value))}
        >
          {/* The event's options, plus the person's own figure when it is not one of them: an
              option removed from Réglages never rewrites an answer. */}
          {[...new Set([...index.plan.volume.options, volunteer.requestedHours])]
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
          name={`${prefix}-preference`}
          value={volunteer.preferredSlotId ?? NO_PREFERENCE}
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
          {volunteer.preferredSlotId !== null &&
            !index.plan.preferenceSlots.some((s) => s.id === volunteer.preferredSlotId) && (
              <option value={volunteer.preferredSlotId}>{volunteer.preferredSlotId} (tranche retirée)</option>
            )}
        </select>
      </label>
    </>
  );
}

/**
 * The name, since 2026-09-15: a typo in the form was the one thing a régisseur could not fix.
 * Only the label changes; the key stays the identity the import found, so a re-import still
 * recognises the person, and the correction is kept by `manualFields` like any other.
 */
export function IdentityEdit({ volunteer, set, prefix }: SectionProps) {
  return (
    <>
      <label className="field">
        <span className="field-label">Prénom</span>
        <FicheText name={`${prefix}-first`} ariaLabel="Prénom" value={volunteer.firstName} onCommit={(v) => set('firstName', v)} />
      </label>
      <label className="field">
        <span className="field-label">Nom</span>
        <FicheText name={`${prefix}-last`} ariaLabel="Nom" value={volunteer.lastName} onCommit={(v) => set('lastName', v)} />
      </label>
      <label className="field">
        <span className="field-label">Surnom</span>
        <FicheText name={`${prefix}-nickname`} ariaLabel="Surnom" value={volunteer.nickname} placeholder="aucun" onCommit={(v) => set('nickname', v)} />
      </label>
      {/*
        Beside the nickname since 2026-10-24, where it used to sit after the e-mail as
        « Surnom important » and nobody found it. It is the form's question, and it is also the
        régisseur's switch for what the grid's small boxes say about this one person.
      */}
      <label className="field">
        <span className="field-label">Sur le planning</span>
        <select
          className="select"
          name="fiche-nickname-matters"
          value={volunteer.nicknameMatters === true ? 'oui' : volunteer.nicknameMatters === false ? 'non' : ''}
          disabled={volunteer.nickname.trim() === ''}
          title={volunteer.nickname.trim() === '' ? 'Sans surnom, le planning affiche le prénom' : undefined}
          onChange={(event) => set('nicknameMatters', event.target.value === '' ? null : event.target.value === 'oui')}
        >
          <option value="">Surnom (non renseigné au formulaire)</option>
          <option value="oui">Surnom</option>
          <option value="non">Prénom</option>
        </select>
      </label>
    </>
  );
}

export function ContactEdit({ volunteer, set, prefix }: SectionProps) {
  return (
    <>
      <label className="field">
        <span className="field-label">Téléphone</span>
        <FicheText name={`${prefix}-phone`} ariaLabel="Téléphone" type="tel" value={volunteer.phone} onCommit={(v) => set('phone', v)} />
      </label>
      <label className="field">
        <span className="field-label">E-mail</span>
        <FicheText name={`${prefix}-email`} ariaLabel="E-mail" type="email" value={volunteer.email} onCommit={(v) => set('email', v)} />
      </label>
    </>
  );
}

/**
 * Field data, 2026-09-15. Read by the régie and the responsables only: the plan an orga without a
 * pole opens has neither field (see get_organiser_planning).
 */
export function FieldDataEdit({ volunteer, set, prefix }: SectionProps) {
  return (
    <>
      <label className="field">
        <span className="field-label">Contact d'urgence</span>
        <FicheText
          name={`${prefix}-emergency`}
          ariaLabel="Contact d'urgence"
          value={volunteer.emergencyContact ?? ''}
          placeholder="nom et téléphone"
          onCommit={(v) => set('emergencyContact', v)}
        />
      </label>
      <label className="field">
        <span className="field-label">Santé, besoins</span>
        <FicheText
          name={`${prefix}-health`}
          ariaLabel="Santé, besoins"
          value={volunteer.healthNote ?? ''}
          placeholder="rien de signalé"
          onCommit={(v) => set('healthNote', v)}
        />
      </label>
      <label className="field">
        <span className="field-label">Mineur·e</span>
        <select
          className="select"
          name={`${prefix}-minor`}
          value={volunteer.minor === true ? 'oui' : volunteer.minor === false ? 'non' : ''}
          onChange={(event) => set('minor', event.target.value === '' ? null : event.target.value === 'oui')}
        >
          <option value="">Non renseigné</option>
          <option value="non">Non</option>
          <option value="oui">Oui</option>
        </select>
      </label>
    </>
  );
}

/**
 * What the caterer reads. Correctable because a caterer ACTS on it: "végé", "vegetarien" and "pas
 * de viande" are one plate, and the régisseur is the one who can say so. A ré-import never undoes
 * what is corrected here; see `reconcile.ts`.
 */
export function MealsEdit({ volunteer, set, prefix }: SectionProps) {
  return (
    <>
      <label className="field">
        <span className="field-label">Régime</span>
        <FicheText name={`${prefix}-diet`} ariaLabel="Régime" value={volunteer.diet} placeholder="sans restriction" onCommit={(v) => set('diet', v)} />
      </label>
      <label className="field">
        <span className="field-label">Allergies</span>
        <FicheText name={`${prefix}-allergies`} ariaLabel="Allergies" value={volunteer.allergies} placeholder="aucune" onCommit={(v) => set('allergies', v)} />
      </label>
    </>
  );
}
