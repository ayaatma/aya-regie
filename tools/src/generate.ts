/**
 * Synthetic dataset generator.
 *
 *   npm run generate
 *   npm run generate -- --volume=balanced
 *   npm run generate -- --volume=balanced --stress=headliner,debutants --seed=7
 *   npm run generate -- --list
 *
 * Writes, per scenario, the four CSVs the tool will import (form answers, poles, shifts,
 * line-up), the access-code list, and a summary that says whether the scenario is actually as
 * tight as it claims to be.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Rng } from './rng.js';
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  demandHours,
  toLabel,
  type Artist,
  type Pole,
  type Shift,
  type SkillLevel,
  toClock,
  type EventSlot,
  type SlotId,
  type Volunteer,
  absentFromPhase,
} from './model.js';
import { allowedVolumes, refusedWindows, usableWindows } from './availability.js';
import { DEFAULT_VOLUME } from './days.js';
import type { Volume } from './scenarios.js';
import {
  EVENT_LENGTH_HOURS,
  EVENT_NAME,
  EVENT_START_ISO,
  HEADLINER_NAME,
  buildArtists,
  buildPoles,
  buildShifts,
} from './event-config.js';
import {
  FIRST_NAMES,
  LAST_NAMES,
  NICKNAMES,
  makeAccessCode,
  makeEmail,
  makePhone,
  typedName,
} from './names.js';
import {
  BASE_CONFIG,
  STRESS_SCENARIOS,
  VOLUME_SCENARIOS,
  resolveConfig,
  type GenConfig,
} from './scenarios.js';
import {
  FORM_COLUMNS,
  artistsToCsv,
  codesToCsv,
  polesToCsv,
  shiftsToCsv,
  toCsv,
  volunteerToFormRow,
} from './csv.js';

// ---------------------------------------------------------------------------
// Volunteers
// ---------------------------------------------------------------------------

/**
 * How often somebody who rules out one pole rules out a second as well.
 *
 * The refusal is a checkbox question, so several answers are the normal case rather than an
 * edge one, and a generator that only ever produces a single veto would not exercise the code
 * that reads the list. Deliberately not in `GenConfig`: it is a property of the form, the same
 * in every scenario, and the scenarios vary tension rather than question shape.
 */
const SECOND_REFUSAL_SHARE = 0.3;

/**
 * How much less likely somebody who prefers the loto is to name an evening artist.
 *
 * They can be placed in the evening now, so naming one is no longer a contradiction, just less
 * likely. It used to be impossible, which was a consequence of the preference being a wall.
 */
const AFTERNOON_ARTIST_SHARE = 0.25;

/**
 * A yes or no drawn from a string rather than from the generator's own stream.
 *
 * For anything added to a volunteer after the scenarios were measured. Every draw from `rng`
 * moves every later one, so reaching for it here would rewrite the fixtures from that point on
 * and quietly invalidate what the numbers in the memory files say about them.
 */
function coin(text: string, ratio: number): boolean {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 100) / 100 < ratio;
}

/**
 * The time constraint as somebody would write it, since the form asks for a sentence.
 *
 * THREE KINDS OF SENTENCE ON PURPOSE, because the importer has to meet all three and a fixture
 * that only contains the easy one proves nothing:
 *
 *   - readable, and matching the slots drawn above. Most answers.
 *   - readable with a doubt: an hour that cuts a slot in half, which the parser refuses whole
 *     and sends to review.
 *   - unreadable: a real sentence with no hour in it, which the parser refuses to guess at.
 *
 * Seeded on the row rather than drawn from `rng`, so adding this question did not renumber
 * every scenario the measurements were taken on.
 */
function noteFor(index: number, refusedSlotIds: readonly SlotId[]): string {
  if (refusedSlotIds.length === 0) {
    if (coin(`note-vide${index}`, 0.85)) return '';
    return coin(`note-rien${index}`, 0.5) ? 'Aucune contrainte' : 'Non, tout me va';
  }

  // Four in ten just tick the old closed question instead of writing anything, which is what
  // an empty note means here and what the CSV writer turns into a slot label in column 25.
  if (coin(`note-ferme${index}`, 0.4)) return '';

  if (coin(`note-floue${index}`, 0.12)) {
    return "Je dois m'organiser avec la nounou, je vous préviens dès que je sais";
  }

  const slots = refusedSlotIds
    .map((id) => DEFAULT_SLOTS.find((slot) => slot.id === id))
    .filter((slot): slot is EventSlot => slot !== undefined)
    .sort((a, b) => a.start - b.start);
  if (slots.length === 0) return '';

  const clock = (hours: number): string => toClock(EVENT_START_ISO, hours);
  if (slots.length === 1) {
    const slot = slots[0]!;
    if (coin(`note-partielle${index}`, 0.15)) {
      // Half a slot: the answer a parser can read and still be wrong about.
      const middle = slot.start + (slot.end - slot.start) / 2;
      return `Je ne peux pas avant ${clock(middle)}`;
    }
    return coin(`note-forme${index}`, 0.5)
      ? `Je ne suis pas disponible de ${clock(slot.start)} à ${clock(slot.end)}`
      : `Pas dispo entre ${clock(slot.start)} et ${clock(slot.end)}, désolé`;
  }

  return slots
    .map((slot) => `pas de ${clock(slot.start)} à ${clock(slot.end)}`)
    .join(' et ');
}

function descendsFrom(pole: Pole, rootKey: string, byKey: Map<string, Pole>): boolean {
  let current: Pole | undefined = pole;
  while (current) {
    if (current.key === rootKey) return true;
    current = current.parentKey ? byKey.get(current.parentKey) : undefined;
  }
  return false;
}

interface GenContext {
  config: GenConfig;
  rng: Rng;
  poles: Pole[];
  leaves: Pole[];
  roots: Pole[];
  popularity: Map<string, number>;
  artists: Artist[];
}

function generateVolunteers(ctx: GenContext): Volunteer[] {
  const { config, rng, leaves, roots, popularity, artists } = ctx;
  const byKey = new Map(ctx.poles.map((p) => [p.key, p]));
  const codes = new Set<string>();
  const volunteers: Volunteer[] = [];

  const shunnedRoot = config.shunnedRootName
    ? roots.find((r) => r.name === config.shunnedRootName)
    : undefined;
  const headliner = artists.find((a) => a.name === HEADLINER_NAME);

  const levels: SkillLevel[] = ['debutant', 'intermediaire', 'expert'];

  for (let i = 0; i < config.volunteers; i++) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);

    const preferenceAnswer = rng.weighted(
      ['loto', 'concerts', 'any'] as const,
      (h) => config.halfWeights[h],
    );
    const preferredSlotId = preferenceAnswer === 'any' ? null : preferenceAnswer;

    // Drawn independently of the preference since 2026-09-08, because the form asks two
    // unrelated questions: which half you would rather work, and when you cannot come at all.
    // Tying them together here quietly hid the combinations the importer will really see.
    //
    // TWO SLOTS ARE POSSIBLE SINCE 2026-09-10, and so is a sentence the parser cannot read.
    // The form asks this in free text now, so the generated CSV has to contain the three things
    // the importer will meet in the real one: a sentence it reads cleanly, a sentence it reads
    // with a doubt, and a sentence it cannot read at all. Without the third, the review queue
    // would never be exercised by any fixture.
    const refusedSlotIds: SlotId[] = [];
    if (rng.chance(config.refusedSlotProbability)) {
      refusedSlotIds.push(rng.pick(DEFAULT_SLOTS.map((slot) => slot.id)));
      // DRAWN FROM A SEED AND NOT FROM `rng`, like the nickname below and for the same reason:
      // one more number taken from the generator here would shift every later draw and rewrite
      // every scenario the measurements are built on.
      if (coin(`deuxieme-tranche${i}`, 0.15)) {
        const second = DEFAULT_SLOTS[Math.abs(i * 7919) % DEFAULT_SLOTS.length]!.id;
        if (!refusedSlotIds.includes(second)) refusedSlotIds.push(second);
      }
    }
    const availabilityNote = noteFor(i, refusedSlotIds);

    // The form only offers what the availability answer leaves room for, so the generator
    // does the same.
    const options = allowedVolumes(
      refusedWindows(DEFAULT_SLOTS, refusedSlotIds),
      DEFAULT_RULES,
      EVENT_LENGTH_HOURS,
      DEFAULT_VOLUME.options,
    );
    const requestedHours = rng.weighted(options, (v) => config.volumeWeights[v as Volume]);

    const refusedPoleKeys: string[] = [];
    if (shunnedRoot && rng.chance(config.shunnedVetoShare ?? 0)) {
      refusedPoleKeys.push(shunnedRoot.key);
    } else if (rng.chance(config.refusedPoleProbability)) {
      refusedPoleKeys.push(rng.pick(roots).key);
    }
    if (refusedPoleKeys.length > 0 && rng.chance(SECOND_REFUSAL_SHARE)) {
      const second = roots.filter((r) => !refusedPoleKeys.includes(r.key));
      if (second.length > 0) refusedPoleKeys.push(rng.pick(second).key);
    }

    const weightOf = (p: Pole): number => {
      const base = popularity.get(p.key) ?? 1;
      const shunned = shunnedRoot && descendsFrom(p, shunnedRoot.key, byKey) ? 0.05 : 1;
      return base * shunned;
    };

    const eligible = leaves.filter(
      (p) => !refusedPoleKeys.some((root) => descendsFrom(p, root, byKey)),
    );
    const choice1 = rng.weighted(eligible, weightOf);
    const rest = eligible.filter((p) => p.key !== choice1.key);
    const choice2 = rest.length > 0 ? rng.weighted(rest, weightOf) : choice1;

    const artistKeys: string[] = [];
    const artistChance =
      config.artistProbability *
      (preferredSlotId === 'loto' ? AFTERNOON_ARTIST_SHARE : 1);
    if (rng.chance(artistChance)) {
      const pick = headliner && rng.chance(config.headlinerBias)
        ? headliner
        : rng.pick(artists);
      artistKeys.push(pick.key);
    }

    // Roughly a third of the registrations answer the surname question, and only where a
    // plausible one exists. Enough for a fixture to exercise the short labels without
    // pretending every volunteer goes by something else.
    //
    // DRAWN FROM THE NAME AND NOT FROM `rng`, on purpose. Taking a number from the generator
    // here would shift every later draw, so adding this field would have quietly rewritten every
    // scenario the fixtures and the measurements are built on.
    const nickname = NICKNAMES[firstName] !== undefined && coin(`surnom${firstName}${i}`, 0.3)
      ? NICKNAMES[firstName]!
      : '';

    volunteers.push({
      key: `v${i}`,
      firstName,
      lastName,
      nickname,
      email: makeEmail(firstName, lastName, i),
      phone: makePhone(rng),
      accessCode: makeAccessCode(rng, codes),
      // Drawn from the name rather than from `rng`, like the surname above and for the same
      // reason: taking a number from the generator here would shift every later draw and quietly
      // rewrite every scenario the measurements are built on.
      diet: coin(`regime${firstName}${i}`, 0.18) ? 'Végétarien' : 'Sans restriction',
      allergies: coin(`allergie${firstName}${i}`, 0.08) ? 'Fruits à coque' : 'Non',
      requestedHours,
      preferredSlotId,
      refusedSlotIds,
      availabilityNote,
      refusedPoleKeys,
      choices: [
        { poleKey: choice1.key, raw: choice1.path, level: rng.weighted(levels, (l) => config.levelWeights[l]) },
        {
          poleKey: choice2.key,
      // A few answers come through the form's "Autre" box as prose naming no pole the form
      // lists. The importer cannot match them, flags the fiche, and the régisseur decides: that
      // path has to exist in a fixture or the review queue is never exercised by one. The drawn
      // key stays on the object so the scenario's own statistics keep counting a second choice;
      // the CSV, which is the artifact, carries the prose.
          raw: coin(`autre-pole${i}`, 0.04)
        ? "Autre : je voudrais m'occuper du feu d'artifice"
        : choice2.path,
          level: rng.weighted(levels, (l) => config.levelWeights[l]),
        },
      ],
      artistKeys,
      buddyRawNames: [],
      manualFields: [],
      needsReview: false,
      reviewReasons: [],
      // The synthetic scenarios are about the exploit, so nobody is generated onto a phase.
      montage: absentFromPhase(),
      demontage: absentFromPhase(),
    });
  }

  addBuddyRequests(volunteers, config, rng);
  return volunteers;
}

/**
 * Buddy requests are one-way. People tend to name someone working the same half of the event,
 * so the generator prefers that, which keeps the requests plausibly satisfiable.
 */
function addBuddyRequests(volunteers: Volunteer[], config: GenConfig, rng: Rng): void {
  for (const v of volunteers) {
    if (!rng.chance(config.buddyProbability)) continue;

    const sameHalf = volunteers.filter(
      (o) => o.key !== v.key && o.preferredSlotId === v.preferredSlotId,
    );
    const pool = sameHalf.length >= 4 ? sameHalf : volunteers.filter((o) => o.key !== v.key);
    if (pool.length === 0) continue;

    const count = rng.chance(config.secondBuddyProbability) ? 2 : 1;
    for (const target of rng.sample(pool, count)) {
      v.buddyRawNames.push(
        typedName(target.firstName, target.lastName, rng, config.buddyMangleProbability),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Splits a shift's person-hours across the three time slots it spans. */
function demandBySlot(shifts: readonly Shift[]): Map<SlotId, number> {
  const totals = new Map<SlotId, number>(DEFAULT_SLOTS.map((s) => [s.id, 0]));
  for (const s of shifts) {
    for (const slot of DEFAULT_SLOTS) {
      const overlap = Math.min(s.end, slot.end) - Math.max(s.start, slot.start);
      if (overlap > 0) totals.set(slot.id, (totals.get(slot.id) ?? 0) + overlap * s.headcount);
    }
  }
  return totals;
}

/**
 * Upper bound of the hours available per slot. A volunteer counts fully in every slot they
 * could work, so the columns overlap on purpose: the point is to spot a slot where the ceiling
 * is already below the demand, which is a recruitment problem no solver can fix.
 */
function offerBySlot(volunteers: readonly Volunteer[]): Map<SlotId, number> {
  const totals = new Map<SlotId, number>(DEFAULT_SLOTS.map((s) => [s.id, 0]));
  for (const v of volunteers) {
    const windows = usableWindows(refusedWindows(DEFAULT_SLOTS, v.refusedSlotIds), EVENT_LENGTH_HOURS);
    for (const slot of DEFAULT_SLOTS) {
      const reaches = windows.some(
        (w) => Math.min(w.end, slot.end) - Math.max(w.start, slot.start) > 0,
      );
      if (reaches) totals.set(slot.id, (totals.get(slot.id) ?? 0) + v.requestedHours);
    }
  }
  return totals;
}

function tally<T extends string>(items: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function buildSummary(
  label: string,
  config: GenConfig,
  poles: Pole[],
  shifts: Shift[],
  artists: Artist[],
  volunteers: Volunteer[],
): string {
  const pathByKey = new Map(poles.map((p) => [p.key, p.path]));
  const demand = demandHours(shifts);
  const offered = volunteers.reduce((t, v) => t + v.requestedHours, 0);
  const averageOffered = offered / volunteers.length;
  const perSlotDemand = demandBySlot(shifts);
  const perSlotOffer = offerBySlot(volunteers);

  const cappedAt4 = volunteers.filter(
    (v) =>
      allowedVolumes(
        refusedWindows(DEFAULT_SLOTS, v.refusedSlotIds),
        DEFAULT_RULES,
        EVENT_LENGTH_HOURS,
        DEFAULT_VOLUME.options,
      ).length === 1,
  ).length;

  const first = (v: Volunteer, i: number) => v.choices[i]?.poleKey ?? '';
  const choice1 = tally(volunteers.map((v) => pathByKey.get(first(v, 0)) ?? first(v, 0)));
  const choice2 = tally(volunteers.map((v) => pathByKey.get(first(v, 1)) ?? first(v, 1)));
  const neverChosen = poles
    .filter((p) => !poles.some((q) => q.parentKey === p.key))
    .filter((p) => !choice1.has(p.path) && !choice2.has(p.path))
    .map((p) => p.path);

  const vetoes = tally(
    volunteers.flatMap((v) => v.refusedPoleKeys.map((key) => pathByKey.get(key)!)),
  );
  const artistPicks = tally(
    volunteers.flatMap((v) =>
      v.artistKeys.map((k) => artists.find((a) => a.key === k)?.name ?? k),
    ),
  );
  const buddyCount = volunteers.reduce((t, v) => t + v.buddyRawNames.length, 0);

  const lines: string[] = [];
  const pct = (n: number) => `${((100 * n) / volunteers.length).toFixed(0)}%`;
  const top = (counts: Map<string, number>, n: number) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => `${k} (${v})`).join(', ');

  lines.push(`Scénario : ${label}`);
  lines.push(`Événement : ${EVENT_NAME}, ${toLabel(EVENT_START_ISO, 0)} -> ${toLabel(EVENT_START_ISO, 18)}`);
  lines.push('');
  lines.push('BESOIN');
  lines.push(`  ${shifts.length} créneaux sur ${poles.filter((p) => !poles.some((q) => q.parentKey === p.key)).length} pôles terminaux`);
  lines.push(`  ${demand.toFixed(0)} heures-personnes à pourvoir`);
  lines.push('');
  lines.push('OFFRE');
  lines.push(`  ${volunteers.length} bénévoles inscrits`);
  lines.push(`  ${offered} heures proposées, soit ${averageOffered.toFixed(1)}h de moyenne`);
  lines.push(`  ${cappedAt4} bénévoles (${pct(cappedAt4)}) plafonnés à 4h par leurs réponses de disponibilité`);
  lines.push('');

  const gap = demand - offered;
  lines.push('ÉCART');
  if (gap > 0) {
    lines.push(`  Déficit de ${gap.toFixed(0)}h. Il manque environ ${Math.ceil(gap / averageOffered)} bénévoles.`);
  } else {
    lines.push(`  Surplus de ${(-gap).toFixed(0)}h.`);
  }
  const floorNeeded = volunteers.length * DEFAULT_RULES.minHoursPerPerson;
  if (floorNeeded > demand) {
    lines.push(
      `  ALERTE sur-recrutement : le plancher de ${DEFAULT_RULES.minHoursPerPerson}h par personne ` +
      `réclame ${floorNeeded}h pour ${demand.toFixed(0)}h disponibles. ` +
      `${Math.ceil((floorNeeded - demand) / DEFAULT_RULES.minHoursPerPerson)} bénévoles ne peuvent pas atteindre leur plancher.`,
    );
  }
  lines.push('');

  lines.push('PAR TRANCHE (l\'offre est un plafond, les colonnes se recouvrent)');
  for (const slot of DEFAULT_SLOTS) {
    const d = perSlotDemand.get(slot.id) ?? 0;
    const o = perSlotOffer.get(slot.id) ?? 0;
    const flag = o < d ? '  <-- plafond sous le besoin' : '';
    lines.push(`  ${slot.id}  besoin ${d.toFixed(0).padStart(4)}h   offre max ${o.toFixed(0).padStart(4)}h${flag}`);
  }
  lines.push('');

  lines.push('RÉPARTITION DES RÉPONSES');
  const halves = tally(volunteers.map((v) => v.preferredSlotId ?? 'any'));
  lines.push(`  Préférence : loto ${halves.get('loto') ?? 0}, concerts ${halves.get('concerts') ?? 0}, peu importe ${halves.get('any') ?? 0}`);
  const volumes = tally(volunteers.map((v) => `${v.requestedHours}h`));
  lines.push(`  Volume : ${[...volumes.entries()].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const lvl = tally(volunteers.flatMap((v) => (v.choices[0] ? [v.choices[0].level] : [])));
  lines.push(`  Niveau (choix 1) : débutant ${lvl.get('debutant') ?? 0}, intermédiaire ${lvl.get('intermediaire') ?? 0}, expert ${lvl.get('expert') ?? 0}`);
  lines.push('');

  lines.push('PRÉFÉRENCES');
  lines.push(`  Choix 1 les plus demandés : ${top(choice1, 4)}`);
  lines.push(`  Pôles refusés : ${vetoes.size > 0 ? top(vetoes, 4) : 'aucun'}`);
  lines.push(`  Pôles que personne ne choisit : ${neverChosen.length > 0 ? neverChosen.join(', ') : 'aucun'}`);
  lines.push(`  Demandes de binôme : ${buddyCount}`);
  lines.push(`  Artistes cités : ${artistPicks.size > 0 ? top(artistPicks, 3) : 'aucun'}`);

  const headlinerCount = artistPicks.get(HEADLINER_NAME) ?? 0;
  if (headlinerCount > 0) {
    const artist = artists.find((a) => a.name === HEADLINER_NAME)!;
    lines.push(
      `  ALERTE couverture : ${headlinerCount} bénévoles (${pct(headlinerCount)}) indisponibles ` +
      `de ${toLabel(EVENT_START_ISO, artist.start)} à ${toLabel(EVENT_START_ISO, artist.end)} (${HEADLINER_NAME}).`,
    );
  }

  lines.push('');
  lines.push(`Config : ${JSON.stringify(config)}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Answers arrive over the campaign, heavily front-loaded once the form is announced. */
function submissionTimestamp(rng: Rng): { iso: number; label: string } {
  const start = Date.parse('2026-10-15T09:00:00+02:00');
  const end = Date.parse('2027-02-20T23:00:00+01:00');
  const t = start + (end - start) * Math.pow(rng.next(), 2.2);
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    iso: t,
    label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

function writeScenario(id: string, label: string, config: GenConfig, seed: number, outRoot: string): void {
  const rng = new Rng(seed);
  const { poles, leaves, roots, popularity } = buildPoles();
  const shifts = buildShifts(poles);
  const artists = buildArtists();
  const volunteers = generateVolunteers({ config, rng, poles, leaves, roots, popularity, artists });

  const pathByKey = new Map(poles.map((p) => [p.key, p.path]));
  const artistNameByKey = new Map(artists.map((a) => [a.key, a.name]));

  // The buddy question asks for a name, a mail address and a phone number in one box, so the
  // generated answer needs the friend's details, not just their name.
  const contactByName = new Map(
    volunteers.map((v) => [`${v.firstName} ${v.lastName}`, { email: v.email, phone: v.phone }]),
  );

  const rows = volunteers
    .map((v) => ({ v, at: submissionTimestamp(rng) }))
    .sort((a, b) => a.at.iso - b.at.iso)
    .map(({ v, at }) =>
      volunteerToFormRow(v, {
        polePathByKey: pathByKey,
        artistNameByKey,
        submittedAt: at.label,
        contactByName,
      }),
    );

  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'benevoles.csv'), toCsv(FORM_COLUMNS, rows), 'utf8');
  writeFileSync(join(dir, 'poles.csv'), polesToCsv(poles), 'utf8');
  writeFileSync(join(dir, 'creneaux.csv'), shiftsToCsv(shifts, pathByKey, EVENT_START_ISO), 'utf8');
  writeFileSync(join(dir, 'lineup.csv'), artistsToCsv(artists, EVENT_START_ISO), 'utf8');
  writeFileSync(join(dir, 'codes_acces.csv'), codesToCsv(volunteers), 'utf8');

  const summary = buildSummary(label, config, poles, shifts, artists, volunteers);
  writeFileSync(join(dir, 'resume.txt'), summary, 'utf8');

  console.log(`\n=== ${dir} ===`);
  console.log(summary);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function main(): void {
  if (process.argv.includes('--list')) {
    console.log('Volume scenarios:');
    for (const s of VOLUME_SCENARIOS) {
      console.log(`  ${s.id.padEnd(20)} ${s.label} (${s.patch.volunteers ?? BASE_CONFIG.volunteers} bénévoles)`);
      console.log(`  ${' '.repeat(20)} ${s.exercises}`);
    }
    console.log('\nStress scenarios (combinables, --stress=a,b):');
    for (const s of STRESS_SCENARIOS) {
      console.log(`  ${s.id.padEnd(20)} ${s.label}`);
      console.log(`  ${' '.repeat(20)} ${s.exercises}`);
    }
    return;
  }

  const seed = Number(arg('seed') ?? 20270313);
  const outRoot = arg('out') ?? 'out';
  const stressIds = (arg('stress') ?? '').split(',').filter(Boolean);
  const volumeId = arg('volume');

  const targets = volumeId
    ? [VOLUME_SCENARIOS.find((s) => s.id === volumeId)!]
    : VOLUME_SCENARIOS;

  for (const target of targets) {
    const id = [target.id, ...stressIds].join('+');
    const label = [target.label, ...stressIds.map(
      (s) => STRESS_SCENARIOS.find((x) => x.id === s)?.label ?? s,
    )].join(' + ');
    writeScenario(id, label, resolveConfig(target.id, stressIds), seed, outRoot);
  }
}

main();
