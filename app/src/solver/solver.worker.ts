/// <reference lib="webworker" />

/**
 * The solver, off the main thread.
 *
 * A full run is 3000 iterations and about two seconds on the real event size, which is far too
 * long to hold the grid. The worker exists for that reason alone: the régisseur keeps scrolling
 * and reading while the search runs, and gets a spinner with a real elapsed time rather than a
 * frozen page. Running to convergence is a dozen of those, so it needs the worker even more.
 *
 * The worker never applies anything. It returns the proposed plan, the difference as
 * `Proposal[]`, and that difference cut into `ProposalGroup[]`: decisions that stand on their
 * own, which is the unit the régisseur accepts or refuses. Nothing the solver decides reaches
 * the plan without somebody saying yes.
 */

import {
  buildProposals,
  groupProposals,
  solve,
  solveToConvergence,
  type Plan,
  type Proposal,
  type ProposalGroup,
  type SolveOptions,
} from '../engine.ts';

/**
 * `once` is a single round; `converge` runs rounds until nothing more is proposed.
 *
 * Both come back as one batch, measured against the plan the request started from, because the
 * régisseur reviews the total difference rather than a dozen intermediate ones. Locked places
 * are untouched either way: `solve` refuses every mutation on one, so running it twelve times
 * cannot erode a guarantee it never relaxes once.
 */
export type SolveMode = 'once' | 'converge';

export interface SolveRequest {
  requestId: number;
  plan: Plan;
  mode: SolveMode;
  options: SolveOptions;
}

/** The three shapes a worker message can take, told apart by `kind`. */
export interface SolveResponse {
  requestId: number;
  kind: 'done';
  /** The plan the solver would like to move to. Never applied as is. */
  after: Plan;
  proposals: Proposal[];
  groups: ProposalGroup[];
  score: number;
  initialScore: number;
  iterations: number;
  elapsedMs: number;
  timedOut: boolean;
  /** Rounds run. Always 1 for a single pass. */
  rounds: number;
  /** False when a convergence stopped on its round cap or time budget instead of settling. */
  converged: boolean;
}

/**
 * Sent after each round of a convergence, so a run of twenty is not a frozen page.
 *
 * A single pass takes about two seconds and needs no commentary. Running to stability takes ten
 * to sixty, and a spinner with no numbers on it for a minute reads as a hang.
 */
export interface SolveProgress {
  requestId: number;
  kind: 'progress';
  round: number;
  /** False once the searches start coming back empty, which is how the end looks approaching. */
  changed: boolean;
  elapsedMs: number;
}

export interface SolveFailure {
  requestId: number;
  kind: 'failed';
  message: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SolveRequest>) => {
  const { requestId, plan, mode, options } = event.data;
  try {
    const run =
      mode === 'converge'
        ? (() => {
            const outcome = solveToConvergence(plan, {
              ...options,
              onRound: ({ round, changed, elapsedMs }) => {
                const progress: SolveProgress = {
                  requestId,
                  kind: 'progress',
                  round,
                  changed,
                  elapsedMs,
                };
                scope.postMessage(progress);
              },
            });
            return {
              after: outcome.plan,
              dropped: outcome.dropped,
              score: outcome.score,
              initialScore: outcome.initialScore,
              elapsedMs: outcome.elapsedMs,
              timedOut: false,
              rounds: outcome.rounds,
              converged: outcome.converged,
            };
          })()
        : (() => {
            const outcome = solve(plan, options);
            return {
              after: outcome.plan,
              dropped: outcome.dropped,
              score: outcome.score,
              initialScore: outcome.initialScore,
              elapsedMs: outcome.elapsedMs,
              timedOut: outcome.timedOut,
              rounds: 1,
              converged: false,
            };
          })();

    const proposals = buildProposals(plan, run.after, run.dropped);
    const response: SolveResponse = {
      requestId,
      kind: 'done',
      after: run.after,
      proposals,
      groups: groupProposals(plan, proposals),
      score: run.score,
      initialScore: run.initialScore,
      iterations: options.iterations ?? 3000,
      elapsedMs: run.elapsedMs,
      timedOut: run.timedOut,
      rounds: run.rounds,
      converged: run.converged,
    };
    scope.postMessage(response);
  } catch (error: unknown) {
    const failure: SolveFailure = {
      requestId,
      kind: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(failure);
  }
};
