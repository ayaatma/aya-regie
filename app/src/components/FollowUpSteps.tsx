/**
 * The follow-up steps on a bénévole's fiche, 2026-10-22: where they stand on each one, and what
 * the régie can do about it from here.
 *
 * A STEP WITH A MAIL reads from the mail log and the answers (`followup.ts`): « envoyé le 02/11 »,
 * « confirmé par le lien », « planning modifié depuis l'envoi ». It can be sent to this one person
 * from here, through the same preview as the validation, and an answer given on the phone can be
 * noted by hand. A STEP WITHOUT ONE is still the box ticked by hand it always was.
 *
 * Mostly the grouped sendings of the Mails tab do the work; this is for the one person who needs
 * something different, and for reading.
 */

import { useState } from 'react';

import {
  isMailAddress,
  planningText,
  registrantOf,
  renderTemplate,
  stateLabel,
  stepProgress,
  type ApplicationStep,
  type StepProgress,
  type Tone,
  type Volunteer,
} from '../engine.ts';
import { recordReply, sendMail, sentAtLabel, useMailLog } from '../mail/mailStore.ts';
import { setApplicationStep } from '../store/applicationEdits.ts';
import { useLoadedPlan, usePlan } from '../store/store.tsx';
import { SendDialog } from './SendDialog.tsx';

const siteUrl = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

export const TONE_CHIP: Record<Tone, string> = { ok: 'chip is-ok', warn: 'chip is-warn', bad: 'chip is-bad', muted: 'chip is-muted' };

const toneOf = (p: StepProgress): Tone =>
  p.state === 'oui' || p.state === 'envoye' || p.state === 'fait-main'
    ? 'ok'
    : p.state === 'non' || p.state === 'echec'
      ? 'bad'
      : p.state === 'en-attente'
        ? 'warn'
        : 'muted';

export function FollowUpSteps({ volunteer }: { volunteer: Volunteer }) {
  const { plan } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const log = useMailLog(eventId);
  const { mails, replies } = log.factsOf(volunteer.key);
  if (plan.applicationSteps.length === 0) return null;
  return (
    <div className="fiche-steps followup-steps">
      {plan.applicationSteps.map((step) => (
        <StepRow
          key={step.key}
          step={step}
          volunteer={volunteer}
          progress={stepProgress(plan, step, volunteer, mails, replies)}
        />
      ))}
    </div>
  );
}

function StepRow({ step, volunteer, progress }: { step: ApplicationStep; volunteer: Volunteer; progress: StepProgress }) {
  const { plan, edit } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const log = useMailLog(eventId);
  const failure = log.entriesOf('benevole', volunteer.key).find((e) => e.stepKey === step.key) ?? null;
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = `${volunteer.firstName} ${volunteer.lastName}`.trim();

  if (!step.mail) {
    const ticked = (volunteer.statusSteps ?? []).includes(step.key);
    return (
      <label className="fiche-step">
        <input
          type="checkbox"
          name={`fiche-step-${step.key}`}
          checked={ticked}
          onChange={(event) => {
            const done = event.target.checked;
            edit((p) => setApplicationStep(p, volunteer.key, step.key, done), `${step.label}: ${name}`);
          }}
        />
        <span>{step.label}</span>
      </label>
    );
  }

  const mailStep = step.mail;
  const person = registrantOf(plan, 'benevole', volunteer.key);
  const mail = person ? renderTemplate(plan, person, mailStep, siteUrl()) : null;
  const addressOk = mail !== null && isMailAddress(mail.to);
  const canSend = eventId !== null && addressOk && (progress.inTarget || progress.lastSent !== null);
  const wantsReply = mailStep.reply !== 'aucune';

  const send = async (): Promise<void> => {
    if (!mail || eventId === null) return;
    setBusy(true);
    await sendMail(eventId, 'benevole', volunteer.key, mail, progress.lastSent ? 'relance' : 'etape', {
      stepKey: step.key,
      planning: planningText(plan, 'benevole', volunteer.key),
    });
    setBusy(false);
    setPreviewing(false);
  };

  const note = async (answer: 'oui' | 'non'): Promise<void> => {
    if (eventId === null) return;
    setBusy(true);
    setError(await recordReply(eventId, volunteer.key, step.key, answer));
    setBusy(false);
  };

  const detail: string[] = [];
  if (progress.lastSent) detail.push(`envoyé ${sentAtLabel(progress.lastSent.sentAt)}`);
  if (progress.reply) {
    detail.push(
      `${progress.reply.answer === 'oui' ? (mailStep.reply === 'confirmer' ? 'confirmé' : 'oui') : 'non'} ${sentAtLabel(progress.reply.answeredAt)}${progress.reply.source === 'lien' ? ' par le lien' : ', noté par la régie'}`,
    );
  }

  return (
    <div className="followup-step">
      <div className="followup-step-head">
        <span className="followup-step-label">{step.label}</span>
        <span className={TONE_CHIP[toneOf(progress)]}>{stateLabel(progress)}</span>
        {detail.length > 0 && <span className="people-meta">{detail.join(', ')}</span>}
      </div>
      {progress.planningChanged && (
        <p className="people-meta is-warn">
          Planning modifié depuis {progress.reply ? 'sa confirmation' : "l'envoi"}: à lui renvoyer.
        </p>
      )}
      {progress.state === 'echec' && failure && (
        <p className="people-meta is-bad">
          ⚠️ Échec {sentAtLabel(failure.sentAt)} à {failure.recipient}: {failure.error}
        </p>
      )}
      {!previewing && (progress.inTarget || progress.lastSent || wantsReply) && (
        <div className="registration-actions">
          {canSend && (
            <button type="button" className="btn is-small" disabled={busy} onClick={() => setPreviewing(true)}>
              {progress.lastSent ? 'Renvoyer' : 'Envoyer'}
            </button>
          )}
          {wantsReply && progress.lastSent && (
            <>
              <button type="button" className="btn is-small" disabled={busy} onClick={() => void note('oui')}>
                {mailStep.reply === 'confirmer' ? 'Noter confirmé' : 'Noter oui'}
              </button>
              {mailStep.reply === 'oui-non' && (
                <button type="button" className="btn is-small" disabled={busy} onClick={() => void note('non')}>
                  Noter non
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="people-meta is-bad">{error}</p>}
      {/* In a window since 2026-10-22, like every other send. See `SendDialog`. */}
      {previewing && mail && (
        <SendDialog
          title={`${step.label}: ${progress.lastSent ? 'renvoyer' : 'envoyer'} à ${name}`}
          intro={
            mail.empty.length > 0 ? (
              <p className="people-meta is-bad">Vide dans ce message: {mail.empty.join(', ')}.</p>
            ) : null
          }
          people={[
            {
              id: volunteer.key,
              name,
              mail,
              kind: 'benevole',
              key: volunteer.key,
              stepKey: step.key,
              planning: planningText(plan, 'benevole', volunteer.key),
            },
          ]}
          confirmLabel={() => 'Envoyer'}
          onConfirm={() => void send()}
          onClose={() => setPreviewing(false)}
        />
      )}
      {busy && <p className="people-meta">Envoi…</p>}
    </div>
  );
}
