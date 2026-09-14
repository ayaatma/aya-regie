/**
 * Deploying the app to planning.ayaatma.fr in one command.
 *
 *   npm run deploy -- --probe       says which transports the host accepts, uploads nothing
 *   npm run deploy -- --dry-run     says what it would send and remove, touches nothing
 *   npm run deploy                  builds, uploads, verifies
 *
 * OVH shared hosting is a folder behind a file transfer protocol: there is no build step on the
 * server, no container, no pipeline. So this builds locally and mirrors `app/dist` into the
 * subdomain's folder, which is the whole of the deployment.
 *
 * THE TRANSPORT IS NEGOTIATED, AND PLAIN FTP IS NEVER AUTOMATIC. The first run against
 * ftp.cluster0XX.hosting.ovh.net answered `500 This security scheme is not implemented` to
 * `AUTH TLS`: that endpoint speaks unencrypted FTP and nothing else. So the script tries SFTP
 * first, then explicit FTPS, then implicit FTPS, and stops rather than falling back to sending
 * the password in clear. That fallback exists, it is one line in the configuration, and it has
 * to be typed by a human who knows what they are agreeing to: these credentials can overwrite
 * the association's website.
 *
 * FOUR THINGS IT REFUSES TO DO, and each one is a way a hand-made upload goes wrong.
 *
 * 1. It refuses to deploy a bundle built without Supabase. Vite inlines the configuration at
 *    build time, so a build made with no `app/.env.local` produces a tool that silently falls
 *    back to the local test scenarios: it would look installed and open onto nothing. The check
 *    is on the built file rather than on the environment, because what matters is what is in the
 *    bundle, not what was in the shell.
 *
 * 2. It refuses to ship the generated scenarios. `vite.config.ts` already drops them, and this
 *    checks, because the day that plugin is removed the picker starts offering to copy a hundred
 *    and twenty imaginary volunteers into the real database.
 *
 * 3. IT NEVER DELETES A FILE IT DID NOT PUT THERE. Pruning a remote folder is where a deploy
 *    script eats a website: one wrong `DEPLOY_FTP_DIR` and it empties the association's home
 *    page. Only files of the shape this build produces are ever removed, and anything else found
 *    up there is reported and left alone.
 *
 * 4. It uploads `index.html` LAST. The asset filenames carry a content hash, so the old page and
 *    the new assets can sit side by side without meaning anything to a visitor; the moment the
 *    site actually changes is the moment `index.html` lands. That keeps the window where a
 *    visitor could get a half-deployed site down to one small file.
 *
 * CREDENTIALS live in `.env.deploy.local` at the repository root, which is gitignored, and their
 * names are deliberately NOT prefixed with `VITE_`: anything so prefixed is inlined into the
 * client bundle by Vite, so an FTP password named that way would be published to the world on
 * the next deploy. See `.env.deploy.example`.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const appDir = join(root, 'app');
const distDir = join(appDir, 'dist');

// ---------------------------------------------------------------------------
// What to send, and what to remove. Pure, because this is the part that deletes.
// ---------------------------------------------------------------------------

export interface RemoteFile {
  path: string;
  size: number;
}

export interface Transfer {
  /** In upload order: everything else first, `index.html` last. */
  upload: string[];
  /** Files this build no longer produces, and that this build's shape accounts for. */
  remove: string[];
  /** Already up there, byte for byte, under a content-hashed name. */
  skipped: string[];
  /** Up there and none of our business. Reported, never touched. */
  foreign: string[];
}

/**
 * Files this tool is allowed to delete.
 *
 * A content-hashed asset, the page itself, an icon, and the generated scenarios which older
 * builds did ship. Anything else in that folder belongs to somebody else.
 */
const ours = (path: string): boolean =>
  path.startsWith('assets/') ||
  path.startsWith('fixtures/') ||
  path === 'index.html' ||
  /^favicon\.[a-z0-9]+$/.test(path) ||
  path === 'vite.svg';

export function planTransfer(local: readonly RemoteFile[], remote: readonly RemoteFile[]): Transfer {
  const remoteByPath = new Map(remote.map((file) => [file.path, file]));
  const localPaths = new Set(local.map((file) => file.path));

  const upload: string[] = [];
  const skipped: string[] = [];

  for (const file of local) {
    const already = remoteByPath.get(file.path);
    // An asset name carries a hash of its own content, so the same name at the same size is the
    // same file. index.html has no hash and is always sent.
    if (already && already.size === file.size && file.path.startsWith('assets/')) {
      skipped.push(file.path);
      continue;
    }
    upload.push(file.path);
  }

  upload.sort((a, b) => {
    const rank = (path: string) => (path === 'index.html' ? 1 : 0);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  const stale = remote.filter((file) => !localPaths.has(file.path));

  return {
    upload,
    remove: stale.filter((file) => ours(file.path)).map((file) => file.path),
    skipped,
    foreign: stale.filter((file) => !ours(file.path)).map((file) => file.path),
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** How to reach the host. `auto` is every encrypted option, in decreasing order of preference. */
export type Protocol = 'auto' | 'sftp' | 'ftps' | 'ftps-implicit' | 'ftp';

export interface Config {
  host: string;
  user: string;
  password: string;
  dir: string;
  protocol: Protocol;
  /** Overrides the protocol's own default (22, or 21, or 990). */
  port: number | null;
  /** Checked over HTTPS once the upload is done. Optional, and a failure undoes nothing. */
  url: string | null;
  /** Some OVH clusters answer FTPS with a certificate their own hostname does not match. */
  insecureTls: boolean;
}

/**
 * What to try, in order.
 *
 * PLAIN FTP IS NEVER IN AN AUTOMATIC ORDER. It sends the password across the network in clear,
 * and these credentials can overwrite the association's website, so choosing it is a decision
 * somebody types rather than a fallback the tool takes on its own.
 */
export function transportOrder(protocol: Protocol): Exclude<Protocol, 'auto'>[] {
  return protocol === 'auto' ? ['sftp', 'ftps', 'ftps-implicit'] : [protocol];
}

function readConfig(): Config {
  const path = join(root, '.env.deploy.local');
  if (!existsSync(path)) {
    throw new Error(
      `Fichier de configuration absent: ${path}\n` +
        'Copiez tools/.env.deploy.example à la racine sous ce nom et remplissez-le. ' +
        'Il est ignoré par git.',
    );
  }
  const text = readFileSync(path, 'utf8');
  const read = (name: string): string => {
    const found = new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm').exec(text);
    return (found?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  };

  const protocol = (read('DEPLOY_PROTOCOL') || 'auto') as Protocol;
  if (!['auto', 'sftp', 'ftps', 'ftps-implicit', 'ftp'].includes(protocol)) {
    throw new Error(
      `DEPLOY_PROTOCOL="${protocol}" inconnu. Valeurs: auto, sftp, ftps, ftps-implicit, ftp.`,
    );
  }

  const config: Config = {
    host: read('DEPLOY_FTP_HOST'),
    user: read('DEPLOY_FTP_USER'),
    password: read('DEPLOY_FTP_PASSWORD'),
    dir: read('DEPLOY_FTP_DIR'),
    protocol,
    port: read('DEPLOY_PORT') === '' ? null : Number(read('DEPLOY_PORT')),
    url: read('DEPLOY_URL') || null,
    insecureTls: read('DEPLOY_FTP_INSECURE_TLS') === '1',
  };

  // --dir=/quelquepart tries another folder without editing a file that holds a password. The
  // OVH multisite root is written relative to the FTP root, so moving a subdomain from
  // ./www/planning to ./planning changes this one value and nothing else.
  const override = process.argv.find((argument) => argument.startsWith('--dir='));
  if (override) config.dir = override.slice('--dir='.length);

  const missing = (['host', 'user', 'password', 'dir'] as const).filter((key) => config[key] === '');
  if (missing.length > 0) {
    throw new Error(
      `Configuration incomplète dans ${path}: ${missing
        .map((key) => `DEPLOY_FTP_${key.toUpperCase()}`)
        .join(', ')}`,
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// The transports
//
// One small interface, two libraries behind it, so the decision of what to send and what to
// delete never has to know which wire it is going over.
// ---------------------------------------------------------------------------

/**
 * How long one attempt gets before it is called a refusal.
 *
 * FOUND BY RUNNING IT. A closed port does not answer "closed", it says nothing, and both
 * libraries wait on that silence: the first --probe against the OVH cluster hung for five
 * minutes instead of reporting that SSH was not open. Under `auto`, which tries three
 * transports in a row, that reads as a script that has frozen.
 *
 * The library's own timeout is set as well, and this wraps it anyway: a timeout the library
 * honours only on some of its phases is not a bound.
 */
const ATTEMPT_TIMEOUT_MS = 10_000;

function withTimeout<T>(what: string, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what}: aucune réponse en ${ATTEMPT_TIMEOUT_MS / 1000} s (port filtré ou fermé)`)),
      ATTEMPT_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

interface Transport {
  readonly name: string;
  /**
   * Where the configured folder actually is, on this transport.
   *
   * THE TWO PROTOCOLS DISAGREE ABOUT PATHS, and finding that out is what the first probe was
   * for. An FTP login on OVH lands with its root already at the account's home, so the
   * subdomain's folder is `/www/planning`. An SFTP session lands IN that home as a real
   * filesystem path, so the same folder is `/homez.NNN/account/www/planning` and the FTP
   * spelling does not exist. Same credentials, same folder, two names for it.
   */
  resolveDir(dir: string): Promise<{ dir: string; exists: boolean }>;
  /**
   * Where this session starts, when the transport has such a notion.
   *
   * Only SFTP does: an FTP login on OVH is chrooted, and its root is all it will ever see. The
   * probe uses it to turn "dossier introuvable" into a listing of what is actually up there,
   * which is the difference between a dead end and a path to correct.
   */
  home?(): Promise<string>;
  /**
   * The names directly inside a folder, one level, no recursion.
   *
   * Separate from `list` because `list` walks the whole tree: pointing it at a home directory
   * sends it through the entire hosting space, which is how the probe came to hang on a listing
   * meant to print twelve names.
   */
  listTop?(dir: string): Promise<string[]>;
  /** Every file under `dir`, recursively, as paths relative to it. */
  list(dir: string): Promise<RemoteFile[]>;
  ensureDir(dir: string): Promise<void>;
  upload(localPath: string, remotePath: string): Promise<void>;
  remove(remotePath: string): Promise<void>;
  close(): Promise<void>;
}

async function openSftp(config: Config): Promise<Transport> {
  // The package ships no type declarations, so the surface this file uses is declared as
  // SftpClient below rather than pulled in as `any`. A dynamic import keeps it out of the way
  // of every other command in this package, which has no business loading an SSH stack.
  const module = (await import('ssh2-sftp-client')) as unknown as {
    default: new () => SftpClient;
  };
  const sftp = new module.default();
  try {
    await withTimeout(
      'sftp',
      sftp.connect({
        host: config.host,
        port: config.port ?? 22,
        username: config.user,
        password: config.password,
        readyTimeout: ATTEMPT_TIMEOUT_MS,
      }),
    );
  } catch (cause) {
    // A refused attempt must let go of its socket, or a run that tries three transports keeps
    // three half-open connections alive and the process never exits.
    await sftp.end().catch(() => undefined);
    throw cause;
  }

  const walkRemote = async (dir: string, prefix: string): Promise<RemoteFile[]> => {
    const out: RemoteFile[] = [];
    const at = prefix === '' ? dir : `${dir}/${prefix}`;
    for (const entry of await sftp.list(at)) {
      if (entry.name === '.' || entry.name === '..') continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.type === 'd') out.push(...(await walkRemote(dir, path)));
      else out.push({ path, size: entry.size });
    }
    return out;
  };

  return {
    name: 'sftp',
    home: () => sftp.cwd(),
    listTop: async (dir) => (await sftp.list(dir)).map((entry) => entry.name),
    resolveDir: async (dir) => {
      if (await sftp.exists(dir)) return { dir, exists: true };
      // The same folder, spelled from the home directory this session started in.
      const home = (await sftp.cwd()).replace(/\/$/, '');
      const fromHome = `${home}/${dir.replace(/^\//, '')}`;
      if (await sftp.exists(fromHome)) return { dir: fromHome, exists: true };
      // Neither exists. The home-relative spelling is the one SFTP would create, and whether it
      // should be created at all is the caller's decision, not this function's.
      return { dir: fromHome, exists: false };
    },
    list: (dir) => walkRemote(dir, ''),
    ensureDir: async (dir) => {
      if (!(await sftp.exists(dir))) await sftp.mkdir(dir, true);
    },
    upload: async (localPath, remotePath) => void (await sftp.put(localPath, remotePath)),
    remove: async (remotePath) => void (await sftp.delete(remotePath)),
    close: async () => void (await sftp.end()),
  };
}

/** What this file uses of ssh2-sftp-client, which ships no types of its own worth leaning on. */
interface SftpClient {
  connect(options: {
    host: string;
    port: number;
    username: string;
    password: string;
    readyTimeout: number;
  }): Promise<unknown>;
  list(path: string): Promise<Array<{ name: string; size: number; type: string }>>;
  exists(path: string): Promise<string | false>;
  mkdir(path: string, recursive?: boolean): Promise<string>;
  cwd(): Promise<string>;
  put(local: string, remote: string): Promise<string>;
  delete(path: string): Promise<string>;
  end(): Promise<void>;
}

async function openFtp(config: Config, mode: 'ftps' | 'ftps-implicit' | 'ftp'): Promise<Transport> {
  const { Client } = await import('basic-ftp');
  const client = new Client(ATTEMPT_TIMEOUT_MS);
  try {
    await withTimeout(
      mode,
      client.access({
        host: config.host,
        port: config.port ?? (mode === 'ftps-implicit' ? 990 : 21),
        user: config.user,
        password: config.password,
        secure: mode === 'ftp' ? false : mode === 'ftps-implicit' ? 'implicit' : true,
        secureOptions: config.insecureTls ? { rejectUnauthorized: false } : undefined,
      }),
    );
  } catch (cause) {
    // A refused attempt must let go of its socket, or a run that tries three transports keeps
    // three half-open connections alive and the process never exits.
    client.close();
    throw cause;
  }

  const walkRemote = async (dir: string, prefix: string): Promise<RemoteFile[]> => {
    const out: RemoteFile[] = [];
    const at = prefix === '' ? dir : `${dir}/${prefix}`;
    for (const entry of await client.list(at)) {
      if (entry.name === '.' || entry.name === '..') continue;
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory) out.push(...(await walkRemote(dir, path)));
      else out.push({ path, size: entry.size });
    }
    return out;
  };

  return {
    name: mode,
    // An FTP login on OVH is already rooted at the account's home, so the configured path is
    // the path. It is still checked: `list` on a folder that does not exist answers with an
    // empty listing rather than an error, and "0 fichier(s)" read as "the folder is there and
    // empty" when it meant "there is no such folder".
    resolveDir: async (dir) => {
      try {
        await client.cd(dir);
        return { dir, exists: true };
      } catch {
        return { dir, exists: false };
      }
    },
    list: (dir) => walkRemote(dir, ''),
    ensureDir: async (dir) => void (await client.ensureDir(dir)),
    upload: async (localPath, remotePath) => void (await client.uploadFrom(localPath, remotePath)),
    remove: async (remotePath) => void (await client.remove(remotePath)),
    close: async () => client.close(),
  };
}

const open = (config: Config, protocol: Exclude<Protocol, 'auto'>): Promise<Transport> =>
  protocol === 'sftp' ? openSftp(config) : openFtp(config, protocol);

/**
 * The first transport that answers, or a refusal naming what each one said.
 *
 * The refusal is the useful part. `500 This security scheme is not implemented` means the host
 * speaks unencrypted FTP and nothing else, and that is a decision to put to somebody rather than
 * a fallback to take quietly.
 */
async function connect(config: Config): Promise<Transport> {
  const attempts = transportOrder(config.protocol);
  const failures: string[] = [];

  for (const protocol of attempts) {
    try {
      const transport = await open(config, protocol);
      console.log(`Connecté en ${protocol}.`);
      return transport;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push(`  ${protocol}: ${message}`);
    }
  }

  throw new Error(
    `Aucun transport chiffré accepté par ${config.host}:\n${failures.join('\n')}\n\n` +
      "Il reste le FTP en clair, que ce script n'utilisera pas de lui-même: il envoie le mot de " +
      "passe en clair sur le réseau, et ce compte peut réécrire le site de l'association. " +
      'Pour le choisir malgré tout, mettez DEPLOY_PROTOCOL=ftp dans .env.deploy.local. ' +
      "Voyez d'abord si l'hébergement propose SFTP: c'est le même compte, sur le port 22.",
  );
}

// ---------------------------------------------------------------------------
// The local build
// ---------------------------------------------------------------------------

/** Every file of dist, as posix-relative paths with their sizes. */
function walk(dir: string, prefix = ''): RemoteFile[] {
  const out: RemoteFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), path));
    else out.push({ path, size: statSync(join(dir, entry.name)).size });
  }
  return out;
}

/**
 * What the bundle must contain to be worth deploying.
 *
 * The Supabase project URL, because Vite inlines it at build time and its absence means a tool
 * that opens onto the local test scenarios instead of the association's planning. Read from the
 * built files, not from the environment: what ships is what is in the bundle.
 */
function checkBundle(files: readonly RemoteFile[]): void {
  const envPath = join(appDir, '.env.local');
  if (!existsSync(envPath)) {
    throw new Error('app/.env.local est absent: le build ne saurait pas où est la base.');
  }
  const wanted = /VITE_SUPABASE_URL\s*=\s*["']?([^"'\s]+)/.exec(readFileSync(envPath, 'utf8'))?.[1];
  if (!wanted) throw new Error('VITE_SUPABASE_URL est absent de app/.env.local.');

  const host = wanted.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const scripts = files.filter((file) => file.path.endsWith('.js'));
  const carriesIt = scripts.some((file) =>
    readFileSync(join(distDir, file.path), 'utf8').includes(host),
  );
  if (!carriesIt) {
    throw new Error(
      `Le bundle ne contient pas ${host}: il a été construit sans app/.env.local, et il ouvrirait ` +
        'sur les jeux de test au lieu de la base. Relancez le build.',
    );
  }

  const fixtures = files.filter((file) => file.path.startsWith('fixtures/'));
  if (fixtures.length > 0) {
    throw new Error(
      `${fixtures.length} fichier(s) de jeux de test dans le build. Ce sont des bénévoles ` +
        "inventés, et leur présence rallume l'offre de les copier dans la vraie base. " +
        'Le plugin dropFixtures de vite.config.ts a dû être retiré.',
    );
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Which transports this host accepts, without sending anything.
 *
 * The first thing to run against a new host: it turns "500 something" into a list of what is
 * actually available, and it is the only way to find out short of trying.
 */
async function probe(config: Config): Promise<void> {
  console.log(`Transports acceptés par ${config.host}:\n`);
  for (const protocol of ['sftp', 'ftps', 'ftps-implicit', 'ftp'] as const) {
    let transport;
    try {
      transport = await open(config, protocol);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.log(`  refusé   ${protocol.padEnd(14)} ${message.split('\n')[0]}`);
      continue;
    }
    // Connected. Whatever happens to the listing now, this transport works, and reporting it as
    // refused is how a working SFTP gets mistaken for a closed door: the first run said
    // "refusé sftp: No such file /www/planning", which was a path, not a refusal.
    try {
      const found = await transport.resolveDir(config.dir);
      if (!found.exists) throw new Error(`aucun dossier ${found.dir}`);
      const files = await transport.list(found.dir);
      console.log(`  ok       ${protocol.padEnd(14)} ${files.length} fichier(s) dans ${found.dir}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.log(
        `  connecté ${protocol.padEnd(14)} dossier introuvable: ${message.split('\n')[0]}`,
      );
      // Not a dead end, a path to correct. What this transport can actually see is the only
      // thing that says where the subdomain's folder really is.
      if (transport.home && transport.listTop) {
        try {
          const home = await transport.home();
          const tops = (await transport.listTop(home)).sort();
          console.log(`           depuis ${home}: ${tops.slice(0, 15).join(', ') || '(vide)'}`);
        } catch (cause) {
          const why = cause instanceof Error ? cause.message : String(cause);
          console.log(`           et son dossier de départ est illisible: ${why}`);
        }
      }
    } finally {
      await transport.close();
    }
  }
  console.log(
    '\nPréférez SFTP. À défaut un FTPS. Le FTP en clair demande DEPLOY_PROTOCOL=ftp, ' +
      'écrit à la main, en sachant que le mot de passe passe en clair.',
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const probing = process.argv.includes('--probe');
  const skipBuild = process.argv.includes('--no-build') || probing;
  const config = readConfig();

  if (probing) {
    await probe(config);
    return;
  }

  if (!skipBuild) {
    console.log('Construction du build…');
    execSync('npm run build', { cwd: appDir, stdio: 'inherit' });
  }
  if (!existsSync(distDir)) throw new Error(`${distDir} est absent. Lancez npm run build.`);

  const local = walk(distDir);
  checkBundle(local);
  const bytes = local.reduce((total, file) => total + file.size, 0);
  console.log(
    `\n${local.length} fichiers, ${Math.round(bytes / 1024)} Ko → ${config.host}:${config.dir}\n`,
  );

  const transport = await connect(config);

  try {
    const found = await transport.resolveDir(config.dir);
    const dir = found.dir;
    if (dir !== config.dir) console.log(`Dossier: ${dir}`);

    /*
     * A FOLDER THAT DOES NOT EXIST IS A STOP, NOT A MKDIR.
     *
     * Learned by doing it: a run against a stale `DEPLOY_FTP_DIR` created the folder, uploaded
     * four files into it, and reported success. The site was unchanged, because nothing serves
     * that folder. The HTTPS check at the end caught it, which is late: by then the files are up
     * there, in a directory that now exists and will look right to whoever finds it next.
     *
     * So the deploy stops and says what it can see instead. `--create-dir` is for the genuine
     * first deploy, where the folder really has to be made.
     */
    if (!found.exists && !process.argv.includes('--create-dir')) {
      let nearby = '';
      if (transport.home && transport.listTop) {
        const home = await transport.home();
        const entries = (await transport.listTop(home)).filter((name) => !name.startsWith('.'));
        nearby = `\nÀ côté, dans ${home}: ${entries.sort().join(', ')}`;
      }
      throw new Error(
        `Le dossier ${dir} n'existe pas.\n` +
          "Rien n'a été envoyé: déployer dans un dossier que personne ne sert donne un envoi qui " +
          'réussit et un site inchangé.' +
          nearby +
          `\n\nSi c'est le bon dossier et qu'il faut le créer: npm run deploy -- --create-dir\n` +
          "Sinon, corrigez DEPLOY_FTP_DIR (le champ « dossier racine » du multisite OVH, écrit " +
          'depuis la racine FTP), ou essayez-en un autre avec --dir=/autre.',
      );
    }

    await transport.ensureDir(dir);
    const remote = await transport.list(dir);
    const transfer = planTransfer(local, remote);

    for (const path of transfer.skipped) console.log(`  =  ${path}`);
    for (const path of transfer.upload) console.log(`  ↑  ${path}`);
    for (const path of transfer.remove) console.log(`  ✕  ${path}`);
    for (const path of transfer.foreign) {
      console.log(`  ·  ${path}   (pas à nous, laissé en place)`);
    }

    if (dryRun) {
      console.log('\n--dry-run: rien envoyé, rien supprimé.');
      return;
    }

    for (const path of transfer.upload) {
      const remotePath = `${dir}/${path}`;
      await transport.ensureDir(remotePath.slice(0, remotePath.lastIndexOf('/')));
      await transport.upload(join(distDir, path), remotePath);
    }
    // After the flip, never before: an old asset removed first would break the page that is
    // still live.
    for (const path of transfer.remove) await transport.remove(`${dir}/${path}`);

    console.log(
      `\n${transfer.upload.length} envoyé(s), ${transfer.remove.length} supprimé(s), ` +
        `${transfer.skipped.length} inchangé(s).`,
    );
  } finally {
    await transport.close();
  }

  if (config.url) await verify(config.url, local);
}

/**
 * Proof that it is actually serving, which "uploaded without error" is not.
 *
 * It asks for the page and checks that the asset the new `index.html` points at is the one that
 * was just sent. A stale cache, a wrong folder, a subdomain pointing elsewhere: all three answer
 * 200 and none of them serves this build.
 */
async function verify(url: string, local: readonly RemoteFile[]): Promise<void> {
  console.log(`\nVérification de ${url}`);
  try {
    const response = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    const html = await response.text();
    const expected = local
      .map((file) => file.path)
      .filter((path) => path.startsWith('assets/') && path.endsWith('.js'));
    const served = expected.filter((path) => html.includes(path.replace('assets/', '')));

    if (response.ok && served.length > 0) {
      console.log(`  ok: ${url} sert bien ${served.join(', ')}`);
    } else if (response.ok) {
      console.log(
        '  ATTENTION: la page répond mais ne référence pas les fichiers envoyés. ' +
          'Cache, mauvais dossier, ou sous-domaine pointant ailleurs.',
      );
      process.exitCode = 1;
    } else {
      console.log(`  ATTENTION: HTTP ${response.status}.`);
      process.exitCode = 1;
    }
  } catch (cause) {
    console.log(`  Injoignable: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}

// Imported by the test, run by the CLI.
if (process.argv[1]?.includes('deploy-cli')) {
  main().catch((cause: unknown) => {
    console.error(`\n${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
