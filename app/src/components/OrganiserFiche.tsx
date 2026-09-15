/**
 * One orga, whole and editable: who they are, how to reach them, and when they are on site.
 *
 * ONE COMPONENT, TWO PLACES. The régisseur reaches an orga from two directions: the list in
 * Réglages, when they are going through the imports, and the grid, when they are looking at the
 * night and want to know who this name is. Both need the same fiche, and two copies of it would
 * have drifted the first time a field was added.
 *
 * EVERYTHING HERE IS A CORRECTION OF WHAT THE FORM SAID, and every one of them is allowed. An
 * orga writes down "je serai là mercredi", their plans change, and the régisseur is the one who
 * knows. So the arrival, the pole, the name, the address, the diet: all of it is editable, and
 * a re-import of the same export never silently puts the old answer back, because the importer
 * only fills a field the export actually carries an answer for.
 *
 * What is NOT editable here is the access code, which is a credential rather than an answer: it
 * is issued, revoked and reissued from the list in Réglages, one person at a time, on purpose.
 */

import {
  phaseDayParts,
  toLabel,
  type Organiser,
  type PhaseId,
} from '../engine.ts';
import { updateOrganiser } from '../store/setupEdits.ts';
import { setOrganiserSkills } from '../store/skillEdits.ts';
import { setOrganiserSideActivities } from '../store/sideActivityEdits.ts';
import { SkillPicker } from './SkillPicker.tsx';
import { setOrganiserPhase } from '../store/phaseEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from './labels.ts';

export function OrganiserFiche({ organiserKey }: { organiserKey: string }) {
  const { plan, index, edit } = useLoadedPlan();
  const person = plan.organisers.find((o) => o.key === organiserKey);
  if (!person) return null;

  const who = organiserName(person) || 'cet orga';
  const roles = index.polesLedBy(person.key);

  const field = (
    label: string,
    key: keyof Organiser,
    options: { type?: string; autoComplete?: string } = {},
  ) => (
    <label className="rule">
      <span className="rule-label">{label}</span>
      <input
        className="select"
        type={options.type ?? 'text'}
        autoComplete={options.autoComplete ?? 'off'}
        name={`orga-${key}-${person.key}`}
        value={String(person[key] ?? '')}
        aria-label={`${label} de ${who}`}
        onChange={(event) =>
          edit(
            (p) => updateOrganiser(p, person.key, { [key]: event.target.value }),
            `${label.toLowerCase()} de ${who}`,
          )
        }
      />
    </label>
  );

  return (
    <div className="orga-fiche">
      <div className="rules-grid">
        {field('Prénom', 'firstName', { autoComplete: 'given-name' })}
        {field('Nom', 'lastName', { autoComplete: 'family-name' })}
        {field('Adresse e-mail', 'email', { type: 'email', autoComplete: 'email' })}
        {field('Téléphone', 'phone', { type: 'tel', autoComplete: 'tel' })}
        {field('Régime alimentaire', 'diet')}
        {field('Allergies', 'allergies')}
        {/* Field data, 2026-09-15: the régie and the responsables only read them. */}
        {field("Contact d'urgence", 'emergencyContact')}
        {field('Santé, besoins', 'healthNote')}
      </div>

      <label className="rule">
        <span className="rule-label">Remarques</span>
        <input
          className="select"
          name={`orga-note-${person.key}`}
          autoComplete="off"
          value={person.note}
          aria-label={`Remarques sur ${who}`}
          onChange={(event) =>
            edit((p) => updateOrganiser(p, person.key, { note: event.target.value }), `remarques sur ${who}`)
          }
        />
        <span className="rule-hint">
          Ce que le formulaire a répondu sur le montage et les pôles atterrit ici, mot pour mot.
        </span>
      </label>

      {plan.skills.length > 0 && (
        <div className="rule">
          <span className="rule-label">Compétences</span>
          <SkillPicker
            skills={plan.skills}
            value={person.skills ?? []}
            name={`orga-skill-${person.key}`}
            onChange={(skills, changed, on) =>
              edit((p) => setOrganiserSkills(p, person.key, skills), `${changed.label} ${on ? 'ajouté' : 'retiré'}: ${who}`)
            }
          />
        </div>
      )}

      {plan.sideActivities.length > 0 && (
        <div className="rule">
          <span className="rule-label">Activités annexes</span>
          <SkillPicker
            skills={plan.sideActivities}
            value={person.sideActivityKeys ?? []}
            name={`orga-activity-${person.key}`}
            onChange={(keys, changed, on) =>
              edit((p) => setOrganiserSideActivities(p, person.key, keys), `${changed.label} ${on ? 'coché' : 'décoché'}: ${who}`)
            }
          />
        </div>
      )}

      <PhasePresenceRow organiserKey={person.key} id="montage" />
      <PhasePresenceRow organiserKey={person.key} id="demontage" />

      <p className="people-meta">
        {roles.length === 0
          ? "Responsable d'aucun pôle."
          : `Responsable de ${roles
              .map((r) => index.poleByKey.get(r.poleKey)?.path ?? r.poleKey)
              .join(', ')}.`}{' '}
        Cela se change sur le pôle lui-même, dans Réglages.
      </p>
    </div>
  );
}

/**
 * When one orga is on site for one phase, and which pole they work in while they are.
 *
 * A HALF-DAY RATHER THAN AN HOUR. "Camille arrive jeudi après-midi" is what the orga form
 * collects and the granularity a phase is worked at, so the field offers the half-days of the
 * phase and nothing finer. A régisseur who needs finer draws the bar on the grid, where the
 * hours are to the quarter.
 *
 * The montage asks when somebody ARRIVES, so a half-day is named by its start; the démontage
 * asks until when they STAY, so it is named by its end. Same field, two questions.
 */
export function PhasePresenceRow({
  organiserKey,
  id,
}: {
  organiserKey: string;
  id: PhaseId;
}) {
  const { plan, edit } = useLoadedPlan();
  const phase = id === 'montage' ? plan.montage : plan.demontage;
  const person = plan.organisers.find((o) => o.key === organiserKey);
  if (!person || !phase.enabled) return null;

  const parts = phaseDayParts(phase);
  const at = id === 'montage' ? person.montageFrom : person.demontageUntil;
  const poleKeys = id === 'montage' ? person.montagePoleKeys : person.demontagePoleKeys;
  const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
  const who = organiserName(person) || 'cet orga';

  /*
   * The moment is matched to the half-day it falls in rather than to an exact equality: an
   * arrival read from the form is "10/03 14:00", which is the afternoon of the first day but
   * not necessarily its first minute. A select that found no match would have shown "pas là"
   * about somebody who is very much there.
   */
  const current = parts.find((part) => at !== null && at >= part.start && at < part.end);
  const value = at === null ? '' : String(id === 'montage' ? (current?.start ?? at) : (current?.end ?? at));

  return (
    <label className="rule">
      <span className="rule-label">{label}</span>
      <span className="rule-input">
        <select
          className="select"
          value={value}
          aria-label={`${label}: présence de ${who}`}
          onChange={(event) =>
            edit(
              (p) =>
                setOrganiserPhase(p, organiserKey, id, {
                  at: event.target.value === '' ? null : Number(event.target.value),
                }),
              `${label.toLowerCase()} de ${who}`,
            )
          }
        >
          <option value="">pas là</option>
          {parts.map((part) => (
            <option key={part.key} value={String(id === 'montage' ? part.start : part.end)}>
              {id === 'montage' ? `à partir de ${part.label}` : `jusqu'à la fin de ${part.label}`}
            </option>
          ))}
          {/* An arrival that matches no half-day, because the dates moved under it. Kept
              visible rather than reset to "pas là", which would lose it in silence. */}
          {at !== null && current === undefined && (
            <option value={String(at)}>{toLabel(phase.startISO, at)} (hors des jours réglés)</option>
          )}
        </select>

        <select
          className="select"
          value={poleKeys[0] ?? ''}
          disabled={at === null}
          aria-label={`${label}: pôle de ${who}`}
          onChange={(event) =>
            edit(
              (p) =>
                setOrganiserPhase(p, organiserKey, id, {
                  poleKeys: event.target.value === '' ? [] : [event.target.value],
                }),
              `pôle ${label.toLowerCase()} de ${who}`,
            )
          }
        >
          <option value="">Général</option>
          {phase.poles
            .filter((pole) => pole.key !== 'general')
            .map((pole) => (
              <option key={pole.key} value={pole.key}>
                {pole.name}
              </option>
            ))}
        </select>
      </span>
      {at !== null && (
        <span className="rule-hint">
          {id === 'montage' ? 'Sur place à partir de ' : "Sur place jusqu'à "}
          {toLabel(phase.startISO, at)}. Le pôle est celui où la grille le dessine tant que rien
          d'autre n'a été décidé pour une demi-journée.
        </span>
      )}
    </label>
  );
}
