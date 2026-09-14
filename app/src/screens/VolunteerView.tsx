/**
 * What a volunteer sees: their own shifts, and nothing else.
 *
 * This is the only screen in the tool reachable without an account, and it is the one most
 * people will ever open. It is read by somebody standing up, on a phone, possibly at 3 in the
 * morning, possibly on a bad connection, to answer one question: where am I supposed to be, and
 * who do I call if something is wrong.
 *
 * Four decisions.
 *
 * THE CODE IS THE ONLY CREDENTIAL, and the filtering happens in Postgres, not here.
 * `get_volunteer_schedule` is SECURITY DEFINER, takes the code as its argument and returns one
 * person's shifts. A wrong code returns nothing rather than returning everything for the browser
 * to filter, which is the difference between a restriction and a curtain.
 *
 * NOBODY ELSE'S CONTACT DETAILS. Other volunteers on the same shift appear as "Marie D.", so
 * somebody knows who they are working with and cannot use this to collect a hundred and twenty
 * phone numbers. The only numbers here are the pole organisers', who are the people to call.
 *
 * THE CODE IS REMEMBERED IN THIS BROWSER. A volunteer types it once, in October, and on the
 * night the page opens straight onto their shifts. Nothing else is stored, and "changer de code"
 * clears it.
 *
 * NO SHIFTS IS A NORMAL ANSWER, not an error. Between the form closing and the first solve,
 * everybody is in that state, and a screen that treats it as a failure would generate a hundred
 * messages to the régisseur in one afternoon.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useStore } from '../storeContext.ts';
import { log } from '../log/logger.ts';
import type { VolunteerSchedule } from '../persistence/types.ts';

const CODE_KEY = 'lototekno:code';

const readCode = (): string => {
  try {
    return window.localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    // A private window, or storage the browser refuses. Typing the code again is the fallback.
    return '';
  }
};

const writeCode = (code: string): void => {
  try {
    if (code === '') window.localStorage.removeItem(CODE_KEY);
    else window.localStorage.setItem(CODE_KEY, code);
  } catch {
    // Not being able to remember the code costs one retype, and nothing else.
  }
};

/** "vendredi 13 mars, 14h00" then "18h00", which is how somebody says where they have to be. */
function when(iso: string): { day: string; clock: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { day: 'date inconnue', clock: '' };
  return {
    day: at.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    clock: at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
}

const hoursBetween = (from: string, to: string): number =>
  Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 3600_000);

/** "4 h" and "4 h 30", because half hours exist and "4.5 h" is not French. */
function duration(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole} h` : `${whole} h ${String(minutes).padStart(2, '0')}`;
}

export function VolunteerView({ onLeave }: { onLeave(): void }) {
  const store = useStore();
  const [code, setCode] = useState(readCode);
  const [typed, setTyped] = useState('');
  const [schedule, setSchedule] = useState<VolunteerSchedule | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'unknown' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const look = useCallback(
    (wanted: string) => {
      if (!store.volunteerSchedule || wanted === '') return;
      setState('loading');
      setError(null);
      store
        .volunteerSchedule(wanted)
        .then((found) => {
          if (!found) {
            setState('unknown');
            setSchedule(null);
            return;
          }
          setSchedule(found);
          setState('idle');
          writeCode(wanted);
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
          setState('error');
          log.warn('planning', 'Consultation bénévole en échec.');
        });
    },
    [store],
  );

  // A code already in this browser opens straight onto the shifts, which is the whole point of
  // remembering it.
  useEffect(() => {
    if (code !== '') look(code);
  }, [code, look]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = typed.trim().toUpperCase();
    if (wanted === '') return;
    setCode(wanted);
    look(wanted);
  };

  const forget = () => {
    writeCode('');
    setCode('');
    setTyped('');
    setSchedule(null);
    setState('idle');
  };

  if (!store.volunteerSchedule) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Espace bénévole</h1>
          <p>Ce mode de stockage ne donne pas accès aux plannings individuels.</p>
          <button className="btn" onClick={onLeave}>
            Retour
          </button>
        </div>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="centered">
        <div className="card">
          <h1>Mon planning bénévole</h1>
          <p>
            Entrez le code d'accès qui vous a été envoyé. Il fait six caractères et ne change pas.
          </p>

          {state === 'unknown' && (
            <p className="alert is-bad">
              Ce code ne correspond à personne. Vérifiez-le, ou demandez-le au régisseur.
            </p>
          )}
          {state === 'error' && <p className="alert is-bad">{error}</p>}

          <form className="inline-form" onSubmit={submit}>
            <input
              className="text-input is-code"
              value={typed}
              onChange={(event) => setTyped(event.target.value.toUpperCase())}
              placeholder="Code d'accès"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={12}
              required
            />
            <button className="btn is-primary" type="submit" disabled={state === 'loading'}>
              {state === 'loading' ? 'Recherche…' : 'Voir mon planning'}
            </button>
          </form>

          <p className="panel-sub">
            <button className="btn is-link" onClick={onLeave}>
              Je suis organisateur ou organisatrice
            </button>
          </p>
        </div>
      </div>
    );
  }

  return <VolunteerShifts schedule={schedule} onForget={forget} />;
}

/**
 * The shifts themselves, taking what they draw.
 *
 * Split out from the lookup so a test can render it against a known schedule: the component
 * around it is a fetch and four pieces of local state, which a server render only ever catches
 * mid-load.
 */
export function VolunteerShifts({
  schedule,
  onForget,
}: {
  schedule: VolunteerSchedule;
  onForget(): void;
}) {
  const total = schedule.creneaux.reduce((sum, c) => sum + hoursBetween(c.debut, c.fin), 0);

  return (
    <div className="benevole">
      <header className="benevole-head">
        <div>
          <strong>
            {schedule.benevole.prenom} {schedule.benevole.nom}
          </strong>
          <span className="benevole-sub">
            {schedule.creneaux.length === 0
              ? `${schedule.benevole.heures_demandees} h demandées`
              : `${schedule.creneaux.length} créneau${
                  schedule.creneaux.length > 1 ? 'x' : ''
                }, ${duration(total)} au total`}
          </span>
        </div>
        <button className="btn" onClick={onForget}>
          Changer de code
        </button>
      </header>

      <p className="benevole-note">
        Ce planning peut encore changer d'ici l'événement. Rouvrez cette page la veille pour être
        sûr ou sûre de l'avoir à jour.
      </p>

      {schedule.creneaux.length === 0 ? (
        <div className="card">
          <p>
            Vous n'avez pas encore de créneau. C'est normal tant que la répartition n'est pas
            terminée: vous recevrez un message quand elle le sera, et cette page l'affichera.
          </p>
        </div>
      ) : (
        <ol className="benevole-list">
          {schedule.creneaux.map((creneau) => {
            const start = when(creneau.debut);
            const end = when(creneau.fin);
            return (
              <li key={`${creneau.debut}-${creneau.pole}`} className="benevole-shift">
                <div className="benevole-when">
                  <span className="benevole-day">{start.day}</span>
                  <span className="benevole-clock">
                    {start.clock} à {end.clock}
                  </span>
                  <span className="benevole-length">
                    {duration(hoursBetween(creneau.debut, creneau.fin))}
                  </span>
                </div>

                <div className="benevole-pole">{creneau.pole}</div>

                {creneau.avec.length > 0 && (
                  <div className="benevole-avec">Avec {creneau.avec.join(', ')}</div>
                )}

                {creneau.responsables.length > 0 && (
                  <div className="benevole-chefs">
                    {creneau.responsables.map((chef) => (
                      <span key={chef.nom} className="benevole-chef">
                        {chef.nom}
                        {chef.telephone !== '' && (
                          // A tap, not a number to copy out: this is the line somebody needs at
                          // 3 in the morning with one hand free.
                          <a className="btn is-small" href={`tel:${chef.telephone.replace(/\s/g, '')}`}>
                            Appeler
                          </a>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/*
        The montage and the démontage, after the créneaux of the event itself.
        ONE PAGE FOR THE WHOLE EVENT, on purpose: somebody who unloads the truck on Thursday and
        works the bar on Saturday has one thing to remember, not two pages to find.
      */}
      {schedule.phases.length > 0 && (
        <>
          <h2 className="benevole-h2">Montage et démontage</h2>
          <ol className="benevole-list">
            {schedule.phases.map((row) => {
              const start = when(row.debut);
              const end = when(row.fin);
              return (
                <li key={`${row.phase}-${row.debut}-${row.pole}${row.evenement}`} className="benevole-shift">
                  <div className="benevole-when">
                    <span className="benevole-day">{start.day}</span>
                    <span className="benevole-clock">
                      {start.clock} à {end.clock}
                    </span>
                    <span className="benevole-length">
                      {duration(hoursBetween(row.debut, row.fin))}
                    </span>
                  </div>
                  <div className="benevole-pole">
                    {row.evenement !== '' ? row.evenement : row.pole}
                    <span className="benevole-avec">
                      {row.phase === 'montage' ? 'Montage' : 'Démontage'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
