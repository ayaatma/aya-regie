/**
 * « Préparer l'événement depuis ce formulaire », 2026-09-16: on the import screen, what the form's
 * answers say about the event's settings, a box per item, applied only when the régisseur says so.
 *
 * The first setup of an event becomes: fetch the sheet, tick what this card proposes, apply, then
 * correct in Réglages. The poles are named the way the form names them and every answer each covers
 * is remembered, so the import matches them even after a rename. See `setup-inference.ts`.
 *
 * WHAT IS TICKED BY DEFAULT: everything the event does not have yet, except a pole only one person
 * wrote (prose in an « Autre » box). The dates and the tranches REPLACE what is there, so they are
 * ticked only while the event holds nobody: on an event already planned, moving them is a decision.
 */

import { useMemo, useState } from 'react';

import {
  applySetup,
  inferSetup,
  type FormMapping,
  type Plan,
  type SetupChoice,
} from '../engine.ts';
import { SetupSection } from './SetupSection.tsx';

const same = (a: string, b: string): boolean =>
  a.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim() ===
  b.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function SetupFromFormCard({
  plan,
  csv,
  mapping,
  onApply,
}: {
  plan: Plan;
  csv: string;
  mapping: FormMapping;
  onApply(next: Plan, summary: string): void;
}) {
  const proposal = useMemo(() => inferSetup(csv, mapping), [csv, mapping]);
  const fresh = plan.volunteers.length === 0;

  const poleExists = (name: string) => plan.poles.some((p) => p.parentKey === null && same(p.name, name));
  const [event, setEvent] = useState(fresh);
  const [montage, setMontage] = useState(fresh || !plan.montage.enabled);
  const [demontage, setDemontage] = useState(fresh || !plan.demontage.enabled);
  const [slots, setSlots] = useState(fresh);
  const [steps, setSteps] = useState(true);
  const [poles, setPoles] = useState(() =>
    proposal.poles.map((p) => ({ on: p.suggested && !poleExists(p.name), name: p.name })),
  );
  const [skills, setSkills] = useState<ReadonlySet<string>>(
    () => new Set(proposal.skills.filter((s) => !plan.skills.some((x) => same(x.label, s)))),
  );
  const [activities, setActivities] = useState<ReadonlySet<string>>(
    () => new Set(proposal.sideActivities.filter((s) => !plan.sideActivities.some((x) => same(x.label, s)))),
  );

  const newSteps = proposal.applicationSteps.filter((s) => !plan.applicationSteps.some((x) => same(x.label, s)));
  const nothing =
    !proposal.event && !proposal.montage && !proposal.demontage && proposal.poles.length === 0 &&
    !proposal.slots && proposal.skills.length === 0 && proposal.sideActivities.length === 0 && newSteps.length === 0;
  if (nothing) return null;

  const toggle = (set: ReadonlySet<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const choice: SetupChoice = {
    event: event && proposal.event !== null,
    montage: montage && proposal.montage !== null,
    demontage: demontage && proposal.demontage !== null,
    poles: poles.flatMap((p, index) => (p.on ? [{ index, name: p.name }] : [])),
    slots: slots && proposal.slots !== null,
    skills: [...skills],
    sideActivities: [...activities],
    applicationSteps: steps && newSteps.length > 0,
  };
  const count =
    Number(choice.event) + Number(choice.montage) + Number(choice.demontage) + choice.poles.length +
    Number(choice.slots) + choice.skills.length + choice.sideActivities.length + Number(choice.applicationSteps);

  const line = (checked: boolean, onChange: () => void, label: string, detail: string, name: string) => (
    <label key={name} className="checkline setup-from-form-line">
      <input type="checkbox" name={name} checked={checked} onChange={onChange} />
      <span>
        <strong>{label}</strong> <span className="people-meta">{detail}</span>
      </span>
    </label>
  );

  return (
    <SetupSection
      className="setup-from-form"
      title="Préparer l'événement depuis ce formulaire"
      meta={`${count} réglage(s) coché(s) sur ce que les réponses proposent`}
      defaultOpen={plan.poles.length === 0}
    >
      <p className="people-meta setup-orgas-note">
        Lu dans les réponses: rien n'est écrit tant que vous n'appliquez pas, et tout se corrige
        ensuite dans Réglages. Les noms de pôles sont modifiables ici; chaque réponse reste reliée à
        son pôle même renommé. Après application, le fichier est relu avec ces réglages.
      </p>

      {(proposal.event || proposal.montage || proposal.demontage || proposal.slots) && (
        <div className="mapping-group">
          <span className="panel-section-title">Dates et tranches</span>
          {proposal.event &&
            line(event, () => setEvent(!event), "Dates de l'événement", `du ${proposal.event.from} au ${proposal.event.to} (heures lues dans les réponses, à vérifier)`, 'setup-event')}
          {proposal.montage &&
            line(montage, () => setMontage(!montage), 'Montage', `${proposal.montage.days} jour(s) cochés, à partir du ${new Date(proposal.montage.startISO).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}, ouvert aux bénévoles`, 'setup-montage')}
          {proposal.demontage &&
            line(demontage, () => setDemontage(!demontage), 'Démontage', `${proposal.demontage.days} jour(s) cochés, ${proposal.demontage.lengthHours} h après la fin, ouvert aux bénévoles`, 'setup-demontage')}
          {proposal.slots &&
            line(slots, () => setSlots(!slots), 'Tranches jour / nuit', `${proposal.slots.map((s) => s.label).join(' · ')} (remplacent les tranches actuelles)`, 'setup-slots')}
        </div>
      )}

      {proposal.poles.length > 0 && (
        <div className="mapping-group">
          <span className="panel-section-title">Pôles ({poles.filter((p) => p.on).length} cochés)</span>
          {proposal.poles.map((p, i) => {
            const exists = poleExists(poles[i]!.name);
            return (
              <div key={i} className="setup-from-form-pole">
                <input
                  type="checkbox"
                  name={`setup-pole-${i}`}
                  aria-label={`Créer le pôle ${poles[i]!.name}`}
                  checked={poles[i]!.on}
                  onChange={() => setPoles(poles.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                />
                <input
                  className="select"
                  name={`setup-pole-name-${i}`}
                  autoComplete="off"
                  value={poles[i]!.name}
                  aria-label="Nom du pôle"
                  onChange={(e) => setPoles(poles.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <span className="people-meta" title={p.answers.join('\n')}>
                  {p.count} choix{p.answers.length > 1 ? `, ${p.answers.length} écritures` : ''}
                  {exists ? ' · déjà dans Réglages, réponses reliées' : ''}
                  {!p.suggested ? ' · écrit une seule fois' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(proposal.skills.length > 0 || proposal.sideActivities.length > 0 || newSteps.length > 0) && (
        <div className="mapping-group">
          <span className="panel-section-title">Compétences, activités, suivi</span>
          {proposal.skills.map((s) =>
            line(skills.has(s), () => setSkills(toggle(skills, s)), s, 'compétence', `setup-skill-${s}`),
          )}
          {proposal.sideActivities.map((s) =>
            line(activities.has(s), () => setActivities(toggle(activities, s)), s, 'activité annexe', `setup-activity-${s}`),
          )}
          {newSteps.length > 0 &&
            line(steps, () => setSteps(!steps), 'Étapes de suivi', newSteps.join(' · '), 'setup-steps')}
        </div>
      )}

      <p>
        <button
          className="btn is-primary"
          disabled={count === 0}
          onClick={() => onApply(applySetup(plan, proposal, choice), `réglages proposés par le formulaire (${count})`)}
        >
          Appliquer ces réglages
        </button>
      </p>
    </SetupSection>
  );
}
