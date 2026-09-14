/**
 * The journal's own rules, which are the ones nothing else can check.
 *
 * A journal is only worth having if it survives the situations it exists to describe: a network
 * that is down, a database that refuses, a burst of edits nobody expected. So what is tested here
 * is mostly failure, plus the one rule that outranks everything else on this path: RECORDING MUST
 * NEVER THROW INTO WHATEVER CALLED IT. A journal that can take an edit down with it is worse than
 * no journal at all, because it fails exactly when the thing it explains is already going wrong.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Logger, type LogEntry } from './logger.ts';

/** A sink that records what it was handed, and can be told to refuse. */
function sink() {
  const batches: Array<{ eventId: string | null; entries: LogEntry[] }> = [];
  let refuse = false;
  return {
    batches,
    fail: (yes: boolean) => {
      refuse = yes;
    },
    appendLog: (eventId: string | null, entries: readonly LogEntry[]) => {
      if (refuse) return Promise.reject(new Error('réseau injoignable'));
      batches.push({ eventId, entries: [...entries] });
      return Promise.resolve(entries.length);
    },
  };
}

/** autoFlush off: these tests drive the flush themselves rather than waiting four seconds. */
const logger = () => new Logger(false);

test('entries carry the plan they belong to, and never the one opened afterwards', async () => {
  const target = sink();
  const journal = logger();
  journal.attach(target);

  // Before a plan is open: the login, the picker, and any failure in either.
  journal.error('planning', 'Impossible de lire la liste des plannings.');
  journal.setEvent('event-1');
  journal.info('planning', 'Planning ouvert.');
  journal.setEvent('event-2');
  journal.info('edition', 'déplacement de Marie Perrin');

  await journal.flush();

  // Three groups, because filing the login failures under the plan somebody opened afterwards
  // is how a journal starts lying.
  assert.deepEqual(
    target.batches.map((batch) => [batch.eventId, batch.entries.length]),
    [
      [null, 1],
      ['event-1', 1],
      ['event-2', 1],
    ],
  );
});

test('a sink that refuses keeps the entries rather than losing them', async () => {
  const target = sink();
  const journal = logger();
  journal.attach(target);

  target.fail(true);
  journal.error('enregistrement', "Échec de l'enregistrement: réseau injoignable");
  await journal.flush();
  assert.equal(target.batches.length, 0);
  assert.equal(journal.pending, 1, 'gardée pour le prochain essai');

  target.fail(false);
  journal.info('enregistrement', 'Enregistré en version 8.');
  await journal.flush();

  assert.deepEqual(
    target.batches[0]?.entries.map((entry) => entry.message),
    ["Échec de l'enregistrement: réseau injoignable", 'Enregistré en version 8.'],
    "la plus ancienne d'abord, dans l'ordre où les choses se sont produites",
  );
});

test('a flush that throws is not a failure of whatever was being logged', async () => {
  const journal = logger();
  journal.attach({
    appendLog: () => {
      throw new Error('le client a explosé');
    },
  });

  journal.info('edition', 'déplacement de Marie Perrin');
  // Rule 1: not a rejected promise, not an exception. The edit that produced this line has
  // already happened and must not be undone by the act of describing it.
  await assert.doesNotReject(() => journal.flush());
  assert.equal(journal.pending, 1);
});

test('recording never throws, whatever it is handed', () => {
  const journal = logger();
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.doesNotThrow(() => journal.info('divers', 'x'.repeat(5000), circular));
});

test('a detail too big to be a sentence is kept as an excerpt, not dropped', async () => {
  const target = sink();
  const journal = logger();
  journal.attach(target);

  journal.info('import', 'Import appliqué.', { lignes: 'x'.repeat(4000) });
  journal.info('divers', 'Objet illisible.', (() => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    return circular;
  })());
  await journal.flush();

  const [big, broken] = target.batches[0]!.entries;
  assert.equal(big?.detail?.tronque, true);
  assert.ok(String(big?.detail?.apercu).length < 1100, "l'aperçu reste petit");
  assert.equal(broken?.detail?.illisible, true);
  assert.ok(big!.message.length <= 500);
});

test('a burst past the buffer keeps the newest and says how many it lost', async () => {
  const target = sink();
  const journal = logger();
  journal.attach(target);

  // The newest are the ones that explain the crash; the oldest are the ones to lose.
  for (let i = 1; i <= 500; i++) journal.info('edition', `édition ${i}`);
  await journal.flush();

  const sent = target.batches[0]!.entries;
  assert.equal(sent[0]?.level, 'warn');
  assert.match(sent[0]!.message, /100 entrée\(s\) de journal perdues/);
  assert.equal(sent[1]?.message, 'édition 101');
  assert.equal(sent[sent.length - 1]?.message, 'édition 500');
});

test('with no sink attached nothing is sent and nothing complains', async () => {
  const journal = logger();
  journal.info('session', "Ouverture de l'outil.");
  await assert.doesNotReject(() => journal.flush());
  // Kept, so that attaching a sink later still sends what happened before it existed.
  assert.equal(journal.pending, 1);
});

test('every entry carries the same session, so two organisers can be told apart', async () => {
  const target = sink();
  const journal = logger();
  journal.attach(target);
  journal.setActor('regie@example.org');

  journal.info('edition', 'une');
  journal.info('edition', 'deux');
  await journal.flush();

  const entries = target.batches[0]!.entries;
  assert.equal(entries[0]?.session, journal.session);
  assert.equal(entries[1]?.session, journal.session);
  assert.equal(entries[0]?.actor, 'regie@example.org');
  assert.notEqual(journal.session, logger().session, 'un onglet, une session');
});
