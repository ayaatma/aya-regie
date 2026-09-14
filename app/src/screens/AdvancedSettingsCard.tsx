/**
 * Réglages avancés: for this event, which rule blocks, which one costs, and how much.
 *
 * The régisseur's request of 2026-09-13: "décider par événement si tel ou tel spécificité doit
 * être prise comme un poids ou un caractère bloquant. Si c'est un poids, quel poids y est
 * attribué." Every row is a `CriterionDefinition` from the engine, so the card cannot offer a
 * mode the engine would refuse, and a criterion added to the engine appears here without a line
 * of this file changing.
 *
 * THE FOUR THRESHOLDS LIVE ON THEIR CRITERION'S ROW. "Règles de planning" was a card of its own
 * until this date, holding the 4 h, the 2 blocks, the 2 h of break and the 4 h floor. A threshold
 * and whether it blocks are one decision ("plus de 4 h d'affilée, bloquant"), and two cards would
 * have had the régisseur set the half of it in one place and the other half in another.
 *
 * A WEIGHT IS READ AGAINST ONE REFERENCE, and each hourly row says which side of it it sits: an
 * hour of a place left empty. Above, the solver leaves the place empty rather than do it; below,
 * it does it whenever that fills a place. That is the only reading of a weight a régisseur needs,
 * and the one the absolute numbers hide.
 *
 * WHAT THE RÉGISSEUR CHANGED IS GREEN, the billetterie's convention for a figure set by hand.
 */

import { useState } from 'react';

import {
  ALWAYS_BLOCKING,
  CONSTRAINT_MODE_LABEL,
  CRITERIA,
  CRITERION_GROUP_LABEL,
  DEFAULT_RULES,
  resolveConstraints,
  type CriterionDefinition,
  type CriterionGroup,
  type CriterionParameter,
  type Plan,
} from '../engine.ts';
import {
  changedCriteria,
  isDefaultCard,
  resetAdvancedSettings,
  resetCriterion,
  setCriterion,
  setLongDay,
} from '../store/constraintEdits.ts';
import { setRules } from '../store/setupEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { NumberField } from '../components/NumberField.tsx';
import { SetupSection } from './SetupSection.tsx';

const GROUPS = Object.keys(CRITERION_GROUP_LABEL) as CriterionGroup[];

const PARAMETER: Record<CriterionParameter, { label: string; suffix: string; step: number; min: number }> = {
  maxConsecutiveHours: { label: 'Au-delà de', suffix: "h d'affilée", step: 0.5, min: 0.5 },
  maxBlocks: { label: 'Au-delà de', suffix: 'bloc(s)', step: 1, min: 1 },
  minBreakHours: { label: 'Pause minimale', suffix: 'h', step: 0.5, min: 0 },
  minHoursPerPerson: { label: 'Plancher', suffix: 'h par personne', step: 0.5, min: 0 },
};

export function AdvancedSettingsCard() {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const resolved = resolveConstraints(plan.constraints);
  const blocking = CRITERIA.filter((c) => resolved[c.id].mode === 'block').length;
  const changed = changedCriteria(plan);

  return (
    <SetupSection
      className="setup-advanced"
      title="Réglages avancés"
      meta={`${blocking} critère(s) bloquant(s) · ${changed === 0 ? 'valeurs par défaut' : `${changed} critère(s) modifié(s)`}`}
    >
      <div className="advanced-intro">
        <p className="people-meta">
          Pour chaque situation, ce que le planning en fait sur cet événement.{' '}
          <strong>Bloquant</strong>: le solveur ne la propose jamais, la case est grisée au
          glisser-déposer, et une case posée à la main passe en rouge.{' '}
          <strong>Poids</strong>: permise, mais elle coûte ce poids au solveur, qui l'évite
          d'autant plus que le poids est élevé; elle reste signalée.{' '}
          <strong>Ignoré</strong>: ni coût ni signalement.
        </p>
        <p className="people-meta">
          Repère: une heure de place non pourvue coûte {resolved.staffing.weight}. Rien n'est
          recalculé en changeant un réglage: ce qui ne va plus passe en rouge, et le prochain
          calcul propose les déplacements, un par un.
        </p>
        <div className="advanced-reset">
          {armed ? (
            <span className="setup-confirm">
              <span className="people-meta">
                Tous les critères, seuils et repères de cette carte reviennent aux valeurs d'un nouvel événement.
              </span>
              <button
                className="btn is-danger"
                onClick={() => {
                  edit(resetAdvancedSettings, 'réglages avancés rétablis par défaut');
                  setArmed(false);
                }}
              >
                Rétablir
              </button>
              <button className="btn" onClick={() => setArmed(false)}>Annuler</button>
            </span>
          ) : (
            <button className="btn" disabled={isDefaultCard(plan)} onClick={() => setArmed(true)}>
              Tout rétablir par défaut
            </button>
          )}
        </div>
      </div>

      {GROUPS.map((group) => (
        <div key={group} className="advanced-group">
          <span className="panel-section-title">{CRITERION_GROUP_LABEL[group]}</span>
          {CRITERIA.filter((c) => c.group === group).map((def) => (
            <CriterionRow key={def.id} def={def} plan={plan} staffing={resolved.staffing.weight} />
          ))}
        </div>
      ))}

      <div className="advanced-group">
        <span className="panel-section-title">Repères d'affichage</span>
        <div className="advanced-row">
          <div className="advanced-what">
            <span className="rule-label">Journée longue</span>
            <span className="rule-hint">
              Où la grille dessine 💪 puis 💪💪 sur les cases d'une personne. Ce n'est pas une
              règle: rien n'est refusé ni coûté.
            </span>
          </div>
          <div className="advanced-param">
            <span className="rule-input">
              <span className="rule-suffix">💪 dès</span>
              <NumberField
                value={plan.constraints.longDayHours}
                step={0.5}
                min={0.5}
                name="long-day-hours"
                ariaLabel="Heures à partir desquelles une journée est longue"
                onCommit={(value) => value !== null && edit((p) => setLongDay(p, { longDayHours: value }), 'journée longue')}
              />
              <span className="rule-suffix">h, 💪💪 dès</span>
              <NumberField
                value={plan.constraints.veryLongDayHours}
                step={0.5}
                min={0.5}
                name="very-long-day-hours"
                ariaLabel="Heures à partir desquelles une journée est très longue"
                onCommit={(value) => value !== null && edit((p) => setLongDay(p, { veryLongDayHours: value }), 'journée très longue')}
              />
              <span className="rule-suffix">h</span>
            </span>
          </div>
        </div>
      </div>

      <div className="advanced-group">
        <span className="panel-section-title">Toujours bloquant</span>
        <p className="people-meta advanced-always">
          Quel que soit l'événement: {ALWAYS_BLOCKING.map((rule) => rule.replace(/\.$/, '').toLowerCase()).join(', ')}.
        </p>
      </div>
    </SetupSection>
  );
}

function CriterionRow({ def, plan, staffing }: { def: CriterionDefinition; plan: Plan; staffing: number }) {
  const { edit } = useLoadedPlan();
  const override = plan.constraints.criteria[def.id];
  const resolved = resolveConstraints(plan.constraints)[def.id];
  const modeChanged = override?.mode !== undefined;
  const weightChanged = override?.weight !== undefined;
  const base = def.parameter ? PARAMETER[def.parameter] : null;
  // On an event counted per day the floor and the block count are per day; say so on the row.
  const perDay = plan.volume.scope === 'day' && (def.parameter === 'minHoursPerPerson' || def.parameter === 'maxBlocks');
  const parameter = base && perDay ? { ...base, suffix: `${base.suffix} par jour` } : base;
  const inert = def.id === 'notChoice1' && plan.poleChoicesRanked === false;
  const parameterValue = def.parameter ? plan.rules[def.parameter] : null;
  const parameterChanged = def.parameter ? plan.rules[def.parameter] !== DEFAULT_RULES[def.parameter] : false;

  // Which side of an empty hour this weight sits, for the rows priced by the hour. Not for the
  // reference itself, nor for the overflow, which is priced by the hour AND the distance.
  const comparable = resolved.mode === 'weight' && def.id !== 'staffing' && def.unit.startsWith('par heure') && !def.unit.includes('×');
  const side = !comparable ? null
    : resolved.weight >= staffing ? "plus cher qu'une heure de place vide"
    : "moins cher qu'une heure de place vide";

  return (
    <div className={`advanced-row${modeChanged || weightChanged || parameterChanged ? ' is-changed' : ''}`}>
      <div className="advanced-what">
        <span className="rule-label">{def.label}</span>
        <span className="rule-hint">{def.hint}</span>
        {inert && (
          <span className="rule-hint is-warn">
            Sans effet sur cet événement: les choix de pôles y sont à égalité (L'événement).
          </span>
        )}
      </div>

      <div className="advanced-param">
        {parameter && parameterValue !== null && (
          <span className={`rule-input${parameterChanged ? ' is-by-hand' : ''}`}>
            <span className="rule-suffix">{parameter.label}</span>
            <NumberField
              value={parameterValue}
              step={parameter.step}
              min={parameter.min}
              name={`param-${def.id}`}
              ariaLabel={`${def.label}: seuil`}
              onCommit={(value) =>
                value !== null && edit((p) => setRules(p, { [def.parameter!]: value }), `seuil ${def.label.toLowerCase()}`)
              }
            />
            <span className="rule-suffix">{parameter.suffix}</span>
          </span>
        )}
      </div>

      {def.modes.length === 1 ? (
        <span className="rule-suffix advanced-mode-fixed">Toujours un poids</span>
      ) : (
      <div className="advanced-mode" role="radiogroup" aria-label={`${def.label}: mode`}>
        {def.modes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={resolved.mode === mode}
              className={`mode-choice is-${mode}${resolved.mode === mode ? ' is-on' : ''}${resolved.mode === mode && modeChanged ? ' is-by-hand' : ''}`}
              onClick={() => edit((p) => setCriterion(p, def.id, { mode }), `${def.label.toLowerCase()}: ${CONSTRAINT_MODE_LABEL[mode].toLowerCase()}`)}
            >
              {CONSTRAINT_MODE_LABEL[mode]}
            </button>
        ))}
      </div>
      )}

      <div className={`advanced-weight${resolved.mode === 'weight' ? '' : ' is-inactive'}`}>
        {resolved.mode === 'weight' ? (
          <>
            <span className={`rule-input${weightChanged ? ' is-by-hand' : ''}`}>
              <NumberField
                value={resolved.weight}
                step={def.defaultWeight >= 100 ? 50 : 1}
                name={`weight-${def.id}`}
                ariaLabel={`${def.label}: poids`}
                onCommit={(value) =>
                  value !== null && edit((p) => setCriterion(p, def.id, { weight: value }), `poids ${def.label.toLowerCase()}`)
                }
              />
              <span className="rule-suffix">{def.unit}</span>
            </span>
            <span className="rule-hint">
              {weightChanged ? `par défaut ${def.defaultWeight}` : 'valeur par défaut'}
              {side ? ` · ${side}` : ''}
            </span>
          </>
        ) : (
          <span className="rule-hint">
            {resolved.mode === 'block' ? 'Pas de poids: jamais proposé.' : 'Pas de poids: sans effet.'}
          </span>
        )}
      </div>

      <div className="advanced-undo">
        {(modeChanged || weightChanged) && (
          <button
            type="button"
            className="btn is-icon"
            title={`Revenir au défaut: ${CONSTRAINT_MODE_LABEL[def.defaultMode].toLowerCase()}${def.defaultMode === 'weight' ? `, ${def.defaultWeight}` : ''}`}
            aria-label={`Rétablir ${def.label} par défaut`}
            onClick={() => edit((p) => resetCriterion(p, def.id), `${def.label.toLowerCase()} par défaut`)}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  );
}
