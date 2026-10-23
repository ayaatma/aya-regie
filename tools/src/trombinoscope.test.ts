/**
 * The trombinoscope's order: every Responsable first, then the Staff and the bénévoles pole by
 * pole, exploit and phases; or one pole with its Responsables at the top.
 */

import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_RULES, absentFromPhase, type Organiser, type Volunteer } from './model.js';
import { emptyPlan, type Plan } from './plan.js';
import { trombinoscope } from './trombinoscope.js';

const volunteer = (key: string, firstName: string, nickname = ''): Volunteer => ({
  key, firstName, lastName: 'B', nickname, email: '', phone: '', accessCode: '', diet: '', allergies: '',
  requestedHours: 4, preferredSlotId: null, refusedSlotIds: [], availabilityNote: '', refusedPoleKeys: [],
  choices: [], artistKeys: [], buddyRawNames: [], manualFields: [], needsReview: false, reviewReasons: [],
  montage: absentFromPhase(), demontage: absentFromPhase(),
});

const orga = (key: string, firstName: string, role: 'responsable' | 'staff'): Organiser => ({
  key, firstName, lastName: 'O', email: '', phone: '', accessCode: '', diet: '', allergies: '', note: '',
  montageFrom: null, demontageUntil: null, montagePoleKeys: [], demontagePoleKeys: [], role,
});

function plan(): Plan {
  const base = emptyPlan({
    name: 'Essai', startISO: '2027-03-13T11:00:00.000Z', lengthHours: 18, address: '', sheetUrl: '',
    slots: [], preferenceSlots: [], rules: DEFAULT_RULES, artists: [], volunteers: [],
    poles: [
      { key: 'bar', name: 'Bar', parentKey: null, path: 'Bar', allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 2 },
      { key: 'bar-pression', name: 'Pression', parentKey: 'bar', path: 'Bar > Pression', allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 2 },
      { key: 'accueil', name: 'Accueil', parentKey: null, path: 'Accueil', allowAllDebutants: true, minExperienced: 0, defaultHeadcount: 2 },
    ],
    shifts: [
      { key: 'p@1', poleKey: 'bar-pression', start: 0, end: 2, headcount: 3 },
      { key: 'a@1', poleKey: 'accueil', start: 0, end: 2, headcount: 3 },
    ],
  });
  return {
    ...base,
    organisers: [orga('resp-zoe', 'Zoé', 'responsable'), orga('resp-ali', 'Ali', 'responsable'), orga('st-max', 'Max', 'staff'), orga('st-lou', 'Lou', 'staff')],
    leaderRoles: [{ key: 'r1', organiserKey: 'resp-zoe', poleKey: 'bar', start: 0, end: 4 }],
    organiserShifts: [{ key: 'os1', organiserKey: 'st-max', shiftKey: 'p@1' }],
    volunteers: [volunteer('v-anne', 'Anne', 'Nano'), volunteer('v-bob', 'Bob')],
    assignments: [
      { volunteerKey: 'v-anne', shiftKey: 'p@1', locked: false, source: 'solver' },
      { volunteerKey: 'v-anne', shiftKey: 'a@1', locked: false, source: 'solver' },
      { volunteerKey: 'v-bob', shiftKey: 'a@1', locked: false, source: 'solver' },
    ],
    montage: {
      ...base.montage,
      enabled: true,
      poles: [...base.montage.poles, { key: 'scene', name: 'Scène' }],
      assignments: [
        { key: 'm1', personKind: 'orga', personKey: 'st-max', poleKey: 'scene', eventKey: '', start: 0, end: 4 },
        { key: 'm2', personKind: 'benevole', personKey: 'v-bob', poleKey: 'scene', eventKey: '', start: 0, end: 4 },
      ],
    },
  };
}

const shape = (sections: ReturnType<typeof trombinoscope>) =>
  sections.map((s) => [s.title, s.groups.map((g) => [g.title, g.people.map((p) => `${p.name}|${p.caption}`)])]);

test('the whole document: Responsables first, then Staff and bénévoles pole by pole', () => {
  deepStrictEqual(shape(trombinoscope(plan(), { kind: 'all' })), [
    ['Responsables', [['', ['Ali O|Général', 'Zoé O|Bar']]]],
    ['Staff', [['Bar', ['Max O|Staff']], ['Montage · Scène', ['Max O|Staff']], ['Sans pôle', ['Lou O|Staff']]]],
    ['Bénévoles', [['Bar', ['Anne B|Nano']], ['Accueil', ['Anne B|Nano', 'Bob B|']], ['Montage · Scène', ['Bob B|']]]],
  ]);
});

test("one pole's page: its Responsables on top, then its Staff, then its bénévoles", () => {
  deepStrictEqual(shape(trombinoscope(plan(), { kind: 'pole', poleId: 'exploit:bar' })), [
    ['Bar', [['Responsables', ['Zoé O|Bar']], ['Staff', ['Max O|Staff']], ['Bénévoles', ['Anne B|Nano']]]],
  ]);
});

test('every pole on its own page leaves out a pole nobody is on', () => {
  deepStrictEqual(
    trombinoscope(plan(), { kind: 'byPole' }).map((s) => s.title),
    ['Bar', 'Accueil', 'Montage · Scène'],
  );
});
