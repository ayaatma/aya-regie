/**
 * A small « OK / Annuler » window, since 2026-10-22, for the one send that is not a person's mail
 * and so has no list to show: a test mail to the régisseur's own address.
 *
 * WHY A WINDOW AND NOT `window.confirm`. The régisseur's rule is that every action that sends a
 * mail asks first, in a popup. The browser's own dialog would do that, but it cannot show what is
 * being sent, it looks like an error, and it blocks the whole page: this one says what leaves,
 * uses the same buttons as `SendDialog`, and closes on Échap or a click beside it.
 */

import { useEffect, type ReactNode } from 'react';

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop is-front" onClick={onClose}>
      <div
        className="dialog is-small"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-intro">{children}</div>
        <div className="registration-actions dialog-actions">
          <button
            type="button"
            className="btn is-primary"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
