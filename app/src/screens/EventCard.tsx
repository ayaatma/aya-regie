/**
 * The event itself: its name, its address, when it starts and how long it runs.
 *
 * Everything else in the tool counts decimal hours from the start, so moving the start slides
 * the whole plan rather than rescheduling anything: a shift at hour 2 is still at hour 2, it just
 * falls at a different wall-clock time. That is what the decimal-hours model buys, and it is why
 * this card can exist at all without a migration behind it.
 *
 * The address is here for the same reason: it is a fact about the event, typed once, that several
 * things to come will read (a trajet that starts at the venue, a sheet for the traiteur).
 *
 * THE LINE-UP LEFT THIS CARD ON 2026-09-13. It was a list of names and hours here while that was
 * all the tool knew about an act; it is a fiche per act now, on its own tab (Artistes), and the
 * régisseur asked in so many words that Réglages stop carrying it.
 */

import { useState } from 'react';

import { dayLabel, eventDays, toClock } from '../engine.ts';
import {
  MAX_EVENT_HOURS,
  setEventAddress,
  setPoleChoicesRanked,
  setVolumeSettings,
  shiftsCutByBoundary,
  setEventLength,
  setEventShiftHours,
  shiftHoursByHand,
  setEventName,
  setEventStart,
} from '../store/setupEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { TimeOfDayField } from '../components/ClockField.tsx';
import { type ClockTime } from '../components/clock.ts';
import { SetupSection } from './SetupSection.tsx';

const pad = (n: number): string => String(n).padStart(2, '0');


/**
 * The start, as two fields rather than one `datetime-local`.
 *
 * The native control is the only place in the tool where the hour was not ours to format, and
 * it follows the operating system's locale: an English-language Windows was putting "12:00 PM"
 * on a French event. A date input, which has no hour to get wrong, next to our own 24 h field.
 *
 * The string handed back is local wall-clock with no zone, on purpose. The régisseur types the
 * hour written on the poster, and the browser is in the same country as the event.
 */
function toLocalDate(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

function toLocalClock(iso: string): ClockTime {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? { hour: 0, minute: 0 }
    : { hour: when.getHours(), minute: when.getMinutes() };
}

/** "4, 6, 8": a list typed as text, committed on blur, so "4, " mid-typing is not a list of one. */
function VolumeOptionsField({ options, onCommit }: { options: readonly number[]; onCommit(options: number[]): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = options.map((o) => String(o).replace('.', ',')).join(', ');
  return (
    <input
      className="select"
      name="volume-options"
      autoComplete="off"
      aria-label="Volumes proposés, en heures, séparés par des virgules"
      value={draft ?? shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const parsed = draft
          .split(/[;\s]+|,(?!\d)/)
          .map((part) => Number(part.trim().replace(',', '.')))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (parsed.length > 0) onCommit(parsed);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

export function EventCard() {
  const { plan, edit } = useLoadedPlan();
  /** Poles whose créneau length was set by hand, which the event's default no longer reaches. */
  const byHand = plan.poles.filter(shiftHoursByHand).length;

  const start = new Date(plan.startISO);
  const ends = new Date(start.getTime() + plan.lengthHours * 3600_000);
  const readable = (when: Date): string =>
    Number.isNaN(when.getTime())
      ? '?'
      : when.toLocaleString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <SetupSection
      className="setup-event"
      title="L'événement"
      meta={`${readable(start)} → ${readable(ends)}`}
    >

      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Nom</span>
          <input
            className="select"
            name="event-name"
            autoComplete="off"
            value={plan.name}
            onChange={(event) => edit((p) => setEventName(p, event.target.value), "nom de l'événement")}
          />
          <span className="rule-hint">Ce que le régisseur et les bénévoles voient en haut.</span>
        </label>

        <label className="rule">
          <span className="rule-label">Adresse</span>
          <input
            className="select"
            name="event-address"
            autoComplete="off"
            placeholder="Lieu de l'événement"
            value={plan.address}
            onChange={(event) =>
              edit((p) => setEventAddress(p, event.target.value), "adresse de l'événement")
            }
          />
          <span className="rule-hint">
            Le lieu, tel qu'il s'écrit sur l'affiche. Il servira partout où le lieu de l'événement
            est un point de départ ou d'arrivée.
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Début</span>
          <span className="rule-input">
            <input
              className="select"
              type="date"
              name="event-start"
              aria-label="Date de l'événement"
              value={toLocalDate(plan.startISO)}
              onChange={(event) => {
                if (event.target.value === '') return;
                const clock = toLocalClock(plan.startISO);
                edit(
                  (p) =>
                    setEventStart(
                      p,
                      `${event.target.value}T${pad(clock.hour)}:${pad(clock.minute)}`,
                    ),
                  "début de l'événement",
                );
              }}
            />
            <TimeOfDayField
              value={toLocalClock(plan.startISO)}
              ariaLabel="Heure de début de l'événement"
              name="event-start-time"
              onChange={(clock) => {
                const date = toLocalDate(plan.startISO);
                if (date === '') return;
                edit(
                  (p) => setEventStart(p, `${date}T${pad(clock.hour)}:${pad(clock.minute)}`),
                  "début de l'événement",
                );
              }}
            />
          </span>
          <span className="rule-hint">
            Déplacer le début fait glisser tout le planning: un créneau à la deuxième heure reste
            à la deuxième heure, il tombe simplement à une autre heure réelle.
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Durée</span>
          <span className="rule-input">
            <input
              type="number"
              min={1}
              max={MAX_EVENT_HOURS}
              step={0.5}
              value={plan.lengthHours}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  edit((p) => setEventLength(p, value), "durée de l'événement");
                }
              }}
            />
            <span className="rule-suffix">h, jusqu'à {toClock(plan.startISO, plan.lengthHours)}</span>
          </span>
          <span className="rule-hint">
            Jusqu'à une semaine. Raccourcir ne supprime rien: les créneaux et les sets qui
            dépassent restent, et la grille va assez loin pour les montrer. Le montage se termine
            à ce début et le démontage commence à cette fin, tous les deux suivent.
          </span>
        </label>

        {/*
          THE EVENT'S DEFAULT LENGTH OF A CRÉNEAU, since 2026-09-17. Every pole follows it unless
          its own length was set by hand (green in the pole's settings), and the événements
          created from the montage or démontage grid take it too.
        */}
        <label className="rule">
          <span className="rule-label">Durée par défaut d'un créneau</span>
          <span className="rule-input">
            <input
              type="number"
              min={0.25}
              max={12}
              step={0.25}
              name="event-default-shift-hours"
              value={plan.defaultShiftHours}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) {
                  edit((p) => setEventShiftHours(p, value), "durée par défaut d'un créneau");
                }
              }}
            />
            <span className="rule-suffix">h</span>
          </span>
          <span className="rule-hint">
            Celle de chaque pôle qui n'a pas la sienne
            {byHand > 0 ? ` (${byHand} pôle${byHand > 1 ? 's ont' : ' a'} une durée réglée à la main, en vert)` : ''}.
            Appliquée aux prochains créneaux créés, jamais aux créneaux existants.
          </span>
        </label>

        {/*
          LE VOLUME HORAIRE, 2026-09-14. For the whole event, or per day; a day begins at the
          boundary hour, noon by default. The régisseur's case: somebody working from 2h to 6h
          and again from 18h to 22h has not worked twice on the same day. See `days.ts`.
        */}
        <div className="rule">
          <span className="rule-label">Volume horaire</span>
          <span className="advanced-mode" role="radiogroup" aria-label="Volume horaire sur tout l'événement ou par jour">
            {(['event', 'day'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={plan.volume.scope === scope}
                className={`mode-choice is-weight${plan.volume.scope === scope ? ' is-on' : ''}`}
                onClick={() => edit((p) => setVolumeSettings(p, { scope }), scope === 'day' ? 'volume horaire par jour' : "volume horaire sur l'événement")}
              >
                {scope === 'day' ? 'Par jour' : "Sur tout l'événement"}
              </button>
            ))}
          </span>
          <span className="rule-hint">
            {plan.volume.scope === 'day'
              ? "Chaque personne donne un volume par jour. Le plancher, le volume et le nombre de blocs se comptent jour par jour; la pause minimale et la durée d'affilée restent continues."
              : "Chaque personne donne un volume pour tout l'événement."}
          </span>
        </div>

        <label className="rule">
          <span className="rule-label">Heure de basculement entre 2 jours</span>
          <span className="rule-input">
            <TimeOfDayField
              value={{ hour: Math.floor(plan.volume.dayStartHour), minute: Math.round((plan.volume.dayStartHour % 1) * 60) }}
              ariaLabel="Heure de basculement entre deux jours"
              onChange={(clock) => edit((p) => setVolumeSettings(p, { dayStartHour: clock.hour + clock.minute / 60 }), 'heure de basculement')}
            />
          </span>
          <span className="rule-hint">
            {(() => {
              const days = eventDays(plan.startISO, plan.lengthHours, plan.volume.dayStartHour);
              const cut = shiftsCutByBoundary(plan, plan.volume.dayStartHour);
              return (
                `${days.length} jour(s): ${days.map((d) => dayLabel(plan.startISO, d)).join(', ')}. ` +
                'Un créneau compte en entier pour le jour où il commence.' +
                (cut > 0 ? ` ${cut} créneau(x) passent cette heure: une heure plus calme serait plus juste.` : '')
              );
            })()}
          </span>
        </label>

        <label className="rule">
          <span className="rule-label">Volumes proposés</span>
          <span className="rule-input">
            <VolumeOptionsField
              options={plan.volume.options}
              onCommit={(options) => edit((p) => setVolumeSettings(p, { options }), 'volumes proposés')}
            />
            <span className="rule-suffix">h{plan.volume.scope === 'day' ? ' par jour' : ''}</span>
          </span>
          <span className="rule-hint">
            Les réponses que le formulaire propose, séparées par des virgules. Ce que la fiche
            d'un bénévole offre, et ce à quoi l'import relie les réponses. Retirer un volume ne
            modifie aucune réponse déjà donnée.
          </span>
        </label>

        {/*
          How the form's pole choices are read. Ranked is the Loto Tekno form ("choix principal",
          "deuxième choix"); a form that ticks a box per pole has no order, and then every choice
          is as good as the next. The lists are kept in order either way.
        */}
        <div className="rule">
          <span className="rule-label">Choix de pôles des bénévoles</span>
          <span className="advanced-mode" role="radiogroup" aria-label="Choix de pôles classés ou à égalité">
            {([true, false] as const).map((ranked) => (
              <button
                key={String(ranked)}
                type="button"
                role="radio"
                aria-checked={plan.poleChoicesRanked === ranked}
                className={`mode-choice is-weight${plan.poleChoicesRanked === ranked ? ' is-on' : ''}`}
                onClick={() => edit((p) => setPoleChoicesRanked(p, ranked), ranked ? 'choix de pôles classés' : 'choix de pôles à égalité')}
              >
                {ranked ? 'Classés' : 'À égalité'}
              </button>
            ))}
          </span>
          <span className="rule-hint">
            Classés: le premier choix est le plus souhaité, chaque rang plus bas coûte un peu plus
            (Réglages avancés). À égalité: tous les choix se valent, seul le hors choix coûte.
          </span>
        </div>
      </div>
    </SetupSection>
  );
}
