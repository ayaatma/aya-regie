/**
 * The dashboard: what this plan costs the people in it.
 *
 * Everything here is read straight off `PlanSummary`. Nothing is recounted, because a figure
 * recomputed in a screen is a figure that will one day disagree with the grid.
 *
 * The brief asks for names, not counts, wherever a number stands for somebody's evening: who
 * got neither of their two choices, who is on the reserve, whose buddy request went unhonoured.
 * A count tells the régisseur there is a problem; a name tells them who to call.
 */

import {
  eventFills,
  fmtHours,
  phaseIssues,
  phasePeople,
  toClock,
  type Phase,
  type PhaseId,
} from '../engine.ts';
import { Fragment } from 'react';

import { useLoadedPlan } from '../store/store.tsx';
import { choiceRankLabel, volumeText } from '../components/layout.ts';
import { organiserName } from '../components/labels.ts';

export function DashboardScreen({ onGoToRecruitment }: { onGoToRecruitment(): void }) {
  const { report, index } = useLoadedPlan();
  const ranked = index.plan.poleChoicesRanked !== false;
  const summary = report.summary;

  const coverage =
    summary.demandHours > 0 ? (summary.assignedHours / summary.demandHours) * 100 : 100;

  const unhonoured = report.volunteers
    .flatMap((v) => v.buddies.filter((b) => !b.honoured).map((b) => ({ from: v.name, to: b.toName })))
    .sort((a, b) => a.from.localeCompare(b.from, 'fr'));

  const reserve = report.volunteers
    .filter((v) => v.reserve)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const artistAlerts = report.artists
    .filter((a) => a.assignedDuring > 0)
    .sort((a, b) => b.assignedDuring - a.assignedDuring);

  const belowFloor = report.volunteers
    .filter((v) => !v.reserve && v.assignedHours > 0 && v.assignedHours < index.rules.minHoursPerPerson)
    .sort((a, b) => a.assignedHours - b.assignedHours);

  return (
    <div className="board">
      <section className="board-card is-span2">
        <h2>Couverture</h2>
        <div className="stat-row">
          {/*
            The headcount comes first, because every other figure on this card is meaningless
            without knowing how many people the form has actually brought in so far.
          */}
          <Stat value={String(summary.volunteersTotal)} label="bénévoles importés" />
          <Stat value={`${coverage.toFixed(0)} %`} label="des heures pourvues" />
          <Stat
            value={fmtHours(summary.gapHours)}
            label="restant à pourvoir"
            tone={summary.gapHours > 0 ? 'bad' : 'ok'}
          />
          <Stat
            value={String(summary.shiftsEmpty)}
            label="créneaux vides"
            tone={summary.shiftsEmpty > 0 ? 'bad' : 'ok'}
          />
          <Stat value={String(summary.shiftsPartial)} label="créneaux incomplets" />
          <Stat value={String(summary.shiftsFilled)} label="créneaux complets" tone="ok" />
          <Stat
            value={String(summary.tier1Count)}
            label="affectations illégales"
            tone={summary.tier1Count > 0 ? 'bad' : 'ok'}
          />
        </div>
        {summary.gapHours > 0 && (
          <p className="board-note">
            <button className="btn" onClick={onGoToRecruitment}>
              Voir le détail du recrutement
            </button>
          </p>
        )}
      </section>

      <section className="board-card">
        <h2>Ce que les bénévoles ont obtenu</h2>
        <div className="bar">
          {/* The first choice in the strong colour, every later one in the second: past two the
              bar would need a colour per rank, and what the régisseur reads here is "first or not". */}
          {summary.hoursByRank.map((hours, rank) => (
            <span
              key={rank}
              className={`bar-part ${rank === 0 ? 'is-c1' : 'is-c2'}`}
              style={{ flexGrow: hours }}
              title={`${choiceRankLabel(rank, ranked)}: ${fmtHours(hours)}`}
            />
          ))}
          <span
            className="bar-part is-hc"
            style={{ flexGrow: summary.hoursHorsChoix }}
            title={`Hors choix: ${fmtHours(summary.hoursHorsChoix)}`}
          />
        </div>
        <dl className="kv">
          {summary.hoursByRank.map((hours, rank) => (
            <Fragment key={rank}>
              <dt>{choiceRankLabel(rank, ranked)}</dt>
              <dd>{fmtHours(hours)}</dd>
            </Fragment>
          ))}
          <dt>Hors choix</dt>
          <dd>{fmtHours(summary.hoursHorsChoix)}</dd>
          <dt>Au volume demandé</dt>
          <dd>
            {summary.volunteersAtRequested} / {summary.volunteersTotal}
          </dd>
          <dt>Sous le plancher de {index.rules.minHoursPerPerson} h</dt>
          <dd>{summary.volunteersBelowFloor}</dd>
          <dt>Sans aucune affectation</dt>
          <dd>{summary.volunteersUnassigned}</dd>
        </dl>
      </section>

      <section className="board-card">
        <h2>Recrutement</h2>
        {summary.overRecruited ? (
          <p className="alert is-bad">
            <strong>Sur-recrutement.</strong> Le planning n'offre pas assez d'heures pour{' '}
            {summary.volunteersTotal} personnes. Au-delà de {summary.volunteerCeiling} inscrits,
            quelqu'un passe forcément sous le plancher de {index.rules.minHoursPerPerson} h. C'est
            le moment de fermer les inscriptions et d'assumer une liste d'attente.
          </p>
        ) : (
          <p className="alert is-ok">
            {summary.volunteersTotal} inscrits pour un plafond de {summary.volunteerCeiling}. Il
            reste de la place pour {Math.max(0, summary.volunteerCeiling - summary.volunteersTotal)}{' '}
            personnes avant que quelqu'un ne passe sous {index.rules.minHoursPerPerson} h.
          </p>
        )}
        <dl className="kv">
          <dt>Heures nécessaires</dt>
          <dd>{fmtHours(summary.demandHours)}</dd>
          <dt>Heures proposées par les inscrits</dt>
          <dd>{fmtHours(summary.offeredHours)}</dd>
          <dt>Heures affectées</dt>
          <dd>{fmtHours(summary.assignedHours)}</dd>
        </dl>
      </section>

      <section className="board-card">
        <h2>Manques par tranche</h2>
        <dl className="kv">
          {summary.gapsBySlot.map((slot) => (
            <div key={slot.id} style={{ display: 'contents' }}>
              <dt>{slot.label}</dt>
              <dd className={slot.hours > 0 ? 'is-bad' : ''}>{fmtHours(slot.hours)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="board-card">
        <h2>Manques par pôle</h2>
        {summary.gapsByPole.length === 0 && <p className="board-empty">Aucun pôle en manque.</p>}
        <dl className="kv">
          {summary.gapsByPole.map((entry) => (
            <div key={entry.poleKey} style={{ display: 'contents' }}>
              <dt>{entry.path}</dt>
              <dd className="is-bad">{fmtHours(entry.gapHours)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="board-card">
        <h2>Hors de tous leurs choix ({summary.horsChoix.length})</h2>
        {summary.horsChoix.length === 0 && (
          <p className="board-empty">Personne. Chaque personne est sur un pôle de ses choix.</p>
        )}
        <ul className="people">
          {summary.horsChoix.map((entry) => (
            <li key={entry.volunteerKey}>
              <strong>{entry.name}</strong>
              <span className="people-meta">{entry.poles.join(', ')}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="board-card">
        <h2>
          Binômes: {summary.buddyHonoured} sur {summary.buddyRequests}
        </h2>
        {unhonoured.length === 0 && (
          <p className="board-empty">
            {summary.buddyRequests === 0
              ? 'Aucune demande de binôme.'
              : 'Toutes les demandes de binôme sont honorées.'}
          </p>
        )}
        <ul className="people">
          {unhonoured.map((pair, i) => (
            <li key={i}>
              <strong>{pair.from}</strong>
              <span className="people-meta">souhaitait être avec {pair.to}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="board-card">
        <h2>Liste d'attente ({reserve.length})</h2>
        <p className="board-note">
          Zéro heure, volontairement. Ce sont les personnes à qui il faudra dire qu'on n'a
          finalement pas eu besoin d'elles, et celles qu'on rappellera en premier.
        </p>
        <ul className="people">
          {reserve.map((v) => (
            <li key={v.key}>
              <strong>{v.name}</strong>
              <span className="people-meta">{volumeText(v.requestedHours, index.dayMode)} proposées</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="board-card">
        <h2>Artistes à ne pas manquer</h2>
        {artistAlerts.length === 0 && (
          <p className="board-empty">
            Personne n'est affecté pendant un set qu'il avait demandé à voir.
          </p>
        )}
        <ul className="people">
          {artistAlerts.map((artist) => (
            <li key={artist.key}>
              <strong>{artist.name}</strong>
              <span className="people-meta">
                {artist.window} · {artist.assignedDuring} affecté(s) sur {artist.namedBy} qui
                voulaient le voir, {fmtHours(artist.demandHours)} à couvrir
              </span>
            </li>
          ))}
        </ul>
      </section>

      {belowFloor.length > 0 && (
        <section className="board-card">
          <h2>Sous le plancher de {index.rules.minHoursPerPerson} h ({belowFloor.length})</h2>
          <p className="board-note">
            Trop peu d'heures pour que le déplacement en vaille la peine. Soit on leur en donne
            plus, soit on les met en liste d'attente et on le leur dit.
          </p>
          <ul className="people">
            {belowFloor.map((v) => (
              <li key={v.key}>
                <strong>{v.name}</strong>
                <span className="people-meta">
                  {fmtHours(v.assignedHours)} affectées sur {fmtHours(v.requestedTotalHours)} proposées
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PhaseCards />
    </div>
  );
}

/**
 * The montage and the démontage, in the two figures a régisseur asks for first: who is on site,
 * and what is short of hands.
 *
 * NOTHING IS RECOUNTED FROM THE GRID, the same rule as everywhere else on this screen: the
 * people are `phasePeople`, the shortfalls are `eventFills` and the conflicts are
 * `phaseClashes`, which are the very functions the grid draws from.
 *
 * A phase that is off shows nothing at all. There is no plan without one, and a card saying "0"
 * about a thing nobody has set up is noise on the screen that matters most on the night.
 */
function PhaseCards() {
  const { plan } = useLoadedPlan();
  const phases: Array<[PhaseId, Phase]> = [
    ['montage', plan.montage],
    ['demontage', plan.demontage],
  ];

  return (
    <>
      {phases
        .filter(([, phase]) => phase.enabled)
        .map(([id, phase]) => {
          const people = phasePeople(phase, plan.organisers, plan.volunteers);
          const orgas = people.filter((p) => p.kind === 'orga').length;
          const short = eventFills(phase).filter((fill) => fill.missing > 0);
          const wrong = phaseIssues(phase, plan.organisers, plan.volunteers);

          return (
            <section key={id} className="board-card">
              <h2>{phase.label || (id === 'montage' ? 'Montage' : 'Démontage')}</h2>
              <p className="board-note">
                {people.length} personne(s) sur place, dont {orgas} orga(s).{' '}
                {phase.volunteersAllowed
                  ? 'Les bénévoles y sont admis sur la fenêtre ouverte dans Réglages.'
                  : "Aucun bénévole n'y est admis."}
              </p>

              {short.length === 0 ? (
                <p className="board-note">
                  {phase.events.length === 0
                    ? "Aucun événement particulier n'est déclaré."
                    : 'Tous les événements ont leur monde.'}
                </p>
              ) : (
                <ul className="people">
                  {short.map(({ event, taken, missing }) => (
                    <li key={event.key}>
                      <strong>{event.label}</strong>
                      <span className="people-meta">
                        {toClock(phase.startISO, event.start)} → {toClock(phase.startISO, event.end)}
                        {' · '}
                        {taken} / {event.headcount}, il en manque {missing}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {wrong.length > 0 && (
                <p className="board-note">
                  {wrong.length} case(s) contredisent une réponse: quelqu'un placé un jour qu'il a
                  dit ne pas pouvoir, ou sur un autre pôle que celui de son formulaire. Rien n'a
                  été retiré, c'est à trancher sur la grille.
                </p>
              )}

              {orgas > 0 && (
                <p className="board-note">
                  Sur place:{' '}
                  {plan.organisers
                    .filter((o) =>
                      people.some((p) => p.kind === 'orga' && p.key === o.key),
                    )
                    .map(organiserName)
                    .join(', ')}
                  .
                </p>
              )}
            </section>
          );
        })}
    </>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`stat ${tone ? `is-${tone}` : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
