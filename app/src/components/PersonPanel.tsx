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
  ORGANISER_CODE_LENGTH,
  statusLabel,
  artistGuests,
  convertPerson,
  organiserRoleOf,
  setOrganiserRole,
  type OrganiserRole,
  type PersonKind,
  type ArtistMember,
  type ExtraPerson,
  type TicketingReport,
  type TicketingRow,
} from '../engine.ts';
import { setArtistMember, setGuest } from '../store/artistEdits.ts';
import { clearChoices, deleteExtraPerson, setExtraPerson } from '../store/ticketingEdits.ts';
import { clearOrganiserCode, deleteOrganiser, giveOrganiserCode } from '../store/setupEdits.ts';
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
import { withNickname } from './labels.ts';
import { OrganiserFiche } from './OrganiserFiche.tsx';
import { PersonMark } from './PersonMark.tsx';
import { FicheEditButton } from './FicheEditButton.tsx';
import { RegistrationSection } from './RegistrationSection.tsx';
import { useNavigation, type PersonRef } from './personNav.ts';
import { VolunteerFiche } from './VolunteerFiche.tsx';
import { FOLD_IDS, FicheFold } from './FicheFold.tsx';
import { movePhoto, photosAvailable } from '../photos/photoStore.ts';

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
  // Held here rather than by the fiche, so it survives the arrow keys walking to the next person:
  // "je corrige les quinze qui n'ont pas de téléphone" is one mode, fifteen fiches.
  const [editing, setEditing] = useState(false);

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
          <PersonBody
            key={`${row.kind}|${row.key}`}
            row={row}
            report={report}
            onClose={onClose}
            onFocus={onFocus}
            editing={editing}
            onToggleEditing={() => setEditing(!editing)}
          />
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
  editing,
  onToggleEditing,
}: {
  row: TicketingRow;
  report: TicketingReport;
  onClose(): void;
  onFocus(person: PersonRef): void;
  /** The fiche's mode édition, for a bénévole or a Staff / Responsable. See `FicheEditButton`. */
  editing: boolean;
  onToggleEditing(): void;
}) {
  const { index } = useLoadedPlan();
  const who = personLabel(row);
  const nickname = row.kind === 'benevole' ? index.volunteerByKey.get(row.key)?.nickname : undefined;
  const mark = row.kind === 'orga' || row.kind === 'benevole' || row.kind === 'artiste' ? row.kind : null;

  // A bénévole's and a Staff / Responsable's fiche fold in categories since 2026-10-24: the door
  // goes into « Pratique et formulaire », the status and the code into a last category of their own.
  const folded = row.kind === 'benevole' || row.kind === 'orga';
  // A bénévole's or an orga's door is read out of the mode édition; the others have no such mode.
  const door = <DoorSection row={row} report={report} who={who} editing={editing || !folded} />;
  const statusFold = (row.kind === 'benevole' || row.kind === 'orga') && (
    <FicheFold
      id={FOLD_IDS.statut}
      title={row.kind === 'orga' ? 'Statut et code responsable' : 'Statut'}
      summary={row.statuses.map((s) => s.label).join(' · ')}
    >
      <ActsOf row={row} />
      <StatusSection kind={row.kind} personKey={row.key} who={who} onFocus={onFocus} />
      {row.kind === 'orga' && <AccessSection organiserKey={row.key} who={who} onDeleted={onClose} />}
    </FicheFold>
  );

  return (
    <>
      <div className="fiche-head">
        <div className="fiche-head-name">
          <p className="panel-kind">{row.statuses.map((s) => s.label).join(' · ')}</p>
          <h2 className="panel-title">
            {mark && <PersonMark kind={mark} personKey={row.key} />}
            {withNickname(`${row.firstName} ${row.lastName}`.trim(), nickname) || 'Sans nom'}
          </h2>
        </div>
        {(row.kind === 'benevole' || row.kind === 'orga') && (
          <FicheEditButton editing={editing} onToggle={onToggleEditing} />
        )}
      </div>

      {row.kind === 'benevole' && (
        <VolunteerFiche volunteerKey={row.key} editing={editing} practical={door} trailing={statusFold} />
      )}
      {row.kind === 'orga' && (
        <OrganiserFiche organiserKey={row.key} editing={editing} practical={door} trailing={statusFold} />
      )}
      {row.kind === 'artiste' && <MemberFiche memberKey={row.key} />}
      {row.kind === 'invite' && <GuestFiche guestKey={row.key} />}
      {row.kind === 'extra' && <ExtraFiche extraKey={row.key} onDeleted={onClose} />}

      {!folded && door}
    </>
  );
}

/**
 * An orga's code responsable, and the way to take them off the plan.
 *
 * HERE SINCE 2026-09-16, out of the Orgas card of Réglages, which the régisseur found a duplicate
 * of this tab. Issuing a code is still the only place in the tool that creates one, a button
 * pressed per person, on purpose: the code opens the whole planning, every volunteer's contact
 * details included. Regenerating and removing ask a second click, since both cannot be undone.
 */
function AccessSection({ organiserKey, who, onDeleted }: { organiserKey: string; who: string; onDeleted(): void }) {
  const { plan, index, edit } = useLoadedPlan();
  const [confirming, setConfirming] = useState<'code' | 'delete' | null>(null);
  const person = plan.organisers.find((o) => o.key === organiserKey);
  if (!person) return null;
  const roles = index.polesLedBy(person.key);

  return (
    <div className="panel-section panel-divider">
      <p className="panel-section-title">Code responsable</p>
      <p className="people-meta">
        Ouvre <strong>tout le planning en lecture seule</strong>, coordonnées des bénévoles
        comprises. Personnel: en régénérer un annule immédiatement le précédent.
      </p>
      <p>
        {person.accessCode === '' ? (
          <span className="people-meta">Pas de code.</span>
        ) : (
          <code className="organiser-code">{person.accessCode}</code>
        )}
      </p>
      {confirming === 'code' ? (
        <div className="fiche-actions">
          <span className="people-meta">Le code actuel cessera de fonctionner immédiatement.</span>
          <button
            className="btn is-danger"
            onClick={() => {
              edit((p) => giveOrganiserCode(p, person.key), `nouveau code pour ${who}`);
              setConfirming(null);
            }}
          >
            Régénérer
          </button>
          <button className="btn" onClick={() => setConfirming(null)}>
            Annuler
          </button>
        </div>
      ) : confirming === 'delete' ? (
        <div className="fiche-actions">
          <span className="people-meta">
            {roles.length > 0 ? `Retire cette personne et ses ${roles.length} pôle(s).` : 'Retire cette personne du planning.'}
          </span>
          <button
            className="btn is-danger"
            onClick={() => {
              edit((p) => deleteOrganiser(p, person.key), `retrait de ${who}`);
              setConfirming(null);
              onDeleted();
            }}
          >
            Retirer
          </button>
          <button className="btn" onClick={() => setConfirming(null)}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="fiche-actions">
          {person.accessCode === '' ? (
            <button
              className="btn is-primary"
              title={`Tire un code de ${ORGANISER_CODE_LENGTH} caractères, à lui transmettre`}
              onClick={() => edit((p) => giveOrganiserCode(p, person.key), `code d'accès pour ${who}`)}
            >
              Générer un code
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => setConfirming('code')}>
                Régénérer
              </button>
              <button
                className="btn"
                title="Retire son accès sans la retirer du planning"
                onClick={() => edit((p) => clearOrganiserCode(p, person.key), `accès retiré à ${who}`)}
              >
                Révoquer
              </button>
            </>
          )}
          <button className="btn is-danger" title={`Retirer ${who} du planning`} onClick={() => setConfirming('delete')}>
            Retirer du planning
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Bénévole, Staff or Responsable, as a proposal the régisseur reads before it happens. Since
 * 2026-10-23 the « orga » is a Staff or a Responsable, chosen here.
 *
 * TWO CLICKS, AND THE SECOND ONE IS INFORMED. The first computes the change and shows what
 * follows the person and what does not; nothing has changed yet. The second applies it as one edit,
 * so one Ctrl+Z puts everything back. The lists are `convertPerson`'s and `setOrganiserRole`'s own,
 * so what is shown is what is applied. See `@engine/convert.ts`.
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
  const { plan, edit, id: eventId } = useLoadedPlan();
  const [target, setTarget] = useState<StatusTarget | null>(null);
  const organiser = kind === 'orga' ? plan.organisers.find((o) => o.key === personKey) : undefined;
  const current: StatusTarget = organiser ? organiserRoleOf(organiser) : 'benevole';
  const others = (['benevole', 'staff', 'responsable'] as const).filter((t) => t !== current);

  if (target === null) {
    return (
      <div className="panel-section panel-divider">
        <p className="panel-section-title">Statut</p>
        <p className="people-meta">{STATUS_TEXT[current]}</p>
        <span className="setup-confirm">
          {others.map((t) => (
            <button key={t} className="btn" onClick={() => setTarget(t)}>
              Passer {STATUS_WORD[t]}…
            </button>
          ))}
        </span>
      </div>
    );
  }

  // Staff ↔ Responsable is the same person on the same fiche; anything else changes the kind.
  const sameKind = current !== 'benevole' && target !== 'benevole';
  const roleChange = sameKind ? setOrganiserRole(plan, personKey, target as OrganiserRole) : null;
  const preview = sameKind ? null : convertPerson(plan, kind, personKey, target === 'benevole' ? 'staff' : target);
  const label = STATUS_WORD[target];

  return (
    <div className="panel-section panel-divider convert-box" role="group" aria-label={`Passer ${who} ${label}`}>
      <p className="panel-section-title">Passer {label}</p>
      {preview?.blocked ? (
        <p className="issue">{preview.blocked}</p>
      ) : roleChange ? (
        <>
          <p className="panel-sub">Rien n'est encore modifié. {STATUS_TEXT[target]}</p>
          {roleChange.lost.length > 0 && (
            <>
              <p className="convert-heading is-warn">Change ou se perd</p>
              <ul className="convert-list is-warn">
                {roleChange.lost.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <p className="panel-sub">Rien n'est encore modifié. Voici ce que le changement ferait.</p>
          <p className="convert-heading">Suit la personne</p>
          <ul className="convert-list">
            {preview!.carried.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="convert-heading is-warn">Change ou se perd</p>
          <ul className="convert-list is-warn">
            {preview!.lost.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <div className="fiche-actions">
        {!preview?.blocked && (
          <button
            className="btn is-primary"
            onClick={() => {
              if (roleChange) {
                edit((p) => setOrganiserRole(p, personKey, target as OrganiserRole).plan, `${who} passé·e ${label}`);
              } else {
                edit((p) => convertPerson(p, kind, personKey, target === 'benevole' ? 'staff' : target).plan, `${who} passé·e ${label}`);
                // The photo is a file filed under the key, not part of the plan: it follows by hand.
                if (photosAvailable && eventId !== null) void movePhoto(eventId, personKey, preview!.newKey).catch(() => undefined);
                onFocus({ kind: preview!.toKind, key: preview!.newKey });
              }
              setTarget(null);
            }}
          >
            Confirmer le passage {label}
          </button>
        )}
        <button className="btn" onClick={() => setTarget(null)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

type StatusTarget = 'benevole' | OrganiserRole;

/** « Passer … »: the status as the sentence names it. */
const STATUS_WORD: Record<StatusTarget, string> = {
  benevole: 'bénévole',
  staff: 'Staff',
  responsable: 'Responsable',
};

const STATUS_TEXT: Record<StatusTarget, string> = {
  benevole: "Bénévole: placé·e sous les règles d'heures, par le solveur ou à la main.",
  staff:
    "Staff: aucune règle d'heures et aucun créneau dû sur l'exploit, mais peut en prendre; présent·e sur le montage et le démontage; tickets boisson et repas du Staff.",
  responsable:
    'Responsable: tout ce qu\'a le Staff, plus des pôles tenus avec leurs horaires (Général par défaut) et ses propres bracelets.',
};

/** The door's four fields, the same ones the row carries, with a way back to the defaults. */
function DoorSection({
  row,
  report,
  who,
  editing,
}: {
  row: TicketingRow;
  report: TicketingReport;
  who: string;
  editing: boolean;
}) {
  const { edit } = useLoadedPlan();
  if (!editing) {
    const ticket = report.ticketTypes.find((t) => t.key === row.ticketTypeKey)?.label ?? 'aucun';
    const bracelets = new Map(report.bracelets.map((b) => [b.key, b.label]));
    return (
      <div className="panel-section panel-divider">
        <p className="panel-section-title">À l'entrée</p>
        <dl className="kv is-near">
          <dt>Billet d'entrée</dt>
          <dd>{ticket}</dd>
          <dt>Bracelet</dt>
          <dd>{row.braceletKeys.map((key) => bracelets.get(key) ?? key).join(' + ') || 'aucun'}</dd>
          {row.kind !== 'extra' && (
            <>
              <dt>Tickets boisson</dt>
              <dd>{row.drinks}</dd>
              <dt>Tickets repas</dt>
              <dd>{row.meals}</dd>
            </>
          )}
          {row.note !== '' && (
            <>
              <dt>Remarque</dt>
              <dd>{row.note}</dd>
            </>
          )}
        </dl>
        {row.issues.map((issue) => (
          <p key={issue} className="issue is-tier2">
            {issue}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="panel-section panel-divider">
      <p className="panel-section-title">À l'entrée</p>
      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Billet d'entrée</span>
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
          <span className="rule-label">Remarque pour l'entrée</span>
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
          title="Rendre le billet d'entrée, le bracelet et les tickets boisson aux réglages, et effacer la remarque"
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
    <>
      <RegistrationSection kind="artiste" personKey={member.key} />
      <div className="panel-section">
        <p className="panel-sub">Membre de {artist.name}.</p>
        <div className="rules-grid">
          <TextRule label="Prénom" name={`fiche-member-first-${member.key}`} value={member.firstName} who={who} onChange={(v) => change({ firstName: v }, 'prénom')} />
          <TextRule label="Nom" name={`fiche-member-last-${member.key}`} value={member.lastName} who={who} onChange={(v) => change({ lastName: v }, 'nom')} />
          <TextRule label="Adresse e-mail" name={`fiche-member-email-${member.key}`} value={member.email} who={who} type="email" onChange={(v) => change({ email: v }, 'adresse e-mail')} />
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
    </>
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
    <>
      <RegistrationSection kind="extra" personKey={extra.key} />
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
              onChange={(event) => change({ status: event.target.value }, 'statut')}
            >
              {plan.ticketing.guestTypes.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
              {!plan.ticketing.guestTypes.some((type) => type.key === extra.status) && (
                <option value={extra.status}>{statusLabel(extra.status, plan.ticketing.guestTypes)}</option>
              )}
            </select>
          </label>
          <TextRule label="Téléphone" name={`extra-phone-${extra.key}`} value={extra.phone} who={who} type="tel" onChange={(v) => change({ phone: v }, 'téléphone')} />
          <TextRule label="Adresse e-mail" name={`extra-email-${extra.key}`} value={extra.email ?? ''} who={who} type="email" onChange={(v) => change({ email: v }, 'adresse e-mail')} />
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
    </>
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
