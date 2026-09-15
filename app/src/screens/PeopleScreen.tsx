/**
 * Personnes: everybody the tool knows, one line each, and the fiche of whoever is clicked.
 *
 * WAS « BILLETTERIE » UNTIL 2026-09-15. The door's list was already the only place where every
 * bénévole, orga, artiste, guest and extra person sat on one screen, so the régisseur asked for it
 * to become the central place for a person's information: see and edit all of it, change somebody
 * from bénévole to orga. The door's list is still here, whole, as the « Accueil » columns.
 *
 * THE LIST STAYS LIGHT, THE FICHE CARRIES EVERYTHING. Three sets of columns answer three quick
 * questions (what does the door hand them, how do I reach them, what do they eat); anything else
 * is one click away in the pane on the right (`PersonPanel`), which the arrow keys walk through.
 *
 * Nothing here counts anything itself: the rows are `ticketingReport`, which reads the catering for
 * the tickets so the door's figure is the caterer's figure. What is written here is what the door
 * decides for one person (`DoorFields`), and the extra people the door alone knows.
 */

import { useEffect, useRef, useState } from 'react';

import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  ENERGY_LABEL,
  PERSON_STATUS_LABEL,
  statusOf,
  type ApplicationStatus,
  ticketingCsv,
  ticketingReport,
  type ExtraPerson,
  type PersonStatus,
  type TicketingReport,
  type TicketingRow,
} from '../engine.ts';
import {
  addExtraPerson,
  clearChoices,
  deleteExtraPerson,
  nextExtraKey,
  setExtraPerson,
} from '../store/ticketingEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { downloadText, today } from '../components/download.ts';
import { NumberField } from '../components/NumberField.tsx';
import {
  BraceletSelect,
  DrinksField,
  NoteField,
  TicketSelect,
  hasDoorChoice,
  personLabel,
} from '../components/DoorFields.tsx';
import { PersonPanel } from '../components/PersonPanel.tsx';
import { samePerson, type PersonRef } from '../components/personNav.ts';

const ALL = 'tous';

/** Which columns the list shows. The fiche shows everything whichever is picked. */
export type PeopleView = 'accueil' | 'contact' | 'repas' | 'candidature';

const VIEW_LABEL: Record<PeopleView, string> = {
  accueil: 'Accueil',
  contact: 'Contact',
  repas: 'Repas',
  // 2026-09-15: where each application stands, the steps ticked, the Réserve and the stamina.
  candidature: 'Candidature',
};

/** The application filter: a status, the Réserve, or everybody. Only bénévoles have one. */
type FollowUp = ApplicationStatus | 'reserve' | typeof ALL;

const flatten = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const refOf = (row: TicketingRow): PersonRef => ({ kind: row.kind, key: row.key });

export function PeopleScreen({
  focus,
  onFocus,
  onGoToSetup,
}: {
  /** Whose fiche is open, held by the shell so it survives a trip to another tab. */
  focus: PersonRef | null;
  onFocus(person: PersonRef | null): void;
  onGoToSetup(): void;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PersonStatus | typeof ALL>(ALL);
  const [view, setView] = useState<PeopleView>('accueil');
  const [withPhones, setWithPhones] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp>(ALL);

  const report = ticketingReport(plan, index);
  const needle = flatten(search);
  const matching = report.rows.filter((row) => {
    if (status !== ALL && !row.statuses.some((s) => s.status === status)) return false;
    if (followUp !== ALL) {
      if (row.kind !== 'benevole') return false;
      if (followUp === 'reserve' ? index.volunteerByKey.get(row.key)?.backup !== true : row.applicationStatus !== followUp) return false;
    }
    if (needle === '') return true;
    return flatten(`${row.lastName} ${row.firstName} ${row.firstName} ${row.lastName}`).includes(needle);
  });

  /*
   * THE RESERVE IS A LIST OF ITS OWN, below everybody else, since 2026-09-15. It left the grids'
   * pool pane the same day: a bénévole in reserve does zero hours and is normally not on site, so
   * mixing them into the list of people the door expects read as the opposite. They are still
   * people the tool holds, with a fiche, a phone to call when somebody does not turn up, and the
   * same filters. Whether they are in the door's CSV is `ticketing.reserveOnDoorList`, set in
   * Réglages, and the card's head says which.
   */
  const reserveKeys = new Set(plan.reserve);
  const inReserve = (row: TicketingRow): boolean => row.kind === 'benevole' && reserveKeys.has(row.key);
  const rows = matching.filter((row) => !inReserve(row));
  const reserveRows = matching.filter(inReserve);
  const reserveTotal = report.rows.filter(inReserve).length;
  /** What the arrow keys walk: the main list, then the reserve, as drawn. */
  const walk = [...rows, ...reserveRows];
  const issues = report.rows.filter((r) => r.issues.length > 0).length;
  const statuses = Object.keys(PERSON_STATUS_LABEL) as PersonStatus[];

  /*
   * THE ARROW KEYS WALK THE LIST, Escape closes the fiche, and neither does anything while a field
   * has the focus: the fiche is full of fields, and a régisseur typing a name must never find they
   * have jumped to the next person. Kept in a ref so the listener is attached once.
   */
  const latest = useRef({ rows: walk, focus, onFocus });
  latest.current = { rows: walk, focus, onFocus };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const { rows: shown, focus: open, onFocus: select } = latest.current;
      if (event.key === 'Escape' && open) {
        select(null);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (shown.length === 0) return;
      event.preventDefault();
      const at = shown.findIndex((r) => samePerson(refOf(r), open));
      const next =
        at < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)));
      const row = shown[next]!;
      select(refOf(row));
      document
        .querySelector(`[data-person="${CSS.escape(`${row.kind}|${row.key}`)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const addExtra = (kind: ExtraPerson['status']): void => {
    const key = nextExtraKey(plan);
    edit((p) => addExtraPerson(p, kind), kind === 'prestataire' ? 'prestataire ajouté' : 'invitation ajoutée');
    onFocus({ kind: 'extra', key });
  };

  return (
    <div className={`screen ${focus ? 'has-person' : 'is-wide'}`}>
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {report.rows.length - reserveTotal} personne{report.rows.length - reserveTotal > 1 ? 's' : ''}
          </strong>
          {reserveTotal > 0 && (
            <span className="people-meta" title="Listées à part, sous les autres">
              + {reserveTotal} en liste d'attente
            </span>
          )}
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
              name="people-search"
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
          <label className="checkline">
            Suivi
            <select
              className="select"
              value={followUp}
              aria-label="Filtrer par suivi de candidature"
              onChange={(event) => setFollowUp(event.target.value as FollowUp)}
            >
              <option value={ALL}>Tous</option>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_LABEL[s]} ({report.rows.filter((r) => r.applicationStatus === s).length})
                </option>
              ))}
              <option value="reserve">Réserve ({plan.volunteers.filter((v) => v.backup === true).length})</option>
            </select>
          </label>
          <label className="checkline">
            Colonnes
            <select
              className="select"
              value={view}
              aria-label="Colonnes affichées"
              onChange={(event) => setView(event.target.value as PeopleView)}
            >
              {(Object.keys(VIEW_LABEL) as PeopleView[]).map((v) => (
                <option key={v} value={v}>
                  {VIEW_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-sep" />
          <button className="btn is-small" onClick={() => addExtra('prestataire')}>
            Ajouter un prestataire
          </button>
          <button className="btn is-small" onClick={() => addExtra('autre')}>
            Ajouter une invitation
          </button>
          <span className="toolbar-sep" />
          <label
            className="checkline"
            title="Une donnée personnelle: à ne cocher que si la liste reste entre les mains des responsables"
          >
            <input
              type="checkbox"
              checked={withPhones}
              onChange={(event) => setWithPhones(event.target.checked)}
            />
            Téléphones
          </label>
          <button
            className="btn"
            title="La liste de l'accueil: statuts, tickets, bracelets et remarques"
            onClick={() =>
              downloadText(
                `billetterie-${today()}${withPhones ? '-avec-telephones' : ''}.csv`,
                ticketingCsv(plan, index, withPhones),
              )
            }
          >
            Exporter la liste d'entrée
          </button>
        </div>

        <div className="screen-body">
          {view === 'accueil' && (report.ticketTypes.length === 0 || report.bracelets.length === 0) && (
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
            <PeopleTable
              rows={rows}
              report={report}
              view={view}
              withPhones={withPhones}
              focus={focus}
              onFocus={onFocus}
            />
            {rows.length === 0 && (
              <p className="panel-sub catering-empty">
                {report.rows.length === reserveTotal
                  ? "Personne n'est encore entré dans l'outil."
                  : 'Personne ne correspond à cette recherche.'}
              </p>
            )}
          </section>

          {reserveTotal > 0 && (
            <section className="screen-card people-reserve">
              <div className="setup-group-head">
                <span className="setup-group-title">Liste d'attente ({reserveTotal})</span>
                <span className="people-meta">
                  zéro heure sur l'exploit, volontairement: ces personnes ne sont normalement pas
                  sur place, on les appelle si quelqu'un manque.{' '}
                  {plan.ticketing.reserveOnDoorList
                    ? "Elles sont dans la liste d'entrée exportée."
                    : "Elles ne sont pas dans la liste d'entrée exportée."}
                </span>
                <button className="btn is-small" onClick={onGoToSetup}>
                  Réglages
                </button>
              </div>
              {reserveRows.length > 0 ? (
                <PeopleTable
                  rows={reserveRows}
                  report={report}
                  view={view}
                  withPhones={withPhones}
                  focus={focus}
                  onFocus={onFocus}
                />
              ) : (
                <p className="panel-sub catering-empty">Personne en liste d'attente ne correspond à cette recherche.</p>
              )}
            </section>
          )}
        </div>
      </div>

      {focus && (
        <PersonPanel person={focus} report={report} onClose={() => onFocus(null)} onFocus={onFocus} />
      )}
    </div>
  );
}

/** The list's table, drawn once for everybody and once more for the reserve. */
function PeopleTable({
  rows,
  report,
  view,
  withPhones,
  focus,
  onFocus,
}: {
  rows: readonly TicketingRow[];
  report: TicketingReport;
  view: PeopleView;
  withPhones: boolean;
  focus: PersonRef | null;
  onFocus(person: PersonRef | null): void;
}) {
  return (
    <div className="screen-scroll">
      <table className="setup-table catering-table ticketing-table people-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Prénom</th>
            <th>Statut</th>
            {view === 'accueil' && (
              <>
                <th title="Tickets boisson à remettre">Boissons</th>
                <th title="Tickets repas à remettre">Repas</th>
                <th>Ticket</th>
                <th>Bracelet</th>
                {withPhones && <th>Téléphone</th>}
                <th>Remarques</th>
                <th />
              </>
            )}
            {view === 'contact' && (
              <>
                <th>Téléphone</th>
                <th>E-mail</th>
                <th>En cas d'urgence</th>
              </>
            )}
            {view === 'candidature' && (
              <>
                <th>Candidature</th>
                <th>Équipe</th>
                <th>Étapes</th>
                <th>Inscription</th>
                <th>Énergie</th>
                <th>Note</th>
              </>
            )}
            {view === 'repas' && (
              <>
                <th>Régime</th>
                <th>Allergies</th>
                <th title="Tickets repas à remettre">Repas</th>
                <th title="Tickets boisson à remettre">Boissons</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PersonLine
              key={`${row.kind}|${row.key}`}
              row={row}
              report={report}
              view={view}
              withPhones={withPhones}
              selected={samePerson(refOf(row), focus)}
              onOpen={() => onFocus(refOf(row))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One line. A click anywhere that is not a field opens the fiche; the name is also a button, for
 * the keyboard. The door's fields stay on the line in the « Accueil » columns, because on the
 * night the door works from the list and not from fiches.
 */
function PersonLine({
  row,
  report,
  view,
  withPhones,
  selected,
  onOpen,
}: {
  row: TicketingRow;
  report: TicketingReport;
  view: PeopleView;
  withPhones: boolean;
  selected: boolean;
  onOpen(): void;
}) {
  const { plan, edit } = useLoadedPlan();
  const who = personLabel(row);
  const extra = row.kind === 'extra' ? plan.ticketing.extras.find((x) => x.key === row.key) : undefined;

  const changeExtra = (over: Partial<Omit<ExtraPerson, 'key'>>, what: string): void =>
    edit((p) => setExtraPerson(p, row.key, over), `${what} de ${who}`);

  const classes = [row.issues.length > 0 ? 'has-issue' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');

  return (
    <tr
      className={classes || undefined}
      data-person={`${row.kind}|${row.key}`}
      aria-selected={selected}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('input, select, button, textarea, a')) return;
        onOpen();
      }}
    >
      <td>
        <button className="link-button" onClick={onOpen} title={`Ouvrir la fiche de ${who}`}>
          <strong>{row.lastName || (row.firstName === '' ? 'Sans nom' : '')}</strong>
        </button>
      </td>
      <td>{row.firstName}</td>
      <td>
        {row.statuses.map((tag) => (
          <span key={tag.label} className={`chip is-status is-${tag.status}`}>
            {tag.label}
          </span>
        ))}
      </td>

      {view === 'accueil' && (
        <>
          <td className={`catering-count${row.drinksByHand ? ' is-by-hand' : ''}`}>
            {extra ? (
              <NumberField
                value={extra.drinkTickets}
                ariaLabel={`Tickets boisson de ${who}`}
                name={`row-extra-drinks-${row.key}`}
                onCommit={(value) => changeExtra({ drinkTickets: Math.round(value ?? 0) }, 'tickets boisson')}
              />
            ) : (
              <DrinksField row={row} report={report} who={who} />
            )}
          </td>
          <td className="catering-count">
            {extra ? (
              <NumberField
                value={extra.mealTickets}
                ariaLabel={`Tickets repas de ${who}`}
                name={`row-extra-meals-${row.key}`}
                onCommit={(value) => changeExtra({ mealTickets: Math.round(value ?? 0) }, 'tickets repas')}
              />
            ) : (
              row.meals
            )}
          </td>
          <td>
            <TicketSelect row={row} report={report} who={who} />
          </td>
          <td>
            <BraceletSelect row={row} report={report} who={who} />
          </td>
          {withPhones && <td>{row.phone}</td>}
          <td>
            <NoteField row={row} report={report} who={who} />
            {row.issues.map((issue) => (
              <span key={issue} className="chip is-warn" title={issue}>
                {issue}
              </span>
            ))}
          </td>
          <td>
            <span className="artist-row-actions">
              {hasDoorChoice(row) && (
                <button
                  className="btn is-icon"
                  title="Rendre le ticket, le bracelet et les tickets boisson aux réglages, et effacer la remarque"
                  onClick={() => edit((p) => clearChoices(p, row.kind, row.key), `choix de ${who} rendus aux réglages`)}
                >
                  ↺
                </button>
              )}
              {extra && (
                <button
                  className="btn is-icon is-danger"
                  title={`Retirer ${who} de la liste`}
                  onClick={() => edit((p) => deleteExtraPerson(p, row.key), `${who} retiré·e de la liste`)}
                >
                  ✕
                </button>
              )}
            </span>
          </td>
        </>
      )}

      {view === 'contact' && (
        <>
          <td>{row.phone}</td>
          <td>{row.email}</td>
          <td>
            {row.kind === 'benevole'
              ? plan.volunteers.find((v) => v.key === row.key)?.emergencyContact
              : row.kind === 'orga'
                ? plan.organisers.find((o) => o.key === row.key)?.emergencyContact
                : ''}
          </td>
        </>
      )}

      {view === 'candidature' && <ApplicationCells row={row} />}

      {view === 'repas' && (
        <>
          <td>{row.diet}</td>
          <td>{row.allergies}</td>
          <td className="catering-count">{row.meals}</td>
          <td className="catering-count">{row.drinks}</td>
        </>
      )}
    </tr>
  );
}

/** The « Candidature » columns of one line. Empty cells for anybody who is not a bénévole. */
function ApplicationCells({ row }: { row: TicketingRow }) {
  const { plan, index } = useLoadedPlan();
  const volunteer = row.kind === 'benevole' ? index.volunteerByKey.get(row.key) : undefined;
  if (!volunteer) return <><td /><td /><td /><td /><td /><td /></>;
  const status = statusOf(volunteer);
  const ticked = new Set(volunteer.statusSteps ?? []);
  const waiting = plan.reserve.includes(volunteer.key);
  return (
    <>
      <td>
        <span className={`chip ${status === 'annule' ? 'is-bad' : status === 'valide' ? 'is-ok' : ''}`}>
          {APPLICATION_STATUS_LABEL[status]}
        </span>
        {waiting && <span className="chip">Liste d'attente</span>}
        {volunteer.backup && <span className="chip is-ok">Réserve</span>}
      </td>
      <td>{plan.teams.find((t) => t.key === volunteer.teamKey)?.name ?? ''}</td>
      <td>
        {plan.applicationSteps.length > 0 && (
          <span
            className={`chip ${plan.applicationSteps.every((s) => ticked.has(s.key)) ? 'is-ok' : 'is-muted'}`}
            title={plan.applicationSteps.map((s) => `${ticked.has(s.key) ? '✓' : '·'} ${s.label}`).join('\n')}
          >
            {plan.applicationSteps.filter((s) => ticked.has(s.key)).length}/{plan.applicationSteps.length}
          </span>
        )}
        {plan.applicationSteps
          .filter((step) => ticked.has(step.key))
          .map((step) => (
            <span key={step.key} className="chip is-ok" title={step.label}>
              ✓ {step.label}
            </span>
          ))}
      </td>
      <td>{volunteer.registeredAt}</td>
      <td>{volunteer.energy ? ENERGY_LABEL[volunteer.energy] : ''}</td>
      <td>{volunteer.regieNote}</td>
    </>
  );
}
