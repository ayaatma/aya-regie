/**
 * The pure core of the `drive-photo` Edge Function (`supabase/functions/drive-photo/core.ts`),
 * under Node, with a fake fetch answering like the Drive API. No Google anywhere.
 */

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { PhotoError, readDrivePhoto, sizedThumbnail, thumbnailSize } from '../../supabase/functions/drive-photo/core.js';

const SA = 'lecture@projet.iam.gserviceaccount.com';
const ID = 'AbCdEfGhIjKlMnOp_123';

type Route = (url: string) => Response;

/** A fetch that answers each URL with the first route whose prefix matches, and records the calls. */
function fakeFetch(routes: Array<[string, Route]>): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return route ? route[1](url) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const meta = (body: object): Route => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const image = (type: string, bytes: number[]): Route => () => new Response(new Uint8Array(bytes), { headers: { 'content-type': type } });

const FILES = 'https://www.googleapis.com/drive/v3/files/';

test('a thumbnail link is asked at the size wanted', () => {
  strictEqual(sizedThumbnail('https://lh3.googleusercontent.com/drive-storage/abc=s220'), 'https://lh3.googleusercontent.com/drive-storage/abc=s800');
  strictEqual(sizedThumbnail('https://lh3.googleusercontent.com/abc'), 'https://lh3.googleusercontent.com/abc=s800');
});

test("Drive's thumbnail is taken first, even for a HEIC a browser cannot draw", async () => {
  const { fetcher, calls } = fakeFetch([
    [`${FILES}${ID}?fields`, meta({ mimeType: 'image/heic', size: '3000000', thumbnailLink: 'https://lh3.googleusercontent.com/t=s220' })],
    ['https://lh3.googleusercontent.com/t=s800', image('image/jpeg', [1, 2, 3])],
  ]);
  const photo = await readDrivePhoto(ID, 'tok', fetcher, SA);
  deepStrictEqual([...photo.bytes], [1, 2, 3]);
  strictEqual(photo.contentType, 'image/jpeg');
  strictEqual(calls.length, 2);
});

test('without a thumbnail, a drawable file is read whole', async () => {
  const { fetcher } = fakeFetch([
    [`${FILES}${ID}?fields`, meta({ mimeType: 'image/png', size: '1000' })],
    [`${FILES}${ID}?alt=media`, image('image/png', [9])],
  ]);
  const photo = await readDrivePhoto(ID, 'tok', fetcher, SA);
  strictEqual(photo.contentType, 'image/png');
  deepStrictEqual([...photo.bytes], [9]);
});

test('without a thumbnail, a HEIC is refused with a sentence saying what to do', async () => {
  const { fetcher } = fakeFetch([[`${FILES}${ID}?fields`, meta({ mimeType: 'image/heic', size: '1000' })]]);
  await rejects(readDrivePhoto(ID, 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && e.status === 422 && /à la main/.test(e.message));
});

test('a file not shared with the account names the address to share the folder with', async () => {
  const { fetcher } = fakeFetch([]);
  await rejects(readDrivePhoto(ID, 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && e.status === 403 && e.message.includes(SA));
});

const refused = (status: number, error: object): Route => () =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

test('a Drive API left disabled says so, not « partagez le dossier »', async () => {
  const { fetcher } = fakeFetch([
    [`${FILES}${ID}?fields`, refused(403, { message: 'Google Drive API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] })],
  ]);
  await rejects(readDrivePhoto(ID, 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && /API Google Drive n'est pas activée/.test(e.message) && !e.message.includes(SA));
});

test('a token without the Drive scope asks for the function to be redeployed', async () => {
  const { fetcher } = fakeFetch([
    [`${FILES}${ID}?fields`, refused(403, { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] })],
  ]);
  await rejects(readDrivePhoto(ID, 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && /Redéployez/.test(e.message));
});

test('a 403 of another kind shows what Google said', async () => {
  const { fetcher } = fakeFetch([[`${FILES}${ID}?fields`, refused(403, { message: 'Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] })]]);
  await rejects(readDrivePhoto(ID, 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && e.message.includes('Rate Limit Exceeded'));
});

test('anything but a Drive id is refused before Google is asked', async () => {
  const { fetcher, calls } = fakeFetch([]);
  await rejects(readDrivePhoto('../../etc', 'tok', fetcher, SA), (e: unknown) => e instanceof PhotoError && e.status === 400);
  ok(calls.length === 0);
});

test('the crop tool may ask for a larger picture, within bounds', async () => {
  strictEqual(thumbnailSize(undefined), 800);
  strictEqual(thumbnailSize(1600), 1600);
  strictEqual(thumbnailSize(99999), 2400);
  strictEqual(thumbnailSize('grand'), 800);
  const { fetcher, calls } = fakeFetch([
    [`${FILES}${ID}?fields`, meta({ mimeType: 'image/jpeg', size: '3000000', thumbnailLink: 'https://lh3.googleusercontent.com/t=s220' })],
    ['https://lh3.googleusercontent.com/t=s1600', image('image/jpeg', [4])],
  ]);
  const photo = await readDrivePhoto(ID, 'tok', fetcher, SA, 1600);
  deepStrictEqual([...photo.bytes], [4]);
  ok(calls.some((c) => c.endsWith('=s1600')));
});
