/**
 * Runs the validation engine over a generated scenario and prints the dashboard the régisseur
 * would see.
 *
 *   npm run validate                                  # scenario "balanced"
 *   npm run validate -- --scenario=shortage-heavy
 *   npm run validate -- --scenario=balanced --broken  # inject one violation per tier 1 code
 *   npm run validate -- --all                         # every scenario in out/, one line each
 *   npm run validate -- --scenario=balanced --verbose
 *
 * The plan comes from `greedyFill`, which is a baseline, not the solver. Two properties are
 * asserted on every run and are the point of this CLI: the baseline never produces a tier 1
 * issue, and `--broken` produces exactly the codes it says it injected.
 */

import { existsSync, readdirSync } from 'node:fs';

import { fmtHours } from './plan.js';
import { greedyFill, injectViolations, loadScenario } from './plan-fixtures.js';
import { validate, type ValidationResult } from './validate.js';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const pct = (n: number, total: number): string =>
  total === 0 ? '-' : `${((100 * n) / total).toFixed(0)}%`;

function report(scenario: string, result: ValidationResult, verbose: boolean): void {
  const { summary } = result;

  console.log(`=== ${scenario} ===`);
  console.log('');
  console.log('COUVERTURE');
  console.log(`  ${summary.shiftsFilled}/${summary.shiftsTotal} créneaux complets, ` +
              `${summary.shiftsPartial} incomplets, ${summary.shiftsEmpty} vides`);
  console.log(`  ${fmtHours(summary.assignedHours)} affectées sur ${fmtHours(summary.demandHours)} ` +
              `à pourvoir, il manque ${fmtHours(summary.gapHours)}`);
  console.log(`  ${fmtHours(summary.offeredHours)} proposées par les inscrits`);
  console.log('');

  console.log('BÉNÉVOLES');
  console.log(`  ${summary.volunteersTotal} inscrits, ${summary.volunteersUnassigned} sans aucun créneau, ` +
              `${summary.volunteersBelowFloor} sous le plancher de 4h, ` +
              `${summary.volunteersOnReserve} en réserve`);
  console.log(`  ${summary.volunteersAtRequested} ont obtenu le volume demandé ` +
              `(${pct(summary.volunteersAtRequested, summary.volunteersTotal)})`);
  if (summary.overRecruited) {
    console.log(`  ALERTE sur-recrutement : au-delà de ${summary.volunteerCeiling} inscrits, ` +
                `quelqu'un passe forcément sous 4h.`);
  }
  console.log('');

  console.log('PRÉFÉRENCES');
  const placed = (summary.hoursByRank[0] ?? 0) + (summary.hoursByRank[1] ?? 0) + summary.hoursHorsChoix;
  console.log(`  Choix 1 : ${fmtHours((summary.hoursByRank[0] ?? 0))} (${pct((summary.hoursByRank[0] ?? 0), placed)})`);
  console.log(`  Choix 2 : ${fmtHours((summary.hoursByRank[1] ?? 0))} (${pct((summary.hoursByRank[1] ?? 0), placed)})`);
  console.log(`  Hors choix : ${fmtHours(summary.hoursHorsChoix)} (${pct(summary.hoursHorsChoix, placed)}), ` +
              `${summary.horsChoix.length} bénévoles concernés`);
  for (const entry of verbose ? summary.horsChoix : summary.horsChoix.slice(0, 3)) {
    console.log(`      ${entry.name} -> ${entry.poles.join(', ')}`);
  }
  if (!verbose && summary.horsChoix.length > 3) {
    console.log(`      ... et ${summary.horsChoix.length - 3} autres`);
  }
  console.log(`  Binômes : ${summary.buddyHonoured}/${summary.buddyRequests} honorés ` +
              `(${pct(summary.buddyHonoured, summary.buddyRequests)})`);
  console.log('');

  console.log('MANQUES PAR TRANCHE');
  for (const slot of summary.gapsBySlot) {
    console.log(`  ${slot.label.padEnd(24)} ${fmtHours(slot.hours).padStart(6)} à pourvoir`);
  }
  console.log('');

  console.log('MANQUES PAR PÔLE');
  for (const entry of summary.gapsByPole.slice(0, verbose ? 100 : 6)) {
    console.log(`  ${fmtHours(entry.gapHours).padStart(6)}  ${entry.path}`);
  }
  console.log('');

  console.log('ANOMALIES');
  console.log(`  ${summary.tier1Count} de niveau 1 (illégales), ${summary.tier2Count} de niveau 2 (à traiter)`);
  for (const entry of summary.byCode) {
    console.log(`  ${String(entry.count).padStart(4)}  [T${entry.tier}] ${entry.code}`);
    const sample = result.issues.filter((i) => i.code === entry.code);
    for (const issue of verbose ? sample : sample.slice(0, 2)) {
      console.log(`        ${issue.message}`);
    }
    if (!verbose && sample.length > 2) console.log(`        ... et ${sample.length - 2} autres`);
  }
  console.log('');

  console.log('DIAGNOSTIC DES TROUS (les 3 créneaux les plus démunis)');
  const worst = result.shifts
    .filter((s) => s.gap !== null)
    .sort((a, b) => b.missing - a.missing || (a.gap!.disponibles - b.gap!.disponibles))
    .slice(0, 3);
  for (const s of worst) {
    console.log(`  ${s.label} : ${s.missing} place(s) manquante(s)`);
    console.log(`      ${s.gap!.raison}`);
  }
  console.log('');

  console.log('PRESSION SUR LA PROGRAMMATION');
  for (const artist of [...result.artists].sort((a, b) => b.namedBy - a.namedBy).slice(0, 3)) {
    console.log(`  ${artist.name} (${artist.window}) : cité par ${artist.namedBy} bénévoles, ` +
                `${artist.assignedDuring} placés pendant son set, ` +
                `${fmtHours(artist.demandHours)} de besoin sur ce créneau`);
  }
  console.log('');
}

function runOne(scenario: string, broken: boolean, verbose: boolean): boolean {
  const empty = loadScenario(scenario);
  const filled = greedyFill(empty);

  const baseline = validate(filled);
  let ok = true;

  if (baseline.summary.tier1Count > 0) {
    ok = false;
    console.log(`ÉCHEC: la base greedy a produit ${baseline.summary.tier1Count} anomalies de niveau 1.`);
    for (const issue of baseline.issues.filter((i) => i.tier === 1).slice(0, 5)) {
      console.log(`   ${issue.code}: ${issue.message}`);
    }
  }

  if (!broken) {
    report(scenario, baseline, verbose);
    console.log(ok
      ? 'Contrôle : la base greedy ne produit aucune anomalie de niveau 1, comme attendu.'
      : 'Contrôle : ÉCHEC, voir ci-dessus.');
    return ok;
  }

  const { plan: sabotaged, injected } = injectViolations(filled);
  const after = validate(sabotaged);
  report(`${scenario} (saboté)`, after, verbose);

  console.log('CONTRÔLE DES VIOLATIONS INJECTÉES');
  const found = new Set(after.issues.filter((i) => i.tier === 1).map((i) => i.code));
  for (const entry of injected) {
    const caught = found.has(entry.code);
    if (!caught) ok = false;
    console.log(`  ${caught ? 'OK  ' : 'RATÉ'}  ${entry.code}  ` +
                `(${entry.volunteerKey} sur ${entry.shiftKey})`);
  }
  const unexpected = [...found].filter((c) => !injected.some((i) => i.code === c));
  if (unexpected.length > 0) {
    console.log(`  Codes de niveau 1 apparus sans avoir été injectés : ${unexpected.join(', ')}`);
    console.log('  (attendu quand une injection en déclenche plusieurs, voir alsoTriggers)');
  }
  return ok;
}

function main(): void {
  const verbose = process.argv.includes('--verbose');
  const broken = process.argv.includes('--broken');

  if (process.argv.includes('--all')) {
    const root = arg('out') ?? 'out';
    let allOk = true;
    for (const scenario of readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      const started = Date.now();
      const empty = loadScenario(scenario, root);
      const filled = greedyFill(empty);
      const result = validate(filled);
      const { summary } = result;
      const tier1 = summary.tier1Count;
      if (tier1 > 0) allOk = false;
      console.log(
        `${scenario.padEnd(42)} ` +
        `${String(summary.volunteersTotal).padStart(4)} bénévoles  ` +
        `${String(summary.shiftsFilled).padStart(3)}/${summary.shiftsTotal} créneaux  ` +
        `manque ${fmtHours(summary.gapHours).padStart(6)}  ` +
        `0h:${String(summary.volunteersUnassigned).padStart(3)}  ` +
        `T1:${String(tier1).padStart(3)}  T2:${String(summary.tier2Count).padStart(4)}  ` +
        `${Date.now() - started} ms`,
      );
    }
    console.log('');
    console.log(allOk
      ? 'Aucune anomalie de niveau 1 sur aucun scénario.'
      : 'ÉCHEC : au moins un scénario produit une anomalie de niveau 1.');
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  const scenario = arg('scenario') ?? 'balanced';
  const root = arg('out') ?? 'out';
  if (!existsSync(`${root}/${scenario}`)) {
    console.error(`Scénario "${scenario}" introuvable dans ${root}/. Lancer d'abord npm run generate.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = runOne(scenario, broken, verbose) ? 0 : 1;
}

main();
