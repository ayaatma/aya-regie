/**
 * Réglages > Mails, 2026-10-22: the message each kind of person gets when validated, and since the
 * same day when their inscription is cancelled.
 *
 * TWO LISTS OF MAILS, EACH MAIL FOR ONE OR SEVERAL KINDS. The régisseur asked for both « one mail
 * for several kinds » and « another mail for another kind »: a mail carries the kinds it is for
 * (the computed ones, then the event's guest types), and ticking a kind on one mail unticks it on
 * the others (`withAudience`), so who gets which text never depends on the order. A kind on no
 * mail gets none, and the card says which. A list equal to the defaults is not stored (`withMails`).
 *
 * Drafts committed on blur, like the régie's note: an edit per keystroke would fill the undo stack
 * and the journal with one line per letter.
 */

import { useEffect, useState } from 'react';

import {
  MAIL_KIND_LABEL,
  MAIL_PLACEHOLDERS,
  audienceOptions,
  audiencesWithoutMail,
  mailsOf,
  registrants,
  renderTemplate,
  withAudience,
  withMails,
  type AudienceMail,
  type MailKind,
} from '../engine.ts';
import { TestMailButton } from '../mail/testMail.tsx';
import { useLoadedPlan, usePlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

const KINDS: readonly MailKind[] = ['validation', 'annulation'];

const siteUrl = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

export function MailTemplatesCard() {
  const { plan, edit } = useLoadedPlan();
  const [kind, setKind] = useState<MailKind>('validation');
  const mails = mailsOf(plan, kind);
  const touched = KINDS.filter((k) => plan.mailTemplates[k] !== undefined);
  const missing = audiencesWithoutMail(plan, kind);

  const save = (next: readonly AudienceMail[], what: string): void =>
    edit((p) => ({ ...p, mailTemplates: withMails(p.mailTemplates, kind, next) }), what);

  const add = (): void => {
    const taken = new Set(mails.map((m) => m.key));
    let n = mails.length + 1;
    while (taken.has(`mail-${n}`)) n++;
    save(
      [...mails, { key: `mail-${n}`, audiences: [], subject: '{evenement} : ', body: 'Bonjour {prenom},\n\n\n\nÀ très vite,\n' + "L'équipe d'organisation" }],
      `mail ${MAIL_KIND_LABEL[kind].toLowerCase()} ajouté`,
    );
  };

  return (
    <SetupSection
      className="setup-mail-templates"
      title="Mails de validation et d'annulation"
      meta={touched.length === 0 ? 'textes par défaut' : `${touched.map((k) => MAIL_KIND_LABEL[k].toLowerCase()).join(' et ')} personnalisé(s)`}
    >
      <p className="people-meta setup-orgas-note">
        Le mail part quand on valide ou qu'on annule une personne depuis sa fiche (onglet Personnes),
        toujours après une fenêtre de confirmation, ou en groupe avec « Valider les personnes
        placées ». Un même mail peut servir à plusieurs types de personne; un type ne reçoit qu'un
        seul mail.
      </p>
      <label className="field">
        <span className="field-label">Mails envoyés à</span>
        <select
          className="select"
          name="mail-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as MailKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'validation' ? 'la validation' : "l'annulation"}
              {plan.mailTemplates[k] !== undefined ? ' (personnalisés)' : ''}
            </option>
          ))}
        </select>
      </label>
      {missing.length > 0 && (
        <p className="people-meta is-warn">
          Sans mail {kind === 'validation' ? 'de validation' : "d'annulation"}: {missing.join(', ')}.
        </p>
      )}

      {mails.map((mail) => (
        <MailEditor
          key={`${kind}-${mail.key}`}
          mail={mail}
          onAudience={(audience, on) =>
            save(withAudience(mails, mail.key, audience, on), `destinataires d'un mail ${MAIL_KIND_LABEL[kind].toLowerCase()}`)
          }
          onText={(subject, body) =>
            save(
              mails.map((m) => (m.key === mail.key ? { ...m, subject, body } : m)),
              `texte d'un mail ${MAIL_KIND_LABEL[kind].toLowerCase()}`,
            )
          }
          onRemove={() =>
            save(
              mails.filter((m) => m.key !== mail.key),
              `mail ${MAIL_KIND_LABEL[kind].toLowerCase()} retiré`,
            )
          }
        />
      ))}

      <p className="registration-actions">
        <button type="button" className="btn is-small" onClick={add}>
          Ajouter un mail
        </button>
        {plan.mailTemplates[kind] !== undefined && (
          <button
            type="button"
            className="btn is-small"
            onClick={() =>
              edit(
                (p) => ({ ...p, mailTemplates: withMails(p.mailTemplates, kind, null) }),
                `mails ${MAIL_KIND_LABEL[kind].toLowerCase()} remis par défaut`,
              )
            }
          >
            Rétablir les mails par défaut
          </button>
        )}
      </p>
      <p className="mail-placeholders">
        Remplacés à l'envoi:{' '}
        {MAIL_PLACEHOLDERS.map((p) => (
          <span key={p.token} title={p.label}>
            <code>{p.token}</code>
          </span>
        ))}
      </p>
    </SetupSection>
  );
}

/** One mail: who it is for, its text, and how it reads for one of them. */
function MailEditor({
  mail,
  onAudience,
  onText,
  onRemove,
}: {
  mail: AudienceMail;
  onAudience(audience: string, on: boolean): void;
  onText(subject: string, body: string): void;
  onRemove(): void;
}) {
  const { plan } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const [subject, setSubject] = useState(mail.subject);
  const [body, setBody] = useState(mail.body);
  // The text changed by an undo, or the defaults restored: the drafts follow.
  useEffect(() => {
    setSubject(mail.subject);
    setBody(mail.body);
  }, [mail.subject, mail.body]);
  const commit = (): void => {
    if (subject !== mail.subject || body !== mail.body) onText(subject, body);
  };

  // Rendered once unfolded: a mail holding {planning} computes a whole planning to show.
  const [showing, setShowing] = useState(false);
  const sample = registrants(plan).find((r) => mail.audiences.includes(r.audience)) ?? null;
  const preview = sample && showing ? renderTemplate(plan, sample, { subject, body }, siteUrl()) : null;

  return (
    <div className="mail-template">
      <div className="setup-bracelet-statuses" role="group" aria-label="Pour qui">
        {audienceOptions(plan).map((option) => (
          <label key={option.key} className="checkline">
            <input
              type="checkbox"
              name={`mail-${mail.key}-${option.key}`}
              checked={mail.audiences.includes(option.key)}
              onChange={(event) => onAudience(option.key, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
        <button type="button" className="btn is-icon is-danger" title="Retirer ce mail" onClick={onRemove}>
          ✕
        </button>
      </div>
      <label className="field">
        <span className="field-label">Objet</span>
        <input
          className="select"
          name={`mail-${mail.key}-subject`}
          autoComplete="off"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          onBlur={commit}
        />
      </label>
      <textarea
        className="select"
        name={`mail-${mail.key}-body`}
        aria-label="Texte du mail"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={commit}
      />
      {mail.audiences.length === 0 && <p className="people-meta is-warn">Ce mail n'est pour personne.</p>}
      {sample && (
        <details onToggle={(event) => setShowing(event.currentTarget.open)}>
          <summary className="people-meta">
            Aperçu pour {`${sample.firstName} ${sample.lastName}`.trim() || 'une personne sans nom'}
            {preview && (
              <>
                : <strong>{preview.subject}</strong>
              </>
            )}
          </summary>
          {preview && (
            <>
              <pre className="registration-mail-body">{preview.body}</pre>
              <p>
                <TestMailButton
                  eventId={eventId}
                  kind={sample.kind}
                  personKey={sample.key}
                  who={`${sample.firstName} ${sample.lastName}`.trim()}
                  mail={preview}
                />
              </p>
            </>
          )}
        </details>
      )}
    </div>
  );
}
