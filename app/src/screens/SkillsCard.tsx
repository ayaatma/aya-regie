/**
 * Réglages > Compétences, 2026-09-15: the competences this event cares about (« Permis B »,
 * « CACES », « Conduite d'engins »). Ticked on each person's fiche, asked for by a pole of the
 * exploit or of a phase. How much a missing one weighs is Réglages avancés, criterion
 * « Sur un pôle qui demande une compétence ».
 *
 * The labels are what the import looks for in the form's free-text competence answer, word for
 * word: naming a tag the way people write it is what makes the import tick it.
 */

import { useState } from 'react';

import { addSkill, moveSkill, removeSkill, renameSkill, skillUsage } from '../store/skillEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

export function SkillsCard() {
  const { plan, edit } = useLoadedPlan();
  const [label, setLabel] = useState('');
  const [armed, setArmed] = useState<string | null>(null);

  const add = () => {
    if (label.trim() === '') return;
    edit((p) => addSkill(p, label), `compétence ${label.trim()}`);
    setLabel('');
  };

  return (
    <SetupSection
      className="setup-skills"
      title="Compétences"
      meta={plan.skills.length === 0 ? 'aucune' : plan.skills.map((s) => s.label).join(' · ')}
    >
      <p className="people-meta setup-orgas-note">
        Une compétence se coche sur la fiche d'une personne et se demande sur un pôle. L'import la
        reconnaît quand la réponse du formulaire écrit son nom en entier: nommez-la comme les gens
        l'écrivent (« Permis B », « CACES »).
      </p>
      <div className="setup-lineup">
        {plan.skills.map((skill, i) => {
          const usage = skillUsage(plan, skill.key);
          return (
            <div key={skill.key} className="setup-ticket-row">
              <input
                className="select"
                name={`skill-${skill.key}`}
                autoComplete="off"
                value={skill.label}
                aria-label="Nom de la compétence"
                onChange={(event) => edit((p) => renameSkill(p, skill.key, event.target.value), `compétence ${skill.label}`)}
              />
              <span className="people-meta">
                {usage.people} personne(s), {usage.poles} pôle(s)
              </span>
              <button className="btn is-icon" title="Monter" disabled={i === 0} onClick={() => edit((p) => moveSkill(p, skill.key, -1), 'ordre des compétences')}>
                ↑
              </button>
              <button
                className="btn is-icon"
                title="Descendre"
                disabled={i === plan.skills.length - 1}
                onClick={() => edit((p) => moveSkill(p, skill.key, 1), 'ordre des compétences')}
              >
                ↓
              </button>
              {armed === skill.key ? (
                <span className="setup-confirm">
                  <span className="people-meta">Retirée de {usage.people} personne(s) et {usage.poles} pôle(s).</span>
                  <button
                    className="btn is-danger"
                    onClick={() => {
                      edit((p) => removeSkill(p, skill.key), `retrait de la compétence ${skill.label}`);
                      setArmed(null);
                    }}
                  >
                    Retirer
                  </button>
                  <button className="btn" onClick={() => setArmed(null)}>
                    Annuler
                  </button>
                </span>
              ) : (
                <button className="btn is-icon is-danger" title={`Retirer ${skill.label}`} onClick={() => setArmed(skill.key)}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Nom d'une compétence"
            name="new-skill"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <button className="btn" disabled={label.trim() === ''} onClick={add}>
            Ajouter une compétence
          </button>
        </span>
      </div>
    </SetupSection>
  );
}
