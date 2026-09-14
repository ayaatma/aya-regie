/**
 * A number field that lets the régisseur empty it mid-edit without the value jumping to zero.
 *
 * Born in `CateringCard.tsx` on 2026-09-12 and moved here on 2026-09-13 when the Artistes tab
 * needed the same thing on twenty fields. The draft lives in the field until blur or Enter, so
 * selecting "2" and typing "1" then "5" commits 15 once rather than 1 then 15, and an emptied
 * field commits nothing at all.
 */

import { useState } from 'react';

export function NumberField({
  value,
  onCommit,
  ariaLabel,
  name,
  step = 1,
  min = 0,
  placeholder,
  title,
}: {
  value: number | null;
  onCommit(value: number | null): void;
  ariaLabel: string;
  name: string;
  step?: number;
  min?: number;
  /** Shown while the field is empty; the one case a null value is a state of its own. */
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className="select is-number"
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      name={name}
      aria-label={ariaLabel}
      autoComplete="off"
      placeholder={placeholder}
      title={title}
      value={draft ?? (value === null ? '' : String(value))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        if (draft.trim() === '') {
          // Emptying a field that may be empty means "no figure of my own"; emptying one that
          // may not keeps what it had.
          if (placeholder !== undefined) onCommit(null);
        } else {
          const parsed = Number(draft.replace(',', '.'));
          if (Number.isFinite(parsed)) onCommit(Math.max(min, parsed));
        }
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}
