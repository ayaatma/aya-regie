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
  isMailAddress,
  registrantOf,
  renderMail,
  setRegistrationStatus,
  type ApplicationStatus,
  type RegistrantKind,
} from '../engine.ts';
import { sendMail, sentAtLabel, useMailLog, type MailEntry } from '../mail/mailStore.ts';
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
  const last = history[0] ?? null;

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
        <MailLine entry={last} />
      ) : (
        !log.loading && <p className="people-meta">Aucun mail envoyé.</p>
      )}
      {history.length > 1 && (
        <>
          <button type="button" className="btn is-link is-small" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Masquer l'historique" : `Historique des mails (${history.length})`}
          </button>
          {showHistory && (
            <ul className="registration-history">
              {history.slice(1).map((entry) => (
                <li key={entry.id}>
                  <MailLine entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MailLine({ entry }: { entry: MailEntry }) {
  const when = sentAtLabel(entry.sentAt);
  if (entry.outcome === 'envoye') {
    return (
      <p className="registration-mail is-ok">
        ✉️ {entry.reason === 'renvoi' ? 'Mail renvoyé' : 'Mail de validation envoyé'} {when} à {entry.recipient}
        {entry.error !== '' && <span className="registration-mail-error"> {entry.error}</span>}
      </p>
    );
  }
  return (
    <p className="registration-mail is-bad">
      ⚠️ Échec de l'envoi {when} à {entry.recipient}
      <span className="registration-mail-error"> {entry.error}</span>
    </p>
  );
}
