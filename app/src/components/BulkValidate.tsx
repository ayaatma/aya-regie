/**
 * « Valider les personnes placées », 2026-10-22: the bénévoles and orgas still in « Inscription »
 * who already hold a place, validated in one go, each sent their validation mail.
 *
 * WHY A BUTTON FOR IT. The responsable des bénévoles fills the grids with the people they know
 * first, and at some point decides that whoever made it onto a grid is in. Validating sixty fiches
 * one by one is the afternoon this saves.
 *
 * EXPLICIT ALL THE WAY: the window names every person (`SendDialog`), the statuses change in one
 * edit the journal and the undo know as one, and the mails leave as a grouped sending the Mails
 * tab follows. Nobody's placement moves.
 */

import { useState } from 'react';

import {
  isMailAddress,
  placedPending,
  registrantOf,
  renderMail,
  setRegistrationStatus,
  type Plan,
} from '../engine.ts';
import { startBatch, useBatch, type BatchJob } from '../mail/mailStore.ts';
import { useLoadedPlan, usePlan } from '../store/store.tsx';
import { SendDialog, type DialogPerson } from './SendDialog.tsx';

const siteUrl = (): string => (typeof window === 'undefined' ? '' : window.location.origin);

/** The people concerned, with the mail each would get, in the Personnes order. */
function pendingPeople(plan: Plan): Array<DialogPerson & { kind: 'benevole' | 'orga'; key: string }> {
  return placedPending(plan).flatMap(({ kind, key }) => {
    const person = registrantOf(plan, kind, key);
    if (!person) return [];
    const name = `${person.firstName} ${person.lastName}`.trim() || 'Sans nom';
    return [{ id: `${kind}|${key}`, kind, key, name: kind === 'orga' ? `${name} (orga)` : name, mail: renderMail(plan, person, siteUrl()) }];
  });
}

export function BulkValidateButton({ className = 'btn' }: { className?: string }) {
  const { plan, edit } = useLoadedPlan();
  const { id: eventId } = usePlan();
  const running = useBatch()?.running === true;
  const [open, setOpen] = useState(false);
  const people = pendingPeople(plan);
  if (people.length === 0) return null;

  const confirm = (): void => {
    edit(
      (p) => people.reduce((next, person) => setRegistrationStatus(next, person.kind, person.key, 'valide'), p),
      `validation de ${people.length} personne(s) placée(s)`,
    );
    if (eventId === null) return;
    const jobs: BatchJob[] = people
      .filter((p) => p.mail !== null && isMailAddress(p.mail.to))
      .map((p) => ({ kind: p.kind, key: p.key, name: p.name, mail: p.mail!, reason: 'validation', stepKey: '', planning: '' }));
    startBatch(eventId, 'Validation', jobs);
  };

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={running}
        title={running ? 'Un envoi groupé est en cours' : "Valide d'un coup les inscriptions qui ont déjà une place"}
        onClick={() => setOpen(true)}
      >
        Valider les {people.length} personne{people.length > 1 ? 's' : ''} placée{people.length > 1 ? 's' : ''}
      </button>
      {open && (
        <SendDialog
          title={`Valider ${people.length} personne${people.length > 1 ? 's' : ''}`}
          intro={
            <p>
              Ces personnes sont encore en « Inscription » et ont au moins un créneau (événement, montage ou
              démontage). Elles passent en « Validée », et chacune reçoit son mail de validation.
              Personne ne change de place.
            </p>
          }
          people={people}
          withoutMailNote="validées quand même, sans mail"
          confirmLabel={(n) => (n === people.length ? `Valider et envoyer ${n} mail${n > 1 ? 's' : ''}` : `Valider ${people.length}, envoyer ${n} mail${n > 1 ? 's' : ''}`)}
          onConfirm={confirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
