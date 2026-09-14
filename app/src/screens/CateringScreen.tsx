/**
 * Le catering: combien de personnes mangent chaque jour, et ce qu'elles ne peuvent pas manger.
 *
 * TWO READERS, ONE SCREEN. The caterer wants a plate count per service and the list of what is
 * not the standard plate; the régisseur wants to see who the tool has put in that count and to
 * disagree with it person by person. So the totals are at the top, the people are below, and the
 * checkbox in between is the only thing on this screen that writes anything.
 *
 * NOTHING HERE COUNTS ANYTHING ITSELF. Every figure comes from `cateringReport`, exactly as the
 * dashboard reads `PlanSummary`: a plate recounted in a screen is a plate that will one day
 * disagree with the file the caterer was sent.
 *
 * A TICKED BOX IS A DECISION AND IT SHOWS. A box the tool worked out and a box a human insisted
 * on look different, because the second survives a re-solve, a moved créneau and a changed rule,
 * and the régisseur is entitled to see which of their decisions are still standing. « Suivre le
 * planning » on a row gives those boxes back to the tool.
 *
 * THE SHELL IS `.screen is-wide` OVER `.screen-main` OVER ONE SCROLLING BODY, and that is not
 * decoration. `.screen-main` is a two-row grid, a toolbar and a body; this screen handed it five
 * children until 2026-09-12, so every row past the second was sized `auto` and ran off the bottom
 * of the window with nothing to scroll. The wide shell is also what gives the people table the
 * whole width, instead of a table scrolling inside 900 px with a third of the screen empty beside
 * it.
 */

import { useState } from 'react';

import {
  cateringCsv,
  cateringReport,
  defaultMealChoices,
  fmtHours,
  isNoAllergy,
  type CateringPerson,
  type MealService,
} from '../engine.ts';
import { clearMeals, setMeal } from '../store/cateringEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { downloadText, fileSlug, today } from '../components/download.ts';
import { PersonMark } from '../components/PersonMark.tsx';

type Filter = 'tous' | 'mangent' | 'main';

export function CateringScreen({ onGoToSetup }: { onGoToSetup(): void }) {
  const { plan, index, edit } = useLoadedPlan();
  const [filter, setFilter] = useState<Filter>('mangent');

  if (!plan.catering.rules.enabled) {
    return (
      <div className="screen is-wide">
        <div className="screen-main">
          <div className="screen-body">
            <div className="card">
              <h1>Repas et tickets boisson</h1>
              <p>
                Le catering n'est pas activé sur cet événement. Les règles se trouvent dans
                Réglages: les services d'une journée, ce à quoi les heures travaillées donnent
                droit, et ce qui est garanti aux orgas.
              </p>
              <div className="card-actions">
                <button className="btn is-primary" onClick={onGoToSetup}>
                  Ouvrir les Réglages
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const report = cateringReport(plan, index);
  const { services } = report;

  const people = report.people.filter((person) => {
    if (filter === 'mangent') return person.serviceKeys.length > 0 || person.drinks > 0;
    if (filter === 'main') return person.handPicked.length > 0;
    return true;
  });

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {report.meals} repas
          </strong>
          <span className="toolbar-sep" />
          <span className="toolbar-note">
            Rempli sur les services les plus proches des créneaux. Une case changée à la main
            reste en vert. Les tickets boisson sont dans la Billetterie.
          </span>
          <span className="toolbar-sep" />
          <button
            className="btn"
            onClick={() =>
              downloadText(`${fileSlug(plan.name)}-catering-${today()}.csv`, cateringCsv(plan, index))
            }
          >
            Exporter pour le traiteur
          </button>
        </div>

        <div className="screen-body">
          {services.length === 0 ? (
            <div className="card">
              <h1>Aucun service</h1>
              <p>
                Aucun repas ne tombe sur les jours de l'événement. Vérifiez les horaires des
                services dans Réglages, ainsi que les dates du montage et du démontage.
              </p>
            </div>
          ) : (
            <>
              {/*
                The two summary cards sit side by side while there is room and stack when there is
                not: neither is long, and stacking them always pushed the table everybody actually
                works in below the fold.
              */}
              <div className="catering-summary">
                <section className="screen-card">
                  <div className="setup-group-head">
                    <span className="setup-group-title">Ce qu'il faut préparer</span>
                    <span className="people-meta">un service par ligne, dans l'ordre des jours</span>
                  </div>

                  <div className="screen-scroll">
                    <table className="setup-table catering-table">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Couverts</th>
                          <th>Dont régimes particuliers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.fills.map((fill) => (
                          <tr key={fill.service.key}>
                            <td>
                              <strong>{fill.service.dayLabel}</strong>{' '}
                              {fill.service.windowLabel.toLowerCase()}
                              <span className="people-meta"> · {momentsOf(fill.service)}</span>
                            </td>
                            <td className="catering-count">{fill.total}</td>
                            <td>
                              {fill.byDiet.length === 0 ? (
                                <span className="people-meta">aucun</span>
                              ) : (
                                fill.byDiet.map((diet) => (
                                  <span className="chip is-warn" key={diet.label}>
                                    {diet.count} × {diet.label}
                                  </span>
                                ))
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="screen-card">
                  <div className="setup-group-head">
                    <span className="setup-group-title">Régimes et allergies</span>
                    <span className="people-meta">
                      seulement les personnes qui mangent au moins une fois
                    </span>
                  </div>

                  <div className="catering-diets">
                    <div>
                      <span className="panel-section-title">Régimes particuliers</span>
                      {report.diets.length === 0 ? (
                        <p className="panel-sub">Personne n'a déclaré de régime particulier.</p>
                      ) : (
                        <ul className="people">
                          {report.diets.map((diet) => (
                            <li key={diet.label}>
                              <strong>{diet.label}</strong>
                              <span className="people-meta">
                                {' '}
                                {diet.names.length} · {diet.names.join(', ')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <span className="panel-section-title">Allergies</span>
                      {report.allergies.length === 0 ? (
                        <p className="panel-sub">Aucune allergie déclarée.</p>
                      ) : (
                        <ul className="people">
                          {report.allergies.map((row) => (
                            <li key={`${row.name}-${row.text}`}>
                              <strong>{row.name}</strong>
                              <span className="people-meta"> {row.text}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <section className="screen-card">
                <div className="setup-group-head">
                  <span className="setup-group-title">Qui mange quoi</span>
                  <span className="panel-tabs is-single">
                    {(['mangent', 'tous', 'main'] as const).map((tab) => (
                      <button
                        key={tab}
                        className="panel-tab"
                        aria-current={filter === tab}
                        onClick={() => setFilter(tab)}
                      >
                        {tab === 'mangent'
                          ? 'Ont droit à quelque chose'
                          : tab === 'tous'
                            ? 'Tout le monde'
                            : 'Modifiés à la main'}
                      </button>
                    ))}
                  </span>
                  <span className="people-meta">
                    {people.length} personne{people.length > 1 ? 's' : ''}
                  </span>
                </div>

                <div className="screen-scroll">
                  <table className="setup-table catering-table">
                    <thead>
                      <tr>
                        <th>Personne</th>
                        <th>Heures</th>
                        {services.map((service) => (
                          <th key={service.key} className="catering-box" title={service.label}>
                            {service.dayLabel}
                            <br />
                            {service.windowLabel.toLowerCase()}
                          </th>
                        ))}
                        <th>Droits</th>
                        <th>Régime, allergies</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {people.map((person) => {
                        const computed = defaultMealChoices(
                          plan,
                          index,
                          services,
                          person.kind,
                          person.key,
                        );
                        return (
                          <tr key={`${person.kind}|${person.key}`}>
                            <td className="catering-who">
                              <PersonMark kind={person.kind} /> {person.name}
                              {person.group !== '' && (
                                <span className="people-meta"> · {person.group}</span>
                              )}
                            </td>
                            <td className="people-meta">{hoursLine(person)}</td>

                            {services.map((service) => {
                              const takes = person.serviceKeys.includes(service.key);
                              const byHand = person.handPicked.includes(service.key);
                              return (
                                <td key={service.key} className="catering-box">
                                  <input
                                    type="checkbox"
                                    checked={takes}
                                    className={byHand ? 'is-manual' : undefined}
                                    aria-label={`${person.name}, ${service.label}`}
                                    title={
                                      byHand
                                        ? 'Choisi à la main: ce choix tient même après un nouveau calcul.'
                                        : "Rempli d'après les heures travaillées."
                                    }
                                    onChange={(event) =>
                                      edit(
                                        (p) =>
                                          setMeal(
                                            p,
                                            person.kind,
                                            person.key,
                                            service.key,
                                            event.target.checked,
                                            computed.has(service.key),
                                          ),
                                        `repas de ${person.name}`,
                                      )
                                    }
                                  />
                                </td>
                              );
                            })}

                            <td
                              className={
                                person.serviceKeys.length < person.exploitMeals
                                  ? 'is-bad'
                                  : undefined
                              }
                            >
                              {person.kind === 'artiste'
                                ? 'selon la présence du groupe'
                                : `${person.exploitMeals} sur l'exploit`}
                            </td>
                            <td>
                              {person.diet.trim() !== '' && (
                                <span className="chip is-warn">{person.diet.trim()}</span>
                              )}
                              {!isNoAllergy(person.allergies) && (
                                <span className="chip is-bad">{person.allergies.trim()}</span>
                              )}
                            </td>
                            <td>
                              {person.handPicked.length > 0 && (
                                <button
                                  className="btn is-icon"
                                  title="Rendre ces cases au planning: elles suivront de nouveau les heures travaillées."
                                  onClick={() =>
                                    edit(
                                      (p) => clearMeals(p, person.kind, person.key),
                                      `repas de ${person.name} rendus au planning`,
                                    )
                                  }
                                >
                                  ↺
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {people.length === 0 && (
                  <p className="panel-sub catering-empty">
                    {filter === 'main'
                      ? "Aucune case n'a été modifiée à la main."
                      : "Personne n'a encore droit à un repas: les heures ne sont pas réparties."}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Montage, Exploit": which of the three moments a service falls across. */
const momentsOf = (service: MealService): string =>
  (Object.keys(service.inMoment) as Array<keyof typeof service.inMoment>)
    .map((id) => (id === 'exploit' ? 'exploit' : id === 'montage' ? 'montage' : 'démontage'))
    .join(', ');

/** "4h exploit · 8h montage", the hours behind the boxes on this row. */
function hoursLine(person: CateringPerson): string {
  const parts: string[] = [];
  if (person.hours.montage > 0) parts.push(`${fmtHours(person.hours.montage)} montage`);
  if (person.hours.exploit > 0) parts.push(`${fmtHours(person.hours.exploit)} exploit`);
  if (person.hours.demontage > 0) parts.push(`${fmtHours(person.hours.demontage)} démontage`);
  return parts.length === 0 ? 'aucune heure' : parts.join(' · ');
}
