/**
 * Claude Code UserPromptSubmit hook: what the database's migrations look like, without the network.
 *
 * Reads db/.migration-state.json, which every connected run of tools/src/migrate-cli.ts writes
 * (the VS Code « BDD update » launch included), and compares it with the files in db/migrations:
 *   - pending migrations as of the last check, and when that check was;
 *   - files added since that check (the check cannot know about them);
 *   - APPLIED files whose content changed since they were applied: never edit those, write a
 *     new migration instead.
 * Prints one hookSpecificOutput.additionalContext block. Never fails the prompt.
 */
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const dir = join(root, 'db', 'migrations');

function main() {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let state = null;
  try {
    state = JSON.parse(readFileSync(join(root, 'db', '.migration-state.json'), 'utf8'));
  } catch {
    // never checked from this machine yet
  }
  const lines = [];
  if (!state) {
    lines.push(
      "Migrations: aucun état connu (db/.migration-state.json absent). Lancer `npm run migrate` (dry, dans tools/) avant de toucher une migration ou de dire qu'elle reste à appliquer.",
    );
  } else {
    const when = new Date(state.checkedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const known = new Set([...state.applied, ...state.pending]);
    const added = files.filter((f) => !known.has(f));
    const edited = Object.entries(state.hashes || {})
      .filter(([f, h]) => {
        try {
          return createHash('sha256').update(readFileSync(join(dir, f))).digest('hex') !== h;
        } catch {
          return true;
        }
      })
      .map(([f]) => f);
    lines.push(
      `Migrations, dernier contrôle ${when} (${state.mode === 'apply' ? 'application: « BDD update » ou --apply' : 'lecture seule'}): ` +
        `${state.applied.length} appliquées` +
        (state.pending.length ? `, EN ATTENTE: ${state.pending.join(', ')}` : ', rien en attente') +
        (state.missing && state.missing.length
          ? `. Vérification en échec: ${state.missing.length} objet(s) manquant(s)`
          : '') +
        '.',
    );
    if (added.length) {
      lines.push(
        `Fichiers de migration écrits depuis ce contrôle (état inconnu, supposer en attente): ${added.join(', ')}.`,
      );
    }
    if (edited.length) {
      lines.push(
        `ATTENTION: migration(s) APPLIQUÉE(S) modifiée(s) depuis leur application: ${edited.join(', ')}. Ne jamais éditer une migration appliquée: remettre le fichier tel qu'il a tourné et écrire une nouvelle migration.`,
      );
    }
    lines.push('Avant de modifier une migration récente, relancer `npm run migrate` (dry) pour rafraîchir cet état.');
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') },
    }),
  );
}

try {
  main();
} catch {
  // A broken status line must never block a message.
}
