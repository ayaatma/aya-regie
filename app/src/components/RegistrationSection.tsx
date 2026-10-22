/**
 * « Inscription » or « Validée », at the top of every fiche, 2026-10-22: the status of a bénévole,
 * an orga, a member of an act or an extra person, the button that validates, and the mail that
 * goes with it.
 *
 * VALIDATING SHOWS THE MAIL FIRST. One click opens the message exactly as it will leave (rendered
 * here from the event's template, `renderMail`), with the box « Envoyer le mail » ticked when the
 * address is one; the second click validates and sends. A status changed by mistake costs nothing,
 * a mail sent by mistake cannot be called back, so the mail is the thing the régisseur reads
 * before committing, never after.
 *
 * WHAT WENT IS SAID UNDER THE STATUS, from `mail_log` (see `mailStore.ts`): the last mail, sent or
 * failed and why, with the history folded under it. « Renvoyer le mail » sends again whatever the
 * last outcome, through the same preview.
 *
 * READ-ONLY (an orga's code): the status only. The mail record needs a régisseur's session.
 */

import { useState } from 'react';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  MAIL_AUDIENCE_LABEL,
  followUpOf,
  isMailAddress,
  registrantOf,
  renderMail,
  setRegistrationStatus,
  type ApplicationStatus,
  type RegistrantKind,
} from '../engine.ts';
import { sendMail, sentAtLabel, useMailLog, type MailEntry } from '../mail/mailStore.ts';
import { TONE_CHIP } from './FollowUpSteps.tsx';
import { useLoadedPlan, usePlan } from '../store/store.tsx';

const siteUrl = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

export function RegistrationSection({
  kind,
  personKey,
  readOnly = false,
}: {
  kind: RegistrantKind;
  personKey: string;
  readOnly?: boolean;
}) {
  const { plan, edit } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const log = useMailLog(readOnly ? null : eventId);
  const [confirming, setConfirming] = useState<null | 'validation' | 'renvoi'>(null);
  const [withMail, setWithMail] = useState(true);
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const person = registrantOf(plan, kind, personKey);
  if (!person) return null;

  const who = `${person.firstName} ${person.lastName}`.trim() || 'cette personne';
  const status = person.status;
  const mail = renderMail(plan, person, siteUrl());
  const addressOk = isMailAddress(mail.to);
  const history = log.entriesOf(kind, personKey);
  const last = log.lastValidationOf(kind, personKey);
  const stepLabels = new Map(plan.applicationSteps.map((st) => [st.key, st.label]));
  // A bénévole's frise: « Planning : confirmé » says validated and mailed already.
  const volunteer = kind === 'benevole' ? plan.volunteers.find((v) => v.key === personKey) : undefined;
  const facts = volunteer ? log.factsOf(volunteer.key) : null;
  const followUp = volunteer && facts ? followUpOf(plan, volunteer, facts.mails, facts.replies) : null;

  const setStatus = (next: ApplicationStatus): void =>
    edit((p) => setRegistrationStatus(p, kind, personKey, next), `inscription de ${who}: ${APPLICATION_STATUS_LABEL[next].toLowerCase()}`);

  const open = (mode: 'validation' | 'renvoi'): void => {
    setConfirming(mode);
    setWithMail(addressOk);
  };

  const confirm = async (): Promise<void> => {
    const mode = confirming;
    if (mode === null) return;
    if (mode === 'validation') setStatus('valide');
    if ((mode === 'renvoi' || withMail) && addressOk && eventId !== null) {
      setSending(true);
      await sendMail(eventId, kind, personKey, mail, mode);
      setSending(false);
    }
    setConfirming(null);
  };

  const banner = (
    <div className={`registration is-${status}`}>
      <span className="registration-status">
        {status === 'candidature' ? '⏳ ' : status === 'valide' ? '✓ ' : '✕ '}
        {APPLICATION_STATUS_LABEL[status]}
        {status === 'candidature' && <span className="registration-hint">, pas encore validée</span>}
      </span>
      <span className="registration-audience">{MAIL_AUDIENCE_LABEL[person.audience]}</span>
      {followUp && status === 'valide' && followUp.stage.label !== 'Validé·e' && (
        <span className="registration-stage">{followUp.stage.label}</span>
      )}
      {followUp && (followUp.badges.length > 0 || followUp.alerts.length > 0) && (
        <span className="registration-marks">
          {[...followUp.badges, ...followUp.alerts].map((mark) => (
            <span key={mark.label} className={TONE_CHIP[mark.tone]}>
              {mark.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );

  if (readOnly) return <div className="panel-section">{banner}</div>;

  return (
    <div className="panel-section registration-section">
      {banner}

      {confirming === null && (
        <div className="registration-actions">
          {status !== 'valide' && (
            <button type="button" className="btn is-primary" onClick={() => open('validation')}>
              Valider
            </button>
          )}
          {status === 'valide' && (
            <button type="button" className="btn is-small" onClick={() => open('renvoi')} disabled={!addressOk}>
              {last ? 'Renvoyer le mail' : 'Envoyer le mail'}
            </button>
          )}
          <label className="registration-select">
            <select
              className="select"
              name={`registration-status-${kind}-${personKey}`}
              value={status}
              aria-label={`Statut de ${who}`}
              onChange={(event) => {
                const next = event.target.value as ApplicationStatus;
                // Validating goes through the preview, whichever control asked for it.
                if (next === 'valide') open('validation');
                else setStatus(next);
              }}
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {confirming !== null && (
        <div className="registration-confirm" role="group" aria-label="Aperçu du mail">
          <p className="registration-confirm-title">
            {confirming === 'validation' ? `Valider ${who}` : `Renvoyer le mail à ${who}`}
          </p>
          {addressOk ? (
            <>
              <p className="registration-mail-head">
                À <strong>{mail.to}</strong>
                <br />
                Objet: <strong>{mail.subject}</strong>
              </p>
              <pre className="registration-mail-body">{mail.body}</pre>
              {mail.empty.length > 0 && (
                <p className="people-meta is-bad">
                  Vide dans ce message: {mail.empty.join(', ')}. Le texte se change dans Réglages, Mails de validation.
                </p>
              )}
              {confirming === 'validation' && (
                <label className="fiche-step">
                  <input
                    type="checkbox"
                    name="registration-with-mail"
                    checked={withMail}
                    onChange={(event) => setWithMail(event.target.checked)}
                  />
                  <span>Envoyer ce mail</span>
                </label>
              )}
            </>
          ) : (
            <p className="people-meta is-bad">
              {mail.to === ''
                ? "Pas d'adresse e-mail sur la fiche: la validation se fait sans mail."
                : `« ${mail.to} » n'est pas une adresse valide: la validation se fait sans mail.`}
            </p>
          )}
          <div className="registration-actions">
            <button
              type="button"
              className="btn is-primary"
              disabled={sending || (confirming === 'renvoi' && !addressOk)}
              onClick={() => void confirm()}
            >
              {sending
                ? 'Envoi…'
                : confirming === 'renvoi'
                  ? 'Envoyer'
                  : withMail && addressOk
                    ? 'Valider et envoyer'
                    : 'Valider sans mail'}
            </button>
            <button type="button" className="btn is-small" disabled={sending} onClick={() => setConfirming(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {log.error && <p className="people-meta is-bad">{log.error}</p>}
      {last ? (
        <MailLine entry={last} stepLabels={stepLabels} />
      ) : (
        !log.loading && <p className="people-meta">Aucun mail de validation envoyé.</p>
      )}
      {history.length > (last ? 1 : 0) && (
        <>
          <button type="button" className="btn is-link is-small" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Masquer l'historique" : `Tous les mails (${history.length})`}
          </button>
          {showHistory && (
            <ul className="registration-history">
              {history.filter((entry) => entry !== last).map((entry) => (
                <li key={entry.id}>
                  <MailLine entry={entry} stepLabels={stepLabels} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MailLine({ entry, stepLabels }: { entry: MailEntry; stepLabels: Map<string, string> }) {
  const when = sentAtLabel(entry.sentAt);
  const step = stepLabels.get(entry.stepKey) ?? entry.stepKey;
  const what =
    entry.reason === 'renvoi'
      ? 'Mail renvoyé'
      : entry.reason === 'etape'
        ? `Mail « ${step} » envoyé`
        : entry.reason === 'relance'
          ? `Mail « ${step} » renvoyé`
          : 'Mail de validation envoyé';
  if (entry.outcome === 'envoye') {
    return (
      <p className="registration-mail is-ok">
        ✉️ {what} {when} à {entry.recipient}
        {entry.error !== '' && <span className="registration-mail-error"> {entry.error}</span>}
      </p>
    );
  }
  return (
    <p className="registration-mail is-bad">
      ⚠️ Échec de l'envoi{entry.stepKey !== '' ? ` « ${step} »` : ''} {when} à {entry.recipient}
      <span className="registration-mail-error"> {entry.error}</span>
    </p>
  );
}
