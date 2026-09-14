/**
 * The planning, in its three moments: montage, exploit, démontage.
 *
 * WHY THIS IS ONE TAB AND NOT THREE. The régisseur thinks "le planning" and then thinks about
 * when. Three tabs would have said these are three tools; they are one grid seen at three
 * moments, and everything around the grid, the toolbar, the side panel, the undo stack and the
 * colour code, is the same. It also keeps the tab bar readable: it already carries eight.
 *
 * The exploit is the default and stays exactly what it was. A phase that has not been configured
 * still shows in the selector, disabled, so that its absence is a fact the régisseur can see
 * rather than a feature they have to know exists.
 */

import { useState } from 'react';

import { PhaseGrid } from './PhaseGrid.tsx';
import { GridScreen } from './GridScreen.tsx';
import { useLoadedPlan } from '../store/store.tsx';
import type { SolveMode } from '../solver/solver.worker.ts';

type Moment = 'montage' | 'exploit' | 'demontage';

export function PlanningScreen({
  onSolve,
  solving,
  solveMode,
  readOnly = false,
  initialPoleFilter,
}: {
  onSolve(mode: SolveMode): void;
  solving: boolean;
  solveMode: SolveMode | null;
  readOnly?: boolean;
  initialPoleFilter?: string;
}) {
  const { plan } = useLoadedPlan();
  const [moment, setMoment] = useState<Moment>('exploit');

  const enabled: Record<Moment, boolean> = {
    montage: plan.montage.enabled,
    exploit: true,
    demontage: plan.demontage.enabled,
  };

  // A phase turned off while it was on screen sends the régisseur back to the exploit rather
  // than leaving them on a grid that says nothing.
  const shown: Moment = enabled[moment] ? moment : 'exploit';

  const switcher = (
    <div className="phase-switch" role="group" aria-label="Moment du planning">
      {(['montage', 'exploit', 'demontage'] as const).map((key) => (
        <button
          key={key}
          type="button"
          aria-current={shown === key}
          disabled={!enabled[key]}
          title={
            enabled[key]
              ? undefined
              : `${key === 'montage' ? 'Le montage' : 'Le démontage'} n'est pas activé (Réglages)`
          }
          onClick={() => setMoment(key)}
        >
          {key === 'montage'
            ? plan.montage.label || 'Montage'
            : key === 'exploit'
              ? 'Exploit'
              : plan.demontage.label || 'Démontage'}
        </button>
      ))}
    </div>
  );

  if (shown === 'exploit') {
    return (
      <GridScreen
        onSolve={onSolve}
        solving={solving}
        solveMode={solveMode}
        readOnly={readOnly}
        initialPoleFilter={initialPoleFilter}
        switcher={switcher}
      />
    );
  }

  /*
   * KEYED ON THE PHASE, so switching from the montage to the démontage starts a fresh grid. Both
   * are the same component, so without this React keeps its state across the switch, and the
   * state includes which box is selected: a montage box, described in the panel, while the
   * démontage is on screen. See `Selection`.
   */
  return <PhaseGrid key={shown} id={shown} switcher={switcher} readOnly={readOnly} />;
}
