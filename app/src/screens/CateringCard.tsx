/**
 * Les repas et les tickets boisson, as rules rather than as a headcount.
 *
 * WHAT BELONGS HERE AND WHAT DOES NOT. This card holds what the association decided: when the
 * meals are served, what a number of hours earns, and what an orga is due whatever they worked.
 * It holds nobody's name and no plate count. Who eats what is the Catering screen, and it is
 * worked out from these figures every time it is drawn.
 *
 * THE FIGURES ARE THE RÉGISSEUR'S, WHICH IS WHY THEY ARE A LIST AND NOT A FORMULA. "Travailler
 * 4h donne droit à 1 repas, 6h ou 8h donne droit à 2 repas" is a step function with two steps,
 * and the next event will have other steps. A formula would fit this year and be wrong the next,
 * with no way for anybody but a developer to say so.
 */

import { useState } from 'react';

import { fmtHours, mealsForHours } from '../engine.ts';
import { NumberField } from '../components/NumberField.tsx';
import {
  addService,
  addTier,
  deleteService,
  deleteTier,
  serviceRemovalCost,
  setCateringRules,
  setService,
  setTier,
} from '../store/cateringEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { PlainClockField } from '../components/ClockField.tsx';
import { SetupSection } from './SetupSection.tsx';

export function CateringCard() {
  const { plan, edit } = useLoadedPlan();
  const rules = plan.catering.rules;
  const [newService, setNewService] = useState('');

  /*
   * Drawn in hour order so they read as steps, but each row remembers WHERE IT SITS IN THE
   * STORED LIST. `setTier` and `deleteTier` address that list, and matching a row back to it by
   * its values would edit the wrong one the moment two tiers are identical, which is exactly the
   * kind of silent wrong edit this tool must not make.
   */
  const tiers = rules.exploitTiers
    .map((tier, index) => ({ tier, index }))
    .sort((a, b) => a.tier.fromHours - b.tier.fromHours);

  return (
    <SetupSection
      className="setup-catering"
      title="Repas et tickets boisson"
      meta={
        rules.enabled
          ? `${rules.services.length} service(s) par jour · ${plan.catering.choices.length} case(s) cochées à la main`
          : 'désactivé'
      }
    >

      <p className="panel-sub import-note">
        Ce que le traiteur a besoin de savoir: combien de personnes mangent à chaque service, et
        ce qu'elles ne peuvent pas manger. Les règles ci-dessous décident de qui a droit à quoi;
        l'écran Catering montre le résultat, personne par personne, et se coche à la main quand
        vous n'êtes pas d'accord.
      </p>

      <div className="rules-grid">
        <label className="rule">
          <span className="rule-label">Repas et boissons sur cet événement</span>
          <span className="rule-input">
            <input
              type="checkbox"
              name="catering-enabled"
              checked={rules.enabled}
              onChange={(event) =>
                edit(
                  (p) => setCateringRules(p, { enabled: event.target.checked }),
                  event.target.checked ? 'activation du catering' : 'catering désactivé',
                )
              }
            />
          </span>
          <span className="rule-hint">
            Tant que c'est décoché, rien n'est compté et l'écran Catering reste vide. Les règles
            ci-dessous sont conservées.
          </span>
        </label>
      </div>

      {rules.enabled && (
        <>
          <div className="setup-group-head">
            <span className="setup-group-title is-sub">Les services d'une journée</span>
            <span className="people-meta">
              heures de l'horloge, les mêmes tous les jours du montage, de l'exploit et du
              démontage
            </span>
          </div>

          <div className="setup-lineup">
            {rules.services.map((service) => (
              <ServiceRow key={service.key} serviceKey={service.key} />
            ))}

            <span className="setup-confirm">
              <input
                className="select"
                placeholder="Intitulé d'un service"
                name="new-service"
                autoComplete="off"
                value={newService}
                onChange={(event) => setNewService(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || newService.trim() === '') return;
                  edit((p) => addService(p, newService, 12, 14), `service ${newService.trim()}`);
                  setNewService('');
                }}
              />
              <button
                className="btn"
                disabled={newService.trim() === ''}
                onClick={() => {
                  edit((p) => addService(p, newService, 12, 14), `service ${newService.trim()}`);
                  setNewService('');
                }}
              >
                Ajouter un service
              </button>
            </span>
          </div>

          <div className="setup-group-head">
            <span className="setup-group-title is-sub">Droit aux repas pendant l'exploit</span>
            <span className="people-meta">
              au montage et au démontage, c'est la présence à l'heure du repas qui décide
            </span>
          </div>

          <div className="setup-lineup">
            {tiers.map(({ tier, index }) => (
              <div className="setup-organiser catering-tier" key={index}>
                <span className="rule-label">À partir de</span>
                <NumberField
                  value={tier.fromHours}
                  step={0.5}
                  ariaLabel="Heures travaillées à partir desquelles ce palier s'applique"
                  name={`tier-hours-${index}`}
                  onCommit={(value) =>
                    edit((p) => setTier(p, index, { fromHours: value ?? 0 }), 'palier de repas')
                  }
                />
                <span className="rule-label">h travaillées</span>
                <span className="clock-range-sep">→</span>
                <NumberField
                  value={tier.meals}
                  ariaLabel="Nombre de repas donnés par ce palier"
                  name={`tier-meals-${index}`}
                  onCommit={(value) =>
                    edit((p) => setTier(p, index, { meals: value ?? 0 }), 'palier de repas')
                  }
                />
                <span className="rule-label">repas</span>
                <button
                  className="btn is-icon is-danger"
                  title="Retirer ce palier"
                  onClick={() =>
                    edit((p) => deleteTier(p, index), 'retrait d\'un palier de repas')
                  }
                >
                  ✕
                </button>
              </div>
            ))}

            <span className="setup-confirm">
              <button className="btn" onClick={() => edit(addTier, 'palier de repas ajouté')}>
                Ajouter un palier
              </button>
              <span className="setup-confirm-text">
                {tiers.length === 0
                  ? 'Aucun palier: personne ne gagne de repas en travaillant.'
                  : summariseTiers(tiers.map((row) => row.tier))}
              </span>
            </span>
          </div>

          <div className="rules-grid">
            <label className="rule">
              <span className="rule-label">Un ticket boisson toutes les</span>
              <span className="rule-input">
                <NumberField
                  value={rules.drinkPerHours}
                  step={0.5}
                  ariaLabel="Heures travaillées par ticket boisson"
                  name="drink-per-hours"
                  onCommit={(value) =>
                    edit((p) => setCateringRules(p, { drinkPerHours: value ?? 0 }), 'tickets boisson')
                  }
                />
              </span>
              <span className="rule-hint">
                Heures travaillées. Chaque tranche entière donne un ticket: 4 h en donnent deux,
                5 h en donnent deux aussi. Mettre 0 pour ne pas en distribuer.
              </span>
            </label>

            <label className="rule">
              <span className="rule-label">Compter aussi le montage et le démontage</span>
              <span className="rule-input">
                <input
                  type="checkbox"
                  name="drink-counts-phases"
                  checked={rules.drinkCountsPhases}
                  onChange={(event) =>
                    edit(
                      (p) => setCateringRules(p, { drinkCountsPhases: event.target.checked }),
                      'tickets boisson',
                    )
                  }
                />
              </span>
              <span className="rule-hint">
                Décoché, seules les heures de l'exploit donnent des tickets.
              </span>
            </label>

            <label className="rule">
              <span className="rule-label">Repas garantis à un·e orga</span>
              <span className="rule-input">
                <NumberField
                  value={rules.organiserMeals}
                  ariaLabel="Repas garantis à une personne de l'organisation"
                  name="organiser-meals"
                  onCommit={(value) =>
                    edit((p) => setCateringRules(p, { organiserMeals: value ?? 0 }), 'repas des orgas')
                  }
                />
              </span>
              <span className="rule-hint">
                Un plancher, jamais un plafond: une personne de l'organisation y a droit même
                sans créneau pendant l'exploit, et garde davantage si les paliers lui en donnent
                davantage.
              </span>
            </label>

            <label className="rule">
              <span className="rule-label">Tickets boisson garantis à un·e orga</span>
              <span className="rule-input">
                <NumberField
                  value={rules.organiserDrinks}
                  ariaLabel="Tickets boisson garantis à une personne de l'organisation"
                  name="organiser-drinks"
                  onCommit={(value) =>
                    edit((p) => setCateringRules(p, { organiserDrinks: value ?? 0 }), 'boissons des orgas')
                  }
                />
              </span>
              <span className="rule-hint">Même principe: un plancher.</span>
            </label>

            <label className="rule">
              <span className="rule-label">Tickets boisson remis à chaque artiste</span>
              <span className="rule-input">
                <NumberField
                  value={rules.artistDrinks}
                  ariaLabel="Tickets boisson remis à chaque membre d'un groupe"
                  name="artist-drinks"
                  onCommit={(value) =>
                    edit((p) => setCateringRules(p, { artistDrinks: value ?? 0 }), 'boissons des artistes')
                  }
                />
              </span>
              <span className="rule-hint">
                Pour chaque membre d'un groupe, quelles que soient ses heures. Changer ce chiffre
                met à jour tous les membres, sauf ceux à qui un nombre a été fixé à la main dans
                l'onglet Artistes.
              </span>
            </label>

            <label className="rule">
              <span className="rule-label">Artiste et aussi bénévole ou orga</span>
              <span className="rule-input">
                <input
                  type="checkbox"
                  name="artist-drinks-cumulative"
                  checked={rules.artistDrinksCumulative}
                  onChange={(event) =>
                    edit(
                      (p) => setCateringRules(p, { artistDrinksCumulative: event.target.checked }),
                      'cumul des tickets boisson',
                    )
                  }
                />
                <span>Les tickets boisson se cumulent</span>
              </span>
              <span className="rule-hint">
                Une personne qui joue dans un groupe et tient aussi un pôle a une seule ligne au
                catering et ne mange jamais deux fois. Pour les tickets, décoché: on garde le plus
                élevé de ses deux statuts; coché: on additionne les deux.
              </span>
            </label>
          </div>
        </>
      )}
    </SetupSection>
  );
}

/** "4 h → 1 repas, 6 h → 2 repas", the rule read back in one line. */
function summariseTiers(tiers: readonly { fromHours: number; meals: number }[]): string {
  const spoken = tiers.map((t) => `${fmtHours(t.fromHours)} → ${t.meals} repas`).join(', ');
  const eight = mealsForHours(8, tiers);
  return `${spoken}. Une personne à 8 h a droit à ${eight} repas.`;
}

function ServiceRow({ serviceKey }: { serviceKey: string }) {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const service = plan.catering.rules.services.find((s) => s.key === serviceKey);
  if (!service) return null;

  const ticked = serviceRemovalCost(plan, service.key);
  const overnight = service.toHour <= service.fromHour;

  return (
    <div className="setup-organiser">
      <input
        className="setup-name"
        name={`service-label-${service.key}`}
        autoComplete="off"
        value={service.label}
        aria-label="Intitulé du service"
        onChange={(event) =>
          edit(
            (p) => setService(p, service.key, { label: event.target.value }),
            `service ${service.label}`,
          )
        }
      />

      <span className="clock-range">
        <PlainClockField
          value={service.fromHour}
          ariaLabel={`Début du service ${service.label}`}
          name={`service-from-${service.key}`}
          hint="Heure de l'horloge, la même tous les jours."
          onChange={(value) =>
            edit((p) => setService(p, service.key, { fromHour: value }), `horaires de ${service.label}`)
          }
        />
        <span className="clock-range-sep">→</span>
        <PlainClockField
          value={service.toHour}
          ariaLabel={`Fin du service ${service.label}`}
          name={`service-to-${service.key}`}
          hint="Une fin avant le début veut dire que le service passe minuit."
          onChange={(value) =>
            edit((p) => setService(p, service.key, { toHour: value }), `horaires de ${service.label}`)
          }
        />
        <span className="rule-suffix">{overnight ? 'passe minuit' : ''}</span>
      </span>

      {/*
        What the régisseur decided by hand about this service on the Catering tab: every box
        ticked or unticked against what the tool worked out. Reworded 2026-09-13 after "aucune
        case cochée à la main · id midi" was reported as unreadable; the key is not shown any
        more, nothing on screen needs it.
      */}
      <span className="people-meta">
        {ticked > 0
          ? `${ticked} repas décidé${ticked > 1 ? 's' : ''} à la main sur ce service dans l'onglet Catering`
          : "aucun repas décidé à la main sur ce service dans l'onglet Catering"}
      </span>

      {armed ? (
        <span className="setup-confirm">
          <span className="setup-confirm-text">
            {ticked > 0
              ? `${ticked} repas décidé${ticked > 1 ? 's' : ''} à la main sur ce service dans l'onglet Catering seront perdus: ils ne désignent plus rien une fois le service retiré.`
              : "Aucun repas décidé à la main sur ce service: rien n'est perdu."}
          </span>
          <button
            className="btn is-danger"
            onClick={() =>
              edit((p) => deleteService(p, service.key), `retrait du service ${service.label}`)
            }
          >
            Retirer
          </button>
          <button className="btn" onClick={() => setArmed(false)}>
            Annuler
          </button>
        </span>
      ) : (
        <button
          className="btn is-icon is-danger"
          title={`Retirer le service ${service.label}`}
          onClick={() => setArmed(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}
