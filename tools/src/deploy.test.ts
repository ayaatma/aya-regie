/**
 * The part of the deployment that deletes, tested without a network.
 *
 * The upload is a library call and a folder; what is worth testing is the decision about what to
 * remove from a live site. One wrong remote folder and a naive mirror empties the association's
 * home page, so the rule is that the script only ever deletes files of the shape it produces.
 *
 *   npm test    (in tools/)
 */

import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { planTransfer, transportOrder, type RemoteFile } from './deploy-cli.js';

const file = (path: string, size = 100): RemoteFile => ({ path, size });

test('index.html goes last, because that is the moment the site changes', () => {
  // The asset names carry a content hash, so the old page and the new assets coexist without
  // meaning anything to a visitor. The flip is index.html landing.
  const plan = planTransfer(
    [file('index.html'), file('assets/index-NEW.js'), file('assets/index-NEW.css')],
    [],
  );

  strictEqual(plan.upload[plan.upload.length - 1], 'index.html');
  strictEqual(plan.upload.length, 3);
});

test('an asset already up there at the same size is not sent again', () => {
  // Same hashed name and same size is the same bytes: that is what the hash in the name is for.
  const plan = planTransfer(
    [file('index.html'), file('assets/index-ABC.js', 500)],
    [file('index.html'), file('assets/index-ABC.js', 500)],
  );

  deepStrictEqual(plan.skipped, ['assets/index-ABC.js']);
  // The page itself has no hash in its name, so it is always sent.
  deepStrictEqual(plan.upload, ['index.html']);
});

test('an asset of the same name but a different size is sent again', () => {
  const plan = planTransfer([file('assets/index-ABC.js', 500)], [file('assets/index-ABC.js', 400)]);
  deepStrictEqual(plan.upload, ['assets/index-ABC.js']);
  deepStrictEqual(plan.skipped, []);
});

test('the previous build\'s assets are removed, and only after the flip', () => {
  const plan = planTransfer(
    [file('index.html'), file('assets/index-NEW.js')],
    [file('index.html'), file('assets/index-OLD.js')],
  );

  deepStrictEqual(plan.remove, ['assets/index-OLD.js']);
});

test('IT NEVER DELETES A FILE IT DID NOT PUT THERE', () => {
  // This is the one that matters. A wrong DEPLOY_FTP_DIR pointing at the association's site
  // would, under a naive mirror, delete the lot. Anything not of this build's shape is reported
  // and left alone.
  const plan = planTransfer(
    [file('index.html'), file('assets/index-NEW.js')],
    [
      file('index.html'),
      file('assets/index-OLD.js'),
      file('accueil.php'),
      file('wp-config.php'),
      file('images/affiche-2026.jpg'),
      file('.htaccess'),
    ],
  );

  deepStrictEqual(plan.remove, ['assets/index-OLD.js']);
  deepStrictEqual(plan.foreign, [
    'accueil.php',
    'wp-config.php',
    'images/affiche-2026.jpg',
    '.htaccess',
  ]);
});

test('the generated scenarios an older build shipped are cleaned up', () => {
  // They were in dist until 2026-09-08 and 884 KB of invented volunteers went up with every
  // deploy. A folder this build no longer produces, and one it is allowed to remove.
  const plan = planTransfer(
    [file('index.html')],
    [file('index.html'), file('fixtures/manifest.json'), file('fixtures/balanced.json')],
  );

  deepStrictEqual(plan.remove, ['fixtures/manifest.json', 'fixtures/balanced.json']);
  deepStrictEqual(plan.foreign, []);
});

test('a first deploy onto an empty folder sends everything', () => {
  const plan = planTransfer([file('index.html'), file('assets/index-NEW.js')], []);
  deepStrictEqual(plan.upload, ['assets/index-NEW.js', 'index.html']);
  deepStrictEqual(plan.remove, []);
});

// ---------------------------------------------------------------------------
// Le choix du transport
// ---------------------------------------------------------------------------

test('plain FTP is never tried on its own, whatever the host refuses', () => {
  // The first real run answered `500 This security scheme is not implemented` to AUTH TLS, so
  // this host speaks unencrypted FTP and nothing else. Falling back to it automatically would
  // put the password of an account that can overwrite the association's website in clear on the
  // wire, without anybody deciding to.
  deepStrictEqual(transportOrder('auto'), ['sftp', 'ftps', 'ftps-implicit']);
});

test('naming a protocol tries that one and only that one', () => {
  // Including the one that sends the password in clear: typed by hand, in the config file, by
  // somebody who has read what it costs.
  deepStrictEqual(transportOrder('ftp'), ['ftp']);
  deepStrictEqual(transportOrder('sftp'), ['sftp']);
  deepStrictEqual(transportOrder('ftps-implicit'), ['ftps-implicit']);
});
