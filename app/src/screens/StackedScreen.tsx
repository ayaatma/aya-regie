/**
 * Two screens on one tab, one under the other.
 *
 * THE TABS WERE TEN AND THE RÉGISSEUR ASKED FOR SEVEN, on 2026-09-13: Import with Impression
 * (renamed Export) under it, Tableau de bord with Recrutement under it, Historique with the
 * Journal under it, the last two folded until opened. Each of the six screens was written as a
 * whole tab, with its own toolbar and its own scrolling body sized to the window, and rewriting
 * them as fragments would have been a day's work for no change anybody could see.
 *
 * So this is a SHELL AROUND THE EXISTING SHELLS, and the stylesheet does the rest: inside a
 * `.stack-section`, a `.screen` stops being a window-high grid and becomes a block, its body
 * stops scrolling on its own, and the one thing that scrolls is `.stack-body`. Every screen
 * keeps its toolbar, which now reads as the head of its part of the page.
 *
 * A FOLDED SECTION IS HIDDEN, NOT UNMOUNTED, for the reason `SetupSection` gives: the Journal
 * loads its rows when it mounts and the history table holds a name being typed, and a fold
 * that threw those away would be a fold nobody dares use. The one cost is that the Journal is
 * fetched even while folded, which it always was when it had a tab of its own.
 */

import { useState, type ReactNode } from 'react';

export interface StackSection {
  /** Also the anchor another part of the page can scroll to: `#stack-<id>`. */
  id: string;
  title: string;
  children: ReactNode;
  /** Folded until opened. Off means the section is always open and carries no caret. */
  foldable?: boolean;
  /**
   * The only section that goes to paper. With two screens on one tab, printing the tab would
   * print both; the stylesheet keeps the others off the page.
   */
  printable?: boolean;
}

export function StackedScreen({ sections }: { sections: readonly StackSection[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(sections.filter((s) => !s.foldable).map((s) => s.id)),
  );

  // From the previous state, not the closure's: two toggles in one tick must both count.
  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="stack-body">
          {sections.map((section) => {
            const shown = open.has(section.id);
            return (
              <section
                key={section.id}
                id={`stack-${section.id}`}
                className={
                  'stack-section' +
                  (section.printable ? ' is-printable' : ' no-print') +
                  (shown ? ' is-open' : ' is-folded')
                }
              >
                <div className="stack-head">
                  {section.foldable ? (
                    <button
                      className="setup-group-toggle"
                      aria-expanded={shown}
                      onClick={() => toggle(section.id)}
                      title={shown ? 'Replier' : 'Déplier'}
                    >
                      <span className="setup-caret" aria-hidden="true">
                        {shown ? '▾' : '▸'}
                      </span>
                      <h2 className="stack-title">{section.title}</h2>
                    </button>
                  ) : (
                    <h2 className="stack-title">{section.title}</h2>
                  )}
                </div>
                <div className="stack-content" hidden={!shown}>
                  {section.children}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Scrolls a section into view, for a button on one part of the page pointing at the other. */
export function scrollToSection(id: string): void {
  document.getElementById(`stack-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
