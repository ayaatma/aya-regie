/**
 * One section of Réglages, folded shut until somebody opens it.
 *
 * WHY SHUT BY DEFAULT, in the régisseur's words of 2026-09-12: "ce serait mieux que chaque grande
 * partie soit à dérouler et non déroulé par défaut". Réglages had grown to nine cards and fifteen
 * pole groups, all open at once, so finding the one thing you came for meant scrolling past
 * everything you did not. Folded, the screen is an index of the event: seven lines, each saying
 * what it holds, and one click to the one that matters.
 *
 * THE CONTENT STAYS MOUNTED AND IS HIDDEN, rather than being unmounted while folded. Two reasons,
 * and the second is the one that decided it:
 *
 *   - a card holds drafts. `ClockField` keeps what is half-typed, `NumberField` keeps a number
 *     mid-edit, the Orgas card keeps which fiche is open and which deletion is armed. Unmounting
 *     throws all of that away, so a fold and an unfold would silently discard an edit in progress.
 *   - `hidden` takes the subtree out of the tab order and out of the accessibility tree, which is
 *     what folded has to mean for somebody who never uses a pointer. A `display: none` from a
 *     class would do the same; the attribute says it without a stylesheet having to agree.
 *
 * The cost is that a folded card still renders, which is what the screen already did for all of
 * them at once, so nothing got slower.
 */

import { useState, type ReactNode } from 'react';

export function SetupSection({
  title,
  meta,
  actions,
  children,
  defaultOpen = false,
  className = '',
  style,
}: {
  title: ReactNode;
  /** The one line that says what is inside without opening it. Counts, never prose. */
  meta?: ReactNode;
  /**
   * Controls that belong on the head itself and stay reachable while the section is folded.
   *
   * BESIDE THE TOGGLE AND NEVER INSIDE IT. A phase's "activée" checkbox lives here, and a form
   * control nested inside a `<button>` is invalid markup that behaves differently in every
   * browser: the click lands on the button, the space bar folds the section instead of ticking
   * the box, and a screen reader announces one control where there are two.
   */
  actions?: ReactNode;
  children: ReactNode;
  /** Open on arrival. Reserved for a section that is the reason somebody came to this screen. */
  defaultOpen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`setup-group${className === '' ? '' : ` ${className}`}`} style={style}>
      <div className="setup-group-head">
        <button
          type="button"
          className="setup-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="setup-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="setup-group-title">{title}</span>
          {meta !== undefined && <span className="people-meta">{meta}</span>}
        </button>
        {actions}
      </div>

      <div className="setup-group-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
