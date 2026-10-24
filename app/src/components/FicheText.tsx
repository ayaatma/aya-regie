/**
 * A text field of a fiche in mode édition, 2026-10-24: typed into freely, saved when it is left.
 *
 * WHY NOT ONE EDIT PER KEYSTROKE. Every correction lands in the undo stack and the journal with a
 * sentence naming the person, so a phone number typed digit by digit would be ten lines of journal
 * and ten Ctrl+Z. The draft is committed on blur and on Enter, once, and only when it differs.
 *
 * COMMITTED ON UNMOUNT TOO. The fiche follows the arrow keys from one person to the next, and a
 * field unmounted while it still has the focus never fires its blur: what was typed would vanish
 * without a word. The commit captured at render names the person it was typed for.
 */

import { useEffect, useRef, useState } from 'react';

export function FicheText({
  value,
  onCommit,
  ariaLabel,
  name,
  placeholder,
  type = 'text',
  autoComplete = 'off',
}: {
  value: string;
  onCommit(value: string): void;
  ariaLabel: string;
  name?: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  const [draft, setDraft] = useState(value);
  // The stored value changed under the field (an undo, another field's commit): follow it.
  useEffect(() => setDraft(value), [value]);

  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  useEffect(
    () => () => {
      const { draft: typed, value: stored, onCommit: commit } = latest.current;
      if (typed !== stored) commit(typed);
    },
    [],
  );

  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      className="select"
      type={type}
      name={name}
      autoComplete={autoComplete}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}
