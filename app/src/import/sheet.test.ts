/**
 * Turning what somebody pastes into something the browser can actually fetch.
 *
 * The endpoints and their CORS behaviour were checked against Google in September 2026 and are
 * documented in `sheet.ts`. What is tested here is the part that is ours: reading a document id
 * and a tab out of whatever form of link the régisseur happens to copy.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csvUrlFromSheet, parseSheetUrl } from './sheet.ts';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

test('an editor link gives up its document and its tab', () => {
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1234567`), {
    documentId: ID,
    gid: '1234567',
  });
});

test('a link with no tab is still usable, and asks for the first one', () => {
  assert.deepEqual(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`), {
    documentId: ID,
    gid: null,
  });
  assert.equal(
    csvUrlFromSheet(`https://docs.google.com/spreadsheets/d/${ID}/edit`),
    `https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv`,
  );
});

test('a published link carries its tab in the query rather than the fragment', () => {
  const published = `https://docs.google.com/spreadsheets/d/e/2PACX-1vAbCd/pubhtml?gid=99&single=true`;
  assert.deepEqual(parseSheetUrl(published), { documentId: '2PACX-1vAbCd', gid: '99' });
});

test('a bare document id works, because that is what half-copied links look like', () => {
  assert.deepEqual(parseSheetUrl(ID), { documentId: ID, gid: null });
});

test('the CSV endpoint is the one that answers without a redirect', () => {
  // Checked against Google: /gviz/tq?tqx=out:csv answers 200 with CORS headers, while
  // /export?format=csv answers 307 to another host. One less thing to break.
  const url = csvUrlFromSheet(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`);
  assert.equal(url, `https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv&gid=0`);
});

test('anything that is not a sheet is refused rather than fetched hopefully', () => {
  for (const junk of ['', '   ', 'https://example.org/planning.csv', 'bonjour']) {
    assert.equal(parseSheetUrl(junk), null, junk);
    assert.equal(csvUrlFromSheet(junk), null, junk);
  }
});
