/**
 * Personnes > Mails, 2026-10-22: the validation of everybody placed, and the grouped sendings of
 * the follow-up, step by step, with who answered.
 *
 * ONE CARD PER STEP, in the event's order (Réglages > Étapes de suivi), each saying who it is
 * for, how many got it, how many answered what, and offering the three sendings that make sense:
 * to whoever has not got it yet, a reminder to whoever has not answered, and the new planning to
 * whoever's créneaux moved since theirs left. Every one of them opens the list of names first.
 *
 * WHAT GOES IS COMPUTED FROM WHAT WENT. A sending stopped halfway (a closed tab, the stop button)
 * is finished by pressing the same button again: the people already served are no longer in it.
 */

import { useState } from 'react';

import {
  audienceLabel,
  batchMembers,
  stepAudiences,
  stepPersons,
  stepTextFor,
  isMailAddress,
  placedPending,
  planningText,
  registrantOf,
  registrants,
  renderMail,
  renderTemplate,
  STEP_REPLY_LABEL,
  stepProgress,
  targetLabel,
  type ApplicationStep,
  type BatchKind,
  type Plan,
  type StepMail,
  type StepProgress,
} from '../engine.ts';
import { BulkValidateButton } from '../components/BulkValidate.tsx';
import { SendDialog, type DialogPerson } from '../components/SendDialog.tsx';
import {
  HOURLY_LIMIT,
  reloadMailBook,
  startBatch,
  stopBatch,
  useBatch,
  useMailLog,
  type BatchJob,
  type MailLog,
} from '../mail/mailStore.ts';
import { useTestAddress } from '../mail/testMail.tsx';
import { useLoadedPlan, usePlan } from '../store/store.tsx';

const siteUrl = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

const clock = (epoch: number): string =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(epoch));

interface Pending {
  title: string;
  intro: string;
  people: Array<DialogPerson & { job: BatchJob | null }>;
  label: string;
}

/** The jobs of one sending of a step, each mail rendered now, as the list will show it. */
function stepJobs(plan: Plan, step: ApplicationStep & { mail: StepMail }, members: readonly StepProgress[], kind: BatchKind): Pending['people'] {
  return members.flatMap((p) => {
    const person = registrantOf(plan, p.personKind, p.volunteerKey);
    if (!person) return [];
    // Each kind of person its own text since 2026-10-22: an orga is told hours, not asked to confirm.
    const rendered = renderTemplate(plan, person, stepTextFor(step.mail, person.audience), siteUrl());
    const mail = kind === 'relance' ? { ...rendered, subject: `Rappel : ${rendered.subject}` } : rendered;
    const name = `${person.firstName} ${person.lastName}`.trim() || 'Sans nom';
    const ok = isMailAddress(mail.to);
    const planning = person.kind === 'benevole' || person.kind === 'orga' ? planningText(plan, person.kind, person.key) : '';
    return [{
      id: `${person.kind}|${person.key}`,
      kind: person.kind,
      key: person.key,
      stepKey: step.key,
      planning,
      name,
      mail,
      job: ok
        ? {
            kind: person.kind, key: person.key, name, mail,
            reason: kind === 'relance' ? ('relance' as const) : ('etape' as const),
            stepKey: step.key, planning,
          }
        : null,
    }];
  });
}

/** Everybody a step could go to, bénévoles first: orgas and others since 2026-10-22. */
function progressOf(plan: Plan, step: ApplicationStep, log: MailLog): StepProgress[] {
  return stepPersons(plan).map((person) => {
    const { mails, replies } = log.factsOfPerson(person.kind, person.key);
    return stepProgress(plan, step, person, mails, replies);
  });
}

export function MailsScreen() {
  const { plan } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const log = useMailLog(eventId);
  const batch = useBatch();
  const [pending, setPending] = useState<Pending | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const running = batch?.running === true;
  const testAddress = useTestAddress();

  // The validated whose last validation mail failed: one button sends it to them again.
  const failedValidation = registrants(plan).filter(
    (r) => (r.kind === 'benevole' || r.kind === 'orga') && r.status === 'valide' && log.lastValidationOf(r.kind, r.key)?.outcome === 'echec',
  );

  const open = (next: Pending): void => setPending(next);
  const launch = (p: Pending): void => {
    if (eventId === null) return;
    startBatch(eventId, p.label, p.people.flatMap((x) => (x.job ? [x.job] : [])));
  };

  return (
    <div className="screen is-wide">
      <div className="screen-main mails-screen">
        <div className="toolbar">
          <strong>Mails</strong>
          <span className="people-meta">
            {log.sentLastHour()} envoyé(s) dans la dernière heure, au plus {HOURLY_LIMIT} par heure
          </span>
          <span className="people-meta" title="Se change dans Réglages, Mails de test">
            {testAddress === '' ? "Pas d'adresse de test (Réglages, Mails de test)" : `Tests envoyés à ${testAddress}`}
          </span>
          <span className="toolbar-sep" />
          <button
            type="button"
            className="btn"
            disabled={eventId === null || refreshing}
            title="Relit les mails partis et les réponses arrivées depuis l'ouverture"
            onClick={() => {
              if (eventId === null) return;
              setRefreshing(true);
              void reloadMailBook(eventId).finally(() => setRefreshing(false));
            }}
          >
            {refreshing ? 'Actualisation…' : 'Actualiser les réponses'}
          </button>
        </div>

        {log.error && <p className="alert is-bad">{log.error}</p>}

        {batch && (
          <div className={`card mails-batch${batch.running ? ' is-running' : ''}`} role="status">
            <strong>
              {batch.running ? 'Envoi en cours' : batch.stopped ? 'Envoi arrêté' : 'Envoi terminé'} : {batch.label}
            </strong>
            <span>
              {batch.sent + batch.failed}/{batch.total}
              {batch.failed > 0 && <span className="is-bad">, {batch.failed} en échec</span>}
            </span>
            {batch.pausedUntil !== null && (
              <span className="is-warn">
                Pause: {HOURLY_LIMIT} mails partis dans l'heure, reprise vers {clock(batch.pausedUntil)}
              </span>
            )}
            {batch.current !== '' && <span className="people-meta">À {batch.current}…</span>}
            {batch.running && (
              <>
                <span className="people-meta">Gardez cet onglet ouvert jusqu'à la fin.</span>
                <button type="button" className="btn is-small" onClick={stopBatch}>
                  Arrêter
                </button>
              </>
            )}
            {!batch.running && batch.sent + batch.failed < batch.total && (
              <span className="people-meta">Le reste partira en relançant le même envoi: il ne vise que celles et ceux qui ne l'ont pas reçu.</span>
            )}
          </div>
        )}

        <section className="card mails-step">
          <header className="mails-step-head">
            <h2>Validation</h2>
            <span className="people-meta">Bénévoles et Staff, un mail par type de personne (Réglages, Mails de validation)</span>
          </header>
          <div className="registration-actions">
            <BulkValidateButton className="btn is-primary" />
            {failedValidation.length > 0 && (
              <button
                type="button"
                className="btn"
                disabled={running}
                onClick={() =>
                  open({
                    title: `Renvoyer la validation à ${failedValidation.length} personne(s)`,
                    intro: 'Leur dernier mail de validation a échoué.',
                    label: 'Validation renvoyée',
                    people: failedValidation.map((r) => {
                      const mail = renderMail(plan, r, siteUrl());
                      const name = `${r.firstName} ${r.lastName}`.trim();
                      return {
                        id: `${r.kind}|${r.key}`, kind: r.kind, key: r.key, name, mail,
                        job: mail !== null && isMailAddress(mail.to)
                          ? { kind: r.kind, key: r.key, name, mail, reason: 'renvoi' as const, stepKey: '', planning: '' }
                          : null,
                      };
                    }),
                  })
                }
              >
                Renvoyer aux {failedValidation.length} en échec
              </button>
            )}
            {placedPending(plan).length === 0 && failedValidation.length === 0 && (
              <span className="people-meta">Personne en « Inscription » n'a de place en ce moment.</span>
            )}
          </div>
        </section>

        {plan.applicationSteps.map((step) =>
          step.mail ? (
            <StepCard key={step.key} step={step as ApplicationStep & { mail: StepMail }} log={log} running={running} onOpen={open} />
          ) : (
            <section key={step.key} className="card mails-step is-manual">
              <header className="mails-step-head">
                <h2>{step.label}</h2>
                <span className="people-meta">
                  Sans mail: se coche à la main sur chaque fiche ({plan.volunteers.filter((v) => (v.statusSteps ?? []).includes(step.key)).length} cochée(s)).
                  Pour l'envoyer d'ici, lui donner un mail dans Réglages, Étapes de suivi.
                </span>
              </header>
            </section>
          ),
        )}

        {pending && (
          <SendDialog
            title={pending.title}
            intro={<p>{pending.intro}</p>}
            people={pending.people}
            confirmLabel={(n) => `Envoyer ${n} mail${n > 1 ? 's' : ''}`}
            onConfirm={() => launch(pending)}
            onClose={() => setPending(null)}
          />
        )}
      </div>
    </div>
  );
}

function StepCard({
  step,
  log,
  running,
  onOpen,
}: {
  step: ApplicationStep & { mail: StepMail };
  log: MailLog;
  running: boolean;
  onOpen(p: Pending): void;
}) {
  const { plan } = useLoadedPlan();
  const all = progressOf(plan, step, log);
  const concerned = all.filter((p) => p.inTarget);
  const count = (state: StepProgress['state']): number => concerned.filter((p) => p.state === state).length;
  const wantsReply = step.mail.reply !== 'aucune';
  const first = batchMembers(all, 'premier');
  const remind = wantsReply ? batchMembers(all, 'relance') : [];
  const moved = batchMembers(all, 'modifie');

  const offer = (kind: BatchKind, members: StepProgress[], title: string, intro: string, button: string) =>
    members.length > 0 && (
      <button
        type="button"
        className={kind === 'premier' ? 'btn is-primary' : 'btn'}
        disabled={running}
        onClick={() =>
          onOpen({ title, intro, label: `${step.label}${kind === 'relance' ? ' (rappel)' : kind === 'modifie' ? ' (planning modifié)' : ''}`, people: stepJobs(plan, step, members, kind) })
        }
      >
        {button}
      </button>
    );

  const figures: Array<[string, number, string]> = [
    ['concernées', concerned.length, ''],
    ['à envoyer', count('a-envoyer'), ''],
    ['en échec', count('echec'), 'is-bad'],
    [wantsReply ? 'sans réponse' : 'envoyés', wantsReply ? count('en-attente') : count('envoye'), wantsReply ? 'is-warn' : 'is-ok'],
  ];
  if (wantsReply) {
    figures.push([step.mail.reply === 'confirmer' ? 'confirmées' : 'oui', count('oui'), 'is-ok']);
    if (step.mail.reply === 'oui-non') figures.push(['non', count('non'), 'is-bad']);
  }
  if (moved.length > 0) figures.push(['planning modifié', moved.length, 'is-warn']);

  return (
    <section className="card mails-step">
      <header className="mails-step-head">
        <h2>{step.label}</h2>
        <span className="people-meta">
          {targetLabel(step.mail, (a) => audienceLabel(plan, a).toLowerCase())}. {STEP_REPLY_LABEL[step.mail.reply]}
          {step.mail.reply !== 'aucune' && stepAudiences(step.mail).some((a) => a !== 'benevole') ? ' (les bénévoles seulement)' : ''}.
        </span>
      </header>
      <ul className="mails-figures">
        {figures.map(([label, n, tone]) => (
          <li key={label} className={n > 0 ? tone : 'is-muted'}>
            <strong>{n}</strong> {label}
          </li>
        ))}
      </ul>
      {count('non') > 0 && (
        <p className="people-meta">
          Non: {concerned.filter((p) => p.state === 'non').map((p) => nameOf(plan, p)).join(', ')}
        </p>
      )}
      <div className="registration-actions">
        {offer(
          'premier',
          first,
          `${step.label} : ${first.length} mail(s)`,
          "Celles et ceux de la cible qui ne l'ont pas encore reçu, ou dont l'envoi a échoué.",
          `Envoyer aux ${first.length} qui ne l'ont pas reçu`,
        )}
        {offer(
          'relance',
          remind,
          `${step.label} : rappel à ${remind.length} personne(s)`,
          "Le même mail, l'objet précédé de « Rappel : », à celles et ceux qui n'ont pas encore répondu.",
          `Relancer les ${remind.length} sans réponse`,
        )}
        {offer(
          'modifie',
          moved,
          `${step.label} : planning modifié, ${moved.length} personne(s)`,
          "Leurs créneaux ont changé depuis le dernier envoi. Elles reçoivent le nouveau planning, et une confirmation donnée avant ne compte plus.",
          `Renvoyer aux ${moved.length} dont le planning a changé`,
        )}
        {first.length === 0 && remind.length === 0 && moved.length === 0 && (
          <span className="people-meta">{concerned.length === 0 ? 'Personne dans la cible pour le moment.' : 'Rien à envoyer.'}</span>
        )}
      </div>
    </section>
  );
}

const nameOf = (plan: Plan, p: StepProgress): string => {
  const person = registrantOf(plan, p.personKind, p.volunteerKey);
  return person ? `${person.firstName} ${person.lastName}`.trim() : p.volunteerKey;
};
