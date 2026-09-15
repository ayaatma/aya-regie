/**
 * What the solver would like to change, as decisions rather than as lines.
 *
 * Nothing here is ever applied silently. A re-solve produces a plan; the difference comes back
 * as proposals, each carrying the French sentence that says why, and the régisseur says yes or
 * no. What changed on 2026-09-07 is the unit of that yes.
 *
 * Line by line did not work. Two people trading shifts is two moves, and accepting either one
 * alone left a shift over its headcount until the other was found and accepted too, so the
 * régisseur ended up hunting through the rest of the batch for the line that cancels the
 * problem they had just created. The engine now cuts the batch into groups that stand on their
 * own, and says which groups each one needs taken first. Accepting a group takes its
 * prerequisites with it; refusing one refuses whatever was counting on it.
 *
 * Reserve decisions sit at the top because they are the only ones that mean telling somebody
 * they are not needed. The engine sorts them there; this screen does not reorder anything.
 */

import { useMemo, useState } from 'react';

import { validate, type ProposalGroup, type ProposalKind } from '../engine.ts';
import {
  applyGroups,
  describeAccepted,
  withDependents,
  withPrerequisites,
} from '../store/applyProposals.ts';
import { useLoadedPlan } from '../store/store.tsx';
import type { SolveOutcome } from '../solver/useSolver.ts';
import type { SolveMode } from '../solver/solver.worker.ts';

type Verdict = 'accepted' | 'rejected';

const KIND_LABEL: Record<ProposalKind, string> = {
  reserve: "Mise en liste d'attente",
  unreserve: "Rappel de la liste d'attente",
  move: 'Déplacement',
  remove: 'Retrait',
  add: 'Ajout',
};

/** The two kinds that mean telling somebody something, rather than tidying the grid. */
const HEAVY: ReadonlySet<ProposalKind> = new Set<ProposalKind>(['reserve', 'remove']);

export interface ProposalsScreenProps {
  outcome: SolveOutcome | null;
  running: boolean;
  error: string | null;
  onSolve(mode: SolveMode): void;
  onDismiss(): void;
  /** Where a run to stability has got to. Null for a single pass. */
  progress: { round: number; changed: boolean } | null;
  elapsedMs: number;
  mode: SolveMode | null;
}

export function ProposalsScreen({
  outcome,
  running,
  error,
  onSolve,
  onDismiss,
  progress,
  elapsedMs,
  mode,
}: ProposalsScreenProps) {
  const { index, apply, plan } = useLoadedPlan();
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});

  const groups = useMemo(() => outcome?.groups ?? [], [outcome]);

  const accepted = useMemo(
    () => groups.filter((g) => verdicts[g.id] === 'accepted'),
    [groups, verdicts],
  );
  const acceptedLines = useMemo(() => accepted.flatMap((g) => g.proposals), [accepted]);
  const undecided = groups.filter((g) => verdicts[g.id] === undefined).length;

  /**
   * What the accepted groups would actually produce, checked before anything is applied.
   *
   * Each group is built to be applicable on its own, so this should stay at zero. It runs
   * anyway, on every click, because it costs 4 ms and because a promise nobody verifies is a
   * promise that quietly stops being true.
   */
  const preview = useMemo(() => {
    if (accepted.length === 0) return null;
    const report = validate(applyGroups(plan, accepted));
    return {
      tier1: report.summary.tier1Count,
      messages: report.issues.filter((i) => i.tier === 1).map((i) => i.message),
    };
  }, [accepted, plan]);

  const shiftLabel = (key: string | null): string => {
    if (!key) return '';
    const shift = index.shiftByKey.get(key);
    return shift ? index.shiftLabel(shift) : key;
  };

  /**
   * Accepting pulls in what the group needs; refusing pushes out what needs the group.
   *
   * Neither is a convenience. A group applied without its prerequisites is exactly the
   * over-staffed shift this screen exists to stop producing, and a group kept after its
   * prerequisite is refused is the same thing seen from the other end.
   */
  const decide = (id: number, verdict: Verdict) => {
    setVerdicts((current) => {
      const next = { ...current };
      if (next[id] === verdict) {
        delete next[id];
        return next;
      }
      if (verdict === 'accepted') {
        for (const need of withPrerequisites(groups, [id])) next[need] = 'accepted';
      } else {
        for (const dependent of withDependents(groups, [id])) next[dependent] = 'rejected';
      }
      return next;
    });
  };

  const setAll = (verdict: Verdict) =>
    setVerdicts(Object.fromEntries(groups.map((g) => [g.id, verdict])));

  const onApply = () => {
    if (accepted.length === 0) return;
    apply(applyGroups(plan, accepted), `application de ${describeAccepted(acceptedLines)}`);
    setVerdicts({});
    onDismiss();
  };

  if (running) {
    return (
      <div className="centered">
        <div className="card">
          <h1>
            <span className="spinner" /> Calcul en cours
          </h1>
          {mode === 'converge' ? (
            <>
              <p>
                Chaque tour est une recherche complète. Le calcul s'arrête quand trois recherches
                d'affilée ne trouvent plus rien, ce qui prend de dix à soixante secondes selon
                l'événement. La grille reste consultable pendant ce temps.
              </p>
              <p className="panel-sub">
                {progress
                  ? `Tour ${progress.round}, ${(elapsedMs / 1000).toFixed(0)} s. ${
                      progress.changed
                        ? 'Le dernier tour a encore trouvé des améliorations.'
                        : "Le dernier tour n'a rien trouvé: la fin approche."
                    }`
                  : `Premier tour, ${(elapsedMs / 1000).toFixed(0)} s.`}
              </p>
            </>
          ) : (
            <p>
              Le solveur travaille dans un fil séparé, la grille reste consultable. Comptez environ
              deux secondes pour un événement de cette taille.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Le calcul a échoué</h1>
          <p>{error}</p>
          <button className="btn is-primary" onClick={() => onSolve('once')}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!outcome) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Aucune proposition en attente</h1>
          <p>
            Lancez un calcul pour voir ce que le solveur changerait. Les places verrouillées ne
            bougeront pas, et rien ne sera appliqué sans votre accord.
          </p>
          <button className="btn is-primary" onClick={() => onSolve('once')}>
            Recalculer
          </button>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Rien à changer</h1>
          <p>
            Le solveur n'a trouvé aucune amélioration à proposer sur ce planning, en{' '}
            {(outcome.elapsedMs / 1000).toFixed(1)} s et {outcome.iterations} itérations.
          </p>
          <button className="btn" onClick={onDismiss}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  const gain = outcome.initialScore - outcome.score;
  const byId = new Map(groups.map((g) => [g.id, g]));

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {groups.length} décision{groups.length > 1 ? 's' : ''}, {outcome.proposals.length}{' '}
            changement{outcome.proposals.length > 1 ? 's' : ''}
          </strong>
          <span className="toolbar-note">
            {(outcome.elapsedMs / 1000).toFixed(1)} s
            {outcome.rounds > 1 && `, ${outcome.rounds} tours`}, coût{' '}
            {Math.round(outcome.initialScore).toLocaleString('fr-FR')} →{' '}
            {Math.round(outcome.score).toLocaleString('fr-FR')}
            {gain > 0 ? ` (${Math.round(gain).toLocaleString('fr-FR')} de mieux)` : ''}
            {outcome.timedOut ? ' · arrêté sur le temps imparti' : ''}
            {outcome.rounds > 1 &&
              (outcome.converged
                ? ' · plus rien à proposer après ce lot'
                : ' · arrêté avant stabilité, un nouveau calcul trouvera encore')}
          </span>
          <div className="toolbar-sep" />
          <button className="btn" onClick={() => setAll('accepted')}>
            Tout accepter
          </button>
          <button className="btn" onClick={() => setAll('rejected')}>
            Tout rejeter
          </button>
          <button className="btn" onClick={() => setVerdicts({})}>
            Réinitialiser
          </button>
          <div className="toolbar-sep" />
          <button className="btn is-primary" onClick={onApply} disabled={accepted.length === 0}>
            Appliquer {acceptedLines.length > 0 ? describeAccepted(acceptedLines) : 'ce qui est accepté'}
          </button>
          <button className="btn" onClick={onDismiss}>
            Abandonner le lot
          </button>
          {undecided > 0 && (
            <span className="toolbar-note">
              {undecided} sans réponse, elles ne seront pas appliquées
            </span>
          )}
        </div>

        {preview && preview.tier1 > 0 && (
          <div className="banner is-error">
            <div>
              <strong>
                Cette sélection créerait {preview.tier1} affectation
                {preview.tier1 > 1 ? 's' : ''} illégale{preview.tier1 > 1 ? 's' : ''}.
              </strong>{' '}
              Chaque décision est pourtant censée tenir toute seule, donc c'est un défaut à
              signaler. Vous pouvez appliquer quand même, ce sera en rouge sur la grille.
              <ul className="preview-issues">
                {preview.messages.slice(0, 4).map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
                {preview.messages.length > 4 && (
                  <li>et {preview.messages.length - 4} autre(s).</li>
                )}
              </ul>
            </div>
          </div>
        )}

        <div className="proposal-list">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              verdict={verdicts[group.id]}
              requiredTitles={group.requires.map((id) => byId.get(id)?.title ?? `#${id}`)}
              shiftLabel={shiftLabel}
              onAccept={() => decide(group.id, 'accepted')}
              onReject={() => decide(group.id, 'rejected')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface GroupCardProps {
  group: ProposalGroup;
  verdict: Verdict | undefined;
  requiredTitles: string[];
  shiftLabel(key: string | null): string;
  onAccept(): void;
  onReject(): void;
}

function GroupCard({ group, verdict, requiredTitles, shiftLabel, onAccept, onReject }: GroupCardProps) {
  const heavy = HEAVY.has(group.kind);
  return (
    <div className={`proposal ${verdict ? `is-${verdict}` : ''} ${heavy ? 'is-heavy' : ''}`}>
      <span className={`proposal-kind ${heavy ? 'is-heavy' : ''}`}>{KIND_LABEL[group.kind]}</span>

      <div className="proposal-body">
        <div className="proposal-who">{group.title}</div>

        {requiredTitles.length > 0 && (
          <div className="proposal-requires">
            Nécessite d'abord: {requiredTitles.join(' · ')}
          </div>
        )}

        {group.proposals.map((proposal, i) => (
          <div key={i} className="proposal-line">
            <div className="proposal-where">
              <span className="proposal-line-kind">{KIND_LABEL[proposal.kind]}</span>
              {proposal.fromShiftKey && <span>{shiftLabel(proposal.fromShiftKey)}</span>}
              {proposal.fromShiftKey && proposal.toShiftKey && (
                <span className="proposal-arrow">→</span>
              )}
              {proposal.toShiftKey && <span>{shiftLabel(proposal.toShiftKey)}</span>}
            </div>
            <div className="proposal-why">{proposal.rationale}</div>
          </div>
        ))}
      </div>

      <div className="proposal-actions">
        <button
          className={`btn ${verdict === 'accepted' ? 'is-primary' : ''}`}
          onClick={onAccept}
          title={
            group.requires.length > 0
              ? 'Accepter, avec ce que cette décision nécessite'
              : 'Accepter cette décision'
          }
        >
          Accepter
        </button>
        <button
          className={`btn ${verdict === 'rejected' ? 'is-danger' : ''}`}
          onClick={onReject}
          title="Rejeter cette décision, et ce qui en dépend"
        >
          Rejeter
        </button>
      </div>
    </div>
  );
}
