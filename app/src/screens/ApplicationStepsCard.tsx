/**
 * Réglages > Étapes de suivi: what happens to a bénévole after their validation, step by step.
 *
 * Each event runs its own sequence, so the list is the event's. Renaming keeps every tick and
 * every mail sent; removing a step hides them without erasing them, since what was sent to whom
 * stays true. See `applicationEdits.ts`.
 *
 * SINCE 2026-10-22 A STEP MAY CARRY A MAIL (« Envoi par mail »): its text, who it is for (the
 * validated bénévoles, placed or not, from so many hours asked), and whether it asks a question
 * the bénévole answers from their personal page. It is then sent from Personnes > Mails, as a
 * grouped sending. A step without one is a box ticked by hand on each fiche, as before.
 *
 * Texts committed on blur, like the validation mails: an edit per keystroke would fill the undo
 * stack and the journal with one line per letter.
 */

import { useEffect, useState } from 'react';

import {
  MAIL_PLACEHOLDERS,
  STEP_REPLIES,
  STEP_REPLY_LABEL,
  blankStepMail,
  inTarget,
  planningText,
  registrantOf,
  renderTemplate,
  targetLabel,
  type ApplicationStep,
  type StepMail,
  type StepReply,
} from '../engine.ts';
import {
  addApplicationStep,
  addDefaultSteps,
  missingDefaultSteps,
  moveApplicationStep,
  removeApplicationStep,
  renameApplicationStep,
  setStepMail,
} from '../store/applicationEdits.ts';
import { TestMailButton } from '../mail/testMail.tsx';
import { useLoadedPlan, usePlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

export function ApplicationStepsCard() {
  const { plan, edit } = useLoadedPlan();
  const [label, setLabel] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const steps = plan.applicationSteps;
  const missing = missingDefaultSteps(plan);
  const mailed = steps.filter((s) => s.mail).length;

  const add = () => {
    if (label.trim() === '') return;
    edit((p) => addApplicationStep(p, label), `étape de suivi ${label.trim()}`);
    setLabel('');
  };

  return (
    <SetupSection
      className="setup-application"
      title="Étapes de suivi"
      meta={`${steps.length} étape(s), dont ${mailed} par mail`}
    >
      <p className="people-meta setup-orgas-note">
        Ce qui se passe après la validation d'un ou une bénévole. Une étape « par mail » s'envoie en
        groupe depuis Personnes, Mails, et peut poser une question à laquelle on répond d'un clic
        depuis le lien du mail. Une étape sans mail se coche à la main sur chaque fiche.
      </p>
      <div className="setup-lineup">
        {steps.map((step, i) => (
          <div key={step.key} className="setup-step">
            <div className="setup-ticket-row">
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
              <button
                type="button"
                className={`btn${openKey === step.key ? ' is-active' : ''}`}
                title={step.mail ? 'Voir et modifier le mail' : 'Envoyer cette étape par mail'}
                onClick={() => setOpenKey((k) => (k === step.key ? null : step.key))}
              >
                {step.mail ? (step.mail.reply === 'aucune' ? '✉️ Mail' : '✉️ Mail et réponse') : 'À cocher'}
              </button>
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
            {openKey === step.key && <StepMailEditor step={step} />}
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
          {missing > 0 && (
            <button
              className="btn"
              title="Heures supplémentaires, Planning, Infos pratiques: les étapes par mail proposées par défaut"
              onClick={() => edit((p) => addDefaultSteps(p), 'étapes de suivi types')}
            >
              Ajouter les étapes types ({missing})
            </button>
          )}
        </span>
      </div>
    </SetupSection>
  );
}

function StepMailEditor({ step }: { step: ApplicationStep }) {
  const { plan, edit } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const stored = step.mail;
  const [subject, setSubject] = useState(stored?.subject ?? '');
  const [body, setBody] = useState(stored?.body ?? '');
  const [question, setQuestion] = useState(stored?.question ?? '');
  // An undo, or another tab's save, changes the stored text: the drafts follow.
  useEffect(() => {
    setSubject(stored?.subject ?? '');
    setBody(stored?.body ?? '');
    setQuestion(stored?.question ?? '');
  }, [stored?.subject, stored?.body, stored?.question]);

  if (!stored) {
    return (
      <div className="step-mail">
        <p className="people-meta">Cette étape se coche à la main sur chaque fiche.</p>
        <button
          type="button"
          className="btn"
          onClick={() => edit((p) => setStepMail(p, step.key, blankStepMail()), `${step.label}: envoi par mail`)}
        >
          Envoyer cette étape par mail
        </button>
      </div>
    );
  }

  const commit = (change: Partial<StepMail>, what: string): void => {
    const next = { ...stored, ...change };
    if (JSON.stringify(next) === JSON.stringify(stored)) return;
    edit((p) => setStepMail(p, step.key, next), `${step.label}: ${what}`);
  };

  const sample = plan.volunteers.find((v) => inTarget(plan, step, v)) ?? null;
  const person = sample ? registrantOf(plan, 'benevole', sample.key) : null;
  const preview = person ? renderTemplate(plan, person, { subject, body }, typeof window === 'undefined' ? '' : window.location.origin) : null;

  return (
    <div className="step-mail mail-template">
      <div className="step-mail-target">
        <label className="fiche-step">
          <input
            type="checkbox"
            name={`step-placed-${step.key}`}
            checked={stored.placedOnly}
            onChange={(event) => commit({ placedOnly: event.target.checked }, 'cible')}
          />
          <span>Seulement les bénévoles qui ont au moins un créneau</span>
        </label>
        <label className="field is-inline">
          <span className="field-label">Ayant demandé au moins</span>
          <input
            className="select is-narrow"
            type="number"
            min={0}
            step={0.5}
            name={`step-hours-${step.key}`}
            value={stored.minRequestedHours}
            onChange={(event) => commit({ minRequestedHours: Math.max(0, Number(event.target.value) || 0) }, 'cible')}
          />
          <span className="people-meta">h (0: tout le monde)</span>
        </label>
        <p className="people-meta">Pour: {targetLabel(stored)}.</p>
      </div>
      <label className="field">
        <span className="field-label">Réponse</span>
        <select
          className="select"
          name={`step-reply-${step.key}`}
          value={stored.reply}
          onChange={(event) => commit({ reply: event.target.value as StepReply }, 'réponse attendue')}
        >
          {STEP_REPLIES.map((r) => (
            <option key={r} value={r}>
              {STEP_REPLY_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {stored.reply !== 'aucune' && (
        <label className="field">
          <span className="field-label">{stored.reply === 'confirmer' ? 'Texte du bouton' : 'Question'}</span>
          <input
            className="select"
            name={`step-question-${step.key}`}
            autoComplete="off"
            value={question}
            placeholder={stored.reply === 'confirmer' ? 'Je confirme mes horaires' : 'Tu confirmes vouloir faire {heures} h ?'}
            onChange={(event) => setQuestion(event.target.value)}
            onBlur={() => commit({ question }, 'question')}
          />
        </label>
      )}
      {stored.reply !== 'aucune' && !`${subject}${body}`.includes('{lien}') && (
        <p className="people-meta is-bad">Le mail ne contient pas {'{lien}'}: personne ne pourra répondre.</p>
      )}
      <label className="field">
        <span className="field-label">Objet</span>
        <input
          className="select"
          name={`step-subject-${step.key}`}
          autoComplete="off"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onBlur={() => commit({ subject }, 'objet du mail')}
        />
      </label>
      <textarea
        className="select"
        name={`step-body-${step.key}`}
        aria-label={`Texte du mail ${step.label}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={() => commit({ body }, 'texte du mail')}
      />
      <p className="mail-placeholders">
        Remplacés à l'envoi:{' '}
        {MAIL_PLACEHOLDERS.map((p) => (
          <span key={p.token} title={p.label}>
            <code>{p.token}</code>
          </span>
        ))}
      </p>
      {preview && person ? (
        <>
          <p className="people-meta">
            Aperçu pour {`${person.firstName} ${person.lastName}`.trim()}: <strong>{preview.subject}</strong>
          </p>
          <pre className="registration-mail-body">{preview.body}</pre>
          <p>
            <TestMailButton
              eventId={eventId}
              kind="benevole"
              personKey={person.key}
              who={`${person.firstName} ${person.lastName}`.trim()}
              mail={preview}
              stepKey={step.key}
              planning={planningText(plan, 'benevole', person.key)}
            />
          </p>
        </>
      ) : (
        <p className="people-meta">Personne dans la cible pour l'instant: pas d'aperçu.</p>
      )}
      <button
        type="button"
        className="btn is-danger"
        onClick={() => edit((p) => setStepMail(p, step.key, undefined), `${step.label}: plus de mail`)}
      >
        Ne plus envoyer par mail
      </button>
    </div>
  );
}
