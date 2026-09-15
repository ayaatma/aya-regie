/**
 * The acts as files: the moments an act occupies, where they fall on each grid's own axis, and
 * what a member of it eats and is handed.
 *
 * What is pinned here is the translation: balances typed as hours of the EVENT (negative when
 * the day before) reach the montage in the montage's own hours, clipped, and the caterer counts
 * the same person once whichever moment the plate falls in.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CATERING,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  DEFAULT_RULES,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_SLOTS,
  makeArtist,
  makeArtistMember,
  type Artist,
  type CateringSettings,
  type Organiser,
} from './model.js';
import { DEFAULT_CONSTRAINTS } from './constraints.js';
import { PlanIndex, type Plan } from './plan.js';
import { defaultPhase } from './phase.js';
import {
  actsOfPerson,
  artistInvitations,
  memberIsLinked,
  artistMemberDrinks,
  artistMemberName,
  artistMoments,
  artistMomentsIn,
  artistMomentsInExploit,
  artistPresence,
  artistTravelLine,
  phaseOffset,
} from './artists.js';
import { cateringReport, setMealChoice } from './catering.js';

const START = '2027-03-13T12:00:00+01:00';
/** Two days before the event, 08h: the montage's hour 52 is the event's hour 0. */
const MONTAGE_START = '2027-03-11T08:00:00+01:00';

function makePlan(artists: Artist[], catering?: CateringSettings): Plan {
  const montage = { ...defaultPhase('montage', MONTAGE_START, 52), enabled: true };
  return {
    name: 'artistes',
    startISO: START,
    lengthHours: 18,
    address: '12 rue de la Salle, Annecy',
    sheetUrl: '',
    rules: DEFAULT_RULES,
    slots: DEFAULT_SLOTS,
    preferenceSlots: DEFAULT_PREFERENCE_SLOTS,
    poles: [],
    shifts: [],
    artists,
    organisers: [],
    leaderRoles: [],
    volunteers: [],
    buddies: [],
    assignments: [],
    reserve: [],
    organiserShifts: [],
    montage,
    demontage: defaultPhase('demontage', '2027-03-14T06:00:00+01:00'),
    ticketing: DEFAULT_TICKETING,
    travel: DEFAULT_TRAVEL_RATES,
    poleChoicesRanked: true,
    volume: { scope: 'event', dayStartHour: 12, options: [4, 6, 8] },
    formMapping: { columns: {}, answers: {} },
    applicationSteps: [],
    skills: [],
    teamsEnabled: false,
    teams: [],
    dismissedBuddies: [],
    constraints: DEFAULT_CONSTRAINTS,
    catering: catering ?? {
      ...DEFAULT_CATERING,
      rules: { ...DEFAULT_CATERING.rules, enabled: true },
    },
  };
}

test('an act with nothing decided occupies its set and nothing else', () => {
  const artist = makeArtist({ key: 'a', name: 'Doline', start: 10, end: 11.5 });
  assert.deepEqual(
    artistMoments(artist).map((m) => [m.kind, m.start, m.end]),
    [['set', 10, 11.5]],
  );
  assert.deepEqual(artistPresence(artist), { start: 10, end: 11.5 });
});

test('the changeovers sit on each side of the set and the balances may fall before the event', () => {
  const artist = makeArtist({
    key: 'a',
    name: 'Doline',
    start: 10,
    end: 11.5,
    changeoverBefore: 0.5,
    changeoverAfter: 0.25,
    soundcheckNeeded: true,
    soundcheckStart: -20,
    soundcheckEnd: -18,
  });
  assert.deepEqual(
    artistMoments(artist).map((m) => [m.kind, m.start, m.end]),
    [
      ['soundcheck', -20, -18],
      ['changeover', 9.5, 10],
      ['set', 10, 11.5],
      ['changeover', 11.5, 11.75],
    ],
  );
  // On site from the balances to the end of the last changeover, as one window.
  assert.deepEqual(artistPresence(artist), { start: -20, end: 11.75 });
});

test('balances that are not needed, or half typed, draw nothing', () => {
  const off = makeArtist({ key: 'a', name: 'X', start: 1, end: 2, soundcheckStart: -3, soundcheckEnd: -2 });
  assert.equal(artistMoments(off).length, 1);
  const backwards = makeArtist({
    key: 'a', name: 'X', start: 1, end: 2, soundcheckNeeded: true, soundcheckStart: -2, soundcheckEnd: -3,
  });
  assert.equal(artistMoments(backwards).length, 1);
});

test('the montage reads the balances in its own hours, clipped to its window', () => {
  const plan = makePlan([
    makeArtist({
      key: 'a',
      name: 'Doline',
      start: 10,
      end: 11.5,
      changeoverBefore: 1,
      soundcheckNeeded: true,
      soundcheckStart: -20,
      soundcheckEnd: -18,
    }),
  ]);
  assert.equal(phaseOffset(plan.startISO, plan.montage), -52);

  const onMontage = artistMomentsIn(plan.startISO, plan.montage, plan.artists);
  // 16h to 18h on the 12th: hour 32 to 34 of a montage that started the 11th at 08h.
  assert.deepEqual(
    onMontage.map((m) => [m.kind, m.start, m.end]),
    [['soundcheck', 32, 34]],
  );
  assert.equal(onMontage[0]!.label, 'Doline · balances');

  // The set and the changeover are the exploit's, and the balances are not.
  assert.deepEqual(
    artistMomentsInExploit(plan.lengthHours, plan.artists).map((m) => [m.kind, m.start, m.end]),
    [
      ['changeover', 9, 10],
      ['set', 10, 11.5],
    ],
  );
});

test('a changeover running past the end of the event is clipped, not dropped', () => {
  const late = makeArtist({ key: 'a', name: 'X', start: 17, end: 18, changeoverAfter: 1 });
  assert.deepEqual(
    artistMomentsInExploit(18, [late]).map((m) => [m.kind, m.start, m.end]),
    [['set', 17, 18]],
  );
  const stretched = makeArtist({ key: 'a', name: 'X', start: 17, end: 18.5 });
  assert.deepEqual(
    artistMomentsInExploit(18, [stretched]).map((m) => [m.kind, m.start, m.end]),
    [['set', 17, 18]],
  );
});

test('a member eats at every service the act is on the venue for, in any moment', () => {
  const plan = makePlan([
    makeArtist({
      key: 'a',
      name: 'Doline',
      // 22h to 23h30 on the 13th, balances 16h to 18h the day before.
      start: 10,
      end: 11.5,
      soundcheckNeeded: true,
      soundcheckStart: -20,
      soundcheckEnd: -18,
      members: [makeArtistMember({ key: 'a-1', firstName: 'Lou', lastName: 'Marin', diet: 'végé' })],
    }),
  ]);
  const report = cateringReport(plan, new PlanIndex(plan));
  const lou = report.people.find((p) => p.key === 'a-1');
  assert.ok(lou);
  assert.equal(lou.kind, 'artiste');
  assert.equal(lou.group, 'Doline');
  assert.equal(lou.name, 'Lou Marin');
  // On site from the 12th 16h to the 13th 23h30: the soir of the 12th, both services of the 13th.
  assert.deepEqual(lou.serviceKeys, ['2027-03-12|soir', '2027-03-13|midi', '2027-03-13|soir']);
  // No quota: the exploit's tiers say nothing about an act.
  assert.equal(lou.exploitMeals, 0);
  assert.equal(lou.drinks, DEFAULT_CATERING.rules.artistDrinks);
  assert.deepEqual(report.diets, [{ label: 'végé', names: ['Lou Marin'] }]);
});

test('a member follows the event setting for tickets until a figure is set for them alone', () => {
  const rules = { ...DEFAULT_CATERING.rules, artistDrinks: 3 };
  assert.equal(artistMemberDrinks(makeArtistMember({ key: 'm' }), rules), 3);
  assert.equal(artistMemberDrinks(makeArtistMember({ key: 'm', drinkTickets: 1 }), rules), 1);
  assert.equal(artistMemberDrinks(makeArtistMember({ key: 'm', drinkTickets: -4 }), rules), 0);
});

test('the régisseur unticks a plate for a member and the disagreement is what is stored', () => {
  const plan = makePlan([
    makeArtist({
      key: 'a',
      name: 'Doline',
      // 20h to 21h30: across the soir service.
      start: 8,
      end: 9.5,
      members: [makeArtistMember({ key: 'a-1' })],
    }),
  ]);
  const before = cateringReport(plan, new PlanIndex(plan)).people.find((p) => p.key === 'a-1')!;
  assert.deepEqual(before.serviceKeys, ['2027-03-13|soir']);

  const choices = setMealChoice(plan, 'artiste', 'a-1', '2027-03-13|soir', false, true);
  assert.deepEqual(choices, [
    { personKind: 'artiste', personKey: 'a-1', serviceKey: '2027-03-13|soir', takes: false },
  ]);
  const after = cateringReport(
    { ...plan, catering: { ...plan.catering, choices } },
    new PlanIndex(plan),
  ).people.find((p) => p.key === 'a-1')!;
  assert.deepEqual(after.serviceKeys, []);
  assert.deepEqual(after.handPicked, ['2027-03-13|soir']);
});

test('a member nobody has named is called after the act and their row', () => {
  const artist = makeArtist({
    key: 'a',
    name: 'Doline',
    start: 1,
    end: 2,
    members: [makeArtistMember({ key: 'm1' }), makeArtistMember({ key: 'm2', firstName: 'Sam' })],
  });
  assert.equal(artistMemberName(artist, artist.members[0]!), 'Doline · membre 1');
  assert.equal(artistMemberName(artist, artist.members[1]!), 'Sam');
});

test('the invitations and the défraiement read as one line each', () => {
  const artist = makeArtist({
    key: 'a',
    name: 'Doline',
    start: 1,
    end: 2,
    trainTickets: 2,
    planeTickets: 1,
    planeDone: true,
    extraGuests: [
      { key: 'g1', firstName: 'A', lastName: 'B' },
      { key: 'g2', firstName: 'C', lastName: 'D' },
      { key: 'g3', firstName: 'E', lastName: 'F' },
    ],
    members: [
      makeArtistMember({ key: 'm1', guests: [{ key: 'g4', firstName: 'G', lastName: 'H' }] }),
      makeArtistMember({ key: 'm2' }),
    ],
  });
  assert.equal(artistInvitations(artist), 4);
  assert.equal(artistTravelLine(artist), "2 billets de train à prendre, 1 billet d'avion pris");
  assert.equal(artistTravelLine(makeArtist({ key: 'b', name: 'X', start: 1, end: 2 })), '');
});

// ---------------------------------------------------------------------------
// A member who is also a bénévole or an orga: one person, one row, one plate
// ---------------------------------------------------------------------------

const orga = (key: string): Organiser => ({
  key,
  firstName: 'Camille',
  lastName: 'Dubois',
  email: '',
  phone: '',
  accessCode: '',
  diet: 'sans gluten',
  allergies: '',
  note: '',
  montageFrom: null,
  demontageUntil: null,
  montagePoleKeys: [],
  demontagePoleKeys: [],
});

/** Camille runs the event as an orga AND plays at 20h in Doline, with balances the day before. */
function planWithCamille(cumulative = false, soundcheck = true): Plan {
  const base = makePlan(
    [
      makeArtist({
        key: 'a',
        name: 'Doline',
        start: 8,
        end: 9.5,
        soundcheckNeeded: soundcheck,
        soundcheckStart: -20,
        soundcheckEnd: -18,
        members: [
          makeArtistMember({ key: 'a-1', firstName: 'Lou' }),
          makeArtistMember({ key: 'a-2', linkedKind: 'orga', linkedKey: 'cam', drinkTickets: 3 }),
        ],
      }),
    ],
    {
      ...DEFAULT_CATERING,
      rules: { ...DEFAULT_CATERING.rules, enabled: true, organiserDrinks: 2, artistDrinksCumulative: cumulative },
    },
  );
  return { ...base, organisers: [orga('cam')] };
}

test('a member who is also an orga is one row on the caterer\'s sheet, never two', () => {
  const plan = planWithCamille();
  const report = cateringReport(plan, new PlanIndex(plan));
  const rows = report.people.filter((p) => p.key === 'cam' || p.key === 'a-2');
  assert.equal(rows.length, 1, 'the member row is folded into the person');
  const camille = rows[0]!;
  assert.equal(camille.kind, 'orga');
  assert.equal(camille.group, 'Doline', "the act's name rides on the person's row");
  assert.equal(camille.diet, 'sans gluten', "the person's own diet, not the member's");
  // Lou, who is nobody else, keeps a row of their own.
  assert.ok(report.people.some((p) => p.key === 'a-1' && p.kind === 'artiste'));
});

test("the person eats as the act does by default: the artist's effects, not the orga's floor", () => {
  // No balances: the act is on the venue for its 20h set alone.
  const plan = planWithCamille(false, false);
  const camille = cateringReport(plan, new PlanIndex(plan)).people.find((p) => p.key === 'cam')!;
  // The set at 20h ticks the exploit's soir. The orga floor (2 meals on the exploit) says
  // nothing: she is there as an artist.
  assert.deepEqual(camille.serviceKeys, ['2027-03-13|soir']);
  // And no act hour was counted as a worked hour.
  assert.equal(camille.hours.exploit, 0);

  // With balances the afternoon before, the act's window runs from them to the set, midi
  // included: one window, as `artistPresence` promises.
  const withBalances = planWithCamille(false, true);
  assert.deepEqual(
    cateringReport(withBalances, new PlanIndex(withBalances)).people.find((p) => p.key === 'cam')!.serviceKeys,
    ['2027-03-12|soir', '2027-03-13|midi', '2027-03-13|soir'],
  );
});

test('cumulative: both statuses count on the same row, and one plate is still one plate', () => {
  const plan = planWithCamille(true, false);
  const camille = cateringReport(plan, new PlanIndex(plan)).people.find((p) => p.key === 'cam')!;
  // The act's soir spends one of the two orga meals; the second buys midi. Never a doublon.
  assert.deepEqual(camille.serviceKeys, ['2027-03-13|midi', '2027-03-13|soir']);
});

test("the drink tickets of a person with two statuses: the artist's, or both when the event says so", () => {
  const one = cateringReport(planWithCamille(false), new PlanIndex(planWithCamille(false)));
  assert.equal(one.people.find((p) => p.key === 'cam')!.drinks, 3, '3 as artist, the 2 as orga set aside');
  const both = cateringReport(planWithCamille(true), new PlanIndex(planWithCamille(true)));
  assert.equal(both.people.find((p) => p.key === 'cam')!.drinks, 5, '2 + 3');
  const fewer = { ...planWithCamille(false) };
  fewer.artists[0]!.members[1]!.drinkTickets = 1;
  assert.equal(
    cateringReport(fewer, new PlanIndex(fewer)).people.find((p) => p.key === 'cam')!.drinks,
    1,
    "the artist's figure even when it is the smaller one",
  );
});

test('a link to somebody the plan no longer holds reads as no link at all', () => {
  const plan = { ...planWithCamille(), organisers: [] };
  const report = cateringReport(plan, new PlanIndex(plan));
  assert.ok(report.people.some((p) => p.key === 'a-2' && p.kind === 'artiste'), 'back to a row of their own');
  assert.equal(memberIsLinked(plan.artists[0]!.members[1]!, plan.organisers, plan.volunteers), false);
  assert.equal(actsOfPerson(plan.artists, 'orga', 'cam').length, 1, 'the link itself is still recorded');
});
