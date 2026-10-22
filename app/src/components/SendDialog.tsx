/**
 * « Êtes-vous sûr ? », with the names, 2026-10-22: the window every grouped action opens before
 * it does anything. The validation of everybody placed, and every grouped sending of a step.
 *
 * THE LIST IS THE CONFIRMATION. The régisseur asked to see who a grouped action touches, name by
 * name, before it touches them: a count alone reads the same whether it is the twelve people
 * meant or forty by mistake. Clicking a name shows the exact mail that person gets, so a blank
 * left empty or a planning that looks wrong is seen before it leaves, not after.
 *
 * Who has no usable address is listed apart: they are validated all the same (a validation is a
 * decision, not a mail), and get nothing.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { isMailAddress, type RenderedMail } from '../engine.ts';

export interface DialogPerson {
  /** Unique within the list. */
  id: string;
  name: string;
  mail: RenderedMail | null;
}

export function SendDialog({
  title,
  intro,
  people,
  confirmLabel,
  withoutMailNote,
  onConfirm,
  onClose,
}: {
  title: string;
  intro: ReactNode;
  people: readonly DialogPerson[];
  confirmLabel: (mailed: number) => string;
  /** What happens to the people without an address; omitted, they are simply left out. */
  withoutMailNote?: string;
  onConfirm(): void;
  onClose(): void;
}) {
  const mailed = people.filter((p) => p.mail !== null && isMailAddress(p.mail.to));
  const unmailed = people.filter((p) => !mailed.includes(p));
  const [shown, setShown] = useState<string | null>(mailed[0]?.id ?? null);
  const preview = mailed.find((p) => p.id === shown)?.mail ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-intro">{intro}</div>
        <div className="dialog-body">
          <div className="dialog-names">
            <p className="people-meta">
              <strong>{mailed.length}</strong> recevront le mail
            </p>
            <ol className="dialog-list">
              {mailed.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`dialog-name${p.id === shown ? ' is-active' : ''}`}
                    onClick={() => setShown(p.id)}
                    title="Voir son mail"
                  >
                    {p.name}
                  </button>
                  {p.mail && p.mail.empty.length > 0 && <span className="chip is-bad">vide: {p.mail.empty.join(', ')}</span>}
                </li>
              ))}
            </ol>
            {unmailed.length > 0 && (
              <>
                <p className="people-meta is-warn">
                  <strong>{unmailed.length}</strong> sans adresse valide
                  {withoutMailNote ? `: ${withoutMailNote}` : ', pas de mail'}
                </p>
                <ol className="dialog-list">
                  {unmailed.map((p) => (
                    <li key={p.id}>
                      <span className="dialog-name is-off">{p.name}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          {preview && (
            <div className="dialog-preview">
              <p className="registration-mail-head">
                À <strong>{preview.to}</strong>
                <br />
                Objet: <strong>{preview.subject}</strong>
              </p>
              <pre className="registration-mail-body">{preview.body}</pre>
            </div>
          )}
        </div>
        <div className="registration-actions dialog-actions">
          <button
            type="button"
            className="btn is-primary"
            disabled={people.length === 0}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel(mailed.length)}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
