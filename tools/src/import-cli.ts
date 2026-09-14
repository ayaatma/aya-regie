/**
 * Runs the importer over a generated scenario and prints the report the régisseur would see.
 *
 *   npm run import                                  # scenario "balanced"
 *   npm run import -- --scenario=balanced+buddies
 *   npm run import -- --file=path/to/benevoles.csv
 *   npm run import -- --scenario=balanced --verbose  # every issue, not just a sample
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EVENT_LENGTH_HOURS,
  EVENT_START_ISO,
  buildArtists,
  buildPoles,
} from './event-config.js';
import { importVolunteers, type ImportIssue } from './import.js';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function main(): void {
  const scenario = arg('scenario') ?? 'balanced';
  const file = arg('file') ?? join('out', scenario, 'benevoles.csv');
  const verbose = process.argv.includes('--verbose');

  const { poles } = buildPoles();
  const artists = buildArtists();
  const csv = readFileSync(file, 'utf8');

  const started = Date.now();
  const { volunteers, buddies, issues } = importVolunteers(csv, {
    poles,
    artists,
    startISO: EVENT_START_ISO,
    lengthHours: EVENT_LENGTH_HOURS,
  });
  const elapsed = Date.now() - started;

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const autoResolved = buddies.filter((b) => b.toKey !== null);
  const manual = buddies.filter((b) => b.toKey === null);

  console.log(`Fichier : ${file}`);
  console.log(`Import  : ${volunteers.length} bénévoles en ${elapsed} ms`);
  console.log('');

  console.log('BINÔMES');
  console.log(`  ${buddies.length} demandes`);
  if (buddies.length > 0) {
    const share = (n: number) => `${((100 * n) / buddies.length).toFixed(0)}%`;
    console.log(`  ${autoResolved.length} résolues automatiquement (${share(autoResolved.length)})`);
    console.log(`  ${manual.length} à trancher à la main (${share(manual.length)})`);
    const byVia = new Map<string, number>();
    for (const b of autoResolved) byVia.set(b.via, (byVia.get(b.via) ?? 0) + 1);
    for (const [via, n] of [...byVia.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(4)} via ${via}`);
    }
    const withSuggestion = manual.filter((b) => b.candidates.length > 0).length;
    console.log(`  ${withSuggestion} des ${manual.length} non résolues ont au moins une suggestion`);
  }
  console.log('');

  console.log('ANOMALIES');
  console.log(`  ${errors.length} erreurs, ${warnings.length} avertissements`);
  const byCode = new Map<string, ImportIssue[]>();
  for (const issue of issues) byCode.set(issue.code, [...(byCode.get(issue.code) ?? []), issue]);
  for (const [code, list] of [...byCode.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(4)}  ${code}`);
    for (const issue of verbose ? list : list.slice(0, 2)) {
      const where = issue.row !== null ? `ligne ${issue.row}` : 'global';
      const hint = issue.suggestions?.length ? `  -> ${issue.suggestions.join(' | ')}` : '';
      console.log(`        ${where}, ${issue.person}: ${issue.message}${hint}`);
    }
    if (!verbose && list.length > 2) console.log(`        ... et ${list.length - 2} autres`);
  }

  if (errors.length === 0) console.log('\nAucune erreur bloquante.');
}

main();
