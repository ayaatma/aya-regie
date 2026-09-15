/**
 * The pure core of the `sheet-csv` Edge Function (`supabase/functions/sheet-csv/core.ts`), under
 * Node: the service account's signed assertion, the tab a link names, the CSV the importer reads,
 * and the sentence a régisseur gets when the sheet is not shared with the account.
 *
 * No Google anywhere: a key pair made for the test, and a fake fetch answering like the Sheets API.
 */

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';
import type { webcrypto } from 'node:crypto';

import { parseCsv } from './import.js';
import {
  SheetError,
  accessToken,
  parseSheetUrl,
  readSheetCsv,
  signedAssertion,
  valuesToCsv,
} from '../../supabase/functions/sheet-csv/core.js';

async function testKey(): Promise<{ pem: string; publicKey: webcrypto.CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

const fromBase64url = (part: string): Buffer => Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('the assertion is a JWT signed with the key, for read-only Sheets access', async () => {
  const { pem, publicKey } = await testKey();
  const jwt = await signedAssertion({ client_email: 'lecture@projet.iam.gserviceaccount.com', private_key: pem }, 1_000);
  const [header, claims, signature] = jwt.split('.');
  deepStrictEqual(JSON.parse(fromBase64url(header!).toString()), { alg: 'RS256', typ: 'JWT' });
  const body = JSON.parse(fromBase64url(claims!).toString());
  strictEqual(body.iss, 'lecture@projet.iam.gserviceaccount.com');
  strictEqual(body.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  strictEqual(body.exp - body.iat, 3600);
  ok(
    await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromBase64url(signature!), new TextEncoder().encode(`${header}.${claims}`)),
    'la signature se vérifie avec la clé publique',
  );
});

test('a refused key says what to do, not a stack trace', async () => {
  const { pem } = await testKey();
  const refusing = (async () => new Response('{}', { status: 400 })) as typeof fetch;
  await rejects(accessToken({ client_email: 'x@y', private_key: pem }, refusing, 0), (e: unknown) => e instanceof SheetError && e.status === 502);
});

/** A fake Sheets API: two tabs, the second one holding the answers. */
function fakeSheets(status = 200): { fetcher: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (status !== 200) return new Response('{}', { status });
    if (url.includes('fields=sheets.properties')) {
      return Response.json({ sheets: [{ properties: { sheetId: 0, title: 'Accueil' } }, { properties: { sheetId: 123456789, title: "Réponses d'août" } }] });
    }
    return Response.json({ values: [['Horodateur', 'Nom', 'Remarque'], ['15/09/2026 17:11:42', 'Martin'], ['16/09/2026 09:00:00', 'Petit', 'dit "oui", puis non']] });
  }) as typeof fetch;
  return { fetcher, urls };
}

test('the tab of the link is read, padded, and comes back as the CSV the importer parses', async () => {
  const ref = parseSheetUrl('https://docs.google.com/spreadsheets/d/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB/edit?gid=123456789#gid=123456789')!;
  deepStrictEqual(ref, { documentId: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB', gid: '123456789' });
  const { fetcher, urls } = fakeSheets();
  const csv = await readSheetCsv(ref, 'jeton', fetcher, 'lecture@projet.iam.gserviceaccount.com');
  ok(urls[1]!.includes(encodeURIComponent("'Réponses d''août'")), "l'onglet du lien, apostrophe échappée");
  deepStrictEqual(parseCsv(csv), [
    ['Horodateur', 'Nom', 'Remarque'],
    ['15/09/2026 17:11:42', 'Martin', ''],
    ['16/09/2026 09:00:00', 'Petit', 'dit "oui", puis non'],
  ]);
});

test('a sheet not shared with the account names the address to share it with', async () => {
  const ref = parseSheetUrl('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB')!;
  await rejects(
    readSheetCsv(ref, 'jeton', fakeSheets(403).fetcher, 'lecture@projet.iam.gserviceaccount.com'),
    (e: unknown) => e instanceof SheetError && e.status === 403 && e.message.includes('lecture@projet.iam.gserviceaccount.com'),
  );
});

test('an empty tab is an empty file, not a crash', () => {
  strictEqual(valuesToCsv([]), '');
});
