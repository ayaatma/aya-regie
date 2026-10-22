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
 * CANCELLING GOES THROUGH THE SAME WINDOW since 2026-10-22, with the event's cancellation mail
 * for that kind of person, « Envoyer ce mail » ticked: the régisseur asked for one, sent on a box
 * left ticked. A kind with no mail of that list is cancelled or validated without one, and the
 * window says so.
 *
 * READ-ONLY (an orga's code): the status only. The mail record needs a régisseur's session.
 */

import { useState } from 'react';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  audienceLabel,
  followUpOf,
  stepPersons,
  isMailAddress,
  registrantOf,
  renderMail,
  setRegistrationStatus,
  type ApplicationStatus,
  type RegistrantKind,
} from '../engine.ts';
import { sendMail, sentAtLabel, useMailLog, type MailEntry } from '../mail/mailStore.ts';
import { TONE_CHIP } from './FollowUpSteps.tsx';
import { SendDialog } from './SendDialog.tsx';
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
  const [confirming, setConfirming] = useState<null | 'validation' | 'renvoi' | 'annulation'>(null);
  const [withMail, setWithMail] = useState(true);
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const person = registrantOf(plan, kind, personKey);
  if (!person) return null;

  const who = `${person.firstName} ${person.lastName}`.trim() || 'cette personne';
  const status = person.status;
  // The mail of the window open, or of the validation when none is: the cancellation has its own.
  const mail = renderMail(plan, person, siteUrl(), confirming === 'annulation' ? 'annulation' : 'validation');
  const addressOk = mail !== null && isMailAddress(mail.to);
  const history = log.entriesOf(kind, personKey);
  const last = log.lastValidationOf(kind, personKey);
  const stepLabels = new Map(plan.applicationSteps.map((st) => [st.key, st.label]));
  // A bénévole's frise: « Planning : confirmé » says validated and mailed already.
  // An orga's too since 2026-10-22, now that a step can be sent to them.
  const stepPerson = kind === 'benevole' || kind === 'orga' ? stepPersons(plan).find((p) => p.kind === kind && p.key === personKey) : undefined;
  const facts = stepPerson ? log.factsOfPerson(kind, personKey) : null;
  const followUp = stepPerson && facts ? followUpOf(plan, stepPerson, facts.mails, facts.replies) : null;

  const setStatus = (next: ApplicationStatus): void =>
    edit((p) => setRegistrationStatus(p, kind, personKey, next), `inscription de ${who}: ${APPLICATION_STATUS_LABEL[next].toLowerCase()}`);

  const open = (mode: 'validation' | 'renvoi' | 'annulation'): void => {
    setConfirming(mode);
    setWithMail(true);
  };

  const confirm = async (): Promise<void> => {
    const mode = confirming;
    if (mode === null) return;
    if (mode === 'validation') setStatus('valide');
    if (mode === 'annulation') setStatus('annule');
    if ((mode === 'renvoi' || withMail) && mail !== null && addressOk && eventId !== null) {
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
      <span className="registration-audience">{audienceLabel(plan, person.audience)}</span>
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
            <button type="button" className="btn is-small" onClick={() => open('renvoi')} disabled={!isMailAddress(person.email)}>
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
                // Validating and cancelling go through the window, whichever control asked.
                if (next === 'valide') open('validation');
                else if (next === 'annule') open('annulation');
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

      {/*
        IN A WINDOW SINCE 2026-10-22, the régisseur's rule for every action that sends a mail: the
        same window as a grouped sending, for one person, with the exact mail beside the name.
      */}
      {confirming !== null && (
        <SendDialog
          title={
            confirming === 'validation'
              ? `Valider ${who}`
              : confirming === 'annulation'
                ? `Annuler l'inscription de ${who}`
                : `Renvoyer le mail à ${who}`
          }
          intro={
            <>
              {confirming === 'annulation' && kind === 'benevole' && (
                <p>Ses places restent où elles sont: elles passent en rouge sur la grille, à libérer depuis sa fiche.</p>
              )}
              {mail === null && (
                <p className="people-meta is-warn">
                  Aucun mail {confirming === 'annulation' ? "d'annulation" : 'de validation'} n'est prévu pour «{' '}
                  {audienceLabel(plan, person.audience)} » (Réglages, Mails).
                </p>
              )}
              {mail !== null && mail.empty.length > 0 && addressOk && (
                <p className="people-meta is-bad">
                  Vide dans ce message: {mail.empty.join(', ')}. Le texte se change dans Réglages, Mails.
                </p>
              )}
              {confirming !== 'renvoi' && addressOk && (
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
          }
          people={[
            {
              id: `${kind}|${personKey}`,
              name: who,
              mail: confirming !== 'renvoi' && !withMail ? null : mail,
              kind,
              key: personKey,
            },
          ]}
          withoutMailNote={
            confirming === 'validation' ? 'validé·e sans mail' : confirming === 'annulation' ? 'annulé·e sans mail' : undefined
          }
          confirmLabel={(mailed) =>
            confirming === 'renvoi'
              ? 'Envoyer'
              : confirming === 'annulation'
                ? mailed > 0
                  ? 'Annuler et envoyer'
                  : 'Annuler sans mail'
                : mailed > 0
                  ? 'Valider et envoyer'
                  : 'Valider sans mail'
          }
          onConfirm={() => void confirm()}
          onClose={() => {
            if (!sending) setConfirming(null);
          }}
        />
      )}
      {sending && <p className="people-meta">Envoi…</p>}

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
      : entry.reason === 'annulation'
        ? "Mail d'annulation envoyé"
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
