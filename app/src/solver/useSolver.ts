/**
 * Driving the solver worker from a screen.
 *
 * One worker for the whole session, created on first use. A run in flight is superseded rather
 * than queued: only the newest request's answer is kept, because a régisseur who presses
 * "Recalculer" twice wants the second result, not both.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Plan, Proposal, ProposalGroup, SolveOptions } from '../engine.ts';
import type {
  SolveFailure,
  SolveMode,
  SolveProgress,
  SolveRequest,
  SolveResponse,
} from './solver.worker.ts';

export interface SolveOutcome {
  /** The plan the solver proposes. Held aside until the proposals are accepted. */
  after: Plan;
  proposals: Proposal[];
  /** The same lines, cut into decisions the régisseur can take one at a time. */
  groups: ProposalGroup[];
  score: number;
  initialScore: number;
  iterations: number;
  elapsedMs: number;
  timedOut: boolean;
  /** Rounds run. Always 1 for a single pass. */
  rounds: number;
  /** False when a convergence stopped on its cap rather than settling. */
  converged: boolean;
}

export interface SolverHandle {
  running: boolean;
  /** Which kind of run is in flight, so the two buttons can show their own spinner. */
  mode: SolveMode | null;
  /** Milliseconds since the current run started, for the spinner. */
  elapsedMs: number;
  /**
   * The round a convergence is on, and whether the searches have started coming back empty.
   *
   * Null for a single pass, which needs no commentary. A run to stability takes ten to sixty
   * seconds, and a spinner with no numbers on it for a minute reads as a hang.
   */
  progress: { round: number; changed: boolean } | null;
  outcome: SolveOutcome | null;
  error: string | null;
  run(plan: Plan, mode: SolveMode, options?: SolveOptions): void;
  /** Throws away the pending proposals without applying any of them. */
  dismiss(): void;
}

export function useSolver(): SolverHandle {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const startedRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<SolveMode | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progress, setProgress] = useState<{ round: number; changed: boolean } | null>(null);
  const [outcome, setOutcome] = useState<SolveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // A ticking elapsed time, so a long run visibly progresses instead of looking hung.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedRef.current), 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const run = useCallback((plan: Plan, mode: SolveMode, options: SolveOptions = {}) => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./solver.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    const worker = workerRef.current;
    const requestId = ++requestRef.current;
    startedRef.current = Date.now();

    setRunning(true);
    setMode(mode);
    setElapsedMs(0);
    setProgress(null);
    setError(null);
    setOutcome(null);

    worker.onmessage = (event: MessageEvent<SolveResponse | SolveFailure | SolveProgress>) => {
      const data = event.data;
      // A superseded run's answer is dropped on the floor, deliberately.
      if (data.requestId !== requestRef.current) return;
      if (data.kind === 'progress') {
        setProgress({ round: data.round, changed: data.changed });
        return;
      }
      setRunning(false);
      setProgress(null);
      if (data.kind === 'done') {
        const { after, proposals, groups, score, initialScore, iterations, timedOut } = data;
        setOutcome({
          after,
          proposals,
          groups,
          score,
          initialScore,
          iterations,
          elapsedMs: data.elapsedMs,
          timedOut,
          rounds: data.rounds,
          converged: data.converged,
        });
      } else {
        setError(data.message);
      }
    };

    worker.onerror = (event) => {
      setRunning(false);
      setError(event.message || 'Le calcul a échoué.');
    };

    const request: SolveRequest = { requestId, plan, mode, options };
    worker.postMessage(request);
  }, []);

  const dismiss = useCallback(() => {
    // Bumping the id makes any answer still in flight irrelevant, so dismissing during a run
    // cannot be undone a second later by a late message.
    requestRef.current += 1;
    setOutcome(null);
    setRunning(false);
    setMode(null);
    setProgress(null);
    setError(null);
  }, []);

  return { running, mode, elapsedMs, progress, outcome, error, run, dismiss };
}
