/**
 * Les artistes: one fiche per act, folded to a line and opened to everything.
 *
 * WHY A TAB AND NOT A CARD. The line-up was a list of names and hours in Réglages, which was
 * right while that was all the tool knew about an act. A fiche with a set, balances, a
 * changement de plateau, a défraiement, a technical rider, five people and their plates is a
 * file, and a file is read on its own screen: the régisseur asked for "un nouvel onglet
 * Artistes", each act folded to its essentials and opened on demand, with everything editable
 * in place the way an orga's fiche is.
 *
 * WHAT IS SHOWN FOLDED is what the régisseur scans the list for: when the act plays, how many
 * they are and how many are named, whether there are balances and when, what is still to book,
 * and what the guest list owes them. Nothing that needs a second look.
 *
 * EVERY HOUR HERE IS AN HOUR OF THE EVENT, including the balances, which are the one thing in
 * the tool allowed before hour zero: a soundcheck the afternoon before is typed as a date and a
 * clock and stored as a negative offset. The montage grid draws it in its own hours, translated
 * by the engine (`artistMomentsIn`), and this screen never knows the montage exists.
 *
 * THE PLATES ARE THE CATERING'S. A member's meal boxes are the same boxes as on the Catering
 * screen, computed by `cateringReport` from the act's hours on the venue and stored only where
 * the régisseur disagrees. Ticking one here or there is the same edit.
 */

import { useState } from 'react';

import { estimateTrip, priceTrip } from '../components/travel.ts';

import {
  artistInvitations,
  artistMemberName,
  memberIsLinked,
  artistTravelLine,
  cateringReport,
  defaultMealChoices,
  fmtHours,
  toClock,
  toLabel,
  type Artist,
  type ArtistMember,
  type CarTrip,
  type CateringReport,
  type FuelKind,
  type Guest,
  type MealPersonKind,
  type PersonKind,
} from '../engine.ts';
import { organiserName } from '../components/labels.ts';
import { addArtist, setArtist } from '../store/setupEdits.ts';
import {
  addArtistMember,
  addCarTrip,
  deleteArtistMember,
  addGuest,
  deleteCarTrip,
  deleteGuest,
  linkArtistMember,
  removeArtist,
  setGuest,
  setArtistMember,
  setCarTrip,
} from '../store/artistEdits.ts';
import { clearMeals, setMeal } from '../store/cateringEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { ClockField, TimeOfDayField } from '../components/ClockField.tsx';
import { NumberField } from '../components/NumberField.tsx';
import { clockOf, hoursAtLocal, localDateOf, slideEnd } from '../components/clock.ts';

const FUEL_LABEL: Record<FuelKind, string> = {
  essence: 'Essence',
  diesel: 'Diesel',
  electrique: 'Électrique',
  gpl: 'GPL',
  autre: 'Autre',
};

const PAYMENT_LABEL: Record<ArtistMember['payment'], string> = {
  cash: 'Cash',
  facture: 'Facture globale',
  declare: 'Déclaré',
};

/** Minutes, for the two changeover fields: nobody says "0,25 h de changement de plateau". */
const toMinutes = (hours: number): number => Math.round(hours * 60);
const fromMinutes = (minutes: number): number => Math.max(0, minutes) / 60;

export function ArtistsScreen() {
  const { plan, index, edit } = useLoadedPlan();
  const [newName, setNewName] = useState('');
  /** Which fiches are open. Several at once: comparing two riders is a real thing to do. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const artists = [...plan.artists].sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  const catering = plan.catering.rules.enabled ? cateringReport(plan, index) : null;
  const people = artists.reduce((total, a) => total + a.size, 0);
  const named = artists.reduce((total, a) => total + a.members.length, 0);

  const add = (): void => {
    const name = newName.trim();
    if (name === '') return;
    edit((p) => addArtist(p, name), `artiste ${name}`);
    setNewName('');
  };

  // From the previous state, not the closure's: two toggles in one tick must both count.
  const toggle = (key: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {artists.length} artiste{artists.length > 1 ? 's' : ''} · {people} personne
            {people > 1 ? 's' : ''}
            {named > 0 && `, ${named} nommée${named > 1 ? 's' : ''}`}
          </strong>
          <span className="toolbar-sep" />
          <span className="toolbar-note">
            Une fiche par groupe, repliée sur l'essentiel. Les passages, balances et changements
            de plateau se retrouvent sur la grille Exploit et sur le montage.
          </span>
          <span className="toolbar-sep" />
          <label className="toolbar-field">
            <input
              className="select"
              placeholder="Nom d'un groupe"
              name="new-artist"
              autoComplete="off"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
            />
          </label>
          <button className="btn is-primary" disabled={newName.trim() === ''} onClick={add}>
            Ajouter un artiste
          </button>
        </div>

        <div className="screen-body">
          {artists.length === 0 ? (
            <div className="card">
              <h1>Aucun artiste</h1>
              <p>
                Ajoutez un groupe par son nom ci-dessus: il prend le créneau qui suit le dernier
                set, et sa fiche s'ouvre pour le reste. Les bénévoles qui ont nommé un artiste
                dans le formulaire le retrouvent ici s'il porte le même nom.
              </p>
            </div>
          ) : (
            artists.map((artist) => (
              <ArtistCard
                key={artist.key}
                artist={artist}
                open={open.has(artist.key)}
                onToggle={() => toggle(artist.key)}
                catering={catering}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** "sam. 13/03 22h à 23h30 (1h30)", the set in one breath. */
function windowLine(startISO: string, start: number, end: number): string {
  const length = end - start;
  return `${toLabel(startISO, start)} à ${toClock(startISO, end)}` +
    (length > 0 ? ` (${fmtHours(length)})` : ', la fin doit être après le début');
}

export function ArtistCard({
  artist,
  open,
  onToggle,
  catering,
}: {
  artist: Artist;
  open: boolean;
  onToggle(): void;
  catering: CateringReport | null;
}) {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const who = artist.name || 'ce groupe';
  const named = plan.volunteers.filter((v) => v.artistKeys.includes(artist.key)).length;
  const travel = artistTravelLine(artist);
  const invitations = artistInvitations(artist);

  const set = <K extends keyof Artist>(field: K, value: Artist[K], what: string): void =>
    edit((p) => setArtist(p, artist.key, { [field]: value }), `${what} de ${who}`);

  return (
    <section className={`screen-card artist-card${open ? ' is-open' : ''}`}>
      <div className="artist-head">
        <button
          className="artist-toggle"
          aria-expanded={open}
          onClick={onToggle}
          title={open ? 'Replier la fiche' : 'Déplier la fiche'}
        >
          <span className="setup-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <strong className="artist-name">{artist.name || 'Sans nom'}</strong>
        </button>

        <div className="artist-summary">
          <span>{windowLine(plan.startISO, artist.start, artist.end)}</span>
          <span className="people-meta">
            {artist.size} personne{artist.size > 1 ? 's' : ''}
            {artist.members.length > 0 && `, ${artist.members.length} nommée${artist.members.length > 1 ? 's' : ''}`}
            {(artist.changeoverBefore > 0 || artist.changeoverAfter > 0) &&
              ` · plateau ${toMinutes(artist.changeoverBefore)} min avant, ${toMinutes(artist.changeoverAfter)} min après`}
          </span>
          <span className="people-meta">
            {artist.soundcheckNeeded
              ? `balances ${windowLine(plan.startISO, artist.soundcheckStart, artist.soundcheckEnd)}` +
                (artist.soundcheckEngineer ? ', avec ingé son' : '')
              : 'pas de balances'}
            {artist.patchSize > 0 && ` · patch ${artist.patchSize}`}
          </span>
          {(travel !== '' || invitations > 0 || named > 0) && (
            <span className="people-meta">
              {[
                travel,
                invitations > 0 ? `${invitations} invitation${invitations > 1 ? 's' : ''}` : '',
                named > 0 ? `${named} bénévole${named > 1 ? 's' : ''} ne veulent pas manquer ce set` : '',
              ]
                .filter((part) => part !== '')
                .join(' · ')}
            </span>
          )}
        </div>

        <div className="artist-actions">
          {armed ? (
            <span className="setup-confirm">
              <span className="people-meta">
                {named > 0
                  ? `Retire ${who}. Les ${named} bénévoles qui l'ont nommé gardent leur réponse.`
                  : `Retire ${who} et ses ${artist.members.length} membre(s).`}
              </span>
              <button
                className="btn is-danger"
                onClick={() => edit((p) => removeArtist(p, artist.key), `retrait de ${who}`)}
              >
                Retirer
              </button>
              <button className="btn" onClick={() => setArmed(false)}>
                Annuler
              </button>
            </span>
          ) : (
            <>
              <button className="btn" aria-expanded={open} onClick={onToggle}>
                {open ? 'Fermer' : 'Modifier'}
              </button>
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${who}`}
                onClick={() => setArmed(true)}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="artist-body">
          <SetSection artist={artist} set={set} />
          <SoundcheckSection artist={artist} set={set} />
          <TechSection artist={artist} set={set} />
          <TravelSection artist={artist} set={set} />
          <MembersSection artist={artist} catering={catering} />
        </div>
      )}
    </section>
  );
}

type Setter = <K extends keyof Artist>(field: K, value: Artist[K], what: string) => void;

function SetSection({ artist, set }: { artist: Artist; set: Setter }) {
  const { plan, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';
  return (
    <div className="artist-section">
      <span className="panel-section-title">Le groupe et son passage</span>
      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Nom du groupe</span>
          <input
            className="select"
            name={`artist-name-${artist.key}`}
            autoComplete="off"
            value={artist.name}
            aria-label="Nom du groupe"
            onChange={(event) => set('name', event.target.value, 'nom')}
          />
        </label>

        <label className="rule">
          <span className="rule-label">Téléphone référent</span>
          <input
            className="select"
            type="tel"
            name={`artist-phone-${artist.key}`}
            autoComplete="off"
            placeholder="Le numéro à appeler pour ce groupe"
            value={artist.contactPhone}
            aria-label={`Téléphone du référent de ${artist.name}`}
            onChange={(event) => set('contactPhone', event.target.value, 'téléphone référent')}
          />
        </label>

        <label className="rule">
          <span className="rule-label">Nombre de personnes</span>
          <span className="rule-input">
            <NumberField
              value={artist.size}
              ariaLabel={`Nombre de personnes dans ${artist.name}`}
              name={`artist-size-${artist.key}`}
              onCommit={(value) => set('size', Math.round(value ?? 0), 'effectif')}
            />
            <span className="rule-suffix">
              {artist.members.length} nommée{artist.members.length > 1 ? 's' : ''} ci-dessous
            </span>
          </span>
        </label>

        <div className="rule">
          <span className="rule-label">Passage</span>
          <span className="rule-input">
            <ClockField
              value={artist.start}
              startISO={plan.startISO}
              maxHours={plan.lengthHours}
              ariaLabel={`Début du set de ${artist.name}`}
              name={`artist-start-${artist.key}`}
              hint="Déplacer le début déplace la fin avec lui"
              onChange={(value) => {
                if (value === null) return;
                // One edit and one undo step: the start and the end move together.
                edit(
                  (p) =>
                    setArtist(p, artist.key, {
                      start: value,
                      end: slideEnd(artist.start, artist.end, value),
                    }),
                  `horaires de ${who}`,
                );
              }}
            />
            <span className="clock-range-sep">→</span>
            <ClockField
              value={artist.end}
              startISO={plan.startISO}
              maxHours={plan.lengthHours}
              ariaLabel={`Fin du set de ${artist.name}`}
              name={`artist-end-${artist.key}`}
              onChange={(value) => {
                if (value !== null) set('end', value, 'horaires');
              }}
            />
            <span className="rule-suffix">
              {artist.end > artist.start
                ? fmtHours(artist.end - artist.start)
                : 'la fin doit être après le début'}
            </span>
          </span>
        </div>

        <label className="rule">
          <span className="rule-label">Changement de plateau avant</span>
          <span className="rule-input">
            <NumberField
              value={toMinutes(artist.changeoverBefore)}
              step={5}
              ariaLabel={`Changement de plateau avant le set de ${artist.name}, en minutes`}
              name={`artist-before-${artist.key}`}
              onCommit={(value) => set('changeoverBefore', fromMinutes(value ?? 0), 'plateau')}
            />
            <span className="rule-suffix">min · 0 pour aucun</span>
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Changement de plateau après</span>
          <span className="rule-input">
            <NumberField
              value={toMinutes(artist.changeoverAfter)}
              step={5}
              ariaLabel={`Changement de plateau après le set de ${artist.name}, en minutes`}
              name={`artist-after-${artist.key}`}
              onCommit={(value) => set('changeoverAfter', fromMinutes(value ?? 0), 'plateau')}
            />
            <span className="rule-suffix">min · 0 pour aucun</span>
          </span>
        </label>
      </div>
    </div>
  );
}

/**
 * The balances: a date, a start, an end.
 *
 * A DATE FIELD, alone in the tool, because this is the one window allowed before the event
 * starts. The end is typed as a clock on the same day, and read as the next day when it comes
 * before the start: "23h à 1h" is a real answer.
 */
function SoundcheckSection({ artist, set }: { artist: Artist; set: Setter }) {
  const { plan, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';
  const date = localDateOf(plan.startISO, artist.soundcheckStart);
  const length = artist.soundcheckEnd - artist.soundcheckStart;

  const moveStart = (nextDate: string, clock: { hour: number; minute: number }): void => {
    const start = hoursAtLocal(plan.startISO, nextDate, clock);
    if (start === null) return;
    edit(
      (p) =>
        setArtist(p, artist.key, {
          soundcheckStart: start,
          soundcheckEnd: slideEnd(artist.soundcheckStart, artist.soundcheckEnd, start),
        }),
      `balances de ${who}`,
    );
  };

  return (
    <div className="artist-section">
      <span className="panel-section-title">Balances</span>
      <div className="rules-grid">
        <label className="rule is-check">
          <span className="rule-input">
            <input
              type="checkbox"
              name={`artist-sc-${artist.key}`}
              checked={artist.soundcheckNeeded}
              onChange={(event) => set('soundcheckNeeded', event.target.checked, 'balances')}
            />
            <span className="rule-label">Besoin de balances</span>
          </span>
        </label>

        {artist.soundcheckNeeded && (
          <>
            <div className="rule">
              <span className="rule-label">Début</span>
              <span className="rule-input">
                <input
                  className="select"
                  type="date"
                  name={`artist-sc-date-${artist.key}`}
                  aria-label={`Jour des balances de ${artist.name}`}
                  value={date}
                  onChange={(event) => {
                    if (event.target.value === '') return;
                    moveStart(event.target.value, clockOf(plan.startISO, artist.soundcheckStart));
                  }}
                />
                <TimeOfDayField
                  value={clockOf(plan.startISO, artist.soundcheckStart)}
                  ariaLabel={`Heure de début des balances de ${artist.name}`}
                  name={`artist-sc-start-${artist.key}`}
                  onChange={(clock) => {
                    if (date !== '') moveStart(date, clock);
                  }}
                />
              </span>
              <span className="rule-hint">
                Peut tomber la veille, pendant le montage: elles y sont alors dessinées.
              </span>
            </div>

            <div className="rule">
              <span className="rule-label">Fin</span>
              <span className="rule-input">
                <TimeOfDayField
                  value={clockOf(plan.startISO, artist.soundcheckEnd)}
                  ariaLabel={`Heure de fin des balances de ${artist.name}`}
                  name={`artist-sc-end-${artist.key}`}
                  onChange={(clock) => {
                    const sameDay = hoursAtLocal(plan.startISO, date, clock);
                    if (sameDay === null) return;
                    // A clock before the start is the next day's: "23h à 1h".
                    set('soundcheckEnd', sameDay > artist.soundcheckStart ? sameDay : sameDay + 24, 'balances');
                  }}
                />
                <span className="rule-suffix">
                  {length > 0 ? `durée ${fmtHours(length)}` : 'la fin doit être après le début'}
                </span>
              </span>
            </div>

            <label className="rule is-check">
              <span className="rule-input">
                <input
                  type="checkbox"
                  name={`artist-sc-eng-${artist.key}`}
                  checked={artist.soundcheckEngineer}
                  onChange={(event) => set('soundcheckEngineer', event.target.checked, 'balances')}
                />
                <span className="rule-label">Besoin d'un ingé son</span>
              </span>
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function TechSection({ artist, set }: { artist: Artist; set: Setter }) {
  return (
    <div className="artist-section">
      <span className="panel-section-title">Technique</span>
      <div className="rules-grid">
        <label className="rule artist-wide">
          <span className="rule-label">Besoins techniques</span>
          <textarea
            className="select artist-text"
            name={`artist-tech-${artist.key}`}
            rows={3}
            value={artist.technicalNeeds}
            aria-label={`Besoins techniques de ${artist.name}`}
            onChange={(event) => set('technicalNeeds', event.target.value, 'besoins techniques')}
          />
        </label>

        <label className="rule">
          <span className="rule-label">Taille du patch</span>
          <span className="rule-input">
            <NumberField
              value={artist.patchSize}
              ariaLabel={`Taille du patch de ${artist.name}`}
              name={`artist-patch-${artist.key}`}
              onCommit={(value) => set('patchSize', Math.round(value ?? 0), 'patch')}
            />
            <span className="rule-suffix">lignes</span>
          </span>
        </label>

        <label className="rule artist-wide">
          <span className="rule-label">Détails</span>
          <textarea
            className="select artist-text"
            name={`artist-notes-${artist.key}`}
            rows={3}
            value={artist.notes}
            aria-label={`Détails sur ${artist.name}`}
            onChange={(event) => set('notes', event.target.value, 'détails')}
          />
        </label>
      </div>
    </div>
  );
}

function TravelSection({ artist, set }: { artist: Artist; set: Setter }) {
  const { plan, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';

  const ticketRow = (
    label: string,
    countField: 'trainTickets' | 'planeTickets',
    doneField: 'trainDone' | 'planeDone',
    costField: 'trainCost' | 'planeCost',
  ) => (
    <div className="rule">
      <span className="rule-label">{label}</span>
      <span className="rule-input">
        <NumberField
          value={artist[countField]}
          ariaLabel={`${label} pour ${who}`}
          name={`artist-${countField}-${artist.key}`}
          onCommit={(value) => set(countField, Math.round(value ?? 0), 'défraiement')}
        />
        {artist[countField] > 0 && (
          <label className="artist-status">
            <input
              type="checkbox"
              name={`artist-${doneField}-${artist.key}`}
              checked={artist[doneField]}
              onChange={(event) => set(doneField, event.target.checked, 'défraiement')}
            />
            <span className={`chip ${artist[doneField] ? 'is-ok' : 'is-warn'}`}>
              {artist[doneField] ? 'fait' : 'à faire'}
            </span>
          </label>
        )}
        {artist[countField] > 0 && (
          <>
            <NumberField
              value={artist[costField]}
              step={0.01}
              ariaLabel={`Coût des ${label.toLowerCase()} pour ${who}`}
              name={`artist-${costField}-${artist.key}`}
              onCommit={(value) => set(costField, Math.max(0, value ?? 0), 'défraiement')}
            />
            <span className="rule-suffix">€ en tout</span>
          </>
        )}
      </span>
    </div>
  );

  return (
    <div className="artist-section">
      <span className="panel-section-title">Défraiement</span>
      <div className="rules-grid">
        {ticketRow('Billets de train', 'trainTickets', 'trainDone', 'trainCost')}
        {ticketRow("Billets d'avion", 'planeTickets', 'planeDone', 'planeCost')}
      </div>

      <div className="artist-trips">
        <span className="setup-group-title is-sub">
          Trajets en voiture ({artist.carTrips.length})
        </span>
        {artist.carTrips.map((trip) => (
          <TripRow key={trip.key} artist={artist} trip={trip} />
        ))}
        <div className="artist-add">
          <button
            className="btn is-small"
            onClick={() => edit((p) => addCarTrip(p, artist.key), `trajet pour ${who}`)}
          >
            Ajouter un trajet
          </button>
          {plan.address.trim() === '' && artist.carTrips.length > 0 && (
            <span className="people-meta">
              L'adresse de l'événement n'est pas renseignée dans Réglages: « lieu de l'événement »
              n'a pas encore d'adresse.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TripRow({ artist, trip }: { artist: Artist; trip: CarTrip }) {
  const { plan, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';
  /** What « Calculer automatiquement » is doing, or what went wrong, under the button. */
  const [estimate, setEstimate] = useState<{ busy: boolean; message: string }>({ busy: false, message: '' });
  const change = (over: Partial<Omit<CarTrip, 'key'>>): void =>
    edit((p) => setCarTrip(p, artist.key, trip.key, over), `trajet de ${who}`);

  /*
   * THE DISTANCE COMES FROM THE MAP, THE PRICE FROM RÉGLAGES. See `components/travel.ts`. The
   * result is written into the trip like a typed figure, so the régisseur can correct either
   * number afterwards; the breakdown stays in the tooltip of the cost.
   */
  const compute = async (): Promise<void> => {
    setEstimate({ busy: true, message: 'Calcul en cours…' });
    try {
      const result = await estimateTrip(trip, plan.address, plan.travel);
      edit(
        (p) => setCarTrip(p, artist.key, trip.key, { distanceKm: result.distanceKm, cost: result.cost }),
        `trajet de ${who} calculé`,
      );
      setEstimate({ busy: false, message: result.detail });
    } catch (error) {
      setEstimate({
        busy: false,
        message: `Calcul impossible: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const detail =
    trip.distanceKm !== null ? priceTrip(trip, trip.distanceKm, plan.travel).detail : '';

  const endpoint = (
    label: string,
    addressField: 'fromAddress' | 'toAddress',
    venueField: 'fromVenue' | 'toVenue',
  ) => (
    <div className="rule">
      <span className="rule-label">{label}</span>
      <span className="rule-input">
        <input
          className="select"
          name={`trip-${addressField}-${trip.key}`}
          autoComplete="off"
          placeholder={trip[venueField] ? plan.address || "Lieu de l'événement" : 'Adresse'}
          value={trip[venueField] ? '' : trip[addressField]}
          disabled={trip[venueField]}
          aria-label={`${label} du trajet`}
          onChange={(event) => change({ [addressField]: event.target.value })}
        />
      </span>
      <label className="artist-status">
        <input
          type="checkbox"
          name={`trip-${venueField}-${trip.key}`}
          checked={trip[venueField]}
          onChange={(event) => change({ [venueField]: event.target.checked })}
        />
        <span className="people-meta">lieu de l'événement</span>
      </label>
    </div>
  );

  return (
    <div className="artist-trip">
      <div className="rules-grid">
        {endpoint('Départ', 'fromAddress', 'fromVenue')}
        {endpoint('Arrivée', 'toAddress', 'toVenue')}

        <label className="rule">
          <span className="rule-label">Carburant</span>
          <select
            className="select"
            name={`trip-fuel-${trip.key}`}
            value={trip.fuel}
            aria-label="Type de carburant"
            onChange={(event) => change({ fuel: event.target.value as FuelKind })}
          >
            {(Object.keys(FUEL_LABEL) as FuelKind[]).map((fuel) => (
              <option key={fuel} value={fuel}>
                {FUEL_LABEL[fuel]}
              </option>
            ))}
          </select>
        </label>

        <label className="rule">
          <span className="rule-label">Consommation</span>
          <span className="rule-input">
            <NumberField
              value={trip.consumptionPer100}
              step={0.1}
              ariaLabel="Consommation du véhicule aux 100 km"
              name={`trip-conso-${trip.key}`}
              onCommit={(value) => change({ consumptionPer100: value ?? 0 })}
            />
            <span className="rule-suffix">
              {trip.fuel === 'electrique' ? 'kWh' : 'L'} / 100 km
            </span>
          </span>
        </label>

        <label className="rule is-check">
          <span className="rule-input">
            <input
              type="checkbox"
              name={`trip-tolls-${trip.key}`}
              checked={trip.tolls}
              onChange={(event) => change({ tolls: event.target.checked })}
            />
            <span className="rule-label">Avec péage</span>
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Distance</span>
          <span className="rule-input">
            <NumberField
              value={trip.distanceKm}
              step={1}
              placeholder="?"
              ariaLabel="Distance du trajet en kilomètres"
              name={`trip-km-${trip.key}`}
              onCommit={(value) => change({ distanceKm: value })}
            />
            <span className="rule-suffix">km</span>
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Coût</span>
          <span className="rule-input">
            <NumberField
              value={trip.cost}
              step={0.01}
              placeholder="?"
              ariaLabel="Coût du trajet en euros"
              name={`trip-cost-${trip.key}`}
              title={detail || undefined}
              onCommit={(value) => change({ cost: value })}
            />
            <span className="rule-suffix">€</span>
            <button
              className="btn is-small"
              disabled={estimate.busy}
              title="Distance par la route d'après la carte, prix du carburant et péage d'après Réglages"
              onClick={() => void compute()}
            >
              Calculer automatiquement
            </button>
          </span>
          {(estimate.message !== '' || detail !== '') && (
            <span className="rule-hint">{estimate.message || detail}</span>
          )}
        </label>

        <div className="rule artist-trip-remove">
          <button
            className="btn is-icon is-danger"
            title="Retirer ce trajet"
            onClick={() =>
              edit((p) => deleteCarTrip(p, artist.key, trip.key), `trajet retiré pour ${who}`)
            }
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The people of the act, one row each, with their plates when the catering is on.
 *
 * The meal boxes are `CateringScreen`'s boxes, drawn from the same report and written through
 * the same edit: a tick here is a tick there. The drink tickets field is EMPTY while the member
 * follows the event's figure, and shows that figure as its placeholder; typing a number is the
 * one way to decide otherwise for this person, and emptying it goes back to following.
 */
function MembersSection({
  artist,
  catering,
}: {
  artist: Artist;
  catering: CateringReport | null;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';
  const services = catering?.services ?? [];
  const rules = plan.catering.rules;

  return (
    <div className="artist-section">
      <span className="panel-section-title">
        Les personnes du groupe ({artist.members.length} nommée
        {artist.members.length > 1 ? 's' : ''} sur {artist.size} prévue{artist.size > 1 ? 's' : ''})
      </span>

      <div className="screen-scroll">
        <table className="setup-table catering-table artist-members">
          <thead>
            <tr>
              <th>Prénom</th>
              <th>Nom</th>
              <th>Rôle</th>
              <th title="Cette personne est aussi bénévole ou orga sur l'événement">Aussi</th>
              <th>Régime</th>
              <th>Allergies</th>
              {services.map((service) => (
                <th key={service.key} className="catering-box" title={service.label}>
                  {service.dayLabel}
                  <br />
                  {service.windowLabel.toLowerCase()}
                </th>
              ))}
              <th title="Tickets boisson">🥤</th>
              <th>Paiement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {artist.members.map((member) => {
              const name = artistMemberName(artist, member);
              const change = (over: Partial<Omit<ArtistMember, 'key'>>, what: string): void =>
                edit((p) => setArtistMember(p, artist.key, member.key, over), `${what} de ${name}`);
              /*
               * ONE PERSON, ONE ROW. A member who is also a bénévole or an orga has no row of
               * their own on the caterer's sheet: the boxes drawn here are the PERSON's, read
               * from and written to their own kind and key, so ticking a plate here or on the
               * Catering tab is the same decision. A link to somebody the plan no longer holds
               * reads as no link.
               */
              const linked = memberIsLinked(member, plan.organisers, plan.volunteers);
              const eater: { kind: MealPersonKind; key: string } = linked
                ? { kind: member.linkedKind!, key: member.linkedKey }
                : { kind: 'artiste', key: member.key };
              const row = catering?.people.find((p) => p.kind === eater.kind && p.key === eater.key);
              const computed = catering
                ? defaultMealChoices(plan, index, services, eater.kind, eater.key)
                : null;
              const linkValue = linked ? `${member.linkedKind}|${member.linkedKey}` : '';

              return (
                <tr key={member.key}>
                  <td>
                    <input
                      className="select"
                      name={`member-first-${member.key}`}
                      autoComplete="off"
                      placeholder="Prénom"
                      value={member.firstName}
                      aria-label={`Prénom, ${name}`}
                      onChange={(event) => change({ firstName: event.target.value }, 'prénom')}
                    />
                  </td>
                  <td>
                    <input
                      className="select"
                      name={`member-last-${member.key}`}
                      autoComplete="off"
                      placeholder="Nom"
                      value={member.lastName}
                      aria-label={`Nom, ${name}`}
                      onChange={(event) => change({ lastName: event.target.value }, 'nom')}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      name={`member-role-${member.key}`}
                      value={member.role}
                      aria-label={`Rôle de ${name}`}
                      onChange={(event) =>
                        change({ role: event.target.value as ArtistMember['role'] }, 'rôle')
                      }
                    >
                      <option value="musicien">Musicien·ne</option>
                      <option value="technicien">Technicien·ne</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="select"
                      name={`member-link-${member.key}`}
                      value={linkValue}
                      aria-label={`${name} est aussi`}
                      title={
                        linked
                          ? 'Une seule ligne au catering, jamais deux repas. Les tickets boisson suivent le réglage « se cumulent » de Réglages.'
                          : 'Si cette personne est aussi bénévole ou orga, la nommer ici évite de la compter deux fois.'
                      }
                      onChange={(event) => {
                        const [kind, key] = event.target.value.split('|');
                        edit(
                          (p) =>
                            linkArtistMember(
                              p,
                              artist.key,
                              member.key,
                              kind === 'orga' || kind === 'benevole' ? (kind as PersonKind) : null,
                              key ?? '',
                            ),
                          `${name} est aussi ${kind === 'orga' ? 'orga' : kind === 'benevole' ? 'bénévole' : 'personne d\'autre'}`,
                        );
                      }}
                    >
                      <option value="">personne d'autre</option>
                      <optgroup label="Orgas">
                        {plan.organisers.map((o) => (
                          <option key={o.key} value={`orga|${o.key}`}>
                            {organiserName(o) || o.key}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Bénévoles">
                        {plan.volunteers.map((v) => (
                          <option key={v.key} value={`benevole|${v.key}`}>
                            {`${v.firstName} ${v.lastName}`.trim() || v.key}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td>
                    <input
                      className="select"
                      name={`member-diet-${member.key}`}
                      autoComplete="off"
                      placeholder="Régime"
                      value={member.diet}
                      aria-label={`Régime de ${name}`}
                      onChange={(event) => change({ diet: event.target.value }, 'régime')}
                    />
                  </td>
                  <td>
                    <input
                      className="select"
                      name={`member-allergies-${member.key}`}
                      autoComplete="off"
                      placeholder="Allergies"
                      value={member.allergies}
                      aria-label={`Allergies de ${name}`}
                      onChange={(event) => change({ allergies: event.target.value }, 'allergies')}
                    />
                  </td>

                  {services.map((service) => {
                    const takes = row?.serviceKeys.includes(service.key) ?? false;
                    const byHand = row?.handPicked.includes(service.key) ?? false;
                    return (
                      <td key={service.key} className="catering-box">
                        <input
                          type="checkbox"
                          checked={takes}
                          className={byHand ? 'is-manual' : undefined}
                          aria-label={`${name}, ${service.label}`}
                          title={
                            (byHand
                              ? 'Choisi à la main: ce choix tient même si les horaires changent.'
                              : "Rempli d'après les heures de présence du groupe.") +
                            (linked ? ' La même case que sur sa ligne du Catering.' : '')
                          }
                          onChange={(event) =>
                            edit(
                              (p) =>
                                setMeal(
                                  p,
                                  eater.kind,
                                  eater.key,
                                  service.key,
                                  event.target.checked,
                                  computed?.has(service.key) ?? false,
                                ),
                              `repas de ${name}`,
                            )
                          }
                        />
                      </td>
                    );
                  })}

                  <td>
                    <NumberField
                      value={member.drinkTickets}
                      placeholder={String(rules.artistDrinks)}
                      ariaLabel={`Tickets boisson de ${name}`}
                      name={`member-drinks-${member.key}`}
                      title={
                        member.drinkTickets === null
                          ? `Suit le réglage de l'événement (${rules.artistDrinks}). Tapez un nombre pour décider autrement.`
                          : `Fixé à la main. Videz le champ pour suivre de nouveau le réglage (${rules.artistDrinks}).`
                      }
                      onCommit={(value) =>
                        change({ drinkTickets: value === null ? null : Math.round(value) }, 'tickets')
                      }
                    />
                    {member.drinkTickets !== null && member.drinkTickets !== rules.artistDrinks && (
                      <span className="people-meta"> (réglage {rules.artistDrinks})</span>
                    )}
                    {linked && row && (
                      <span
                        className="people-meta"
                        title={
                          rules.artistDrinksCumulative
                            ? 'Ses deux statuts se cumulent (Réglages).'
                            : 'Le plus élevé de ses deux statuts (Réglages).'
                        }
                      >
                        {' '}
                        → {row.drinks} au total
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="select"
                      name={`member-payment-${member.key}`}
                      value={member.payment}
                      aria-label={`Mode de paiement de ${name}`}
                      onChange={(event) =>
                        change({ payment: event.target.value as ArtistMember['payment'] }, 'paiement')
                      }
                    >
                      {(Object.keys(PAYMENT_LABEL) as ArtistMember['payment'][]).map((mode) => (
                        <option key={mode} value={mode}>
                          {PAYMENT_LABEL[mode]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className="artist-row-actions">
                      {row && row.handPicked.length > 0 && (
                        <button
                          className="btn is-icon"
                          title="Rendre ses repas au planning: ils suivront de nouveau les heures du groupe."
                          onClick={() =>
                            edit(
                              (p) => clearMeals(p, eater.kind, eater.key),
                              `repas de ${name} rendus au planning`,
                            )
                          }
                        >
                          ↺
                        </button>
                      )}
                      <button
                        className="btn is-icon is-danger"
                        title={`Retirer ${name} du groupe`}
                        onClick={() =>
                          edit(
                            (p) => deleteArtistMember(p, artist.key, member.key),
                            `${name} retiré de ${who}`,
                          )
                        }
                      >
                        ✕
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="artist-add">
        <button
          className="btn is-small"
          onClick={() => edit((p) => addArtistMember(p, artist.key), `membre ajouté à ${who}`)}
        >
          Ajouter une personne
        </button>
        {!plan.catering.rules.enabled && (
          <span className="people-meta">
            Le catering n'est pas activé dans Réglages: les repas apparaîtront ici quand il le sera.
          </span>
        )}
      </div>

      <GuestsSection artist={artist} />
    </div>
  );
}

/**
 * The people the act lets in, by name: each member's, then the act's own.
 *
 * NAMES AND NOT A COUNT, since 2026-09-13: "ce ne doit pas être une checkbox, mais un nom et un
 * prénom". The door reads names off a list. The event's figure per artist
 * (`ticketing.guestsPerArtist`) is a ceiling the fiche shows and never enforces: a fourth name
 * on a member allowed three is a signalement on the billetterie, not a refusal here.
 */
function GuestsSection({ artist }: { artist: Artist }) {
  const { plan, edit } = useLoadedPlan();
  const who = artist.name || 'ce groupe';
  const allowed = plan.ticketing.guestsPerArtist;

  const guestRow = (guest: Guest, label: string) => (
    <div key={guest.key} className="artist-guest">
      <input
        className="select"
        name={`guest-first-${guest.key}`}
        autoComplete="off"
        placeholder="Prénom"
        value={guest.firstName}
        aria-label={`Prénom, ${label}`}
        onChange={(event) =>
          edit((p) => setGuest(p, artist.key, guest.key, { firstName: event.target.value }), `invité de ${who}`)
        }
      />
      <input
        className="select"
        name={`guest-last-${guest.key}`}
        autoComplete="off"
        placeholder="Nom"
        value={guest.lastName}
        aria-label={`Nom, ${label}`}
        onChange={(event) =>
          edit((p) => setGuest(p, artist.key, guest.key, { lastName: event.target.value }), `invité de ${who}`)
        }
      />
      <button
        className="btn is-icon is-danger"
        title="Retirer cette invitation"
        onClick={() => edit((p) => deleteGuest(p, artist.key, guest.key), `invitation retirée pour ${who}`)}
      >
        ✕
      </button>
    </div>
  );

  return (
    <div className="artist-section">
      <span className="panel-section-title">
        Invitations ({artistInvitations(artist)} · {allowed} par artiste dans Réglages)
      </span>
      <div className="artist-guests">
        {artist.members.map((member) => {
          const name = artistMemberName(artist, member);
          const over = member.guests.length > allowed;
          return (
            <div key={member.key} className="artist-guest-group">
              <span className={`people-meta${over ? ' is-bad' : ''}`}>
                Invités de {name} ({member.guests.length} sur {allowed})
                {over && ' · au-delà du réglage'}
              </span>
              {member.guests.map((guest) => guestRow(guest, `invité de ${name}`))}
              <button
                className="btn is-small"
                onClick={() => edit((p) => addGuest(p, artist.key, member.key), `invitation pour ${name}`)}
              >
                Ajouter un invité
              </button>
            </div>
          );
        })}
        <div className="artist-guest-group">
          <span className="people-meta">Invitations supplémentaires du groupe ({artist.extraGuests.length})</span>
          {artist.extraGuests.map((guest) => guestRow(guest, `invité de ${who}`))}
          <button
            className="btn is-small"
            onClick={() => edit((p) => addGuest(p, artist.key, null), `invitation pour ${who}`)}
          >
            Ajouter une invitation
          </button>
        </div>
      </div>
    </div>
  );
}
