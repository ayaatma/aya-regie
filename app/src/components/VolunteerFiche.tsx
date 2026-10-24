/**
 * One bénévole, whole: what they answered, what the plan did with it, and what is wrong.
 *
 * WAS `SidePanel`'s "Bénévole" TAB, until 2026-09-11. A fiche is not a tab: it is what the panel
 * shows about whatever was clicked, and a tab meant the régisseur had to leave the list they were
 * picking from in order to read about the person they had just picked. It now lives in a pane of
 * its own, beside the pools rather than instead of them. See `InfoPanel` and `Selection`.
 *
 * SELF-CONTAINED, ALSO SINCE THE MOVE. It used to be handed `index`, `report` and three callbacks
 * by the one screen that drew it. It is drawn by three screens now, and threading five props
 * through each of them to arrive at the same three `edit` calls would be five chances to pass the
 * wrong one. Everything it needs is in the plan context, exactly as `OrganiserFiche` already did.
 *
 * READ, OR EDITED IN PLACE, since 2026-10-24. « Modifier la fiche » used to swap the whole fiche
 * for a form of another shape, where nothing was where the régisseur had just read it. Now the
 * 🖍️ of the pane's head (`editing`, held by the pane) turns each section into its own fields, at
 * the same place: the name and contact where they are read, the choices under « Ses choix », the
 * refusals under « Ne veut pas ». Out of it the fiche is read and only the daily actions stay
 * live: validating, the réserve, the steps, the note, the waiting list, a status change.
 *
 * FOLDED IN CATEGORIES, AND REDUCED BESIDE A GRID, since 2026-10-24: on the Personnes tab a head
 * that stays open (photo, status, warning, waiting list) over folded categories (`FicheFold`);
 * beside a grid only what placing the person there needs. See `FicheContext`.
 *
 * Correcting a fiche and validating it are ordinary edits: they land in the undo stack and in the
 * journal with a sentence naming the person, because a correction can turn one of their boxes red
 * and being able to take it back the same way as a drag is what makes it safe to try.
 */

import { Fragment, useState, type ReactNode } from 'react';

import {
  addBuddy,
  correctVolunteer,
  markReviewed,
  markToReview,
  removeBuddy,
  setReserve,
} from '../store/edits.ts';
import {
  ENERGY_LABEL,
  choicePoleLabel,
  driveFileIds,
  fmtHours,
  windowHours,
  isNoAllergy,
  isStandardDiet,
  normalise,
  parsePoleAnswer,
  type EditableField,
  type Plan,
  type PlanIndex,
  type PoleChoice,
  type ValidationResult,
  type Volunteer,
  type VolunteerReport,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { setVolunteerPhase } from '../store/phaseEdits.ts';
import { preferenceLabel, slotLabel } from './labels.ts';
import { choiceRankLabel, levelLabel, volumeText } from './layout.ts';
import {
  ArtistsEdit,
  AvoidedSlotsEdit,
  ChoicesEdit,
  ContactEdit,
  FieldDataEdit,
  IdentityEdit,
  MealsEdit,
  RefusedPolesEdit,
  RefusedSlotsEdit,
  RequestEdit,
  type SectionProps,
  type SetField,
} from './VolunteerEdit.tsx';
import { ApplicationSection, ReleasePlaces, holdsPlacesCancelled } from './ApplicationSection.tsx';
import { FOLD_IDS, FicheFold, FoldAll, type FoldTone } from './FicheFold.tsx';
import { AvailabilityDays } from './AvailabilityDays.tsx';
import { PhaseDaysEdit, volunteerPhases } from './PhaseDaysEdit.tsx';
import { UnavailableRanges } from './UnavailableRanges.tsx';
import { SkillPicker } from './SkillPicker.tsx';
import { PersonPhoto } from './PersonPhoto.tsx';
import { RegistrationSection } from './RegistrationSection.tsx';

/**
 * The chips at the top of somebody's panel, and what each one is allowed to claim.
 *
 * "Planning illégal" is a heavy sentence and it only ever fires on a tier 1 issue: a rule that
 * must never be broken, actually broken. `VolunteerReport.colour` cannot be used for it, because
 * red wins there over everything, so a volunteer with a single tier 2 remark would be announced
 * as illegal. A tier 2 remark says "à surveiller", in orange, and being placed outside both
 * chosen poles is not a fault at all: it is a quality result, worth naming, in orange.
 */
export function statusChips(
  report: VolunteerReport,
): Array<{ label: string; tone: 'bad' | 'warn' | '' }> {
  const chips: Array<{ label: string; tone: 'bad' | 'warn' | '' }> = [];

  const tier1 = report.issues.filter((issue) => issue.tier === 1).length;
  if (tier1 > 0) {
    chips.push({ label: tier1 > 1 ? `${tier1} règles enfreintes` : 'Planning illégal', tone: 'bad' });
  } else if (report.issues.length > 0) {
    chips.push({ label: 'À surveiller', tone: 'warn' });
  }

  if (report.hoursOutside > 0) chips.push({ label: 'Hors choix', tone: 'warn' });

  if (report.volumeBand === 'orange-fonce') chips.push({ label: 'Journée très longue', tone: '' });
  else if (report.volumeBand === 'orange-clair') chips.push({ label: 'Journée longue', tone: '' });

  return chips;
}

/**
 * Where a fiche is read, since 2026-10-24, and what it shows there.
 *
 * - `personnes`: the whole fiche, in folded categories (`FicheFold`) under a head that stays open:
 *   photo, status, warning, waiting list.
 * - `exploit`, the pane of the exploit grid: only what placing somebody at an hour on a pole needs,
 *   open, nothing folded: their day, their wishes, their constraints. The rest is « Ouvrir dans
 *   Personnes » away, and the practical facts (phone, urgence, santé) one fold below.
 * - `phase`, the pane of the montage and démontage grids: the same, with the phase answers in place
 *   of the exploit's choices.
 */
export type FicheContext = 'personnes' | 'exploit' | 'phase';

export function VolunteerFiche({
  volunteerKey,
  readOnly = false,
  editing = false,
  context = 'personnes',
  practical,
  trailing,
}: {
  volunteerKey: string;
  readOnly?: boolean;
  /** The pane's mode édition: every section becomes its fields, in place. Ignored when read-only. */
  editing?: boolean;
  context?: FicheContext;
  /** Drawn at the end of « Pratique et formulaire »: the door's fields, on the Personnes tab. */
  practical?: ReactNode;
  /** Categories drawn after the fiche's own (the Personnes tab's « Statut »), under the same « Tout déplier ». */
  trailing?: ReactNode;
}) {
  const { index, report, edit } = useLoadedPlan();

  const onSetReserve = (key: string, reserve: boolean) => {
    const name = index.volunteerName(key);
    edit(
      (p) => setReserve(p, key, reserve),
      reserve ? `mise en liste d'attente de ${name}` : `sortie de liste d'attente de ${name}`,
    );
  };

  const onCorrect = (key: string, patch: Partial<Pick<Volunteer, EditableField>>) => {
    if (Object.keys(patch).length === 0) return;
    edit((p) => correctVolunteer(p, key, patch), `correction de la fiche de ${index.volunteerName(key)}`);
  };

  const onReviewed = (key: string) => {
    edit((p) => markReviewed(p, key), `fiche de ${index.volunteerName(key)} relue`);
  };

  const onToReview = (key: string) => {
    edit(
      (p) => markToReview(p, key, 'Remise à relire à la main par la régie.'),
      `fiche de ${index.volunteerName(key)} remise à relire`,
    );
  };

  return (
    <VolunteerDetail
      index={index}
      report={report}
      volunteerKey={volunteerKey}
      onSetReserve={onSetReserve}
      onCorrect={onCorrect}
      onReviewed={onReviewed}
      onToReview={onToReview}
      readOnly={readOnly}
      editing={editing && !readOnly}
      context={context}
      practical={practical}
      trailing={trailing}
    />
  );
}


interface VolunteerDetailProps {
  index: PlanIndex;
  report: ValidationResult;
  volunteerKey: string;
  onSetReserve(volunteerKey: string, reserve: boolean): void;
  /** Corrects what the tool made of somebody’s answers. Marks the fields as corrected. */
  onCorrect(volunteerKey: string, patch: Partial<Pick<Volunteer, EditableField>>): void;
  /** "J’ai relu cette fiche": clears the review tag and its reasons. */
  onReviewed(volunteerKey: string): void;
  /** Sends the fiche back to « à relire », since 2026-09-16: one click, from the fiche itself. */
  onToReview(volunteerKey: string): void;
  readOnly?: boolean;
  editing: boolean;
  context: FicheContext;
  practical?: ReactNode;
  trailing?: ReactNode;
}

function VolunteerDetail({
  index,
  report,
  volunteerKey,
  onSetReserve,
  onCorrect,
  onReviewed,
  onToReview,
  readOnly = false,
  editing,
  context,
  practical,
  trailing,
}: VolunteerDetailProps) {
  const { edit } = useLoadedPlan();

  const detail = report.volunteers.find((v) => v.key === volunteerKey);
  const volunteer: Volunteer | undefined = index.volunteerByKey.get(volunteerKey);
  if (!detail || !volunteer) return <p className="pool-empty">Bénévole introuvable.</p>;

  const plan = index.plan;
  const folded = context === 'personnes';
  const chips = statusChips(detail);
  // Joining the reserve means zero hours, so it is refused outright for somebody holding a
  // pinned place rather than half-applied. The edit layer refuses it too; this says why.
  const pinned = plan.assignments.some((a) => a.volunteerKey === volunteerKey && a.locked);

  // What the sections of « Corriger la lecture » write through, here straight into the plan: one
  // field, one correction, one line of journal. See `VolunteerEdit`.
  const set: SetField = (field, value) => onCorrect(volunteer.key, { [field]: value });
  const sections: SectionProps = { index, volunteer, set, prefix: `fiche-${volunteer.key}` };
  const hasFieldData = (volunteer.emergencyContact ?? '').trim() !== '' || (volunteer.healthNote ?? '').trim() !== '';
  const hasPhases = volunteerPhases(plan).length > 0;
  const teamName = volunteer.teamKey ? (plan.teams.find((t) => t.key === volunteer.teamKey)?.name ?? 'Équipe') : '';

  // ---- The head, never folded --------------------------------------------------------------

  /*
    THE NAME IS NOT WRITTEN HERE, since 2026-09-12: the pane's head already names the person, with
    the nickname, and writing it again put the same "Prénom Nom" twice at the top. In mode édition
    the name is a field right under the photo, where it is read.
  */
  const head = (
    <>
      <PersonPhoto
        personKey={volunteer.key}
        name={`${volunteer.firstName} ${volunteer.lastName}`}
        readOnly={readOnly}
        editing={editing}
        formFileId={driveFileIds(volunteer.formAnswers?.photo ?? '')[0] ?? null}
      />
      {/* Right under the photo since 2026-10-24: what is wrong is the first thing read after the face. */}
      <FicheWarning volunteer={volunteer} detail={detail} readOnly={readOnly} onReviewed={onReviewed} />
      {editing ? (
        <div className="panel-section">
          <IdentityEdit {...sections} />
        </div>
      ) : (
        folded &&
        volunteer.nickname.trim() !== '' && (
          <p className="panel-sub">Sur le planning: {index.volunteerShortName(volunteer.key)}</p>
        )
      )}
      <RegistrationSection kind="benevole" personKey={volunteer.key} readOnly={readOnly || !folded} part="status" />
      {(volunteer.minor === true || volunteer.backup === true) && (
        <p className="fiche-head-marks">
          {volunteer.minor === true && <span className="chip is-warn">Mineur·e</span>}
          {volunteer.backup === true && <span className="chip is-ok">Réserve</span>}
        </p>
      )}
    </>
  );

  /*
    Putting somebody on the waiting list is telling them they are not needed. It is the single
    most consequential button of the fiche, so a reader is not offered it at all: what they see
    instead is the fact, which is what they came for. Only on the Personnes tab since 2026-10-24.
  */
  const waitingList = readOnly ? (
    detail.reserve && <p className="panel-sub">Cette personne est en liste d'attente.</p>
  ) : (
    <div className="panel-section">
      <button
        className={`btn ${detail.reserve ? '' : 'is-danger'}`}
        disabled={!detail.reserve && pinned}
        onClick={() => onSetReserve(volunteerKey, !detail.reserve)}
      >
        {detail.reserve ? "Sortir de la liste d'attente" : "Mettre en liste d'attente"}
      </button>
      {!detail.reserve && pinned && (
        <p className="panel-sub" style={{ marginTop: 6 }}>
          Impossible: la liste d'attente met à zéro heure, et cette personne occupe une place
          verrouillée. Déverrouillez-la d'abord sur la grille.
        </p>
      )}
      {!detail.reserve && !pinned && detail.assignedHours > 0 && (
        <p className="panel-sub" style={{ marginTop: 6 }}>
          La mise en liste d'attente retire ses {fmtHours(detail.assignedHours)} d'affectation.
        </p>
      )}
    </div>
  );

  // ---- Affectation: what the plan did with them --------------------------------------------

  const affectation = (
    <>
      {chips.length > 0 && (
        <p>
          {chips.map((chip) => (
            <span key={chip.label} className={`chip ${chip.tone ? `is-${chip.tone}` : ''}`}>
              {chip.label}
            </span>
          ))}
        </p>
      )}

      <dl className="kv is-near">
        <dt>Heures affectées</dt>
        <dd>
          {fmtHours(detail.assignedHours)} / {fmtHours(detail.requestedTotalHours)}
        </dd>
        {detail.hoursByRank.map((hours, rank) =>
          hours > 0 ? (
            <Fragment key={rank}>
              <dt>{choiceRankLabel(rank, plan.poleChoicesRanked !== false)}</dt>
              <dd>{fmtHours(hours)}</dd>
            </Fragment>
          ) : null,
        )}
        <dt>Hors choix</dt>
        <dd>{fmtHours(detail.hoursOutside)}</dd>
        {detail.toleratedOverflowHours > 0 && (
          <>
            <dt>Débordement toléré</dt>
            <dd>{fmtHours(detail.toleratedOverflowHours)}</dd>
          </>
        )}
        {/*
          Marked as a problem, unlike the line above it. The overflow the régisseur accepts is
          the plan working as intended; hours past it are somebody working against the answer
          they gave, which is a tier 2 signalement and reads as one here.
        */}
        {detail.againstPreferenceHours > 0 && (
          <>
            <dt>Contre sa préférence</dt>
            <dd className="is-bad">{fmtHours(detail.againstPreferenceHours)}</dd>
          </>
        )}
      </dl>

      <div className="panel-section">
        <p className="panel-section-title">Sa journée</p>
        {detail.blocks.length === 0 && (
          <p className="pool-empty">
            {detail.reserve ? "En liste d'attente, zéro heure, volontairement." : 'Aucune affectation.'}
          </p>
        )}
        {detail.blocks.map((block, i) => (
          <p key={i}>
            {index.label(block.start)} à {index.label(block.end)}{' '}
            <span className="pool-item-meta">({fmtHours(block.end - block.start)})</span>
            <br />
            {block.shiftKeys.map((key) => {
              const shift = index.shiftByKey.get(key);
              return (
                <span key={key} className="chip">
                  {shift ? index.polePath(shift.poleKey) : key}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </>
  );

  // ---- Souhaits: what they asked for -------------------------------------------------------

  const choices = (
    <div className="panel-section">
      <p className="panel-section-title">Ses choix</p>
      {/*
        The pole a responsable sent them to, 2026-09-15: counts as their first choice, and the
        solver keeps them there. The régisseur can still drag them anywhere.
      */}
      {editing ? (
        <label className="people-meta imposed-pole">
          Pôle imposé par un·e responsable{' '}
          <select
            className="select is-inline"
            name="fiche-imposed-pole"
            value={volunteer.imposedPoleKey ?? ''}
            onChange={(event) => {
              const imposedPoleKey = event.target.value === '' ? null : event.target.value;
              edit((p) => correctVolunteer(p, volunteer.key, { imposedPoleKey }), `pôle imposé de ${index.volunteerName(volunteer.key)}`);
            }}
          >
            <option value="">aucun</option>
            {plan.poles.map((p) => (
              <option key={p.key} value={p.key}>{p.path}</option>
            ))}
          </select>
        </label>
      ) : (
        volunteer.imposedPoleKey && (
          <p><span className="chip is-ok">Pôle imposé: {index.polePath(volunteer.imposedPoleKey)}</span></p>
        )
      )}
      {editing ? (
        <ChoicesEdit {...sections} />
      ) : volunteer.choices.length === 0 ? (
        <p className="pool-item-meta">Aucun choix de pôle.</p>
      ) : (
        <p>
          {volunteer.choices.map((choice, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {plan.poleChoicesRanked !== false ? `${i + 1}. ` : '• '}
              {choicePoleLabel(choice, (key) => index.polePath(key))}{' '}
              <span className="pool-item-meta">({levelLabel(choice.level)})</span>
              {answerDiffers(choice, plan) && (
                <span className="pool-item-meta" title="Ce qui a été répondu au formulaire, avant la correction">
                  {' '}· réponse au formulaire: « {choice.raw.trim()} »
                </span>
              )}
            </Fragment>
          ))}
        </p>
      )}
      {detail.horsChoixPoles.length > 0 && (
        <p>
          Hors de ses choix:{' '}
          {detail.horsChoixPoles.map((path) => (
            <span key={path} className="chip is-warn">
              {path}
            </span>
          ))}
        </p>
      )}
    </div>
  );

  const artists = editing ? (
    <ArtistsEdit {...sections} />
  ) : (
    volunteer.artistKeys.length > 0 && (
      <div className="panel-section">
        <p className="panel-section-title">Ne veut pas manquer</p>
        {volunteer.artistKeys.map((key) => (
          <span key={key} className="chip">
            {index.artistByKey.get(key)?.name ?? key}
          </span>
        ))}
      </div>
    )
  );

  const sideActivities = plan.sideActivities.length > 0 && (
    <div className="panel-section">
      <p className="panel-section-title">Activités annexes</p>
      <SkillPicker
        skills={plan.sideActivities.map((a) => ({ key: a.key, label: a.when ? `${a.label} (${a.when})` : a.label }))}
        value={volunteer.sideActivityKeys ?? []}
        readOnly={!editing}
        name={`fiche-activity-${volunteer.key}`}
        onChange={(sideActivityKeys, changed, on) =>
          edit((p) => correctVolunteer(p, volunteer.key, { sideActivityKeys }), `${changed.label} ${on ? 'coché' : 'décoché'}: ${index.volunteerName(volunteer.key)}`)
        }
      />
    </div>
  );

  const souhaits = (
    <>
      {editing ? (
        <div className="panel-section">
          <RequestEdit {...sections} />
        </div>
      ) : (
        <p className="panel-sub">
          {preferenceLabel(plan.preferenceSlots, volunteer.preferredSlotId)},{' '}
          {volumeText(volunteer.requestedHours, index.dayMode)} demandées
        </p>
      )}
      {choices}
      <BuddiesSection volunteer={volunteer} buddies={detail.buddies} readOnly={!editing} />
      {artists}
      <SkillsSection volunteer={volunteer} readOnly={!editing} />
      {sideActivities}
    </>
  );

  // ---- Contraintes: what they ruled out ----------------------------------------------------

  /*
    Refusals get their own line rather than a clause at the end of a grey sentence. They are hard
    constraints: placing somebody in a slot or a pole they ruled out is a tier 1 issue, and the
    régisseur looking at a box needs to see the veto without hunting for it.
  */
  const contraintes = (
    <>
      {editing ? (
        <>
          <RefusedSlotsEdit {...sections} withRanges={false} />
          <RefusedPolesEdit {...sections} />
        </>
      ) : (
        (volunteer.refusedSlotIds.length > 0 || volunteer.refusedPoleKeys.length > 0) && (
          <div className="panel-section">
            <p className="panel-section-title">Ne veut pas</p>
            {volunteer.refusedSlotIds.map((id) => (
              <span className="chip is-bad" key={id}>
                Travailler {slotLabel(index.slots, id)}
              </span>
            ))}
            {volunteer.refusedPoleKeys.map((key) => (
              <span className="chip is-bad" key={key}>
                Le pôle {index.polePath(key)}
              </span>
            ))}
          </div>
        )
      )}

      {editing ? (
        <AvoidedSlotsEdit {...sections} />
      ) : (
        (volunteer.avoidedSlotIds ?? []).length > 0 && (
          <div className="panel-section">
            <p className="panel-section-title">Préfère éviter</p>
            {(volunteer.avoidedSlotIds ?? []).map((id) => (
              <span className="chip is-warn" key={id}>
                Travailler {slotLabel(index.slots, id)}
              </span>
            ))}
          </div>
        )
      )}

      {/* « Plages libres » holds any stretch, which a day's two edges cannot show: the list instead. */}
      {plan.availabilityMode === 'plages' ? (
        <div className="panel-section">
          <p className="panel-section-title">Ne peut pas travailler</p>
          <p className="people-meta">
            {fmtHours(windowHours(index.windowsOf(volunteer.key)))} disponibles sur l'événement, tranches refusées déduites
            {volunteer.manualFields.includes('unavailable') ? ' · corrigé à la main' : ''}.
          </p>
          <UnavailableRanges
            index={index}
            windows={volunteer.unavailable ?? []}
            namePrefix="fiche"
            readOnly={!editing}
            onChange={(unavailable) =>
              edit((p) => correctVolunteer(p, volunteer.key, { unavailable }), `plages indisponibles de ${index.volunteerName(volunteer.key)}`)
            }
          />
        </div>
      ) : (
        <AvailabilityDays volunteer={volunteer} readOnly={!editing} />
      )}
    </>
  );

  // ---- Suivi: where the régie is with them -------------------------------------------------

  const suivi = (
    <>
      <RegistrationSection kind="benevole" personKey={volunteer.key} readOnly={readOnly} part="mails" />
      <ApplicationSection volunteer={volunteer} detail={detail} readOnly={readOnly} editing={editing} />
      {!volunteer.needsReview && !readOnly && (
        <p className="fiche-back-to-review">
          <button
            className="btn is-small"
            onClick={() => onToReview(volunteer.key)}
            title="La fiche repasse en rouge dans Personnes, jusqu'à ce qu'on la valide"
          >
            Remettre à relire
          </button>
        </p>
      )}
    </>
  );

  // ---- Pratique et formulaire: how to reach them, what they need, what they wrote ----------

  const pratique = (
    <>
      {editing ? (
        <div className="panel-section">
          <ContactEdit {...sections} />
        </div>
      ) : (
        (volunteer.phone || volunteer.email) && (
          <p className="panel-contact">
            {volunteer.phone && (
              <a className="chip" href={`tel:${volunteer.phone.replace(/\s+/g, '')}`}>
                {volunteer.phone}
              </a>
            )}
            {volunteer.email && (
              <a className="chip" href={`mailto:${volunteer.email}`}>
                {volunteer.email}
              </a>
            )}
          </p>
        )
      )}

      {/* Field data: shown whenever there is any, since this is what is needed in a hurry. */}
      {editing ? (
        <div className="panel-section">
          <p className="panel-section-title">Sur le terrain</p>
          <FieldDataEdit {...sections} />
        </div>
      ) : (
        hasFieldData && (
          <div className="panel-section fiche-field-data">
            <p className="panel-section-title">Sur le terrain</p>
            {(volunteer.emergencyContact ?? '').trim() !== '' && (
              <p className="fiche-raw-answer">
                <span className="fiche-raw-label">En cas d'urgence</span>
                {volunteer.emergencyContact}
              </p>
            )}
            {(volunteer.healthNote ?? '').trim() !== '' && (
              <p className="fiche-raw-answer">
                <span className="fiche-raw-label">Santé, besoins</span>
                {volunteer.healthNote}
              </p>
            )}
          </div>
        )
      )}

      {/*
        Shown only when there is something to say. A fiche is read on the night with a phone in
        the other hand, and "Régime: sans restriction" on a hundred and twenty of them is a line
        that pushes the useful ones off the screen.
      */}
      {editing ? (
        <div className="panel-section">
          <p className="panel-section-title">Repas</p>
          <MealsEdit {...sections} />
        </div>
      ) : (
        (!isStandardDiet(volunteer.diet) || !isNoAllergy(volunteer.allergies)) && (
          <div className="panel-section">
            <p className="panel-section-title">Repas</p>
            <p>
              {!isStandardDiet(volunteer.diet) && <span className="chip is-warn">{volunteer.diet.trim()}</span>}
              {!isNoAllergy(volunteer.allergies) && (
                <span className="chip is-bad">Allergie: {volunteer.allergies.trim()}</span>
              )}
            </p>
          </div>
        )
      )}

      <RawAnswers volunteer={volunteer} />
      {practical}
    </>
  );

  // ---- What each closed category says ------------------------------------------------------

  const refusals = volunteer.refusedSlotIds.length + volunteer.refusedPoleKeys.length;
  const avoided = (volunteer.avoidedSlotIds ?? []).length;
  const summaries = {
    affectation: detail.reserve
      ? "Liste d'attente"
      : [`${fmtHours(detail.assignedHours)} / ${fmtHours(detail.requestedTotalHours)}`, ...chips.map((c) => c.label)].join(' · '),
    souhaits: [
      preferenceLabel(plan.preferenceSlots, volunteer.preferredSlotId),
      volunteer.imposedPoleKey ? `imposé: ${index.polePath(volunteer.imposedPoleKey)}` : '',
      ...volunteer.choices.map((c) => choicePoleLabel(c, (key) => index.polePath(key))),
    ]
      .filter(Boolean)
      .join(' · '),
    contraintes:
      [
        refusals > 0 ? `${refusals} refus` : '',
        avoided > 0 ? `${avoided} à éviter` : '',
        plan.availabilityMode === 'plages' ? `${fmtHours(windowHours(index.windowsOf(volunteer.key)))} disponibles` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Aucun refus',
    phases:
      volunteerPhases(plan)
        .filter((id) => (id === 'montage' ? volunteer.montage : volunteer.demontage).present)
        .map((id) => {
          const phase = id === 'montage' ? plan.montage : plan.demontage;
          return phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
        })
        .join(' · ') || 'Pas là',
    suivi: [
      volunteer.backup ? 'Réserve' : '',
      teamName,
      volunteer.energy ? ENERGY_LABEL[volunteer.energy] : '',
      (volunteer.regieNote ?? '').trim() !== '' ? 'note' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    pratique: [
      volunteer.phone,
      !isStandardDiet(volunteer.diet) ? volunteer.diet.trim() : '',
      !isNoAllergy(volunteer.allergies) ? `Allergie: ${volunteer.allergies.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
  const affectationTone: FoldTone = chips.some((c) => c.tone === 'bad') ? 'bad' : chips.some((c) => c.tone === 'warn') ? 'warn' : '';
  const pratiqueFold = (
    <FicheFold
      id={FOLD_IDS.pratique}
      title="Pratique et formulaire"
      summary={summaries.pratique}
      tone={isNoAllergy(volunteer.allergies) ? '' : 'bad'}
    >
      {pratique}
    </FicheFold>
  );

  // ---- The planning's panes: open, and only what placing them needs ------------------------

  if (!folded) {
    return (
      <>
        {head}
        {context === 'exploit' ? (
          <>
            {affectation}
            {souhaits}
            {contraintes}
          </>
        ) : (
          <>
            <PhaseAnswers volunteer={volunteer} readOnly={!editing} />
            <BuddiesSection volunteer={volunteer} buddies={detail.buddies} readOnly={!editing} />
            <SkillsSection volunteer={volunteer} readOnly={!editing} />
          </>
        )}
        {pratiqueFold}
      </>
    );
  }

  // ---- The Personnes tab: the head, then the categories ------------------------------------

  const ids = [
    FOLD_IDS.affectation,
    FOLD_IDS.souhaits,
    FOLD_IDS.contraintes,
    ...(hasPhases ? [FOLD_IDS.phases] : []),
    FOLD_IDS.suivi,
    FOLD_IDS.pratique,
    ...(trailing ? [FOLD_IDS.statut] : []),
  ];

  return (
    <>
      {head}
      {waitingList}
      <FoldAll ids={ids} />
      <FicheFold id={FOLD_IDS.affectation} title="Affectation" summary={summaries.affectation} tone={affectationTone}>
        {affectation}
      </FicheFold>
      <FicheFold id={FOLD_IDS.souhaits} title="Souhaits" summary={summaries.souhaits}>
        {souhaits}
      </FicheFold>
      <FicheFold
        id={FOLD_IDS.contraintes}
        title="Contraintes"
        summary={summaries.contraintes}
        tone={refusals > 0 ? 'bad' : avoided > 0 ? 'warn' : ''}
      >
        {contraintes}
      </FicheFold>
      {hasPhases && (
        <FicheFold id={FOLD_IDS.phases} title="Montage et démontage" summary={summaries.phases}>
          <PhaseAnswers volunteer={volunteer} readOnly={!editing} />
        </FicheFold>
      )}
      <FicheFold id={FOLD_IDS.suivi} title="Suivi" summary={summaries.suivi}>
        {suivi}
      </FicheFold>
      {pratiqueFold}
      {trailing}
    </>
  );
}

/**
 * The warning at the top of a fiche, 2026-10-24: « à relire », the signalements and a cancelled
 * person still holding places, in one box that stays above the folds.
 *
 * The doubt the importer had sits here because it is a statement about the fiche itself: what is
 * written below may be a guess. Validating says a human has read the answers as typed and stands
 * behind what the tool made of them, whether or not anything was corrected.
 *
 * The line says what is wrong; the detail (the reasons, every signalement) opens under it, closed
 * by default so that a fiche with three tier 2 remarks is not a wall of them. « Valider la fiche »
 * and freeing the places of a cancelled person are never folded.
 */
function FicheWarning({
  volunteer,
  detail,
  readOnly,
  onReviewed,
}: {
  volunteer: Volunteer;
  detail: VolunteerReport;
  readOnly: boolean;
  onReviewed(volunteerKey: string): void;
}) {
  const { plan } = useLoadedPlan();
  const release = !readOnly && holdsPlacesCancelled(plan, volunteer);
  const issues = detail.issues;
  if (!volunteer.needsReview && issues.length === 0 && !release) return null;

  const tier1 = issues.filter((issue) => issue.tier === 1).length;
  const line = [
    volunteer.needsReview ? 'Fiche à relire' : '',
    issues.length > 0 ? `${issues.length} signalement${issues.length > 1 ? 's' : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`fiche-review${tier1 > 0 ? ' is-bad' : ''}`}>
      {release && <ReleasePlaces volunteer={volunteer} detail={detail} />}
      {line !== '' && (
        <details className="fiche-warning">
          <summary className="fiche-warning-line">⚠️ {line}</summary>
          {volunteer.needsReview && (
            <>
              <p className="panel-section-title">À relire</p>
              {volunteer.reviewReasons.map((reason, i) => (
                <p className="fiche-review-reason" key={i}>
                  {reason}
                </p>
              ))}
            </>
          )}
          {issues.length > 0 && (
            <>
              <p className="panel-section-title">Signalements</p>
              {issues.map((issue, i) => (
                <div key={i} className={`issue ${issue.tier === 2 ? 'is-tier2' : ''}`}>
                  <span className="issue-code">{issue.code}</span>
                  {issue.message}
                </div>
              ))}
            </>
          )}
        </details>
      )}
      {/* Not folded: validating a fiche read is the gesture of the weeks of the import. */}
      {volunteer.needsReview && !readOnly && (
        <button className="btn is-primary is-small" onClick={() => onReviewed(volunteer.key)}>
          Valider la fiche
        </button>
      )}
    </div>
  );
}

/**
 * Compétences: the tags held, ticked here as a correction of the form's answer (so a re-import
 * keeps them), with the sentence they were read from underneath.
 */
function SkillsSection({ volunteer, readOnly }: { volunteer: Volunteer; readOnly: boolean }) {
  const { plan, index, edit } = useLoadedPlan();
  if (plan.skills.length === 0 && (volunteer.skillsNote ?? '').trim() === '') return null;
  const name = index.volunteerName(volunteer.key);
  return (
    <div className="panel-section">
      <p className="panel-section-title">Compétences</p>
      <SkillPicker
        skills={plan.skills}
        value={volunteer.skills ?? []}
        readOnly={readOnly}
        name={`fiche-skill-${volunteer.key}`}
        onChange={(skills, changed, on) =>
          edit((p) => correctVolunteer(p, volunteer.key, { skills }), `${changed.label} ${on ? 'ajouté' : 'retiré'}: ${name}`)
        }
      />
      {(volunteer.skillsNote ?? '').trim() !== '' && (
        <p className="fiche-raw-answer">
          <span className="fiche-raw-label">Réponse</span>
          {volunteer.skillsNote}
        </p>
      )}
    </div>
  );
}

/**
 * Binômes: those asked for, whether the plan honours them, and, since 2026-09-14, adding or
 * removing one by hand. N binômes per person, as the model always allowed; what was missing was a
 * way to settle one the import could not resolve (« Marie D. », a nickname) without editing the
 * form's answer.
 */
function BuddiesSection({
  volunteer,
  buddies,
  readOnly,
}: {
  volunteer: Volunteer;
  buddies: VolunteerReport['buddies'];
  readOnly: boolean;
}) {
  const { index, edit } = useLoadedPlan();
  const [adding, setAdding] = useState('');
  const resolvedNames = new Set(buddies.map((b) => b.toName));
  const unresolved = volunteer.buddyRawNames.filter(
    (raw) => ![...resolvedNames].some((name) => name.toLowerCase().includes(raw.toLowerCase()) || raw.toLowerCase().includes(name.toLowerCase())),
  );
  const others = index.plan.volunteers
    .filter((v) => v.key !== volunteer.key && !buddies.some((b) => b.toKey === v.key))
    .map((v) => ({ key: v.key, name: index.volunteerName(v.key) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (readOnly && buddies.length === 0) return null;

  return (
    <div className="panel-section">
      <p className="panel-section-title">Binômes demandés</p>
      {buddies.length === 0 && <p className="pool-item-meta">Aucun.</p>}
      {buddies.map((buddy) => (
        <span key={buddy.toKey} className={`chip ${buddy.honoured ? 'is-ok' : 'is-bad'}`}>
          {buddy.toName} {buddy.honoured ? '✓' : '✗'}
          {!readOnly && (
            <button
              type="button"
              className="chip-remove"
              title={`Retirer le binôme avec ${buddy.toName}`}
              aria-label={`Retirer le binôme avec ${buddy.toName}`}
              onClick={() => edit((p) => removeBuddy(p, volunteer.key, buddy.toKey), `binôme retiré: ${buddy.toName}`)}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {unresolved.length > 0 && (
        <p className="pool-item-meta">
          Écrit dans le formulaire sans correspondance: {unresolved.map((raw) => `« ${raw} »`).join(', ')}.
        </p>
      )}
      {!readOnly && (
        <div className="buddy-add">
          <select
            className="select"
            aria-label="Ajouter un binôme"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          >
            <option value="">Ajouter un binôme…</option>
            {others.map((o) => (
              <option key={o.key} value={o.key}>{o.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={adding === ''}
            onClick={() => {
              const name = index.volunteerName(adding);
              edit((p) => addBuddy(p, volunteer.key, adding), `binôme ajouté: ${name}`);
              setAdding('');
            }}
          >
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The answers as they were typed, above everything the tool made of them.
 *
 * ALWAYS SHOWN WHEN THERE IS ONE, not only when a fiche is flagged. A reading that nobody
 * doubted can still be wrong, and the régisseur looking at somebody’s availability needs the
 * sentence in front of them to notice it. This is also the only place the sentence exists in
 * the interface: nothing else displays it, and nothing anywhere may edit it.
 *
 * A pole answer is only worth showing when it is not simply the pole’s own name, which is what
 * the closed list produces and what most answers are.
 */
/**
 * Whether a pole choice says something else than its answer to the form, since 2026-10-22.
 *
 * « Je m'en fous », read as nothing and corrected to « Tous les pôles acceptés », used to vanish
 * from the fiche: the sentence was only shown while the choice was unread. So the answer is read
 * again the way the import reads it (the event's correspondence first, then the automatic rules)
 * and shown beside the choice whenever the choice now differs from that reading. An answer the
 * choice still matches says nothing new and is not repeated; an answer read as nothing and still
 * unread is shown in « Ce qui a été écrit » instead.
 */
function answerDiffers(choice: PoleChoice, plan: Plan): boolean {
  const raw = choice.raw.trim();
  if (raw === '') return false;
  const decided = plan.formMapping.answers.pole?.[normalise(raw)];
  const reading = decided !== undefined ? { value: decided, confident: true } : parsePoleAnswer(raw, plan.poles);
  const readAny = reading.value === '' && reading.confident;
  if (choice.anyPole) return !readAny;
  if (choice.poleKey === '') return false;
  return readAny || reading.value !== choice.poleKey;
}

function RawAnswers({ volunteer }: { volunteer: Volunteer }) {
  const note = volunteer.availabilityNote.trim();
  const choices = volunteer.choices
    .map((c, i) => [`Choix ${i + 1}`, c.raw, c.poleKey] as const)
    .filter(([, rawAnswer, key], i) => rawAnswer.trim() !== '' && key === '' && !volunteer.choices[i]!.anyPole);

  if (note === '' && choices.length === 0) return null;

  return (
    <div className="panel-section fiche-raw">
      <p className="panel-section-title">Ce qui a été écrit</p>
      {note !== '' && (
        <p className="fiche-raw-answer">
          <span className="fiche-raw-label">Contrainte horaire</span>
          {note}
        </p>
      )}
      {choices.map(([label, rawAnswer]) => (
        <p className="fiche-raw-answer" key={label}>
          <span className="fiche-raw-label">{label}</span>
          {rawAnswer.trim()}
        </p>
      ))}
    </div>
  );
}

/**
 * What this bénévole answered about the montage and the démontage, and the régisseur's reading.
 *
 * SHOWN ONLY FOR A PHASE THAT IS OPEN TO BÉNÉVOLES, because otherwise the answer changes nothing
 * and a fiche full of dead questions is a fiche nobody reads. The sentence, when there is one,
 * is in "Ce qui a été écrit" with the other raw answers: this block is the reading, and the
 * reading is what a régisseur may correct.
 *
 * Correcting marks the field, so a re-import of the same export never puts the old reading back.
 * See `setVolunteerPhase`.
 */
function PhaseAnswers({ volunteer, readOnly }: { volunteer: Volunteer; readOnly: boolean }) {
  const { plan, edit } = useLoadedPlan();
  const phases = volunteerPhases(plan);
  if (phases.length === 0) return null;

  return (
    <div className="panel-section">
      <p className="panel-section-title">Montage et démontage</p>
      {phases.map((id) => {
        const phase = id === 'montage' ? plan.montage : plan.demontage;
        const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
        return (
          <p key={id} className="people-meta">
            <PhaseDaysEdit
              id={id}
              phase={phase}
              answer={id === 'montage' ? volunteer.montage : volunteer.demontage}
              namePrefix="fiche"
              readOnly={readOnly}
              onChange={(presence) =>
                edit((p) => setVolunteerPhase(p, volunteer.key, id, presence), `${label.toLowerCase()} de ${volunteer.firstName}`)
              }
            />
            {volunteer.manualFields.includes(id) && ' · corrigé à la main'}
          </p>
        );
      })}
    </div>
  );
}
