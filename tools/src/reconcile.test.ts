/**
 * Re-importing the form, tested against the one thing that must never happen.
 *
 * The form is exported and re-imported for months. Answers are the CSV's to overwrite;
 * placements are the régisseur's and are never touched here. And a row missing from an export is
 * a decision, not an automatic deletion, because a filtered view exported by mistake would
 * otherwise cost several people their evening.
 */

import { ok, strictEqual, deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { FORM_COLUMNS } from './csv.js';
import { importVolunteers, volunteerIdentity, type ImportResult } from './import.js';
import { EVENT_START_ISO, buildArtists, buildPoles } from './event-config.js';
import { loadScenario, greedyFill } from './plan-fixtures.js';
import {
  applyReconciliation,
  existingCodes,
  keptByDefault,
  mergeWithManual,
  reconcileVolunteers,
  summariseReconciliation,
} from './reconcile.js';
import { validate } from './validate.js';
import type { Plan } from './plan.js';
import type { EditableField, Volunteer } from './model.js';

const { poles } = buildPoles();
const artists = buildArtists();

/**
 * A CSV built by hand, so a row can be edited or deleted exactly the way a régisseur would.
 *
 * The headers are `FORM_COLUMNS`, which are the real export's own, rather than a set invented
 * here. A fixture with its own private wording tests the reconciliation and nothing about the
 * column binding, and the binding is precisely where this broke: against the real file two
 * columns landed on the wrong question. The answers below are the form's real options too.
 */
interface Row {
  first: string;
  last: string;
  email: string;
  preference?: string;
  volume?: string;
  choice1?: string;
  choice2?: string;
  refusedPoles?: string;
  buddies?: string;
  /** The time constraint, in the volunteer’s own words. Column 25 since 2026-09-10. */
  note?: string;
  /** The form's timestamp. Defaults to one fixed instant. */
  at?: string;
}

const VOLUME_4 = 'Je préfère rester sur un seul créneau de 4 h. 😊';
const VOLUME_8 = 'Je suis partant·e pour 4 h de plus, j\'ai l\'habitude ! 💪💪';

/**
 * By index into the real export, because that is what the file has forty of.
 *
 * The fifteen useful answers sit at fixed positions among twenty-five the tool ignores, and the
 * gaps are not padding: three of them are the decoys that stole a real column the first time the
 * binder met the actual file. Writing the row positionally, as the export does, is what keeps
 * this fixture a fixture of the real thing.
 */
const csvOf = (rows: readonly Row[]): string =>
  [
    FORM_COLUMNS.map(quote).join(','),
    ...rows.map((r) => {
      const row = new Array<string>(FORM_COLUMNS.length).fill('');
      row[0] = r.at ?? '2026-10-01 10:00';
      row[1] = r.email;
      row[2] = r.last;
      row[3] = r.first;
      row[7] = '0600000000';
      row[10] = 'Dupont Claude, 06 11 22 33 44';
      row[19] = r.volume ?? VOLUME_4;
      row[20] = r.choice1 ?? 'Bar / Service';
      row[21] = 'Habitué';
      row[22] = r.choice2 ?? 'Propreté';
      row[23] = 'Habitué';
      row[24] = r.refusedPoles ?? 'Aucun';
      row[25] = r.note ?? '';
      row[26] = r.preference ?? 'Peux importe';
      row[29] = r.buddies ?? '';
      row[32] = '2 personnes';
      return row.map(quote).join(',');
    }),
  ].join('\n');

/** The headers carry commas and apostrophes, so the fixture has to be a real CSV. */
const quote = (value: string): string =>
  /[",\n]/.test(value) ? '"' + value.split('"').join('""') + '"' : value;

const importOf = (rows: readonly Row[], plan?: Plan): ImportResult =>
  importVolunteers(csvOf(rows), {
    startISO: EVENT_START_ISO,
    poles,
    artists,
    ...(plan ? { existingCodes: existingCodes(plan) } : {}),
  });

const BASE: Row[] = [
  { first: 'Alice', last: 'Martin', email: 'alice@example.org' },
  { first: 'Bruno', last: 'Petit', email: 'bruno@example.org' },
  { first: 'Chloé', last: 'Durand', email: 'chloe@example.org' },
];

/** An empty plan carrying the real poles and shifts, then the three rows above. */
function planWith(rows: readonly Row[]): Plan {
  const base = loadScenario('balanced');
  const imported = importOf(rows);
  return { ...base, volunteers: imported.volunteers, buddies: [], assignments: [], reserve: [] };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test('identity comes from the answer, never from the row it sits on', () => {
  // The bug this replaced: keys were `row1`, `row2`… so deleting one row renamed everybody below
  // it, and every assignment in the plan silently pointed at the wrong person.
  const first = importOf(BASE);
  const withoutAlice = importOf(BASE.slice(1));

  strictEqual(first.volunteers[1]!.key, withoutAlice.volunteers[0]!.key);
  strictEqual(first.volunteers[2]!.key, withoutAlice.volunteers[1]!.key);
});

test('the email is the identity, so a corrected name still finds the same person', () => {
  const before = importOf(BASE);
  const renamed = importOf([{ ...BASE[0]!, first: 'Alix' }, ...BASE.slice(1)]);
  strictEqual(before.volunteers[0]!.key, renamed.volunteers[0]!.key);
});

test('without an email the name is the identity, and a clash is reported not merged', () => {
  strictEqual(volunteerIdentity('Jean', 'Dupont', ''), 'nom:jean-dupont');
  strictEqual(volunteerIdentity('Jean', 'Dupont', 'J.Dupont@Example.org '), 'mail:j.dupont@example.org');

  const twins = importOf([
    { first: 'Jean', last: 'Dupont', email: '' },
    { first: 'Jean', last: 'Dupont', email: '' },
  ]);
  strictEqual(twins.volunteers.length, 2, 'les deux réponses sont importées');
  ok(twins.volunteers[0]!.key !== twins.volunteers[1]!.key, 'avec des clés distinctes');
  ok(twins.issues.some((i) => i.code === 'identite-ambigue'), 'et le problème est signalé');
});

test('two answers on one address are one person, and the later answer is kept', () => {
  const twice = importOf([
    { first: 'Alice', last: 'Martin', email: 'alice@example.org', volume: VOLUME_4 },
    BASE[1]!,
    { first: 'Alice', last: 'Martin', email: 'Alice@Example.org', volume: VOLUME_8 },
  ]);
  strictEqual(twice.volunteers.length, 2, 'une seule fiche pour Alice');
  const alice = twice.volunteers.find((v) => v.firstName === 'Alice')!;
  strictEqual(alice.key, 'mail:alice@example.org');
  strictEqual(alice.requestedHours, 8, 'la réponse la plus récente fait foi');
  const issue = twice.issues.find((i) => i.code === 'reponse-en-double');
  ok(issue, 'la réponse remplacée est signalée');
  strictEqual(issue!.row, 1);
  ok(!issue!.message.includes('même nom'), 'pas de doute sur le nom quand il est le même');
  ok(!twice.issues.some((i) => i.code === 'identite-ambigue'));
});

test('the timestamp decides which answer is the later one, not the row order', () => {
  // A sheet sorted by hand: the first row is the newer answer.
  const result = importOf([
    { first: 'Alice', last: 'Martin', email: 'alice@example.org', volume: VOLUME_8, at: '02/10/2026 09:30:00' },
    { first: 'Alix', last: 'Martin', email: 'alice@example.org', volume: VOLUME_4, at: '01/10/2026 18:00:00' },
  ]);
  strictEqual(result.volunteers.length, 1);
  strictEqual(result.volunteers[0]!.firstName, 'Alice');
  const issue = result.issues.find((i) => i.code === 'reponse-en-double')!;
  ok(issue.message.includes('même nom'), 'des noms différents sont signalés pour vérification');
});

// ---------------------------------------------------------------------------
// What a fresh export changes
// ---------------------------------------------------------------------------

test('a new row is an addition, a changed answer is an update, a missing row is a removal', () => {
  const plan = planWith(BASE);
  const next = importOf([
    { ...BASE[0]!, volume: VOLUME_8 },
    // Bruno is gone from this export.
    BASE[2]!,
    { first: 'David', last: 'Roux', email: 'david@example.org' },
  ]);

  const r = reconcileVolunteers(plan, next);
  deepStrictEqual(r.added.map((v) => v.firstName), ['David']);
  deepStrictEqual(r.updated.map((u) => u.name), ['Alice Martin']);
  deepStrictEqual(r.removed.map((entry) => entry.name), ['Bruno Petit']);
  strictEqual(r.unchanged, 1, 'Chloé n\'a rien changé');

  deepStrictEqual(r.updated[0]!.changes, [
    { label: 'Volume demandé', before: '4 h', after: '8 h' },
  ]);
});

test('a removal says what it would cost before anybody decides', () => {
  const filled = greedyFill(planWith(BASE));
  const bruno = filled.volunteers.find((v) => v.firstName === 'Bruno')!;
  const held = filled.assignments.filter((a) => a.volunteerKey === bruno.key).length;
  ok(held > 0, 'Bruno doit être placé quelque part');

  const r = reconcileVolunteers(filled, importOf([BASE[0]!, BASE[2]!]));
  strictEqual(r.removed.length, 1);
  strictEqual(r.removed[0]!.assignments, held);
  ok(r.removed[0]!.hours > 0);
  ok(summariseReconciliation(r).includes('absent'));
});

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

test('an update overwrites the answers and keeps every placement', () => {
  const filled = greedyFill(planWith(BASE));
  const alice = filled.volunteers.find((v) => v.firstName === 'Alice')!;
  const held = filled.assignments.filter((a) => a.volunteerKey === alice.key).map((a) => a.shiftKey);
  ok(held.length > 0);

  const next = importOf([{ ...BASE[0]!, volume: VOLUME_8 }, BASE[1]!, BASE[2]!], filled);
  const after = applyReconciliation(filled, next, reconcileVolunteers(filled, next));

  const updated = after.volunteers.find((v) => v.key === alice.key)!;
  strictEqual(updated.requestedHours, 8, 'la réponse vient du CSV');
  deepStrictEqual(
    after.assignments.filter((a) => a.volunteerKey === alice.key).map((a) => a.shiftKey),
    held,
    'et le placement reste celui du régisseur',
  );
});

test('an access code already sent out survives a re-import', () => {
  const plan = planWith(BASE);
  const codes = plan.volunteers.map((v) => v.accessCode);

  const next = importOf(BASE.map((r) => ({ ...r, volume: '6 heures' })), plan);
  const after = applyReconciliation(plan, next, reconcileVolunteers(plan, next));

  deepStrictEqual(after.volunteers.map((v) => v.accessCode), codes);
});

test('a removal takes the person and their placements, and nothing else', () => {
  const filled = greedyFill(planWith(BASE));
  const bruno = filled.volunteers.find((v) => v.firstName === 'Bruno')!;
  const others = filled.assignments.filter((a) => a.volunteerKey !== bruno.key).length;

  const next = importOf([BASE[0]!, BASE[2]!], filled);
  const after = applyReconciliation(filled, next, reconcileVolunteers(filled, next));

  ok(!after.volunteers.some((v) => v.key === bruno.key));
  ok(!after.assignments.some((a) => a.volunteerKey === bruno.key));
  strictEqual(after.assignments.length, others, 'les autres gardent tout');
  strictEqual(validate(after).issues.filter((i) => i.code === 'reference-inconnue').length, 0);
});

test('a removal can be refused, and then nothing about that person moves', () => {
  // A filtered view exported by mistake must not cost somebody their evening.
  const filled = greedyFill(planWith(BASE));
  const bruno = filled.volunteers.find((v) => v.firstName === 'Bruno')!;
  const held = filled.assignments.filter((a) => a.volunteerKey === bruno.key).map((a) => a.shiftKey);

  const next = importOf([BASE[0]!, BASE[2]!], filled);
  const after = applyReconciliation(filled, next, reconcileVolunteers(filled, next), {
    keep: new Set([bruno.key]),
  });

  ok(after.volunteers.some((v) => v.key === bruno.key));
  deepStrictEqual(
    after.assignments.filter((a) => a.volunteerKey === bruno.key).map((a) => a.shiftKey),
    held,
  );
});

test('an export that changes nothing changes nothing', () => {
  const filled = greedyFill(planWith(BASE));
  const next = importOf(BASE, filled);
  const r = reconcileVolunteers(filled, next);

  strictEqual(r.added.length, 0);
  strictEqual(r.updated.length, 0);
  strictEqual(r.removed.length, 0);
  strictEqual(r.unchanged, BASE.length);
  ok(summariseReconciliation(r).includes('Rien à changer'));

  const after = applyReconciliation(filled, next, r);
  deepStrictEqual(
    after.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`).sort(),
    filled.assignments.map((a) => `${a.volunteerKey}|${a.shiftKey}`).sort(),
  );
});

test('a buddy pair is rebuilt from the export it came from', () => {
  const plan = planWith(BASE);
  const next = importOf([
    { ...BASE[0]!, buddies: 'Bruno Petit' },
    BASE[1]!,
    BASE[2]!,
  ], plan);

  const after = applyReconciliation(plan, next, reconcileVolunteers(plan, next));
  const alice = after.volunteers.find((v) => v.firstName === 'Alice')!;
  const bruno = after.volunteers.find((v) => v.firstName === 'Bruno')!;

  ok(after.buddies.some((b) => b.fromKey === alice.key && b.toKey === bruno.key));
});

test('a pairing pointing at somebody removed does not survive as a dangling reference', () => {
  const plan = planWith(BASE);
  const withPair = importOf([{ ...BASE[0]!, buddies: 'Bruno Petit' }, BASE[1]!, BASE[2]!], plan);
  const paired = applyReconciliation(plan, withPair, reconcileVolunteers(plan, withPair));
  ok(paired.buddies.length > 0);

  // Bruno leaves the form.
  const next = importOf([BASE[0]!, BASE[2]!], paired);
  const after = applyReconciliation(paired, next, reconcileVolunteers(paired, next));

  const survivors = new Set(after.volunteers.map((v) => v.key));
  for (const pair of after.buddies) {
    ok(survivors.has(pair.fromKey) && survivors.has(pair.toKey), 'aucun binôme orphelin');
  }
});

test('reconciling never mutates the plan it was given', () => {
  const filled = greedyFill(planWith(BASE));
  const before = JSON.stringify(filled);
  const next = importOf([BASE[0]!], filled);
  applyReconciliation(filled, next, reconcileVolunteers(filled, next));
  strictEqual(JSON.stringify(filled), before);
});

// ---------------------------------------------------------------------------
// Corrections made by hand, and what a re-import is allowed to do to them
// ---------------------------------------------------------------------------

/** The plan after the régisseur corrected one field on one fiche, the way the panel does. */
function corrected(
  plan: Plan,
  key: string,
  patch: Partial<Volunteer>,
  fields: EditableField[],
): Plan {
  return {
    ...plan,
    volunteers: plan.volunteers.map((v) =>
      v.key === key ? { ...v, ...patch, manualFields: fields, needsReview: false, reviewReasons: [] } : v,
    ),
  };
}

test('an answer the importer could not read flags the fiche, and quotes what was written', () => {
  const rows: Row[] = [
    {
      ...BASE[0]!,
      note: "Je dois voir avec ma soeur, je vous redis",
    },
  ];
  const imported = importOf(rows);
  const alice = imported.volunteers[0]!;
  ok(alice.needsReview, 'la fiche doit partir en relecture');
  deepStrictEqual(alice.refusedSlotIds, [], 'aucune tranche ne doit être inventée');
  strictEqual(alice.availabilityNote, 'Je dois voir avec ma soeur, je vous redis');
  ok(alice.reviewReasons.some((r) => r.includes('soeur')), 'la phrase est citée au régisseur');
});

test('a correction survives a re-import of the same export', () => {
  const rows: Row[] = [{ ...BASE[0]!, note: "Je ne peux pas avant 15h" }];
  const plan = planWith(rows);
  const key = plan.volunteers[0]!.key;

  // The parser refused the whole afternoon over a constraint that only covers half of it, and
  // said so. The régisseur decides the person can do the afternoon after all.
  const fixed = corrected(plan, key, { refusedSlotIds: [] }, ['refusedSlotIds']);

  const again = importOf(rows, fixed);
  const after = applyReconciliation(fixed, again, reconcileVolunteers(fixed, again));
  const alice = after.volunteers.find((v) => v.key === key)!;

  deepStrictEqual(alice.refusedSlotIds, [], 'la correction doit tenir');
  ok(!alice.needsReview, 'et la fiche ne doit pas repartir en relecture toute seule');
});

test('a field nobody corrected is still updated by the export', () => {
  const rows: Row[] = [{ ...BASE[0]!, note: "Je ne peux pas avant 15h" }];
  const plan = planWith(rows);
  const key = plan.volunteers[0]!.key;
  const fixed = corrected(plan, key, { refusedSlotIds: [] }, ['refusedSlotIds']);

  const again = importOf([{ ...rows[0]!, volume: VOLUME_8 }], fixed);
  const after = applyReconciliation(fixed, again, reconcileVolunteers(fixed, again));
  const alice = after.volunteers.find((v) => v.key === key)!;

  strictEqual(alice.requestedHours, 8, "le ré-import reste la façon dont une réponse arrive");
  deepStrictEqual(alice.refusedSlotIds, [], 'sans toucher au champ corrigé');
});

test('a sentence rewritten by the volunteer sends the fiche back to relecture, correction kept', () => {
  const plan = planWith([{ ...BASE[0]!, note: "Je ne peux pas avant 15h" }]);
  const key = plan.volunteers[0]!.key;
  const fixed = corrected(plan, key, { refusedSlotIds: [] }, ['refusedSlotIds']);

  // Same person, new answer: the correction was made against something they no longer say.
  const again = importOf([{ ...BASE[0]!, note: "Finalement je ne peux pas de 0h à 6h" }], fixed);
  const after = applyReconciliation(fixed, again, reconcileVolunteers(fixed, again));
  const alice = after.volunteers.find((v) => v.key === key)!;

  deepStrictEqual(alice.refusedSlotIds, [], 'la correction du régisseur est conservée');
  strictEqual(alice.availabilityNote, 'Finalement je ne peux pas de 0h à 6h');
  ok(alice.needsReview, 'mais quelqu\u2019un doit relire');
  ok(
    alice.reviewReasons.some((r) => r.includes('changé')),
    'et la raison doit dire que la réponse a changé',
  );
});

test('the review screen shows what accepting the import really does, corrections included', () => {
  const plan = planWith([{ ...BASE[0]!, note: "Je ne peux pas avant 15h" }]);
  const key = plan.volunteers[0]!.key;
  const fixed = corrected(plan, key, { refusedSlotIds: [] }, ['refusedSlotIds']);

  const again = importOf([{ ...BASE[0]!, note: "Je ne peux pas avant 15h" }], fixed);
  const diff = reconcileVolunteers(fixed, again);

  // The export would put the afternoon back, and it will not: nothing changes, so the screen
  // must not announce a change. This is the whole reason both sides call `mergeWithManual`.
  const change = diff.updated.find((u) => u.key === key);
  ok(
    !change || !change.changes.some((c) => c.label === 'Tranches refusées'),
    'aucune ligne ne doit annoncer un changement qui ne se produira pas',
  );
});

test('mergeWithManual keeps the access code, like any other import', () => {
  const plan = planWith(BASE);
  const before = plan.volunteers[0]!;
  const imported = { ...before, accessCode: 'AUTRECODE', phone: '0611111111' };
  const merged = mergeWithManual(before, imported);
  strictEqual(merged.accessCode, before.accessCode, 'un code déjà envoyé ne change jamais');
  strictEqual(merged.phone, '0611111111');
});

test('a binôme added by hand survives the next export, and one removed by hand does not come back', () => {
  const plan = planWith(BASE);
  const withPair = importOf([{ ...BASE[0]!, buddies: 'Bruno Petit' }, BASE[1]!, BASE[2]!], plan);
  const paired = applyReconciliation(plan, withPair, reconcileVolunteers(plan, withPair));
  const alice = paired.volunteers.find((v) => v.firstName === 'Alice')!;
  const bruno = paired.volunteers.find((v) => v.firstName === 'Bruno')!;
  const chloe = paired.volunteers.find((v) => v.firstName === 'Chloé')!;

  // By hand: Alice no longer with Bruno, Chloé now with Alice.
  const edited: Plan = {
    ...paired,
    buddies: [{ fromKey: chloe.key, toKey: alice.key, manual: true }],
    dismissedBuddies: [{ fromKey: alice.key, toKey: bruno.key }],
  };
  const again = importOf([{ ...BASE[0]!, buddies: 'Bruno Petit' }, BASE[1]!, BASE[2]!], edited);
  const after = applyReconciliation(edited, again, reconcileVolunteers(edited, again));
  ok(!after.buddies.some((b) => b.fromKey === alice.key && b.toKey === bruno.key), 'le binôme retiré reste retiré');
  ok(after.buddies.some((b) => b.fromKey === chloe.key && b.toKey === alice.key), 'le binôme ajouté reste');
});

// ---------------------------------------------------------------------------
// Bénévole ↔ orga, 2026-09-15
// ---------------------------------------------------------------------------

test('a row naming somebody the plan holds as an orga is listed, never added as a second person', () => {
  const plan = planWith(BASE.slice(1));
  const withOrga: Plan = {
    ...plan,
    organisers: [
      ...plan.organisers,
      { key: 'resp-alice', firstName: 'Alice', lastName: 'Martin', email: 'ALICE@example.org', phone: '', accessCode: '', diet: '', allergies: '', note: '', montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [] },
    ],
  };
  const imported = importOf(BASE, withOrga);
  const r = reconcileVolunteers(withOrga, imported);
  strictEqual(r.added.length, 0);
  deepStrictEqual(r.alreadyOrga.map((v) => v.firstName), ['Alice']);
  ok(summariseReconciliation(r).includes('1 déjà orga, non ajouté'));
  const next = applyReconciliation(withOrga, imported, r);
  ok(!next.volunteers.some((v) => v.firstName === 'Alice'), 'still one fiche for Alice: the orga');
  strictEqual(next.volunteers.length, 2);
});

test('an absent bénévole entered by hand is kept by default, an absent one from the form is not', () => {
  const plan = planWith(BASE);
  const byHand: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v) => (v.firstName === 'Bruno' ? { ...v, enteredByHand: true } : v)),
  };
  const r = reconcileVolunteers(byHand, importOf([BASE[0]!]));
  strictEqual(r.removed.length, 2);
  const kept = keptByDefault(r);
  deepStrictEqual([...kept].map((key) => byHand.volunteers.find((v) => v.key === key)!.firstName), ['Bruno']);
});

test("a re-import never touches the régisseur's tracking of an application", () => {
  const plan = planWith(BASE);
  const tracked: Plan = {
    ...plan,
    volunteers: plan.volunteers.map((v, i) =>
      i === 0 ? { ...v, status: 'annule' as const, statusSteps: ['confirmation'], regieNote: 'mail du 3' } : v),
  };
  const next = importOf([{ ...BASE[0]!, volume: VOLUME_8 }, ...BASE.slice(1)]);
  const applied = applyReconciliation(tracked, next, reconcileVolunteers(tracked, next));
  const alice = applied.volunteers.find((v) => v.firstName === 'Alice')!;
  strictEqual(alice.requestedHours, 8, 'la réponse est mise à jour');
  strictEqual(alice.status, 'annule');
  deepStrictEqual(alice.statusSteps, ['confirmation']);
  strictEqual(alice.regieNote, 'mail du 3');
});
