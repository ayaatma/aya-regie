/**
 * La fiche d'une personne, beside the list of the Personnes tab: everything the tool holds about
 * one person, and every bit of it editable.
 *
 * WHY A PANE AND NOT A POPUP, decided 2026-09-15. The régisseur goes through fiches one after the
 * other ("je corrige les quinze qui n'ont pas de téléphone"): a modal hides the list it was opened
 * from, and each fiche would cost an open, a close and finding the place again. The pane keeps the
 * list in view, follows the arrow keys, and shows the row changing as the fiche is typed into.
 *
 * ONE FICHE PER KIND OF PERSON, AND NONE WRITTEN TWICE. A bénévole's fiche is `VolunteerFiche`, an
 * orga's is `OrganiserFiche`: the same components the grids' info pane draws, so a field added to
 * either shows up in both places. What is here is the door's four fields (`DoorFields`), and the
 * small fiches of the three kinds that had no fiche of their own: a member of an act, a guest, an
 * extra person.
 */

import { useState } from 'react';

import {
  PERSON_STATUS_LABEL,
  artistGuests,
  convertPerson,
  type PersonKind,
  type ArtistMember,
  type ExtraPerson,
  type TicketingReport,
  type TicketingRow,
} from '../engine.ts';
import { setArtistMember, setGuest } from '../store/artistEdits.ts';
import { clearChoices, deleteExtraPerson, setExtraPerson } from '../store/ticketingEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import {
  BraceletSelect,
  DrinksField,
  NoteField,
  TicketSelect,
  hasDoorChoice,
  personLabel,
} from './DoorFields.tsx';
import { NumberField } from './NumberField.tsx';
import { OrganiserFiche } from './OrganiserFiche.tsx';
import { PersonMark } from './PersonMark.tsx';
import { useNavigation, type PersonRef } from './personNav.ts';
import { VolunteerFiche } from './VolunteerFiche.tsx';

export function PersonPanel({
  person,
  report,
  onClose,
  onFocus,
}: {
  person: PersonRef;
  report: TicketingReport;
  onClose(): void;
  /** Follows the person to their new key after a change of status. */
  onFocus(person: PersonRef): void;
}) {
  const row = report.rows.find((r) => r.kind === person.kind && r.key === person.key);

  return (
    <aside className="panel is-person" aria-label="Fiche de la personne">
      <div className="panel-tabs is-single">
        <span className="panel-tab is-title" aria-current>
          Fiche
        </span>
        <button className="panel-tab is-close" title="Fermer la fiche (Échap)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="panel-body">
        {row ? (
          <PersonBody key={`${row.kind}|${row.key}`} row={row} report={report} onClose={onClose} onFocus={onFocus} />
        ) : (
          <p className="pool-empty">Cette personne n'est plus dans le plan.</p>
        )}
      </div>
    </aside>
  );
}

function PersonBody({
  row,
  report,
  onClose,
  onFocus,
}: {
  row: TicketingRow;
  report: TicketingReport;
  onClose(): void;
  onFocus(person: PersonRef): void;
}) {
  const who = personLabel(row);
  const mark = row.kind === 'orga' || row.kind === 'benevole' || row.kind === 'artiste' ? row.kind : null;

  return (
    <>
      <p className="panel-kind">{row.statuses.map((s) => s.label).join(' · ')}</p>
      <h2 className="panel-title">
        {mark && <PersonMark kind={mark} />}
        {`${row.firstName} ${row.lastName}`.trim() || 'Sans nom'}
      </h2>

      {row.kind === 'benevole' && <VolunteerFiche volunteerKey={row.key} />}
      {row.kind === 'orga' && <OrganiserFiche organiserKey={row.key} />}
      {row.kind === 'artiste' && <MemberFiche memberKey={row.key} />}
      {row.kind === 'invite' && <GuestFiche guestKey={row.key} />}
      {row.kind === 'extra' && <ExtraFiche extraKey={row.key} onDeleted={onClose} />}

      {(row.kind === 'benevole' || row.kind === 'orga') && <ActsOf row={row} />}

      <DoorSection row={row} report={report} who={who} />

      {(row.kind === 'benevole' || row.kind === 'orga') && (
        <StatusSection kind={row.kind} personKey={row.key} who={who} onFocus={onFocus} />
      )}
    </>
  );
}

/**
 * Bénévole ↔ orga, as a proposal the régisseur reads before it happens.
 *
 * TWO CLICKS, AND THE SECOND ONE IS INFORMED. The first computes the conversion and shows what
 * follows the person and what does not; nothing has changed yet. The second applies it as one edit,
 * so one Ctrl+Z puts everything back. The lists are `convertPerson`'s own, so what is shown is what
 * is applied. See `@engine/convert.ts`.
 */
function StatusSection({
  kind,
  personKey,
  who,
  onFocus,
}: {
  kind: PersonKind;
  personKey: string;
  who: string;
  onFocus(person: PersonRef): void;
}) {
  const { plan, edit } = useLoadedPlan();
  const [open, setOpen] = useState(false);
  const target = kind === 'benevole' ? 'orga' : 'bénévole';

  if (!open) {
    return (
      <div className="panel-section panel-divider">
        <p className="panel-section-title">Statut</p>
        <p className="people-meta">
          {kind === 'benevole'
            ? "Bénévole: placé·e sous les règles d'heures, par le solveur ou à la main."
            : "Orga: aucune règle d'heures, jamais placé·e par le solveur."}
        </p>
        <button className="btn" onClick={() => setOpen(true)}>
          Passer en {target}…
        </button>
      </div>
    );
  }

  const preview = convertPerson(plan, kind, personKey);

  return (
    <div className="panel-section panel-divider convert-box" role="group" aria-label={`Passer ${who} en ${target}`}>
      <p className="panel-section-title">Passer en {target}</p>
      {preview.blocked !== null ? (
        <p className="issue">{preview.blocked}</p>
      ) : (
        <>
          <p className="panel-sub">Rien n'est encore modifié. Voici ce que le changement ferait.</p>
          <p className="convert-heading">Suit la personne</p>
          <ul className="convert-list">
            {preview.carried.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="convert-heading is-warn">Change ou se perd</p>
          <ul className="convert-list is-warn">
            {preview.lost.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <div className="fiche-actions">
        {preview.blocked === null && (
          <button
            className="btn is-primary"
            onClick={() => {
              edit((p) => convertPerson(p, kind, personKey).plan, `${who} passé·e en ${target}`);
              setOpen(false);
              onFocus({ kind: preview.toKind, key: preview.newKey });
            }}
          >
            Confirmer le passage en {target}
          </button>
        )}
        <button className="btn" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** The door's four fields, the same ones the row carries, with a way back to the defaults. */
function DoorSection({ row, report, who }: { row: TicketingRow; report: TicketingReport; who: string }) {
  const { edit } = useLoadedPlan();
  return (
    <div className="panel-section panel-divider">
      <p className="panel-section-title">À l'entrée</p>
      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Ticket</span>
          <TicketSelect row={row} report={report} who={who} prefix="fiche-" />
        </label>
        <label className="rule">
          <span className="rule-label">Bracelet</span>
          <BraceletSelect row={row} report={report} who={who} prefix="fiche-" />
        </label>
        {row.kind !== 'extra' && (
          <label className="rule">
            <span className="rule-label">Tickets boisson</span>
            <DrinksField row={row} report={report} who={who} prefix="fiche-" />
          </label>
        )}
        {row.kind !== 'extra' && (
          <p className="people-meta">
            Tickets repas: {row.meals}, comptés par le catering.
          </p>
        )}
        <label className="rule">
          <span className="rule-label">Remarque pour la porte</span>
          <NoteField row={row} report={report} who={who} prefix="fiche-" />
        </label>
      </div>
      {row.issues.map((issue) => (
        <p key={issue} className="issue is-tier2">
          {issue}
        </p>
      ))}
      {hasDoorChoice(row) && (
        <button
          className="btn is-small"
          title="Rendre le ticket, le bracelet et les tickets boisson aux réglages, et effacer la remarque"
          onClick={() => edit((p) => clearChoices(p, row.kind, row.key), `choix de ${who} rendus aux réglages`)}
        >
          Revenir aux réglages
        </button>
      )}
    </div>
  );
}

/** A bénévole or an orga who also plays: the acts, and the way to their fiche. */
function ActsOf({ row }: { row: TicketingRow }) {
  const nav = useNavigation();
  const acts = row.statuses.filter((s) => s.status === 'artiste');
  if (acts.length === 0) return null;
  return (
    <div className="panel-section">
      <p className="panel-section-title">Joue aussi</p>
      <p>
        {acts.map((tag) => (
          <span key={tag.label} className="chip is-status is-artiste">
            {tag.label}
          </span>
        ))}
      </p>
      {nav && (
        <button className="btn is-small" onClick={nav.openArtists}>
          Ouvrir l'onglet Artistes
        </button>
      )}
    </div>
  );
}

const PAYMENT_LABEL: Record<ArtistMember['payment'], string> = {
  cash: 'Cash',
  facture: 'Facture globale',
  declare: 'Déclaré',
};

/**
 * A member of an act. The act's own file (défraiement, rider, balances, meals by service) stays on
 * the Artistes tab, which this links to; what is here is the person.
 */
function MemberFiche({ memberKey }: { memberKey: string }) {
  const { plan, edit } = useLoadedPlan();
  const nav = useNavigation();
  const artist = plan.artists.find((a) => a.members.some((m) => m.key === memberKey));
  const member = artist?.members.find((m) => m.key === memberKey);
  if (!artist || !member) return <p className="pool-empty">Ce membre n'est plus dans le groupe.</p>;

  const who = `${member.firstName} ${member.lastName}`.trim() || 'ce membre';
  const change = (over: Partial<Omit<ArtistMember, 'key'>>, what: string): void =>
    edit((p) => setArtistMember(p, artist.key, member.key, over), `${what} de ${who}`);

  return (
    <div className="panel-section">
      <p className="panel-sub">Membre de {artist.name}.</p>
      <div className="rules-grid">
        <TextRule label="Prénom" name={`fiche-member-first-${member.key}`} value={member.firstName} who={who} onChange={(v) => change({ firstName: v }, 'prénom')} />
        <TextRule label="Nom" name={`fiche-member-last-${member.key}`} value={member.lastName} who={who} onChange={(v) => change({ lastName: v }, 'nom')} />
        <label className="rule">
          <span className="rule-label">Rôle</span>
          <select
            className="select"
            name={`fiche-member-role-${member.key}`}
            value={member.role}
            aria-label={`Rôle de ${who}`}
            onChange={(event) => change({ role: event.target.value as ArtistMember['role'] }, 'rôle')}
          >
            <option value="musicien">Musicien·ne</option>
            <option value="technicien">Technicien·ne</option>
          </select>
        </label>
        <TextRule label="Régime alimentaire" name={`fiche-member-diet-${member.key}`} value={member.diet} who={who} onChange={(v) => change({ diet: v }, 'régime')} />
        <TextRule label="Allergies" name={`fiche-member-allergies-${member.key}`} value={member.allergies} who={who} onChange={(v) => change({ allergies: v }, 'allergies')} />
        <label className="rule">
          <span className="rule-label">Paiement</span>
          <select
            className="select"
            name={`fiche-member-payment-${member.key}`}
            value={member.payment}
            aria-label={`Paiement de ${who}`}
            onChange={(event) => change({ payment: event.target.value as ArtistMember['payment'] }, 'paiement')}
          >
            {(Object.keys(PAYMENT_LABEL) as ArtistMember['payment'][]).map((mode) => (
              <option key={mode} value={mode}>
                {PAYMENT_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="people-meta">
        {member.guests.length === 0
          ? 'Aucun invité.'
          : `Invités: ${member.guests.map((g) => `${g.firstName} ${g.lastName}`.trim() || 'sans nom').join(', ')}.`}{' '}
        Les invités, les repas par service et le défraiement se règlent sur la fiche du groupe.
      </p>
      {nav && (
        <button className="btn is-small" onClick={nav.openArtists}>
          Ouvrir l'onglet Artistes
        </button>
      )}
    </div>
  );
}

function GuestFiche({ guestKey }: { guestKey: string }) {
  const { plan, edit } = useLoadedPlan();
  const nav = useNavigation();
  const found = plan.artists
    .flatMap((artist) => artistGuests(artist).map((entry) => ({ artist, ...entry })))
    .find((entry) => entry.guest.key === guestKey);
  if (!found) return <p className="pool-empty">Cette invitation n'existe plus.</p>;

  const { artist, guest, member } = found;
  const who = `${guest.firstName} ${guest.lastName}`.trim() || 'cet invité';
  const host = member ? `${member.firstName} ${member.lastName}`.trim() : '';

  return (
    <div className="panel-section">
      <p className="panel-sub">
        Invité de {artist.name}
        {host !== '' ? `, sur la liste de ${host}` : ', invitation du groupe'}.
      </p>
      <div className="rules-grid">
        <TextRule label="Prénom" name={`fiche-guest-first-${guest.key}`} value={guest.firstName} who={who} onChange={(v) => edit((p) => setGuest(p, artist.key, guest.key, { firstName: v }), `prénom de ${who}`)} />
        <TextRule label="Nom" name={`fiche-guest-last-${guest.key}`} value={guest.lastName} who={who} onChange={(v) => edit((p) => setGuest(p, artist.key, guest.key, { lastName: v }), `nom de ${who}`)} />
      </div>
      {nav && (
        <button className="btn is-small" onClick={nav.openArtists}>
          Ouvrir l'onglet Artistes
        </button>
      )}
    </div>
  );
}

/** Somebody the door alone knows: a prestataire or another invitation, typed here in full. */
function ExtraFiche({ extraKey, onDeleted }: { extraKey: string; onDeleted(): void }) {
  const { plan, edit } = useLoadedPlan();
  const extra = plan.ticketing.extras.find((x) => x.key === extraKey);
  if (!extra) return <p className="pool-empty">Cette personne n'est plus sur la liste.</p>;

  const who = `${extra.firstName} ${extra.lastName}`.trim() || 'cette personne';
  const change = (over: Partial<Omit<ExtraPerson, 'key'>>, what: string): void =>
    edit((p) => setExtraPerson(p, extra.key, over), `${what} de ${who}`);

  return (
    <div className="panel-section">
      <div className="rules-grid">
        <TextRule label="Prénom" name={`extra-first-${extra.key}`} value={extra.firstName} who={who} onChange={(v) => change({ firstName: v }, 'prénom')} />
        <TextRule label="Nom" name={`extra-last-${extra.key}`} value={extra.lastName} who={who} onChange={(v) => change({ lastName: v }, 'nom')} />
        <label className="rule">
          <span className="rule-label">Statut</span>
          <select
            className="select"
            name={`extra-status-${extra.key}`}
            value={extra.status}
            aria-label={`Statut de ${who}`}
            onChange={(event) => change({ status: event.target.value as ExtraPerson['status'] }, 'statut')}
          >
            <option value="prestataire">{PERSON_STATUS_LABEL.prestataire}</option>
            <option value="autre">{PERSON_STATUS_LABEL.autre}</option>
          </select>
        </label>
        <TextRule label="Téléphone" name={`extra-phone-${extra.key}`} value={extra.phone} who={who} type="tel" onChange={(v) => change({ phone: v }, 'téléphone')} />
        <label className="rule">
          <span className="rule-label">Tickets boisson</span>
          <NumberField
            value={extra.drinkTickets}
            ariaLabel={`Tickets boisson de ${who}`}
            name={`extra-drinks-${extra.key}`}
            onCommit={(value) => change({ drinkTickets: Math.round(value ?? 0) }, 'tickets boisson')}
          />
        </label>
        <label className="rule">
          <span className="rule-label">Tickets repas</span>
          <NumberField
            value={extra.mealTickets}
            ariaLabel={`Tickets repas de ${who}`}
            name={`extra-meals-${extra.key}`}
            onCommit={(value) => change({ mealTickets: Math.round(value ?? 0) }, 'tickets repas')}
          />
        </label>
      </div>
      <button
        className="btn is-danger is-small"
        onClick={() => {
          edit((p) => deleteExtraPerson(p, extra.key), `${who} retiré·e de la liste`);
          onDeleted();
        }}
      >
        Retirer de la liste
      </button>
    </div>
  );
}

function TextRule({
  label,
  name,
  value,
  who,
  type = 'text',
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  who: string;
  type?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="rule">
      <span className="rule-label">{label}</span>
      <input
        className="select"
        type={type}
        name={name}
        autoComplete="off"
        value={value}
        aria-label={`${label} de ${who}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
