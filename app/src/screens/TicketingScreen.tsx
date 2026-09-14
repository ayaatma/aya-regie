/**
 * La billetterie: the list the door works from.
 *
 * ONE READER, ONE QUESTION: somebody at the entrance, a name in front of them, asking "does this
 * person get in, and what do I hand them". So the list is sorted by name, searchable by name,
 * and every row says the statuses, the two ticket counts, the kind of entry and the bracelet.
 * Nothing here counts anything itself: it is `ticketingReport`, which reads the catering for the
 * tickets so the door's figure is the caterer's figure.
 *
 * TWO THINGS ARE WRITTEN HERE. A ticket or a bracelet chosen for one person against the default
 * (stored only where it differs, like a plate on the Catering tab), and the people the door
 * alone knows: prestataires and other invitations, typed in place on their own row. The rest
 * (ticket types, bracelets, the invitations per artist) is Réglages'.
 */

import { useState } from 'react';

import {
  PERSON_STATUS_LABEL,
  defaultBracelet,
  defaultTicketType,
  ticketingCsv,
  ticketingReport,
  type ExtraPerson,
  type PersonStatus,
  type TicketingReport,
  type TicketingRow,
} from '../engine.ts';
import {
  addExtraPerson,
  chooseForPerson,
  clearChoices,
  deleteExtraPerson,
  setExtraPerson,
} from '../store/ticketingEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { downloadText, today } from '../components/download.ts';
import { NumberField } from '../components/NumberField.tsx';


const ALL = 'tous';

const flatten = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export function TicketingScreen({ onGoToSetup }: { onGoToSetup(): void }) {
  const { plan, index, edit } = useLoadedPlan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PersonStatus | typeof ALL>(ALL);
  const [withPhones, setWithPhones] = useState(false);

  const report = ticketingReport(plan, index);
  const needle = flatten(search);
  const rows = report.rows.filter((row) => {
    if (status !== ALL && !row.statuses.some((s) => s.status === status)) return false;
    if (needle === '') return true;
    return flatten(`${row.lastName} ${row.firstName} ${row.firstName} ${row.lastName}`).includes(needle);
  });
  const issues = report.rows.filter((r) => r.issues.length > 0).length;
  const statuses = Object.keys(PERSON_STATUS_LABEL) as PersonStatus[];

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {report.rows.length} personne{report.rows.length > 1 ? 's' : ''} sans billet
          </strong>
          {issues > 0 && (
            <span className="chip is-warn" title="Des lignes portent une incohérence, signalée en bout de ligne">
              {issues} incohérence{issues > 1 ? 's' : ''}
            </span>
          )}
          <span className="toolbar-sep" />
          <label className="toolbar-field">
            <input
              className="select"
              placeholder="Chercher un nom"
              name="ticketing-search"
              autoComplete="off"
              value={search}
              aria-label="Chercher une personne"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="checkline">
            Statut
            <select
              className="select"
              value={status}
              aria-label="Filtrer par statut"
              onChange={(event) => setStatus(event.target.value as PersonStatus | typeof ALL)}
            >
              <option value={ALL}>Tous ({report.rows.length})</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {PERSON_STATUS_LABEL[s]} ({report.byStatus[s] ?? 0})
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-sep" />
          <button
            className="btn is-small"
            onClick={() => edit((p) => addExtraPerson(p, 'prestataire'), 'prestataire ajouté')}
          >
            Ajouter un prestataire
          </button>
          <button
            className="btn is-small"
            onClick={() => edit((p) => addExtraPerson(p, 'autre'), 'invitation ajoutée')}
          >
            Ajouter une invitation
          </button>
          <span className="toolbar-sep" />
          <label className="checkline" title="Une donnée personnelle: à ne cocher que si la liste reste entre les mains des responsables">
            <input
              type="checkbox"
              checked={withPhones}
              onChange={(event) => setWithPhones(event.target.checked)}
            />
            Téléphones
          </label>
          <button
            className="btn"
            onClick={() =>
              downloadText(
                `billetterie-${today()}${withPhones ? '-avec-telephones' : ''}.csv`,
                ticketingCsv(plan, index, withPhones),
              )
            }
          >
            Exporter la liste
          </button>
        </div>

        <div className="screen-body">
          {(report.ticketTypes.length === 0 || report.bracelets.length === 0) && (
            <p className="screen-card-note ticketing-note">
              {report.ticketTypes.length === 0 && 'Aucun type de ticket'}
              {report.ticketTypes.length === 0 && report.bracelets.length === 0 && ' et '}
              {report.bracelets.length === 0 && (report.ticketTypes.length === 0 ? 'aucun bracelet' : 'Aucun bracelet')}
              {" n'est défini pour cet événement: la liste se lit quand même, ces colonnes restent vides. "}
              <button className="btn is-small" onClick={onGoToSetup}>
                Ouvrir les Réglages
              </button>
            </p>
          )}

          <section className="screen-card">
            <div className="screen-scroll">
              <table className="setup-table catering-table ticketing-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Prénom</th>
                    <th>Statut</th>
                    <th title="Tickets boisson à remettre">Boissons</th>
                    <th title="Tickets repas à remettre">Repas</th>
                    <th>Ticket</th>
                    <th>Bracelet</th>
                    {withPhones && <th>Téléphone</th>}
                    <th>Remarques</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <TicketingLine
                      key={`${row.kind}|${row.key}`}
                      row={row}
                      report={report}
                      withPhones={withPhones}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <p className="panel-sub catering-empty">
                {report.rows.length === 0
                  ? "Personne n'est encore entré dans l'outil."
                  : 'Personne ne correspond à cette recherche.'}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * One line. The extras edit their own name, phone and figures in place, since the row is the
 * only place they exist; everybody else is read from their own file and edited there.
 */
function TicketingLine({
  row,
  report,
  withPhones,
}: {
  row: TicketingRow;
  report: TicketingReport;
  withPhones: boolean;
}) {
  const { plan, edit } = useLoadedPlan();
  const name = `${row.firstName} ${row.lastName}`.trim() || 'cette personne';
  const extra = row.kind === 'extra' ? plan.ticketing.extras.find((x) => x.key === row.key) : undefined;
  // What this row would get with no choice at all, from the same rules the report applies, so
  // a pick equal to the default stores nothing.
  const computedDrinks = row.computedDrinks;
  const computed = {
    ticketTypeKey: defaultTicketType(report.ticketTypes)?.key ?? null,
    braceletKey: defaultBracelet(report.bracelets, row.statuses.map((s) => s.status))?.key ?? null,
    drinkTickets: computedDrinks,
  };
  const byHand = row.ticketByHand || row.braceletByHand || row.drinksByHand || row.note !== '';

  const changeExtra = (over: Partial<Omit<ExtraPerson, 'key'>>, what: string): void =>
    edit((p) => setExtraPerson(p, row.key, over), `${what} de ${name}`);

  return (
    <tr className={row.issues.length > 0 ? 'has-issue' : undefined}>
      <td>
        {extra ? (
          <input
            className="select"
            name={`extra-last-${row.key}`}
            autoComplete="off"
            placeholder="Nom"
            value={extra.lastName}
            aria-label={`Nom, ${name}`}
            onChange={(event) => changeExtra({ lastName: event.target.value }, 'nom')}
          />
        ) : (
          <strong>{row.lastName}</strong>
        )}
      </td>
      <td>
        {extra ? (
          <input
            className="select"
            name={`extra-first-${row.key}`}
            autoComplete="off"
            placeholder="Prénom"
            value={extra.firstName}
            aria-label={`Prénom, ${name}`}
            onChange={(event) => changeExtra({ firstName: event.target.value }, 'prénom')}
          />
        ) : (
          row.firstName
        )}
      </td>
      <td>
        {extra ? (
          <select
            className="select"
            name={`extra-status-${row.key}`}
            value={extra.status}
            aria-label={`Statut de ${name}`}
            onChange={(event) =>
              changeExtra({ status: event.target.value as ExtraPerson['status'] }, 'statut')
            }
          >
            <option value="prestataire">Prestataire</option>
            <option value="autre">Autre invitation</option>
          </select>
        ) : (
          row.statuses.map((tag) => (
            <span key={tag.label} className={`chip is-status is-${tag.status}`}>
              {tag.label}
            </span>
          ))
        )}
      </td>
      <td className={`catering-count${row.drinksByHand ? ' is-by-hand' : ''}`}>
        {extra ? (
          <NumberField
            value={extra.drinkTickets}
            ariaLabel={`Tickets boisson de ${name}`}
            name={`extra-drinks-${row.key}`}
            onCommit={(value) => changeExtra({ drinkTickets: Math.round(value ?? 0) }, 'tickets boisson')}
          />
        ) : (
          /*
           * THE COMPUTED FIGURE IS THE PLACEHOLDER, the régisseur's figure is the value. Typing
           * the computed figure back stores nothing; emptying the field goes back to it. Green
           * says "this one is not the rule's".
           */
          <NumberField
            value={row.drinksByHand ? row.drinks : null}
            placeholder={String(computedDrinks)}
            ariaLabel={`Tickets boisson de ${name}`}
            name={`drinks-${row.kind}-${row.key}`}
            title={
              row.drinksByHand
                ? `Fixé à la main (calculé: ${computedDrinks}). Videz le champ pour revenir au calcul.`
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
                    computed,
                  ),
                `tickets boisson de ${name}`,
              )
            }
          />
        )}
      </td>
      <td className="catering-count">
        {extra ? (
          <NumberField
            value={extra.mealTickets}
            ariaLabel={`Tickets repas de ${name}`}
            name={`extra-meals-${row.key}`}
            onCommit={(value) => changeExtra({ mealTickets: Math.round(value ?? 0) }, 'tickets repas')}
          />
        ) : (
          row.meals
        )}
      </td>
      <td>
        <select
          className={`select${row.ticketByHand ? ' is-manual' : ''}`}
          name={`ticket-${row.kind}-${row.key}`}
          value={row.ticketTypeKey ?? ''}
          disabled={report.ticketTypes.length === 0}
          aria-label={`Ticket de ${name}`}
          title={row.ticketByHand ? 'Choisi à la main; suit Réglages sinon.' : "Le type par défaut de l'événement."}
          onChange={(event) =>
            edit(
              (p) =>
                chooseForPerson(
                  p,
                  row.kind,
                  row.key,
                  { ticketTypeKey: event.target.value || null },
                  computed,
                ),
              `ticket de ${name}`,
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
      </td>
      <td>
        <select
          className={`select${row.braceletByHand ? ' is-manual' : ''}`}
          name={`bracelet-${row.kind}-${row.key}`}
          value={row.braceletKey ?? ''}
          disabled={report.bracelets.length === 0}
          aria-label={`Bracelet de ${name}`}
          title={row.braceletByHand ? 'Choisi à la main; suit Réglages sinon.' : "Le bracelet par défaut de son statut."}
          onChange={(event) =>
            edit(
              (p) =>
                chooseForPerson(
                  p,
                  row.kind,
                  row.key,
                  { braceletKey: event.target.value || null },
                  computed,
                ),
              `bracelet de ${name}`,
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
      </td>
      {withPhones && (
        <td>
          {extra ? (
            <input
              className="select"
              type="tel"
              name={`extra-phone-${row.key}`}
              autoComplete="off"
              placeholder="Téléphone"
              value={extra.phone}
              aria-label={`Téléphone de ${name}`}
              onChange={(event) => changeExtra({ phone: event.target.value }, 'téléphone')}
            />
          ) : (
            row.phone
          )}
        </td>
      )}
      <td>
        <input
          className="select"
          name={`note-${row.kind}-${row.key}`}
          autoComplete="off"
          placeholder="Remarque pour la porte"
          value={row.note}
          aria-label={`Remarque sur ${name}`}
          onChange={(event) =>
            edit(
              (p) => chooseForPerson(p, row.kind, row.key, { note: event.target.value }, computed),
              `remarque sur ${name}`,
            )
          }
        />
        {row.issues.map((issue) => (
          <span key={issue} className="chip is-warn" title={issue}>
            {issue}
          </span>
        ))}
      </td>
      <td>
        <span className="artist-row-actions">
          {byHand && (
            <button
              className="btn is-icon"
              title="Rendre le ticket, le bracelet et les tickets boisson aux réglages, et effacer la remarque"
              onClick={() => edit((p) => clearChoices(p, row.kind, row.key), `choix de ${name} rendus aux réglages`)}
            >
              ↺
            </button>
          )}
          {extra && (
            <button
              className="btn is-icon is-danger"
              title={`Retirer ${name} de la liste`}
              onClick={() => edit((p) => deleteExtraPerson(p, row.key), `${name} retiré de la billetterie`)}
            >
              ✕
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}
