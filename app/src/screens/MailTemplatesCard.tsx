/**
 * Réglages > Mails de validation, 2026-10-22: the message each kind of person gets when validated.
 *
 * One text per audience (bénévole, orga, responsable, artiste, prestataire, autre), with blanks
 * like `{prenom}` filled at sending time (`renderMail`). Only a rewritten text is stored; a text
 * put back to the default follows the default again (`withMailTemplate`).
 *
 * Drafts committed on blur, like the régie's note: an edit per keystroke would fill the undo stack
 * and the journal with one line per letter.
 */

import { useEffect, useState } from 'react';

import {
  DEFAULT_MAIL_TEMPLATES,
  MAIL_AUDIENCES,
  MAIL_AUDIENCE_LABEL,
  MAIL_PLACEHOLDERS,
  mailTemplateFor,
  registrants,
  renderMail,
  withMailTemplate,
  type MailAudience,
} from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

export function MailTemplatesCard() {
  const { plan, edit } = useLoadedPlan();
  const [audience, setAudience] = useState<MailAudience>('benevole');
  const stored = mailTemplateFor(plan, audience);
  const [subject, setSubject] = useState(stored.subject);
  const [body, setBody] = useState(stored.body);
  // Another audience picked, or the text changed by an undo: the drafts follow.
  useEffect(() => {
    setSubject(stored.subject);
    setBody(stored.body);
  }, [audience, stored.subject, stored.body]);

  const rewritten = MAIL_AUDIENCES.filter((a) => plan.mailTemplates[a] !== undefined);
  const commit = (next: { subject: string; body: string }): void => {
    if (next.subject === stored.subject && next.body === stored.body) return;
    edit(
      (p) => ({ ...p, mailTemplates: withMailTemplate(p.mailTemplates, audience, next) }),
      `mail de validation ${MAIL_AUDIENCE_LABEL[audience].toLowerCase()}`,
    );
  };

  const sample = registrants(plan).find((r) => r.audience === audience) ?? null;
  const preview = sample
    ? renderMail({ ...plan, mailTemplates: withMailTemplate(plan.mailTemplates, audience, { subject, body }) }, sample, typeof window === 'undefined' ? '' : window.location.origin)
    : null;

  return (
    <SetupSection
      className="setup-mail-templates"
      title="Mails de validation"
      meta={rewritten.length === 0 ? 'textes par défaut' : `${rewritten.length} texte(s) personnalisé(s)`}
    >
      <p className="people-meta setup-orgas-note">
        Le mail part quand on valide une personne depuis sa fiche (onglet Personnes), après un aperçu.
        Un texte par type de personne.
      </p>
      <div className="mail-template">
        <label className="field">
          <span className="field-label">Pour</span>
          <select
            className="select"
            name="mail-template-audience"
            value={audience}
            onChange={(event) => setAudience(event.target.value as MailAudience)}
          >
            {MAIL_AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {MAIL_AUDIENCE_LABEL[a]}
                {plan.mailTemplates[a] !== undefined ? ' (personnalisé)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Objet</span>
          <input
            className="select"
            name="mail-template-subject"
            autoComplete="off"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            onBlur={() => commit({ subject, body })}
          />
        </label>
        <textarea
          className="select"
          name="mail-template-body"
          aria-label="Texte du mail"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => commit({ subject, body })}
        />
        <p className="mail-placeholders">
          Remplacés à l'envoi:{' '}
          {MAIL_PLACEHOLDERS.map((p) => (
            <span key={p.token} title={p.label}>
              <code>{p.token}</code>
            </span>
          ))}
        </p>
        {plan.mailTemplates[audience] !== undefined && (
          <button
            type="button"
            className="btn is-small"
            onClick={() => {
              setSubject(DEFAULT_MAIL_TEMPLATES[audience].subject);
              setBody(DEFAULT_MAIL_TEMPLATES[audience].body);
              edit(
                (p) => ({ ...p, mailTemplates: withMailTemplate(p.mailTemplates, audience, null) }),
                `mail de validation ${MAIL_AUDIENCE_LABEL[audience].toLowerCase()} remis par défaut`,
              );
            }}
          >
            Rétablir le texte par défaut
          </button>
        )}
        {preview && sample && (
          <>
            <p className="people-meta">
              Aperçu pour {`${sample.firstName} ${sample.lastName}`.trim() || 'une personne sans nom'}:{' '}
              <strong>{preview.subject}</strong>
            </p>
            <pre className="registration-mail-body">{preview.body}</pre>
          </>
        )}
      </div>
    </SetupSection>
  );
}
