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
 * Correcting a fiche and validating it are ordinary edits: they land in the undo stack and in the
 * journal with a sentence naming the person, because a correction can turn one of their boxes red
 * and being able to take it back the same way as a drag is what makes it safe to try.
 */

import { Fragment, useState } from 'react';

import {
  addBuddy,
  correctVolunteer,
  markReviewed,
  removeBuddy,
  setReserve,
} from '../store/edits.ts';
import {
  fmtHours,
  isNoAllergy,
  isStandardDiet,
  phaseDayParts,
  type EditableField,
  type PlanIndex,
  type ValidationResult,
  type Volunteer,
  type VolunteerReport,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { setVolunteerPhase } from '../store/phaseEdits.ts';
import { preferenceLabel, slotLabel } from './labels.ts';
import { choiceRankLabel, levelLabel, volumeText } from './layout.ts';
import { VolunteerEdit } from './VolunteerEdit.tsx';

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

export function VolunteerFiche({
  volunteerKey,
  readOnly = false,
}: {
  volunteerKey: string;
  readOnly?: boolean;
}) {
  const { index, report, edit } = useLoadedPlan();

  const onSetReserve = (key: string, reserve: boolean) => {
    const name = index.volunteerName(key);
    edit(
      (p) => setReserve(p, key, reserve),
      reserve ? `mise en réserve de ${name}` : `sortie de réserve de ${name}`,
    );
  };

  const onCorrect = (key: string, patch: Partial<Pick<Volunteer, EditableField>>) => {
    if (Object.keys(patch).length === 0) return;
    edit((p) => correctVolunteer(p, key, patch), `correction de la fiche de ${index.volunteerName(key)}`);
  };

  const onReviewed = (key: string) => {
    edit((p) => markReviewed(p, key), `fiche de ${index.volunteerName(key)} relue`);
  };

  return (
    <VolunteerDetail
      index={index}
      report={report}
      volunteerKey={volunteerKey}
      onSetReserve={onSetReserve}
      onCorrect={onCorrect}
      onReviewed={onReviewed}
      readOnly={readOnly}
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
  readOnly?: boolean;
}

function VolunteerDetail({
  index,
  report,
  volunteerKey,
  onSetReserve,
  onCorrect,
  onReviewed,
  readOnly = false,
}: VolunteerDetailProps) {
  // Above every early return, on purpose: a hook called after one is a hook the next render may
  // not call at all, which is the rule React breaks loudly and at a distance.
  const [editing, setEditing] = useState(false);

  const detail = report.volunteers.find((v) => v.key === volunteerKey);
  const volunteer: Volunteer | undefined = index.volunteerByKey.get(volunteerKey);
  if (!detail || !volunteer) return <p className="pool-empty">Bénévole introuvable.</p>;

  const chips = statusChips(detail);
  // Joining the reserve means zero hours, so it is refused outright for somebody holding a
  // pinned place rather than half-applied. The edit layer refuses it too; this says why.
  const pinned = index.plan.assignments.some((a) => a.volunteerKey === volunteerKey && a.locked);

  if (editing) {
    return (
      <>
        {/* No name here either: `InfoPanel`'s own head carries it, three lines above. */}
        <p className="panel-sub">Correction de la fiche</p>
        <RawAnswers volunteer={volunteer} />
        <VolunteerEdit
          index={index}
          volunteer={volunteer}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            onCorrect(volunteer.key, patch);
            setEditing(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      {/*
        THE NAME IS NOT WRITTEN HERE, since 2026-09-12, and it was until then.

        This fiche is only ever drawn inside `InfoPanel`, under a `Head` that already says what
        kind of thing was selected and names it. Writing it again two lines lower put the same
        "Prénom Nom" twice at the top of the pane, reported word for word as "son nom prénom
        apparait 2 fois". The head is the one that stays, because it carries the orga / bénévole
        mark beside the name and this one never did.
      */}
      <p className="panel-sub">
        {preferenceLabel(index.plan.preferenceSlots, volunteer.preferredSlotId)},{' '}
        {volumeText(volunteer.requestedHours, index.dayMode)} demandées
      </p>

      {/*
        The doubt the importer had, and the one button that clears it.

        It sits above everything else on the fiche because it is a statement about the fiche
        itself: what is written below may be a guess. Validating says a human has read the
        answers as typed and stands behind what the tool made of them, whether or not anything
        was corrected: a parser that guessed right still has to be told it did.
      */}
      {volunteer.needsReview && (
        <div className="fiche-review">
          <p className="panel-section-title">À relire</p>
          {volunteer.reviewReasons.map((reason, i) => (
            <p className="fiche-review-reason" key={i}>
              {reason}
            </p>
          ))}
          {!readOnly && (
            <button className="btn is-primary" onClick={() => onReviewed(volunteer.key)}>
              Valider la fiche
            </button>
          )}
        </div>
      )}

      <RawAnswers volunteer={volunteer} />

      {!readOnly && (
        <p>
          <button className="btn" onClick={() => setEditing(true)}>
            Modifier la fiche
          </button>
        </p>
      )}

      {/*
        Refusals get their own line rather than a clause at the end of a grey sentence. They are
        hard constraints: placing somebody in a slot or a pole they ruled out is a tier 1 issue,
        and the régisseur looking at a box needs to see the veto without hunting for it.
      */}
      {(volunteer.refusedSlotIds.length > 0 || volunteer.refusedPoleKeys.length > 0) && (
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
      )}

      {/*
        Contact details, for the régisseur.

        Who ELSE may see a volunteer's phone number is a separate question and not built: the
        régisseur is already trusted with every field on the form. A pole organiser seeing only
        their own pole's numbers needs a organiser login, which does not exist yet, and it is a GDPR
        matter rather than a convenience. See feature_admin_ui.md.
      */}
      {(volunteer.phone || volunteer.email) && (
        <p className="panel-contact">
          {volunteer.phone && (
            <a className="chip" href={`tel:${volunteer.phone.replace(/s+/g, '')}`}>
              {volunteer.phone}
            </a>
          )}
          {volunteer.email && (
            <a className="chip" href={`mailto:${volunteer.email}`}>
              {volunteer.email}
            </a>
          )}
        </p>
      )}

      {chips.length > 0 && (
        <p>
          {chips.map((chip) => (
            <span key={chip.label} className={`chip ${chip.tone ? `is-${chip.tone}` : ''}`}>
              {chip.label}
            </span>
          ))}
        </p>
      )}

      <dl className="kv">
        <dt>Heures affectées</dt>
        <dd>
          {fmtHours(detail.assignedHours)} / {fmtHours(detail.requestedTotalHours)}
        </dd>
        {detail.hoursByRank.map((hours, rank) =>
          hours > 0 ? (
            <Fragment key={rank}>
              <dt>{choiceRankLabel(rank, index.plan.poleChoicesRanked !== false)}</dt>
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

      {/*
        Shown only when there is something to say. A fiche is read on the night with a phone in
        the other hand, and "Régime: sans restriction" on a hundred and twenty of them is a line
        that pushes the useful ones off the screen.
      */}
      {(!isStandardDiet(volunteer.diet) || !isNoAllergy(volunteer.allergies)) && (
        <div className="panel-section">
          <p className="panel-section-title">Repas</p>
          <p>
            {!isStandardDiet(volunteer.diet) && (
              <span className="chip is-warn">{volunteer.diet.trim()}</span>
            )}
            {!isNoAllergy(volunteer.allergies) && (
              <span className="chip is-bad">Allergie: {volunteer.allergies.trim()}</span>
            )}
          </p>
        </div>
      )}

      <div className="panel-section">
        <p className="panel-section-title">Ses choix</p>
        {volunteer.choices.length === 0 ? (
          <p className="pool-item-meta">Aucun choix de pôle.</p>
        ) : (
          <p>
            {volunteer.choices.map((choice, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {index.plan.poleChoicesRanked !== false ? `${i + 1}. ` : '• '}
                {choice.poleKey !== '' ? index.polePath(choice.poleKey) : `« ${choice.raw.trim()} »`}{' '}
                <span className="pool-item-meta">({levelLabel(choice.level)})</span>
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

      <div className="panel-section">
        <p className="panel-section-title">Sa journée</p>
        {detail.blocks.length === 0 && (
          <p className="pool-empty">
            {detail.reserve ? 'En réserve, zéro heure, volontairement.' : 'Aucune affectation.'}
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

      <BuddiesSection volunteer={volunteer} buddies={detail.buddies} readOnly={readOnly} />

      <PhaseAnswers volunteer={volunteer} />

      {volunteer.artistKeys.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-title">Ne veut pas manquer</p>
          {volunteer.artistKeys.map((key) => (
            <span key={key} className="chip">
              {index.artistByKey.get(key)?.name ?? key}
            </span>
          ))}
        </div>
      )}

      {detail.issues.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-title">Signalements</p>
          {detail.issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.tier === 2 ? 'is-tier2' : ''}`}>
              <span className="issue-code">{issue.code}</span>
              {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="panel-section">
        {/*
          Putting somebody in reserve is telling them they are not needed. It is the single most
          consequential button in the panel, so a reader is not offered it at all: what they see
          instead is the fact, which is what they came for.
        */}
        {readOnly ? (
          detail.reserve && <p className="panel-sub">Cette personne est en réserve.</p>
        ) : (
          <button
            className={`btn ${detail.reserve ? '' : 'is-danger'}`}
            disabled={!detail.reserve && pinned}
            onClick={() => onSetReserve(volunteerKey, !detail.reserve)}
          >
            {detail.reserve ? 'Sortir de la réserve' : 'Mettre en réserve'}
          </button>
        )}
        {!readOnly && !detail.reserve && pinned && (
          <p className="panel-sub" style={{ marginTop: 6 }}>
            Impossible: la réserve met à zéro heure, et cette personne occupe une place
            verrouillée. Déverrouillez-la d'abord sur la grille.
          </p>
        )}
        {!readOnly && !detail.reserve && !pinned && detail.assignedHours > 0 && (
          <p className="panel-sub" style={{ marginTop: 6 }}>
            La mise en réserve retire ses {fmtHours(detail.assignedHours)} d'affectation.
          </p>
        )}
      </div>
    </>
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
function RawAnswers({ volunteer }: { volunteer: Volunteer }) {
  const note = volunteer.availabilityNote.trim();
  const choices = volunteer.choices
    .map((c, i) => [`Choix ${i + 1}`, c.raw, c.poleKey] as const)
    .filter(([, rawAnswer, key]) => rawAnswer.trim() !== '' && key === '');

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
function PhaseAnswers({ volunteer }: { volunteer: Volunteer }) {
  const { plan, edit } = useLoadedPlan();
  const phases = (['montage', 'demontage'] as const).filter(
    (id) => (id === 'montage' ? plan.montage : plan.demontage).enabled &&
            (id === 'montage' ? plan.montage : plan.demontage).volunteersAllowed,
  );
  if (phases.length === 0) return null;

  return (
    <div className="panel-section">
      <p className="panel-section-title">Montage et démontage</p>
      {phases.map((id) => {
        const phase = id === 'montage' ? plan.montage : plan.demontage;
        const answer = id === 'montage' ? volunteer.montage : volunteer.demontage;
        const parts = phaseDayParts(phase);
        const window = answer.windows[0] ?? null;
        const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
        const corrected = volunteer.manualFields.includes(id);

        return (
          <p key={id} className="people-meta">
            {label}:{' '}
            <select
              className="select is-inline"
              value={answer.present ? 'oui' : 'non'}
              aria-label={`${label}: présence`}
              onChange={(event) =>
                edit(
                  (p) =>
                    setVolunteerPhase(p, volunteer.key, id, {
                      present: event.target.value === 'oui',
                      windows: event.target.value === 'oui' ? answer.windows : [],
                    }),
                  `${label.toLowerCase()} de ${volunteer.firstName}`,
                )
              }
            >
              <option value="non">pas là</option>
              <option value="oui">présent·e</option>
            </select>

            {answer.present && (
              <>
                {' '}
                <select
                  className="select is-inline"
                  value={window === null ? '' : String(window.start)}
                  aria-label={`${label}: à partir de`}
                  onChange={(event) => {
                    const start = event.target.value === '' ? null : Number(event.target.value);
                    edit(
                      (p) =>
                        setVolunteerPhase(p, volunteer.key, id, {
                          windows:
                            start === null
                              ? []
                              : [{ start, end: Math.max(window?.end ?? 0, phase.volunteersUntil) }],
                        }),
                      `${label.toLowerCase()} de ${volunteer.firstName}`,
                    );
                  }}
                >
                  <option value="">toute la période ouverte</option>
                  {parts.map((part) => (
                    <option key={part.key} value={String(part.start)}>
                      à partir de {part.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {corrected && ' · corrigé à la main'}
          </p>
        );
      })}
    </div>
  );
}
