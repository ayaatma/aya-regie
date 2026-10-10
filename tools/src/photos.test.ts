import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { driveFileIds, needsDriveFetch, parsePhotoObjectName, photoObjectName, squareCrop } from './photos.js';

test('a Google Forms upload answer yields its Drive file ids, once each', () => {
  deepStrictEqual(driveFileIds('https://drive.google.com/open?id=FakeDriveFileId_0123456789'), ['FakeDriveFileId_0123456789']);
  deepStrictEqual(
    driveFileIds('https://drive.google.com/open?id=AAAAAAAAAAAA, https://drive.google.com/file/d/BBBBBBBBBBBB/view, https://drive.google.com/open?id=AAAAAAAAAAAA'),
    ['AAAAAAAAAAAA', 'BBBBBBBBBBBB'],
  );
  deepStrictEqual(driveFileIds(''), []);
  deepStrictEqual(driveFileIds('envoyée par mail'), []);
});

test('an object name says whose photo it is and where it came from, both ways', () => {
  const drive = photoObjectName('abc123', { kind: 'drive', fileId: 'X_y-1234567' });
  strictEqual(drive, 'abc123--drive-X_y-1234567.webp');
  deepStrictEqual(parsePhotoObjectName(drive), { personHash: 'abc123', source: { kind: 'drive', fileId: 'X_y-1234567' } });
  deepStrictEqual(parsePhotoObjectName(photoObjectName('abc123', { kind: 'manuel', at: 42 }, 'jpg')), {
    personHash: 'abc123',
    source: { kind: 'manuel', at: 42 },
  });
  strictEqual(parsePhotoObjectName('.emptyFolderPlaceholder'), null);
});

test('the form never replaces a hand-picked photo, nor fetches the same file twice', () => {
  strictEqual(needsDriveFetch(null, 'A'), true);
  strictEqual(needsDriveFetch({ kind: 'manuel', at: 1 }, 'A'), false);
  strictEqual(needsDriveFetch({ kind: 'drive', fileId: 'A' }, 'A'), false);
  strictEqual(needsDriveFetch({ kind: 'drive', fileId: 'A' }, 'B'), true);
});

test('the square keeps the short side, a little above the middle of a portrait', () => {
  deepStrictEqual(squareCrop(400, 300), { x: 50, y: 0, size: 300 });
  deepStrictEqual(squareCrop(300, 400), { x: 0, y: 30, size: 300 });
  deepStrictEqual(squareCrop(200, 200), { x: 0, y: 0, size: 200 });
});
