/**
 * A crash in one screen must not take the whole tool with it.
 *
 * React unmounts the entire tree on an uncaught render error. The first time that happened here,
 * a missing array on an old stored plan turned the settings screen into a blank page **and took
 * the navigation with it**, so the régisseur could not even click back to the grid to see that
 * their plan was still there. One missing field, and the tool looked destroyed.
 *
 * So the boundary sits inside the shell, around the screen only. The header, the tabs, the undo
 * buttons and the save state stay alive, which means the answer to any future crash is "click
 * another tab", not "reload and hope".
 *
 * It deliberately shows the error text. The régisseur is not the audience for a stack trace, but
 * they are the one who will report it, and "something went wrong" wastes that.
 *
 * The fallback is a separate function component, and `getDerivedStateFromError` is a plain static
 * method, because both can then be tested. React does not invoke error boundaries during server
 * rendering, so the class as a whole cannot be exercised by the test suite: what is left to
 * trust is React's own behaviour, and the two pieces below are checked directly.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { log } from '../log/logger.ts';

export function ScreenError({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <div className="centered">
      <div className="card">
        <h1>Cet écran n'a pas pu s'afficher</h1>
        <p>
          Le reste de l'outil fonctionne: les onglets en haut sont toujours actifs, et votre
          planning n'a pas été touché. Rien n'est perdu.
        </p>
        <p>
          <code>{message}</code>
        </p>
        <p className="panel-sub">
          Si cela se reproduit, ce message est ce qu'il faut signaler. Le détail complet est dans
          la console du navigateur.
        </p>
        <button className="btn" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    </div>
  );
}

interface Props {
  /** Changing this clears the error, so switching screens recovers on its own. */
  resetKey: string;
  children: ReactNode;
}

interface State {
  message: string | null;
  seenFor: string | null;
}

export class ScreenBoundary extends Component<Props, State> {
  override state: State = { message: null, seenFor: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Kept in the console in full, because the message alone rarely says where.
    console.error('Écran en erreur', error, info.componentStack);
    // And in the journal, because the console belongs to a browser that will be closed by the
    // time anybody asks what happened.
    const cause = error instanceof Error ? error.message : String(error);
    log.error('ecran', `L'écran "${this.props.resetKey}" n'a pas pu s'afficher: ${cause}`, {
      pile: (info.componentStack ?? '').split('\n').slice(0, 6).join(' | '),
    });
    this.setState({ seenFor: this.props.resetKey });
  }

  override componentDidUpdate(): void {
    // Moving to another screen clears the error rather than leaving it stuck on the new one.
    if (this.state.message !== null && this.state.seenFor !== this.props.resetKey) {
      this.setState({ message: null, seenFor: null });
    }
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <ScreenError
        message={this.state.message}
        onRetry={() => this.setState({ message: null, seenFor: null })}
      />
    );
  }
}
