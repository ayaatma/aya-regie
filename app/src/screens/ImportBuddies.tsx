/**
 * The binômes of a fiche still under review, since 2026-10-22.
 *
 * A binôme the import could not resolve used to be fixable only once the import was applied, on
 * the fiche in Personnes, and only against the people already there. Here it is fixed on the
 * fiche being imported, against everybody: the people of this file AND the people already on
 * the plan (entered by hand, or kept from an earlier import). Nothing is written to the plan
 * until « Appliquer cet import »; the pairs added or removed are held on the fiche's fix and
 * replayed after the reconciliation, as manual pairs, by `withBuddyFixes`.
 *
 * Each pair is one person asking to work with another. Several are allowed, and they stay
 * pairs: A with B and A with C does not put B with C.
 */

import { useState } from 'react';
import type { Plan, ResolvedBuddy, Volunteer } from '../engine.ts';
import { addBuddy, removeBuddy } from '../store/edits.ts';
import type { BuddyFix } from '../import/importSession.ts';

export interface ImportBuddiesProps {
  volunteer: Volunteer;
  /** What the import resolved from this person's answer, unresolved names included. */
  resolved: readonly ResolvedBuddy[];
  /** Everybody a binôme may name: this file's people, then the plan's people not in it. */
  people: readonly Volunteer[];
  fix: BuddyFix | undefined;
  onChange(next: BuddyFix): void;
}

const fullName = (v: Volunteer): string => `${v.firstName} ${v.lastName}`.trim();

export function ImportBuddies({ volunteer, resolved, people, fix, onChange }: ImportBuddiesProps) {
  const [adding, setAdding] = useState('');
  const added = fix?.added ?? [];
  const removed = fix?.removed ?? [];
  const byKey = new Map(people.map((p) => [p.key, p]));

  const fromForm = resolved.filter((b) => b.toKey !== null && !removed.includes(b.toKey)).map((b) => b.toKey!);
  const current = [...new Set([...fromForm, ...added])];
  const unresolved = resolved.filter((b) => b.toKey === null);
  // Two people of one name are told apart by their address, which is what the form asked for.
  const homonyms = new Set(people.map(fullName).filter((name, i, all) => all.indexOf(name) !== i));
  const choices = people
    .filter((p) => p.key !== volunteer.key && !current.includes(p.key))
    .map((p) => ({ key: p.key, name: homonyms.has(fullName(p)) && p.email ? `${fullName(p)} (${p.email})` : fullName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const remove = (toKey: string): void =>
    onChange(
      added.includes(toKey)
        ? { added: added.filter((k) => k !== toKey), removed }
        : { added, removed: [...removed, toKey] },
    );
  const add = (toKey: string): void =>
    onChange({ added: [...added.filter((k) => k !== toKey), toKey], removed: removed.filter((k) => k !== toKey) });

  return (
    <div className="panel-section import-buddies">
      <p className="panel-section-title">Binômes demandés</p>
      {current.length === 0 && <p className="pool-item-meta">Aucun relié pour l'instant.</p>}
      {current.map((toKey) => {
        const name = byKey.get(toKey) ? fullName(byKey.get(toKey)!) : toKey;
        return (
          <span key={toKey} className="chip">
            {name}
            <button
              type="button"
              className="chip-remove"
              title={`Retirer le binôme avec ${name}`}
              aria-label={`Retirer le binôme avec ${name}`}
              onClick={() => remove(toKey)}
            >
              ✕
            </button>
          </span>
        );
      })}
      {unresolved.length > 0 && (
        <p className="pool-item-meta">
          Écrit dans le formulaire sans correspondance: {unresolved.map((b) => `« ${b.rawName} »`).join(', ')}.
          {unresolved.some((b) => b.candidates.length > 0) &&
            ` Peut-être: ${[...new Set(unresolved.flatMap((b) => b.candidates))].join(', ')}.`}
        </p>
      )}
      <div className="buddy-add">
        <select
          className="select"
          aria-label={`Ajouter un binôme à ${fullName(volunteer)}`}
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
        >
          <option value="">Ajouter un binôme…</option>
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={adding === ''}
          onClick={() => {
            add(adding);
            setAdding('');
          }}
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

/**
 * The binômes settled on the fiches, laid on the plan the import just built. Only pairs whose two
 * people are still on it: somebody the import removes takes their pairs along, as everywhere.
 */
export function withBuddyFixes(plan: Plan, fixes: Record<string, { buddies?: BuddyFix }>): Plan {
  const present = new Set(plan.volunteers.map((v) => v.key));
  let next = plan;
  for (const [fromKey, fix] of Object.entries(fixes)) {
    if (!fix.buddies || !present.has(fromKey)) continue;
    for (const toKey of fix.buddies.removed) next = removeBuddy(next, fromKey, toKey);
    for (const toKey of fix.buddies.added) if (present.has(toKey)) next = addBuddy(next, fromKey, toKey);
  }
  return next;
}
