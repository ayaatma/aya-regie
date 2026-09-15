/**
 * Réglages > Suivi des candidatures, 2026-09-15: the steps the régisseur ticks per bénévole.
 *
 * Each event runs its own sequence (a confirmation mail, a reconfirmation, a photo reminder), so
 * the list is the event's. Renaming keeps every tick; removing a step hides its ticks without
 * erasing them, since what was sent to whom stays true. See `applicationEdits.ts`.
 */

import { useState } from 'react';

import { statusOf } from '../engine.ts';
import {
  addApplicationStep,
  moveApplicationStep,
  removeApplicationStep,
  renameApplicationStep,
} from '../store/applicationEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

export function ApplicationStepsCard() {
  const { plan, edit } = useLoadedPlan();
  const [label, setLabel] = useState('');
  const steps = plan.applicationSteps;
  const tickedBy = (key: string) => plan.volunteers.filter((v) => (v.statusSteps ?? []).includes(key)).length;
  const counts = { valide: 0, annule: 0, candidature: 0 };
  for (const v of plan.volunteers) counts[statusOf(v)]++;

  const add = () => {
    if (label.trim() === '') return;
    edit((p) => addApplicationStep(p, label), `étape de suivi ${label.trim()}`);
    setLabel('');
  };

  return (
    <SetupSection
      className="setup-application"
      title="Suivi des candidatures"
      meta={`${steps.length} étape(s) · ${counts.valide} validée(s), ${counts.candidature} en attente de décision, ${counts.annule} annulée(s)`}
    >
      <p className="people-meta setup-orgas-note">
        Les étapes se cochent sur la fiche de chaque bénévole, dans l'onglet Personnes (vue
        Candidature). Renommer une étape garde les coches; la retirer les masque sans les effacer.
      </p>
      <div className="setup-lineup">
        {steps.map((step, i) => (
          <div key={step.key} className="setup-ticket-row">
            <input
              className="select"
              name={`application-step-${step.key}`}
              autoComplete="off"
              value={step.label}
              aria-label="Nom de l'étape"
              onChange={(event) =>
                edit((p) => renameApplicationStep(p, step.key, event.target.value), `étape ${step.label}`)
              }
            />
            <span className="people-meta">{tickedBy(step.key)} cochée(s)</span>
            <button
              className="btn is-icon"
              title="Monter"
              disabled={i === 0}
              onClick={() => edit((p) => moveApplicationStep(p, step.key, -1), `ordre des étapes`)}
            >
              ↑
            </button>
            <button
              className="btn is-icon"
              title="Descendre"
              disabled={i === steps.length - 1}
              onClick={() => edit((p) => moveApplicationStep(p, step.key, 1), `ordre des étapes`)}
            >
              ↓
            </button>
            <button
              className="btn is-icon is-danger"
              title={`Retirer ${step.label}`}
              onClick={() => edit((p) => removeApplicationStep(p, step.key), `retrait de l'étape ${step.label}`)}
            >
              ✕
            </button>
          </div>
        ))}
        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Nom d'une étape"
            name="new-application-step"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <button className="btn" disabled={label.trim() === ''} onClick={add}>
            Ajouter une étape
          </button>
        </span>
      </div>
    </SetupSection>
  );
}
