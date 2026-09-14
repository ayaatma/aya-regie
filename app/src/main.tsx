import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { FixtureStore } from './persistence/fixtureStore.ts';
import { SupabasePlanStore } from './persistence/supabaseStore.ts';
import { getSupabase, supabaseConfigured } from './persistence/supabaseClient.ts';
import { PlanProvider } from './store/store.tsx';
import { StoreContext } from './storeContext.ts';
import { VolunteerView } from './screens/VolunteerView.tsx';
import { OrganiserView } from './screens/OrganiserView.tsx';
import { log } from './log/logger.ts';
import './styles.css';

/**
 * Where the plans live, decided once, here.
 *
 * Configured means Supabase; not configured means the generated scenarios in this browser.
 * Everything above the `PlanStore` interface is written against the interface and cannot tell
 * the difference, which is what let the whole tool be built and exercised on real-sized data
 * before a line of SQL had ever run.
 *
 * Keeping the fixture path alive is deliberate. It is the only way to work on the grid without
 * a network, and the only way the tests run at all.
 */
const store = supabaseConfigured ? new SupabasePlanStore(getSupabase()) : new FixtureStore();

/*
 * The journal, wired here and nowhere else.
 *
 * It writes wherever the plans are written, which means a problem reported by somebody else is
 * readable afterwards without their browser. On the fixture path it stays in this browser, where
 * it is at least exercised by the tests.
 *
 * The two window handlers are the ones nothing else catches: an error thrown outside React's
 * rendering, and a promise nobody awaited. Those are exactly the failures that leave no trace on
 * screen and are therefore never reported accurately.
 */
if (store.appendLog) {
  log.attach({ appendLog: (eventId, entries) => store.appendLog!(eventId, entries) });
}

log.info('session', "Ouverture de l'outil.", {
  navigateur: navigator.userAgent,
  ecran: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
  stockage: store.shared ? 'base partagée' : 'ce navigateur',
});

window.addEventListener('error', (event) => {
  log.error('divers', `Erreur non rattrapée: ${event.message}`, {
    fichier: event.filename,
    ligne: event.lineno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown;
  log.error('divers', `Promesse rejetée sans traitement: ${
    reason instanceof Error ? reason.message : String(reason)
  }`);
});

// A tab being hidden or closed is the last chance to send what is buffered, and it is the moment
// somebody gives up on a screen that is misbehaving, so it is the batch most worth having.
window.addEventListener('pagehide', () => void log.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void log.flush();
});

/**
 * Who is at the door. There are three.
 *
 * The volunteer view and the organisers' view both sit OUTSIDE the auth gate and inside the store,
 * because neither has an account: their credential is an access code, checked by Postgres, and
 * the two RPCs that take one are the only functions granted to anon. Everything else in the
 * schema requires `authenticated`, which is what makes both of them read-only by construction
 * rather than by good manners.
 *
 * The volunteer's door is offered on the login form, because most people who open this address
 * are volunteers and a form asking for an organiser's e-mail reads as "you are not welcome
 * here". The organisers' door is NOT offered there: there are about fifteen organisers, they are
 * handed their link directly, and a third button on the login card would make the common case
 * harder to read for the sake of a rare one. `?responsable` is how they arrive.
 */
function Root() {
  const [volunteer, setVolunteer] = useState(false);
  /*
   * Read once, at startup, from the query string. A organiser's link carries it, and after the
   * first visit their code is remembered anyway, so this is a bookmark that keeps working.
   * `history.replaceState` is deliberately NOT called: leaving the marker in the address is what
   * makes the page reloadable and the bookmark honest.
   */
  const [organiser, setOrganiser] = useState(
    () => new URLSearchParams(window.location.search).has('responsable'),
  );

  if (organiser) return <OrganiserView onLeave={() => setOrganiser(false)} />;
  if (volunteer) return <VolunteerView onLeave={() => setVolunteer(false)} />;

  return (
    <AuthGate onVolunteer={() => setVolunteer(true)}>
      <PlanProvider store={store}>
        <App onVolunteer={() => setVolunteer(true)} onOrganiser={() => setOrganiser(true)} />
      </PlanProvider>
    </AuthGate>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Element #root introuvable');

createRoot(root).render(
  <StrictMode>
    {/* The store is outside the gate: the volunteer view needs it and has no session. The plan
        provider stays inside, so no plan is fetched before an organiser is logged in. */}
    <StoreContext.Provider value={store}>
      <Root />
    </StoreContext.Provider>
  </StrictMode>,
);
