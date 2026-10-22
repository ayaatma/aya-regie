/**
 * Les mails de test: one person's mail, sent to the régisseur, says whose it is.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asTest } from './testMail.tsx';

test('a test is the person’s mail, readdressed, marked, and naming who it was written for', () => {
  const mail = { to: 'lea@example.org', subject: 'Loto : ton planning', body: 'Bonjour Léa', empty: [] };
  const sent = asTest(mail, 'regie@example.org', 'Léa Martin');
  assert.equal(sent.to, 'regie@example.org');
  assert.equal(sent.subject, '[TEST] Loto : ton planning');
  assert.match(sent.body, /^Mail de test : voici ce que recevrait Léa Martin \(lea@example\.org\)\./);
  assert.ok(sent.body.endsWith('Bonjour Léa'));
});
