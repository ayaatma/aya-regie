/**
 * Le suivi après la validation: a person's planning as a mail says it, who each step is for, and
 * how the mails and answers read once they happened.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  batchMembers,
  followUpOf,
  inTarget,
  isPlaced,
  placedPending,
  planningLines,
  planningText,
  stepProgress,
  stepPersons,
  stepTextFor,
  type MailFact,
  type ReplyFact,
} from './followup.js';
import { DEFAULT_APPLICATION_STEPS, type Volunteer } from './model.js';
import { defaultPhase } from './phase.js';
import type { Plan } from './plan.js';
import { registrantOf, renderTemplate } from './registration.js';

const volunteer = (key: string, over: Partial<Volunteer> = {}): Volunteer =>
  ({
    key, firstName: key.toUpperCase(), lastName: 'Test', email: `${key}@example.org`, accessCode: `C${key}`,
    requestedHours: 4, status: 'valide', statusSteps: [], ...over,
  }) as unknown as Volunteer;

const [hours, planningStep, infos] = DEFAULT_APPLICATION_STEPS as [
  (typeof DEFAULT_APPLICATION_STEPS)[number],
  (typeof DEFAULT_APPLICATION_STEPS)[number],
  (typeof DEFAULT_APPLICATION_STEPS)[number],
];

function makePlan(): Plan {
  const montage = {
    ...defaultPhase('montage', '2027-03-11T08:00:00+01:00'),
    enabled: true,
    assignments: [{ key: 'pa1', personKind: 'benevole', personKey: 'lea', poleKey: 'general', eventKey: '', start: 1, end: 5 }],
  };
  return {
    name: 'Loto Test',
    startISO: '2027-03-13T12:00:00+01:00',
    address: 'Salle des fêtes',
    mailTemplates: {},
    applicationSteps: DEFAULT_APPLICATION_STEPS,
    poles: [{ key: 'bar', path: 'Bar / Caisse' }],
    shifts: [
      { key: 'bar@1', poleKey: 'bar', start: 2, end: 6, headcount: 2 },
      { key: 'bar@2', poleKey: 'bar', start: 10, end: 12, headcount: 2 },
    ],
    assignments: [
      { volunteerKey: 'lea', shiftKey: 'bar@2', locked: false, source: 'manual' },
      { volunteerKey: 'lea', shiftKey: 'bar@1', locked: false, source: 'manual' },
      { volunteerKey: 'max', shiftKey: 'bar@1', locked: false, source: 'manual' },
    ],
    volunteers: [
      volunteer('lea', { requestedHours: 8 }),
      volunteer('max', { status: 'candidature' }),
      volunteer('zoe', { requestedHours: 6 }),
      volunteer('ana', { status: 'annule', requestedHours: 8 }),
    ],
    organisers: [{ key: 'o1', firstName: 'Sam', lastName: 'Roux', email: '', accessCode: 'ORGA-1' }],
    organiserShifts: [{ key: 'os1', organiserKey: 'o1', shiftKey: 'bar@2' }],
    leaderRoles: [],
    artists: [],
    ticketing: { extras: [] },
    montage,
    demontage: { ...defaultPhase('demontage', '2027-03-14T06:00:00+01:00'), enabled: false },
  } as unknown as Plan;
}

const sent = (stepKey: string, sentAt: string, planning = '', outcome: MailFact['outcome'] = 'envoye', id = 1): MailFact => ({
  id, stepKey, outcome, sentAt, planning,
});

test('a planning is every créneau and every phase box, in clock order, in Paris time', () => {
  const plan = makePlan();
  assert.deepEqual(planningLines(plan, 'benevole', 'lea'), [
    '- jeudi 11 mars, 09h00 à 13h00 : Montage, Général',
    '- samedi 13 mars, 14h00 à 18h00 : Bar / Caisse',
    '- samedi 13 mars, 22h00 à 00h00 : Bar / Caisse',
  ]);
  assert.deepEqual(planningLines(plan, 'orga', 'o1'), ['- samedi 13 mars, 22h00 à 00h00 : Bar / Caisse']);
  assert.equal(planningText(plan, 'benevole', 'zoe'), '');
  assert.equal(isPlaced(plan, 'benevole', 'zoe'), false);
});

test('the placed people still in « Inscription » are who the bulk validation names', () => {
  const plan = makePlan();
  assert.deepEqual(placedPending(plan), [
    { kind: 'benevole', key: 'max' },
    { kind: 'orga', key: 'o1' },
  ]);
});

test('a step is for validated bénévoles inside its target, never for an inscription or a cancellation', () => {
  const plan = makePlan();
  const [lea, max, zoe, ana] = plan.volunteers as [Volunteer, Volunteer, Volunteer, Volunteer];
  assert.equal(inTarget(plan, hours, lea), true, '8 h asked, 6 needed');
  assert.equal(inTarget(plan, hours, zoe), true, 'not placed, and the step does not ask it');
  assert.equal(inTarget(plan, hours, ana), false, 'cancelled');
  assert.equal(inTarget(plan, planningStep, zoe), false, 'placed nowhere');
  assert.equal(inTarget(plan, planningStep, max), false, 'still an inscription');
  assert.equal(inTarget(plan, { key: 'x', label: 'X' }, lea), false, 'no mail, no target');
});

test('{planning}, {heures} and the personal link are filled for a bénévole', () => {
  const plan = makePlan();
  const lea = registrantOf(plan, 'benevole', 'lea')!;
  const mail = renderTemplate(plan, lea, planningStep.mail!, 'https://planning.example.org/');
  assert.match(mail.body, /- samedi 13 mars, 14h00 à 18h00 : Bar \/ Caisse/);
  assert.match(mail.body, /https:\/\/planning\.example\.org\/\?code=Clea/);
  assert.deepEqual(mail.empty, []);
  const ask = renderTemplate(plan, lea, hours.mail!, 'https://planning.example.org');
  assert.equal(ask.subject, 'Loto Test : tu confirmes tes 8 h ?');
});

test('a step reads as à envoyer, échec, envoyé, en attente, then the answer', () => {
  const plan = makePlan();
  const lea = plan.volunteers[0]!;
  const current = planningText(plan, 'benevole', 'lea');
  assert.equal(stepProgress(plan, planningStep, lea, [], []).state, 'a-envoyer');
  assert.equal(stepProgress(plan, planningStep, lea, [sent('planning', '2026-11-01T10:00:00Z', '', 'echec')], []).state, 'echec');
  assert.equal(stepProgress(plan, infos, lea, [sent('infos', '2026-11-01T10:00:00Z', current)], []).state, 'envoye');
  const mails = [sent('planning', '2026-11-01T10:00:00Z', current)];
  assert.equal(stepProgress(plan, planningStep, lea, mails, []).state, 'en-attente');
  const yes: ReplyFact = { stepKey: 'planning', answer: 'oui', answeredAt: '2026-11-02T08:00:00Z', source: 'lien' };
  const done = stepProgress(plan, planningStep, lea, mails, [yes]);
  assert.equal(done.state, 'oui');
  assert.equal(done.planningChanged, false);
});

test('a planning that moved after the mail is flagged, and a new mail asks the confirmation again', () => {
  const plan = makePlan();
  const lea = plan.volunteers[0]!;
  const yes: ReplyFact = { stepKey: 'planning', answer: 'oui', answeredAt: '2026-11-02T08:00:00Z', source: 'lien' };
  const old = [sent('planning', '2026-11-01T10:00:00Z', '- an older planning')];
  const moved = stepProgress(plan, planningStep, lea, old, [yes]);
  assert.equal(moved.state, 'oui');
  assert.equal(moved.planningChanged, true);
  const resent = [...old, sent('planning', '2026-11-03T10:00:00Z', planningText(plan, 'benevole', 'lea'), 'envoye', 2)];
  const again = stepProgress(plan, planningStep, lea, resent, [yes]);
  assert.equal(again.state, 'en-attente', 'the old « oui » answered the old planning');
  assert.equal(again.planningChanged, false);
});

test('the frise shows the furthest step, the hours beside it, and the alerts add up', () => {
  const plan = makePlan();
  const lea = plan.volunteers[0]!;
  const current = planningText(plan, 'benevole', 'lea');
  const mails = [
    sent('heures-supp', '2026-10-25T10:00:00Z'),
    sent('planning', '2026-11-01T10:00:00Z', current),
    sent('infos', '2026-11-05T10:00:00Z', '', 'echec'),
  ];
  const replies: ReplyFact[] = [
    { stepKey: 'heures-supp', answer: 'non', answeredAt: '2026-10-26T10:00:00Z', source: 'lien' },
    { stepKey: 'planning', answer: 'oui', answeredAt: '2026-11-02T10:00:00Z', source: 'regie' },
  ];
  const f = followUpOf(plan, lea, mails, replies);
  assert.deepEqual(f.stage, { label: 'Planning : confirmé', tone: 'ok' });
  assert.deepEqual(f.badges, [{ label: 'Heures supplémentaires : non', tone: 'bad' }]);
  assert.deepEqual(f.alerts.map((a) => a.label), ["Infos pratiques : échec de l'envoi"]);
  assert.deepEqual(followUpOf(plan, plan.volunteers[1]!, [], []).stage, { label: 'Inscription', tone: 'warn' });
});

test('the three sendings of a step: first, reminder, moved planning', () => {
  const plan = makePlan();
  const [lea, , zoe] = plan.volunteers as [Volunteer, Volunteer, Volunteer];
  const asked = [lea, zoe].map((v) => stepProgress(plan, hours, v, v.key === 'lea' ? [sent('heures-supp', '2026-10-25T10:00:00Z')] : [], []));
  assert.deepEqual(batchMembers(asked, 'premier').map((p) => p.state), ['a-envoyer']);
  assert.deepEqual(batchMembers(asked, 'relance').map((p) => p.state), ['en-attente']);
  const moved = [stepProgress(plan, planningStep, lea, [sent('planning', '2026-11-01T10:00:00Z', 'old')], [])];
  assert.equal(batchMembers(moved, 'modifie').length, 1);
  assert.equal(batchMembers(moved, 'relance').length, 0, 'a moved planning is resent, not reminded');
});

test('a step may go to the orgas too, with their own text, and asks them nothing', () => {
  const plan = makePlan();
  const sam = stepPersons(plan).find((p) => p.kind === 'orga' && p.key === 'o1')!;
  assert.equal(inTarget(plan, planningStep, sam), false, 'still an inscription');
  const validated = { ...sam, status: 'valide' as const };
  assert.equal(inTarget(plan, planningStep, validated), true, 'planning goes to the orgas since 2026-10-22');
  assert.equal(inTarget(plan, hours, validated), false, 'the extra hours are a bénévole question');
  assert.match(stepTextFor(planningStep.mail!, 'orga').subject, /tes horaires/);
  assert.match(stepTextFor(planningStep.mail!, 'benevole').subject, /ton planning bénévole/);
  const progress = stepProgress(plan, planningStep, validated, [sent('planning', '2026-11-01T10:00:00Z', planningText(plan, 'orga', 'o1'))], []);
  assert.equal(progress.state, 'envoye', 'sent, and no answer is waited for');
  assert.equal(progress.personKind, 'orga');
});

test('a step with no list of kinds goes to the bénévoles only, as before', () => {
  const plan = makePlan();
  const { audiences: _a, variants: _v, ...oldMail } = planningStep.mail!;
  const old = { ...planningStep, mail: oldMail };
  const sam = { ...stepPersons(plan).find((p) => p.kind === 'orga')!, status: 'valide' as const };
  assert.equal(inTarget(plan, old, sam), false);
});
