/**
 * The shell: which screen is showing, the state of the save, and the undo stack.
 *
 * The solver lives here rather than inside the grid, because a run started from the grid ends
 * with a batch of proposals to read on another screen, and the run must survive that move.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSession } from './auth/useSession.ts';
import { useSolver } from './solver/useSolver.ts';
import type { SolveMode } from './solver/solver.worker.ts';
import { usePlan } from './store/store.tsx';
import { DashboardScreen } from './screens/DashboardScreen.tsx';
import { PlanningScreen } from './screens/PlanningScreen.tsx';
import { ProposalsScreen } from './screens/ProposalsScreen.tsx';
import { RecruitmentScreen } from './screens/RecruitmentScreen.tsx';
import { PlanPicker } from './screens/PlanPicker.tsx';
import { SetupScreen } from './screens/SetupScreen.tsx';
import { CateringScreen } from './screens/CateringScreen.tsx';
import { ArtistsScreen } from './screens/ArtistsScreen.tsx';
import { PeopleScreen } from './screens/PeopleScreen.tsx';
import { NavigationContext, type Navigation, type PersonRef } from './components/personNav.ts';
import { ImportScreen } from './screens/ImportScreen.tsx';
import { PrintScreen } from './screens/PrintScreen.tsx';
import { HistoryScreen } from './screens/HistoryScreen.tsx';
import { ScreenBoundary } from './components/ScreenBoundary.tsx';
import { NightView } from './screens/NightView.tsx';
import { useIsPhone } from './components/useIsPhone.ts';
import { CheckpointBar } from './components/CheckpointBar.tsx';
import { AccountBar } from './auth/AccountBar.tsx';
import { JournalScreen } from './screens/JournalScreen.tsx';
import { MagasinScreen } from './screens/MagasinScreen.tsx';
import { StackedScreen, scrollToSection } from './screens/StackedScreen.tsx';
import { log } from './log/logger.ts';

/*
 * SEVEN TABS SINCE 2026-09-13, down from ten. The régisseur asked for three pairs to share a
 * page: Tableau de bord with Recrutement under it, Import with the printable page (renamed
 * Export) under it, Historique with the Journal under it, those last two folded until opened.
 * The six screens are unchanged; `StackedScreen` puts two of them one under the other.
 */
type Screen =
  | 'grille'
  | 'propositions'
  | 'tableau'
  | 'artistes'
  | 'catering'
  | 'magasin'
  | 'personnes'
  | 'reglages'
  | 'import'
  | 'historique';

const TABS: Array<{ id: Screen; label: string }> = [
  { id: 'grille', label: 'Grille' },
  { id: 'propositions', label: 'Propositions' },
  { id: 'tableau', label: 'Tableau de bord' },
  // Was « Billetterie », after Catering, until 2026-09-15: the central place for a person's
  // information now, so it comes before the tabs that each hold one part of it.
  { id: 'personnes', label: 'Personnes' },
  { id: 'artistes', label: 'Artistes' },
  { id: 'catering', label: 'Catering' },
  // 2026-09-15: the equipment, lent or owned, and where each piece is.
  { id: 'magasin', label: 'Magasin' },
  { id: 'reglages', label: 'Réglages' },
  { id: 'import', label: 'Import/Export' },
  { id: 'historique', label: 'Historique' },
];

const saveLabel = (dirty: boolean, saving: boolean, savedAt: string | null): string => {
  if (saving) return 'Enregistrement…';
  if (dirty) return 'Modifications non enregistrées';
  if (!savedAt) return 'Aucune modification';
  const when = new Date(savedAt);
  return `Enregistré à ${String(when.getHours()).padStart(2, '0')}:${String(
    when.getMinutes(),
  ).padStart(2, '0')}`;
};

/**
 * `onVolunteer` is here as well as on the login form, and not only for a developer working on
 * the fixtures where there is no login at all. The régisseur has to be able to see exactly what
 * a volunteer sees, from inside the tool, without a second browser and somebody else's code.
 */
export function App({
  onVolunteer,
  onOrganiser,
}: {
  onVolunteer(): void;
  /** Shows the tool as a pole organiser sees it, from inside, without a second browser. */
  onOrganiser(): void;
}) {
  const state = usePlan();
  const solver = useSolver();
  // Null on the fixtures, so the button below simply does not exist there.
  const { session, signOut } = useSession();
  const [screen, setScreen] = useState<Screen>('grille');
  /** Whose fiche is open on the Personnes tab. Here, so a trip to another tab keeps it open. */
  const [personFocus, setPersonFocus] = useState<PersonRef | null>(null);
  const navigation = useMemo<Navigation>(
    () => ({
      openPerson: (person) => {
        setPersonFocus(person);
        setScreen('personnes');
      },
      openArtists: () => setScreen('artistes'),
    }),
    [],
  );
  /** Set when somebody on a small screen asks for the desktop tool anyway. */
  const [fullOnPhone, setFullOnPhone] = useState(false);
  /** Set while the régisseur is naming the version on screen. */
  const [naming, setNaming] = useState(false);
  /** Set while the régisseur is choosing a password. Exclusive with `naming`: one banner slot. */
  const [account, setAccount] = useState(false);
  const phone = useIsPhone();

  const { plan, canUndo, canRedo, undo, redo } = state;

  // Who the journal says did all this. Postgres records its own idea of the same thing, which is
  // the one nobody can type; this is the one a human can read back.
  useEffect(() => log.setActor(session?.user?.email ?? undefined), [session]);

  const onSolve = useCallback(
    (mode: SolveMode) => {
      if (!plan) return;
      setScreen('propositions');
      solver.run(plan, mode);
    },
    [plan, solver],
  );

  // Ctrl+Z and Ctrl+Shift+Z, kept off any field the régisseur might be typing in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  /*
   * A load that failed leaves nothing to show, so this replaces the whole shell. It must
   * therefore carry its own way out: it used to be a dead end with no button at all, which left
   * the only reading of it as "the tool is gone".
   *
   * The message is shown as it came, because the useful ones name a column or a function, and
   * the person reading them is the one who can act on them.
   */
  if (state.error) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Impossible de charger le planning</h1>
          <p>{state.error}</p>
          <p>
            Le planning lui-même n'a pas été modifié: rien n'a été écrit. Si le message parle
            d'une colonne ou d'une fonction absente, la base de données n'est pas à jour, et une
            migration reste à appliquer.
          </p>
          <div className="card-actions">
            {state.id && (
              <button className="btn is-primary" onClick={() => state.open(state.id!)}>
                Réessayer
              </button>
            )}
            <button className="btn" onClick={state.close}>
              Revenir à la liste des plannings
            </button>
          </div>
          <p className="card-note">
            Les jeux de test s'écrivent avec <code>npm run fixture -- --all</code> dans le dossier{' '}
            <code>tools</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!plan) return <PlanPicker />;

  /*
   * On a phone the grid is not usable, so it is not offered. The night view answers the one
   * question a phone gets asked during the event, says in its first line that it changes
   * nothing, and keeps a way back to the full tool for anyone who disagrees with our reading of
   * their screen.
   */
  if (phone && !fullOnPhone) {
    return (
      <ScreenBoundary resetKey="nuit">
        <NightView onLeave={() => setFullOnPhone(true)} />
      </ScreenBoundary>
    );
  }

  const pending = solver.outcome?.proposals.length ?? 0;
  const tier1 = state.report?.summary.tier1Count ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          Planning bénévoles<span>{plan.name}</span>
        </div>

        <nav className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className="tab"
              aria-current={screen === tab.id}
              onClick={() => setScreen(tab.id)}
            >
              {tab.label}
              {tab.id === 'propositions' && pending > 0 && (
                <span className="tab-badge is-quiet">{pending}</span>
              )}
              {tab.id === 'grille' && tier1 > 0 && <span className="tab-badge">{tier1}</span>}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <button className="btn is-icon" onClick={undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
            ↶
          </button>
          <button
            className="btn is-icon"
            onClick={redo}
            disabled={!canRedo}
            title="Rétablir (Ctrl+Maj+Z)"
          >
            ↷
          </button>
          <span className={`save-state ${state.dirty ? 'is-dirty' : ''}`}>
            {saveLabel(state.dirty, state.saving, state.savedAt)}
          </span>
          <button
            className="btn"
            onClick={() => {
              setNaming(true);
              setAccount(false);
            }}
            disabled={naming}
            title="Conserver cette version du planning sous un nom, définitivement"
          >
            Point de sauvegarde
          </button>
          <button
            className="btn"
            onClick={onVolunteer}
            title="Voir l'outil comme un bénévole le voit"
          >
            Vue bénévole
          </button>
          <button
            className="btn"
            onClick={onOrganiser}
            title="Voir l'outil comme un responsable de pôle le voit"
          >
            Vue responsable
          </button>
          <button className="btn" onClick={() => window.location.reload()} title="Changer de plan">
            Changer
          </button>
          {session && (
            <>
              <button
                className="btn"
                onClick={() => {
                  setAccount(true);
                  setNaming(false);
                }}
                disabled={account}
                title="Choisir un mot de passe pour ne plus dépendre du lien envoyé par email"
              >
                Mon compte
              </button>
              <button
                className="btn"
                onClick={() => void signOut()}
                title="Fermer la session sur ce navigateur"
              >
                Se déconnecter
              </button>
            </>
          )}
        </div>
      </header>

      {/*
        Five banners for one slot, and the order is the order of severity. An outdated page
        cannot write at all, so it outranks a refused save, which can be retried, which outranks
        a conflict, which is a choice, which outranks the checkpoint bar and the account bar,
        which are conveniences. The last two never compete: opening either closes the other,
        since each is a form somebody is in the middle of filling in.
      */}
      {state.outdated !== null ? (
        <div className="banner is-error">
          <strong>Cette page est une version périmée de l'outil.</strong> Elle ne peut plus
          enregistrer: elle ne connaît pas toutes les informations que le planning contient
          maintenant, et écrire depuis ici les effacerait. Rechargez la page pour reprendre.
          {state.dirty && ' Vos dernières modifications ne sont pas enregistrées: notez-les avant de recharger.'}
          <div className="banner-actions">
            <button className="btn is-primary" onClick={() => window.location.reload()}>
              Recharger la page
            </button>
          </div>
        </div>
      ) : state.saveError ? (
        /*
          The plan is still on screen and still complete: the refusal happened on the way to the
          database, so nothing was written and nothing was lost. Saying so is most of the job,
          because the failure this replaces showed an error card instead of the plan, which reads
          as "everything is gone".
        */
        <div className="banner is-error">
          <strong>Le serveur a refusé le dernier enregistrement.</strong> {state.saveError}
          {state.dirty
            ? " Vos modifications sont toujours à l'écran, mais elles ne sont enregistrées nulle part: gardez cet onglet ouvert."
            : ' Rien n\'a été perdu.'}
          <div className="banner-actions">
            <button className="btn is-primary" onClick={state.retrySave}>
              Réessayer
            </button>
          </div>
        </div>
      ) : state.conflict ? (
        <div className="banner">
          <strong>Quelqu'un d'autre a modifié ce planning.</strong> Votre copie de travail a été
          construite sur la version {state.baseVersion}, le serveur en est à la version{' '}
          {state.conflict.version}. Rien n'a été écrasé.
          <div className="banner-actions">
            <button className="btn" onClick={state.acceptTheirs}>
              Reprendre leur version
            </button>
            <button className="btn is-danger" onClick={state.keepMine}>
              Garder la mienne et écraser
            </button>
          </div>
        </div>
      ) : naming ? (
        <CheckpointBar
          onSeeHistory={() => {
            setNaming(false);
            setScreen('historique');
          }}
          onClose={() => setNaming(false)}
        />
      ) : account ? (
        <AccountBar email={session?.user?.email ?? null} onClose={() => setAccount(false)} />
      ) : (
        <div />
      )}

      {/*
        The boundary sits here, inside the shell, so a screen that throws leaves the tabs above
        it usable. A crash used to unmount the whole tree, nav included, which turned one missing
        field on an old stored plan into a blank page with no way out.
      */}
      <NavigationContext.Provider value={navigation}>
      <ScreenBoundary resetKey={screen}>
        {screen === 'grille' && (
          <PlanningScreen onSolve={onSolve} solving={solver.running} solveMode={solver.mode} />
        )}
        {screen === 'propositions' && (
          <ProposalsScreen
            outcome={solver.outcome}
            running={solver.running}
            error={solver.error}
            onSolve={onSolve}
            onDismiss={solver.dismiss}
            progress={solver.progress}
            elapsedMs={solver.elapsedMs}
            mode={solver.mode}
          />
        )}
        {screen === 'tableau' && (
          <StackedScreen
            sections={[
              {
                id: 'tableau',
                title: 'Tableau de bord',
                children: (
                  <DashboardScreen onGoToRecruitment={() => scrollToSection('recrutement')} />
                ),
              },
              { id: 'recrutement', title: 'Recrutement', children: <RecruitmentScreen /> },
            ]}
          />
        )}
        {screen === 'artistes' && <ArtistsScreen />}
        {screen === 'catering' && <CateringScreen onGoToSetup={() => setScreen('reglages')} />}
        {screen === 'magasin' && <MagasinScreen />}
        {screen === 'personnes' && (
          <PeopleScreen
            focus={personFocus}
            onFocus={setPersonFocus}
            onGoToSetup={() => setScreen('reglages')}
          />
        )}
        {screen === 'reglages' && <SetupScreen />}
        {screen === 'import' && (
          <StackedScreen
            sections={[
              { id: 'import', title: 'Import', children: <ImportScreen /> },
              { id: 'export', title: 'Export', children: <PrintScreen />, printable: true },
            ]}
          />
        )}
        {screen === 'historique' && (
          <StackedScreen
            sections={[
              { id: 'historique', title: 'Historique', children: <HistoryScreen />, foldable: true },
              { id: 'journal', title: 'Journal', children: <JournalScreen />, foldable: true },
            ]}
          />
        )}
      </ScreenBoundary>
      </NavigationContext.Provider>
    </div>
  );
}
