/**
 * Préparer un événement depuis son formulaire: what a festival-shaped export proposes, and what
 * applying a choice writes. Invented answers, the shape of a real form.
 *
 *   npm test
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { applySetup, inferSetup } from './setup-inference.js';
import { importVolunteers } from './import.js';
import { newEventPlan } from './plan.js';

const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const HEADERS = [
  'Statut',
  'Horodateur', 'Adresse e-mail', 'Nom', 'Prénom',
  'Peux-tu faire des shifts de nuit ? (entre 3h et 7h)',
  'Est-ce que tu as des compétences en bricolage ?',
  'Quelles sont tes compétences / permis / CACES / ton métier ?',
  'Quels jours es-tu dispo sur le montage ?',
  'Quels jours es-tu dispo sur le démontage ?',
  'Est-ce que tu serais dispo pour venir nous aider sur le pré-montage aussi ?',
  'Es-tu intéressé.e pour faire des week-end déco avant le festival ?',
  'A quelle heure peux-tu arriver vendredi 18 Septembre ?',
  'A quelle heure dois-tu repartir dimanche 20 Septembre ?',
  "Où es-tu le plus à l'aise ? Ton premier choix.",
  "Où es-tu le plus à l'aise ? Ton deuxième choix.",
];

const ROWS = [
  ['Validé.e, Email de confirmation envoyé', '01/06/2026 10:00:00', 'a@exemple.org', 'Alpha', 'Ana', 'Oui', 'Oui', 'Permis B, CACES', 'Mardi 15 septembre (montage), Mercredi 16 septembre (montage)', 'Lundi 21 septembre (démontage)', 'Oui', 'Non', 'Avant 14h', 'Après 18h', 'Bar', 'Maraude (Réduction des risques)'],
  ['Validé.e, Email de confirmation envoyé, Présence reconfirmée', '02/06/2026 10:00:00', 'b@exemple.org', 'Beta', 'Ben', 'Non je ne peux pas', 'Non', 'permis B', 'Mercredi 16 septembre (montage)', 'Mardi 22 septembre (démontage)', 'Non', 'Oui', 'Entre 16h et 18h', 'Entre 14h et 16h', 'Maraude', 'Bar'],
  ['Annulé.e', '03/06/2026 10:00:00', 'c@exemple.org', 'Gamma', 'Cléo', 'Oui mais je préfère ne pas en faire si possible', 'Un peu', 'caces', '', '', 'Oui', 'Oui', 'Avant 14h', 'Après 18h', 'Bar', 'je veux bien aider partout'],
];

const csv = [HEADERS, ...ROWS].map((r) => r.map(quote).join(',')).join('\n');

test('a festival form proposes its dates, phases, poles, nights, competences, activities and steps', () => {
  const p = inferSetup(csv);
  ok(p.event);
  strictEqual(new Date(p.event.startISO).getDate(), 18);
  strictEqual(new Date(p.event.startISO).getHours(), 14, "l'arrivée la plus tôt écrite");
  strictEqual(p.event.lengthHours, 52, 'jusqu’au dimanche 18h');
  strictEqual(new Date(p.montage!.startISO).getDate(), 15);
  strictEqual(p.montage!.days, 2);
  strictEqual(p.demontage!.days, 2);

  deepStrictEqual(p.poles.map((x) => [x.name, x.count, x.suggested]), [
    ['Bar', 3, true],
    ['Maraude', 2, true],
    ['je veux bien aider partout', 1, false],
  ]);
  deepStrictEqual(p.poles[1]!.answers.sort(), ['Maraude', 'Maraude (Réduction des risques)']);

  ok(p.slots && p.slots.filter((s) => s.label.startsWith('Nuit')).length === 2, 'une tranche par nuit');
  const tiled = p.slots!.every((s, i) => i === 0 ? s.start === 0 : s.start === p.slots![i - 1]!.end);
  ok(tiled && p.slots![p.slots!.length - 1]!.end === p.event.lengthHours, 'les tranches couvrent l’événement');

  deepStrictEqual(p.skills, ['Bricolage', 'Permis B', 'CACES']);
  deepStrictEqual(p.sideActivities, ['Pré-montage', 'Week-end déco']);
  deepStrictEqual(p.applicationSteps, ['Email de confirmation envoyé']);
});

test('applying what was ticked lets the next import read every answer against it', () => {
  const p = inferSetup(csv);
  const plan = applySetup(newEventPlan('Essai', new Date(2026, 5, 1)), p, {
    event: true, montage: true, demontage: true, slots: true, applicationSteps: true,
    poles: [{ index: 0, name: 'Bar' }, { index: 1, name: 'Maraude, réduction des risques' }],
    skills: p.skills, sideActivities: p.sideActivities,
  });
  strictEqual(plan.poles.length, 2);
  ok(plan.montage.enabled && plan.demontage.enabled && plan.montage.volunteersAllowed);
  strictEqual(plan.formMapping.answers.pole!['maraude'], plan.poles[1]!.key, 'la réponse courte reste reconnue après renommage');

  const r = importVolunteers(csv, {
    poles: plan.poles, artists: [], slots: plan.slots, preferenceSlots: plan.preferenceSlots, rules: plan.rules,
    lengthHours: plan.lengthHours, startISO: plan.startISO, mapping: plan.formMapping, volume: plan.volume,
    constraints: plan.constraints, phases: { montage: plan.montage, demontage: plan.demontage },
    skills: plan.skills, sideActivities: plan.sideActivities,
  });
  const ben = r.volunteers.find((v) => v.firstName === 'Ben')!;
  deepStrictEqual(ben.choices.map((c) => c.poleKey), [plan.poles[1]!.key, plan.poles[0]!.key]);
  strictEqual(ben.refusedSlotIds.length, 2, 'les deux nuits refusées');
  deepStrictEqual(ben.skills, [plan.skills.find((s) => s.label === 'Permis B')!.key]);
  ok(ben.montage.windows.length > 0, 'le jour de montage coché');
  const cleo = r.volunteers.find((v) => v.firstName === 'Cléo')!;
  strictEqual((cleo.avoidedSlotIds ?? []).length, 2);
  deepStrictEqual(cleo.sideActivityKeys!.length, 2);
});

test('applying twice adds nothing twice', () => {
  const p = inferSetup(csv);
  const choice = {
    event: true, montage: false, demontage: false, slots: false, applicationSteps: true,
    poles: [{ index: 0, name: 'Bar' }], skills: ['CACES'], sideActivities: ['Week-end déco'],
  };
  const once = applySetup(newEventPlan('Essai'), p, choice);
  const twice = applySetup(once, p, choice);
  strictEqual(twice.poles.length, 1);
  strictEqual(twice.skills.length, 1);
  strictEqual(twice.sideActivities.length, 1);
  strictEqual(twice.applicationSteps.length, once.applicationSteps.length);
});
