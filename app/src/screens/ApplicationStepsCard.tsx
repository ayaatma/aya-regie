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
  audienceLabel,
  audienceOptions,
  stepAudiences,
  stepPersons,
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
  type StepMailVariant,
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

  // The preview is of the step's own text: somebody in the target that no variant takes.
  const variants = stored.variants ?? [];
  const audiences = stored.audiences ?? ['benevole'];
  const sample =
    stepPersons(plan).find((p) => inTarget(plan, step, p) && !variants.some((v) => v.audiences.includes(p.audience))) ?? null;
  const person = sample ? registrantOf(plan, sample.kind, sample.key) : null;
  const preview = person ? renderTemplate(plan, person, { subject, body }, typeof window === 'undefined' ? '' : window.location.origin) : null;
  const label = (a: string): string => audienceLabel(plan, a);

  return (
    <div className="step-mail mail-template">
      {/*
        WHO THE STEP GOES TO, since 2026-10-22: the bénévoles until then, and only them. A kind
        ticked here gets the step's text below, unless one of the other texts names it.
      */}
      <div className="setup-bracelet-statuses" role="group" aria-label={`Destinataires de ${step.label}`}>
        <span className="field-label">Pour</span>
        {audienceOptions(plan).map((option) => (
          <label key={option.key} className="checkline">
            <input
              type="checkbox"
              name={`step-audience-${step.key}-${option.key}`}
              checked={audiences.includes(option.key) || variants.some((v) => v.audiences.includes(option.key))}
              disabled={variants.some((v) => v.audiences.includes(option.key))}
              onChange={(event) =>
                commit(
                  {
                    audiences: event.target.checked
                      ? [...audiences.filter((a) => a !== option.key), option.key]
                      : audiences.filter((a) => a !== option.key),
                  },
                  'destinataires',
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      {stored.reply !== 'aucune' && stepAudiences(stored).some((a) => a !== 'benevole') && (
        <p className="people-meta">Seuls les bénévoles peuvent répondre par leur lien: les autres reçoivent le mail, sans question.</p>
      )}
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
        <p className="people-meta">Pour: {targetLabel(stored, (a) => label(a).toLowerCase())}.</p>
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
              kind={person.kind}
              personKey={person.key}
              who={`${person.firstName} ${person.lastName}`.trim()}
              mail={preview}
              stepKey={step.key}
              planning={person.kind === 'benevole' || person.kind === 'orga' ? planningText(plan, person.kind, person.key) : ''}
            />
          </p>
        </>
      ) : (
        <p className="people-meta">Personne dans la cible pour l'instant: pas d'aperçu.</p>
      )}

      {/* Another text for some kinds of person, since 2026-10-22. See `StepMail.variants`. */}
      {variants.map((variant, index) => (
        <VariantEditor
          key={index}
          variant={variant}
          label={label}
          options={audienceOptions(plan)}
          onChange={(next) =>
            commit(
              {
                variants: variants.map((v, i) => (i === index ? next : v)),
                // A kind given to a variant leaves the step's own list: one kind, one text.
                audiences: audiences.filter((a) => !next.audiences.includes(a)),
              },
              'autre texte',
            )
          }
          onRemove={() => commit({ variants: variants.filter((_, i) => i !== index) }, 'autre texte retiré')}
        />
      ))}
      <button
        type="button"
        className="btn is-small"
        onClick={() =>
          commit({ variants: [...variants, { audiences: [], subject: stored.subject, body: stored.body }] }, 'autre texte ajouté')
        }
      >
        Ajouter un texte pour un autre type de personne
      </button>
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

/** One other text of a step: the kinds it is for, and its words. Drafts committed on blur. */
function VariantEditor({
  variant,
  label,
  options,
  onChange,
  onRemove,
}: {
  variant: StepMailVariant;
  label(audience: string): string;
  options: ReadonlyArray<{ key: string; label: string }>;
  onChange(next: StepMailVariant): void;
  onRemove(): void;
}) {
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);
  useEffect(() => {
    setSubject(variant.subject);
    setBody(variant.body);
  }, [variant.subject, variant.body]);
  const commit = (): void => {
    if (subject !== variant.subject || body !== variant.body) onChange({ ...variant, subject, body });
  };
  return (
    <div className="mail-template step-variant">
      <div className="setup-bracelet-statuses" role="group" aria-label="Pour qui">
        <span className="field-label">Autre texte pour</span>
        {options.map((option) => (
          <label key={option.key} className="checkline">
            <input
              type="checkbox"
              checked={variant.audiences.includes(option.key)}
              onChange={(event) =>
                onChange({
                  ...variant,
                  audiences: event.target.checked
                    ? [...variant.audiences.filter((a) => a !== option.key), option.key]
                    : variant.audiences.filter((a) => a !== option.key),
                })
              }
            />
            {option.label}
          </label>
        ))}
        <button type="button" className="btn is-icon is-danger" title="Retirer ce texte" onClick={onRemove}>
          ✕
        </button>
      </div>
      {variant.audiences.length === 0 && <p className="people-meta is-warn">Ce texte n'est pour personne.</p>}
      <label className="field">
        <span className="field-label">Objet</span>
        <input
          className="select"
          autoComplete="off"
          value={subject}
          aria-label={`Objet pour ${variant.audiences.map(label).join(', ')}`}
          onChange={(event) => setSubject(event.target.value)}
          onBlur={commit}
        />
      </label>
      <textarea
        className="select"
        aria-label={`Texte pour ${variant.audiences.map(label).join(', ')}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={commit}
      />
    </div>
  );
}
