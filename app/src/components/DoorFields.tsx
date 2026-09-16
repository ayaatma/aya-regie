/**
 * The four things the door decides about one person: the ticket, the bracelet, the drink tickets
 * and a remark. Drawn in two places since 2026-09-15, the row of the Personnes tab and the fiche
 * beside it, so they are written once here: two copies of `chooseForPerson`'s defaults would drift
 * the first time one of them learnt a new rule.
 *
 * `prefix` keeps the two copies' field names apart. Both can be on screen at once (the row and the
 * open fiche of the same person), and a form field's name is how the tests and the browser's
 * autofill tell them apart.
 */

import type { TicketingReport, TicketingRow } from '../engine.ts';
import { defaultBracelet, defaultTicketType } from '../engine.ts';
import { chooseForPerson } from '../store/ticketingEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { NumberField } from './NumberField.tsx';

interface DoorFieldProps {
  row: TicketingRow;
  report: TicketingReport;
  /** "Camille Dubois", or "cette personne" for a row with no name yet. */
  who: string;
  prefix?: string;
}

export const personLabel = (row: Pick<TicketingRow, 'firstName' | 'lastName'>): string =>
  `${row.firstName} ${row.lastName}`.trim() || 'cette personne';

/**
 * What this row would get with no choice at all, from the same rules the report applies, so a pick
 * equal to the default stores nothing.
 */
export function doorDefaults(row: TicketingRow, report: TicketingReport) {
  return {
    ticketTypeKey: defaultTicketType(report.ticketTypes)?.key ?? null,
    braceletKey: defaultBracelet(report.bracelets, row.statuses.map((s) => s.status))?.key ?? null,
    drinkTickets: row.computedDrinks,
  };
}

export const hasDoorChoice = (row: TicketingRow): boolean =>
  row.ticketByHand || row.braceletByHand || row.drinksByHand || row.note !== '';

export function TicketSelect({ row, report, who, prefix = '' }: DoorFieldProps) {
  const { edit } = useLoadedPlan();
  return (
    <select
      className={`select${row.ticketByHand ? ' is-manual' : ''}`}
      name={`${prefix}ticket-${row.kind}-${row.key}`}
      value={row.ticketTypeKey ?? ''}
      disabled={report.ticketTypes.length === 0}
      aria-label={`Ticket de ${who}`}
      title={row.ticketByHand ? 'Choisi à la main; suit Réglages sinon.' : "Le type par défaut de l'événement."}
      onChange={(event) =>
        edit(
          (p) =>
            chooseForPerson(p, row.kind, row.key, { ticketTypeKey: event.target.value || null }, doorDefaults(row, report)),
          `ticket de ${who}`,
        )
      }
    >
      {report.ticketTypes.length === 0 && <option value="">aucun type défini</option>}
      {report.ticketTypes.map((type) => (
        <option key={type.key} value={type.key}>
          {type.label}
        </option>
      ))}
    </select>
  );
}

export function BraceletSelect({ row, report, who, prefix = '' }: DoorFieldProps) {
  const { edit } = useLoadedPlan();
  return (
    <select
      className={`select${row.braceletByHand ? ' is-manual' : ''}`}
      name={`${prefix}bracelet-${row.kind}-${row.key}`}
      value={row.braceletKey ?? ''}
      disabled={report.bracelets.length === 0}
      aria-label={`Bracelet de ${who}`}
      title={row.braceletByHand ? 'Choisi à la main; suit Réglages sinon.' : 'Le bracelet par défaut de son statut.'}
      onChange={(event) =>
        edit(
          (p) =>
            chooseForPerson(p, row.kind, row.key, { braceletKey: event.target.value || null }, doorDefaults(row, report)),
          `bracelet de ${who}`,
        )
      }
    >
      <option value="">{report.bracelets.length === 0 ? 'aucun bracelet défini' : 'aucun'}</option>
      {report.bracelets.map((bracelet) => (
        <option key={bracelet.key} value={bracelet.key}>
          {bracelet.label}
        </option>
      ))}
    </select>
  );
}

/**
 * THE COMPUTED FIGURE IS THE PLACEHOLDER, the régisseur's figure is the value. Typing the computed
 * figure back stores nothing; emptying the field goes back to it. Green says "this one is not the
 * rule's". Not for an extra, whose figure is their own and edited on their own fields.
 */
export function DrinksField({ row, report, who, prefix = '' }: DoorFieldProps) {
  const { edit } = useLoadedPlan();
  return (
    <NumberField
      value={row.drinksByHand ? row.drinks : null}
      placeholder={String(row.computedDrinks)}
      ariaLabel={`Tickets boisson de ${who}`}
      name={`${prefix}drinks-${row.kind}-${row.key}`}
      title={
        row.drinksByHand
          ? `Fixé à la main (calculé: ${row.computedDrinks}). Videz le champ pour revenir au calcul.`
          : "Calculé d'après les règles de l'événement. Tapez un nombre pour décider autrement."
      }
      onCommit={(value) =>
        edit(
          (p) =>
            chooseForPerson(
              p,
              row.kind,
              row.key,
              { drinkTickets: value === null ? null : Math.round(value) },
              doorDefaults(row, report),
            ),
          `tickets boisson de ${who}`,
        )
      }
    />
  );
}

export function NoteField({ row, report, who, prefix = '' }: DoorFieldProps) {
  const { edit } = useLoadedPlan();
  return (
    <input
      className="select"
      name={`${prefix}note-${row.kind}-${row.key}`}
      autoComplete="off"
      placeholder="Remarque pour l'entrée"
      value={row.note}
      aria-label={`Remarque sur ${who}`}
      onChange={(event) =>
        edit(
          (p) => chooseForPerson(p, row.kind, row.key, { note: event.target.value }, doorDefaults(row, report)),
          `remarque sur ${who}`,
        )
      }
    />
  );
}
