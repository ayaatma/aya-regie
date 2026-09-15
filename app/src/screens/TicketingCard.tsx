/**
 * La billetterie, as rules: the kinds of entry, the bracelets, and the invitations per artist.
 *
 * WHAT BELONGS HERE. What the association decided about the door: "un ticket Loto seulement
 * ouvre jusqu'à 20h", "les artistes et leurs invités ont le bracelet backstage", "chaque
 * artiste peut inviter deux personnes". Nobody's name. Who gets which is the Personnes tab,
 * worked out from these every time it is drawn, and changed there one person at a time.
 *
 * A TICKET TYPE IS A WINDOW OF THE EVENT, typed as two clock fields like a créneau, because the
 * régisseur's examples are stretches of time ("une après-midi loto PUIS une soirée concerts",
 * "Pass Vendredi/Samedi"). The one opening the most of the event is everybody's default.
 *
 * A BRACELET NAMES ITS STATUSES, one bracelet per status: ticking "artiste" on backstage unticks
 * it on basique, so the list's order never decides anything. See `setBraceletDefault`.
 */

import { useState } from 'react';

import { PERSON_STATUS_LABEL, fmtHours, type FuelKind, type PersonStatus } from '../engine.ts';
import {
  addBracelet,
  addTicketType,
  braceletHolders,
  deleteBracelet,
  deleteTicketType,
  setBracelet,
  setBraceletDefault,
  setGuestsPerArtist,
  setReserveOnDoorList,
  setTicketType,
  setTravelRate,
  ticketTypeHolders,
} from '../store/ticketingEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { ClockField } from '../components/ClockField.tsx';
import { NumberField } from '../components/NumberField.tsx';
import { slideEnd } from '../components/clock.ts';
import { SetupSection } from './SetupSection.tsx';

const STATUSES = Object.keys(PERSON_STATUS_LABEL) as PersonStatus[];

export function TicketingCard() {
  const { plan, edit } = useLoadedPlan();
  const { ticketing } = plan;
  const [newTicket, setNewTicket] = useState('');
  const [newBracelet, setNewBracelet] = useState('');
  const [armed, setArmed] = useState<{ what: 'ticket' | 'bracelet'; key: string } | null>(null);

  return (
    <SetupSection
      className="setup-ticketing"
      title="Billetterie"
      meta={`${ticketing.ticketTypes.length} type(s) de ticket · ${ticketing.bracelets.length} bracelet(s) · ${ticketing.guestsPerArtist} invitation(s) par artiste`}
    >
      <p className="people-meta setup-orgas-note">
        Ce que la billetterie remet à chaque personne se lit dans l'onglet Personnes: les
        tickets boisson et repas viennent du catering, le type de ticket et le bracelet viennent
        d'ici. Rien n'est refusé: un repas servi hors du ticket est signalé, pas retiré.
      </p>

      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Invitations par artiste</span>
          <span className="rule-input">
            <NumberField
              value={ticketing.guestsPerArtist}
              ariaLabel="Invitations nommées auxquelles chaque membre d'un groupe a droit"
              name="guests-per-artist"
              onCommit={(value) => edit((p) => setGuestsPerArtist(p, value ?? 0), 'invitations par artiste')}
            />
            <span className="rule-suffix">par membre d'un groupe</span>
          </span>
          <span className="rule-hint">
            Chaque invitation est un nom et un prénom, saisis sur la fiche du groupe. Un membre
            qui en nomme davantage est signalé dans l'onglet Personnes, jamais refusé.
          </span>
        </label>
        <label className="rule">
          <span className="rule-label">Réserve</span>
          <span className="rule-input">
            <input
              type="checkbox"
              name="reserve-on-door-list"
              checked={ticketing.reserveOnDoorList}
              onChange={(event) =>
                edit(
                  (p) => setReserveOnDoorList(p, event.target.checked),
                  event.target.checked ? "réserve ajoutée à la liste d'entrée" : "réserve retirée de la liste d'entrée",
                )
              }
            />
            <span>Les bénévoles en réserve sont dans la liste d'entrée</span>
          </span>
          <span className="rule-hint">
            Une personne en réserve ne fait aucune heure et n'est normalement pas sur place:
            décoché, elle n'est pas dans le fichier exporté pour la porte. Cochez si elle peut
            tout de même venir, au montage par exemple. L'onglet Personnes la liste à part dans
            les deux cas.
          </span>
        </label>
      </div>

      <div className="setup-lineup">
        <span className="panel-section-title">Types de ticket ({ticketing.ticketTypes.length})</span>
        <p className="panel-sub">
          Un nom et la plage de l'événement qu'il ouvre. Celui qui couvre le plus de l'événement
          est le ticket de tout le monde, sauf choix contraire dans l'onglet Personnes.
        </p>
        {ticketing.ticketTypes.map((type) => (
          <div key={type.key} className="setup-ticket-row">
            <input
              className="select"
              name={`ticket-label-${type.key}`}
              autoComplete="off"
              value={type.label}
              aria-label="Nom du type de ticket"
              onChange={(event) =>
                edit((p) => setTicketType(p, type.key, { label: event.target.value }), `ticket ${type.label}`)
              }
            />
            <span className="clock-range">
              <ClockField
                value={type.start}
                startISO={plan.startISO}
                maxHours={plan.lengthHours}
                ariaLabel={`Début de validité de ${type.label}`}
                name={`ticket-start-${type.key}`}
                hint="Déplacer le début déplace la fin avec lui"
                onChange={(value) => {
                  if (value === null) return;
                  edit(
                    (p) => setTicketType(p, type.key, { start: value, end: slideEnd(type.start, type.end, value) }),
                    `plage de ${type.label}`,
                  );
                }}
              />
              <span className="clock-range-sep">→</span>
              <ClockField
                value={type.end}
                startISO={plan.startISO}
                maxHours={plan.lengthHours}
                ariaLabel={`Fin de validité de ${type.label}`}
                name={`ticket-end-${type.key}`}
                onChange={(value) => {
                  if (value !== null) edit((p) => setTicketType(p, type.key, { end: value }), `plage de ${type.label}`);
                }}
              />
              <span className="rule-suffix">
                {type.end > type.start ? fmtHours(type.end - type.start) : 'la fin doit être après le début'}
              </span>
            </span>
            {armed?.what === 'ticket' && armed.key === type.key ? (
              <span className="setup-confirm">
                <span className="people-meta">
                  {ticketTypeHolders(plan, type.key) > 0
                    ? `${ticketTypeHolders(plan, type.key)} personne(s) l'avaient à la main et reviennent au défaut.`
                    : 'Retire ce type.'}
                </span>
                <button
                  className="btn is-danger"
                  onClick={() => {
                    edit((p) => deleteTicketType(p, type.key), `retrait du ticket ${type.label}`);
                    setArmed(null);
                  }}
                >
                  Retirer
                </button>
                <button className="btn" onClick={() => setArmed(null)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${type.label}`}
                onClick={() => setArmed({ what: 'ticket', key: type.key })}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Nom d'un type de ticket"
            name="new-ticket-type"
            autoComplete="off"
            value={newTicket}
            onChange={(event) => setNewTicket(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || newTicket.trim() === '') return;
              edit((p) => addTicketType(p, newTicket), `ticket ${newTicket.trim()}`);
              setNewTicket('');
            }}
          />
          <button
            className="btn"
            disabled={newTicket.trim() === ''}
            onClick={() => {
              edit((p) => addTicketType(p, newTicket), `ticket ${newTicket.trim()}`);
              setNewTicket('');
            }}
          >
            Ajouter un type de ticket
          </button>
        </span>
      </div>

      <div className="setup-lineup">
        <span className="panel-section-title">Bracelets ({ticketing.bracelets.length})</span>
        <p className="panel-sub">
          Un nom, et les statuts qui le reçoivent par défaut. Un statut ne va qu'à un bracelet:
          le cocher ici le décoche ailleurs. Une personne à plusieurs statuts reçoit celui de
          l'artiste, puis du responsable, puis de l'orga, puis du bénévole.
        </p>
        {ticketing.bracelets.map((bracelet) => (
          <div key={bracelet.key} className="setup-bracelet-row">
            <input
              className="select"
              name={`bracelet-label-${bracelet.key}`}
              autoComplete="off"
              value={bracelet.label}
              aria-label="Nom du bracelet"
              onChange={(event) =>
                edit((p) => setBracelet(p, bracelet.key, { label: event.target.value }), `bracelet ${bracelet.label}`)
              }
            />
            <span className="setup-bracelet-statuses">
              {STATUSES.map((status) => (
                <label key={status} className="checkline">
                  <input
                    type="checkbox"
                    name={`bracelet-${bracelet.key}-${status}`}
                    checked={bracelet.defaultFor.includes(status)}
                    onChange={(event) =>
                      edit(
                        (p) => setBraceletDefault(p, bracelet.key, status, event.target.checked),
                        `bracelet ${bracelet.label}`,
                      )
                    }
                  />
                  {PERSON_STATUS_LABEL[status]}
                </label>
              ))}
            </span>
            {armed?.what === 'bracelet' && armed.key === bracelet.key ? (
              <span className="setup-confirm">
                <span className="people-meta">
                  {braceletHolders(plan, bracelet.key) > 0
                    ? `${braceletHolders(plan, bracelet.key)} personne(s) l'avaient à la main et reviennent au défaut.`
                    : 'Retire ce bracelet.'}
                </span>
                <button
                  className="btn is-danger"
                  onClick={() => {
                    edit((p) => deleteBracelet(p, bracelet.key), `retrait du bracelet ${bracelet.label}`);
                    setArmed(null);
                  }}
                >
                  Retirer
                </button>
                <button className="btn" onClick={() => setArmed(null)}>
                  Annuler
                </button>
              </span>
            ) : (
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${bracelet.label}`}
                onClick={() => setArmed({ what: 'bracelet', key: bracelet.key })}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <span className="setup-confirm">
          <input
            className="select"
            placeholder="Nom d'un bracelet"
            name="new-bracelet"
            autoComplete="off"
            value={newBracelet}
            onChange={(event) => setNewBracelet(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || newBracelet.trim() === '') return;
              edit((p) => addBracelet(p, newBracelet), `bracelet ${newBracelet.trim()}`);
              setNewBracelet('');
            }}
          />
          <button
            className="btn"
            disabled={newBracelet.trim() === ''}
            onClick={() => {
              edit((p) => addBracelet(p, newBracelet), `bracelet ${newBracelet.trim()}`);
              setNewBracelet('');
            }}
          >
            Ajouter un bracelet
          </button>
        </span>
      </div>
    </SetupSection>
  );
}

const FUEL_LABEL: Record<FuelKind, string> = {
  essence: 'Essence',
  diesel: 'Diesel',
  electrique: 'Électrique',
  gpl: 'GPL',
  autre: 'Autre',
};

/**
 * What a car journey is reimbursed at: a fuel price per litre (kWh) by kind, a toll per km.
 *
 * THE ASSOCIATION'S FIGURES, NOT A LIVE PRICE. « Calculer automatiquement » on a trajet fetches
 * the road distance from the map and multiplies it by these; the pump price on the day of the
 * reimbursement is the treasurer's to state, once, here.
 */
export function TravelCard() {
  const { plan, edit } = useLoadedPlan();
  const { travel } = plan;
  return (
    <SetupSection
      className="setup-travel"
      title="Défraiement des trajets"
      meta={`essence ${travel.fuelPrices.essence} €/L · diesel ${travel.fuelPrices.diesel} €/L · péage ${travel.tollPerKm} €/km`}
    >
      <p className="people-meta setup-orgas-note">
        Les chiffres que « Calculer automatiquement » applique à la distance d'un trajet, sur la
        fiche d'un groupe: consommation × prix du carburant, plus le péage au kilomètre quand le
        trajet en a. La distance vient de la carte; ces prix viennent d'ici.
      </p>
      <div className="rules-grid">
        {(Object.keys(FUEL_LABEL) as FuelKind[]).map((fuel) => (
          <label key={fuel} className="rule">
            <span className="rule-label">{FUEL_LABEL[fuel]}</span>
            <span className="rule-input">
              <NumberField
                value={travel.fuelPrices[fuel]}
                step={0.01}
                ariaLabel={`Prix du carburant ${FUEL_LABEL[fuel]}`}
                name={`fuel-${fuel}`}
                onCommit={(value) => edit((p) => setTravelRate(p, fuel, value ?? 0), `prix ${FUEL_LABEL[fuel]}`)}
              />
              <span className="rule-suffix">€ / {fuel === 'electrique' ? 'kWh' : 'L'}</span>
            </span>
          </label>
        ))}
        <label className="rule">
          <span className="rule-label">Péage</span>
          <span className="rule-input">
            <NumberField
              value={travel.tollPerKm}
              step={0.01}
              ariaLabel="Prix du péage au kilomètre"
              name="toll-per-km"
              onCommit={(value) => edit((p) => setTravelRate(p, 'toll', value ?? 0), 'prix du péage')}
            />
            <span className="rule-suffix">€ / km, sur un trajet avec péage</span>
          </span>
        </label>
      </div>
    </SetupSection>
  );
}
