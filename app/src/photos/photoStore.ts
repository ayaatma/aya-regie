/**
 * The photos of the trombinoscope, 2026-10-10: where the app keeps them and how it reads them back.
 *
 * Two ways in, both asked for by the régisseur: the form's upload question, fetched from Drive
 * through the `drive-photo` function once an import is applied (`syncFormPhotos`), and a file the
 * régie drops on a fiche (`putPhoto`). Either way the browser shrinks the picture to one small
 * square (`shrinkPhoto`) and keeps it in the PRIVATE Storage bucket `photos`, read back through
 * signed URLs. The plan document never carries a photo. The pure rules (object names, what a
 * re-import fetches, the crop) are in `tools/src/photos.ts`.
 *
 * ONE LISTING PER EVENT. A fiche needs one photo, but the Personnes list draws a hundred fiches in
 * an afternoon, so the event's folder is listed once, every URL signed in one call, and every
 * component reads that book. A write updates the book in place and tells its readers.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { needsDriveFetch, parsePhotoObjectName, photoObjectName, squareCrop, type PhotoLink, type PhotoSource } from '../engine.ts';
import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';

const BUCKET = 'photos';
/** The side of the square kept, in pixels: sharp on a fiche at 96 px on a dense screen, about 20 KB. */
export const PHOTO_SIZE = 320;
/** A signed URL lasts this long; a page open longer lists again on the next write or reload. */
const SIGNED_SECONDS = 6 * 3600;

/** Whether this build can keep photos at all: not with the fixtures, which have no Storage. */
export const photosAvailable = supabaseConfigured;

// ---------------------------------------------------------------------------
// The person's name in Storage
// ---------------------------------------------------------------------------

const hashes = new Map<string, string>();

/**
 * The first 32 hex digits of the SHA-256 of a person's key. A key is built from the name or the
 * address, and neither belongs in a file path, so the path carries this instead.
 */
export async function personHash(key: string): Promise<string> {
  const known = hashes.get(key);
  if (known) return known;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  hashes.set(key, hex);
  return hex;
}

// ---------------------------------------------------------------------------
// The book: what the event's folder holds
// ---------------------------------------------------------------------------

interface Held {
  name: string;
  source: PhotoSource;
  url: string | null;
}

interface Book {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  byHash: Map<string, Held>;
  /** Bumped on every change, so `useSyncExternalStore` sees a new snapshot. */
  version: number;
  listeners: Set<() => void>;
  loaded: Promise<void> | null;
}

const books = new Map<string, Book>();

function bookOf(eventId: string): Book {
  let book = books.get(eventId);
  if (!book) {
    book = { status: 'loading', error: null, byHash: new Map(), version: 0, listeners: new Set(), loaded: null };
    books.set(eventId, book);
  }
  return book;
}

const changed = (book: Book): void => {
  book.version += 1;
  for (const listener of book.listeners) listener();
};

const message = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Lists the event's folder and signs every URL, once; a second call waits on the first. */
function loadBook(eventId: string): Promise<void> {
  const book = bookOf(eventId);
  if (book.loaded) return book.loaded;
  book.loaded = (async () => {
    try {
      const storage = getSupabase().storage.from(BUCKET);
      const names: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await storage.list(eventId, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw error;
        names.push(...data.map((f) => f.name));
        if (data.length < 1000) break;
      }
      const held = new Map<string, Held>();
      for (const name of names) {
        const parsed = parsePhotoObjectName(name);
        if (!parsed) continue;
        // Two objects for one person is an interrupted replacement: the newer source wins.
        const previous = held.get(parsed.personHash);
        if (!previous || name > previous.name) held.set(parsed.personHash, { name, source: parsed.source, url: null });
      }
      if (held.size > 0) {
        const paths = [...held.values()].map((h) => `${eventId}/${h.name}`);
        const { data, error } = await storage.createSignedUrls(paths, SIGNED_SECONDS);
        if (error) throw error;
        const urlOf = new Map(data.map((d) => [d.path, d.signedUrl]));
        for (const h of held.values()) h.url = urlOf.get(`${eventId}/${h.name}`) ?? null;
      }
      book.byHash = held;
      book.status = 'ready';
      book.error = null;
    } catch (cause) {
      book.status = 'error';
      book.error = `Photos illisibles: ${message(cause)}`;
      // Let the next reader try again rather than keeping a failure forever.
      book.loaded = null;
    }
    changed(book);
  })();
  return book.loaded;
}

/** One person's photo URL, and whether the book is still loading, for a fiche. */
export function usePhoto(eventId: string | null, personKey: string): { url: string | null; source: PhotoSource | null; loading: boolean; error: string | null } {
  // The hash is async the first time a key is seen; until then, nothing, never the previous person's.
  const [computed, setComputed] = useState<{ key: string; hash: string } | null>(null);
  useEffect(() => {
    let live = true;
    void personHash(personKey).then((h) => live && setComputed({ key: personKey, hash: h }));
    return () => {
      live = false;
    };
  }, [personKey]);
  const hash = hashes.get(personKey) ?? (computed?.key === personKey ? computed.hash : null);

  const enabled = photosAvailable && eventId !== null;
  useEffect(() => {
    if (enabled) void loadBook(eventId!);
  }, [enabled, eventId]);

  useSyncExternalStore(
    (listener) => {
      if (!enabled) return () => undefined;
      const book = bookOf(eventId!);
      book.listeners.add(listener);
      return () => book.listeners.delete(listener);
    },
    () => (enabled ? bookOf(eventId!).version : -1),
    // Rendered to a string (the screen tests): no photos there.
    () => -1,
  );

  if (!enabled) return { url: null, source: null, loading: false, error: null };
  const book = bookOf(eventId!);
  const held = hash ? book.byHash.get(hash) : undefined;
  return { url: held?.url ?? null, source: held?.source ?? null, loading: book.status === 'loading' || hash === null, error: book.error };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * A picture as a small square: the short side kept, cropped a little above the middle, drawn at
 * PHOTO_SIZE (or smaller, never enlarged), WebP where the browser writes it and JPEG otherwise.
 */
export async function shrinkPhoto(file: Blob): Promise<{ blob: Blob; extension: 'webp' | 'jpg' }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Cette image ne se lit pas dans le navigateur (une photo HEIC d'iPhone, par exemple). Enregistrez-la en JPEG ou en PNG, puis déposez-la à nouveau.");
  }
  const crop = squareCrop(bitmap.width, bitmap.height);
  const side = Math.min(PHOTO_SIZE, crop.size);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error("Le navigateur n'a pas pu redimensionner l'image.");
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
  bitmap.close();

  const encode = (type: string): Promise<Blob | null> => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode('image/webp');
  // A browser that cannot write WebP silently writes PNG instead: check what came back.
  if (webp && webp.type === 'image/webp') return { blob: webp, extension: 'webp' };
  const jpeg = await encode('image/jpeg');
  if (!jpeg) throw new Error("Le navigateur n'a pas pu enregistrer l'image.");
  return { blob: jpeg, extension: 'jpg' };
}

/**
 * Keeps a picture as somebody's photo, replacing whatever they had. The picture is shrunk here,
 * so a caller hands in the file as it came.
 */
export async function putPhoto(eventId: string, personKey: string, file: Blob, source: PhotoSource): Promise<void> {
  const { blob, extension } = await shrinkPhoto(file);
  await storeSquare(eventId, personKey, blob, extension, source);
}

/**
 * Keeps a square the crop tool already drew at PHOTO_SIZE (2026-10-23), under the same source as
 * before: a form photo reframed stays the form's, so the next import does not fetch it again and
 * undo the framing, while a NEW upload in the form still replaces it.
 */
export async function putCroppedPhoto(eventId: string, personKey: string, square: Blob, source: PhotoSource): Promise<void> {
  await storeSquare(eventId, personKey, square, square.type === 'image/webp' ? 'webp' : 'jpg', source);
}

async function storeSquare(eventId: string, personKey: string, blob: Blob, extension: 'webp' | 'jpg', source: PhotoSource): Promise<void> {
  await loadBook(eventId);
  const book = bookOf(eventId);
  const hash = await personHash(personKey);
  const name = photoObjectName(hash, source, extension);
  const storage = getSupabase().storage.from(BUCKET);

  const { error } = await storage.upload(`${eventId}/${name}`, blob, { contentType: blob.type, upsert: true, cacheControl: '3600' });
  if (error) throw new Error(`La photo n'a pas pu être enregistrée: ${error.message}`);

  // The old one goes AFTER the new one is safely there: an interruption leaves two, never none.
  const previous = book.byHash.get(hash);
  if (previous && previous.name !== name) await storage.remove([`${eventId}/${previous.name}`]);

  const { data } = await storage.createSignedUrl(`${eventId}/${name}`, SIGNED_SECONDS);
  book.byHash.set(hash, { name, source, url: data?.signedUrl ?? null });
  changed(book);
}

/**
 * Carries a photo over to somebody's new key, 2026-10-24: a bénévole passed Staff or Responsable
 * gets a new key (`resp-...`), and the photo, filed under the hash of the old one, vanished from
 * the fiche. Nothing is done when the new key already has a photo, or the old one none.
 */
export async function movePhoto(eventId: string, fromKey: string, toKey: string): Promise<void> {
  await loadBook(eventId);
  const book = bookOf(eventId);
  const from = await personHash(fromKey);
  const to = await personHash(toKey);
  const held = book.byHash.get(from);
  if (!held || book.byHash.has(to)) return;
  const name = held.name.replace(from, to);
  const storage = getSupabase().storage.from(BUCKET);
  const { error } = await storage.move(`${eventId}/${held.name}`, `${eventId}/${name}`);
  if (error) throw new Error(`La photo n'a pas pu suivre le changement de statut: ${error.message}`);
  const { data } = await storage.createSignedUrl(`${eventId}/${name}`, SIGNED_SECONDS);
  book.byHash.delete(from);
  book.byHash.set(to, { name, source: held.source, url: data?.signedUrl ?? null });
  changed(book);
}

/** Forgets somebody's photo. The form's comes back at the next import that carries it. */
export async function removePhoto(eventId: string, personKey: string): Promise<void> {
  await loadBook(eventId);
  const book = bookOf(eventId);
  const hash = await personHash(personKey);
  const held = book.byHash.get(hash);
  if (!held) return;
  const { error } = await getSupabase().storage.from(BUCKET).remove([`${eventId}/${held.name}`]);
  if (error) throw new Error(`La photo n'a pas pu être retirée: ${error.message}`);
  book.byHash.delete(hash);
  changed(book);
}

// ---------------------------------------------------------------------------
// From the form, through Drive
// ---------------------------------------------------------------------------

/** What the `drive-photo` function answered: the picture, a reason, or no function to ask. */
type DriveRead = { blob: Blob } | { error: string } | { unavailable: string };

async function readFromDrive(fileId: string, size?: number): Promise<DriveRead> {
  try {
    const { data, error } = await getSupabase().functions.invoke<Blob>('drive-photo', { body: size === undefined ? { fileId } : { fileId, size } });
    if (!error && data instanceof Blob) return { blob: data };
    const response = (error as { context?: unknown } | null)?.context;
    /*
     * Since 2026-10-23 only « there is no function » and « it is not configured » stop the whole
     * run. A dropped connection, a timeout or a busy function used to count as « unavailable »
     * too, which silently left every photo after it unfetched: they are now one person's failure,
     * tried again, and the run goes on.
     */
    if (!(response instanceof Response)) return { error: "La fonction drive-photo n'a pas répondu (réseau, ou fonction occupée)." };
    let body: { error?: string } = {};
    try {
      body = (await response.clone().json()) as typeof body;
    } catch {
      // Not our JSON: the gateway answering, for a function that does not exist or failed.
    }
    if (body.error === undefined) {
      return response.status === 404
        ? { unavailable: "La fonction drive-photo n'est pas déployée." }
        : { error: `La fonction drive-photo a répondu ${response.status}.` };
    }
    if (response.status === 503) return { unavailable: body.error };
    return { error: body.error };
  } catch (cause) {
    return { error: message(cause) };
  }
}

/** One read, and a second one after a pause when the first failed for a reason other than access. */
async function readFromDriveTwice(fileId: string, size?: number): Promise<DriveRead> {
  const first = await readFromDrive(fileId, size);
  if (!('error' in first) || /inaccessible|pas une image|trop lourde|identifiant/i.test(first.error)) return first;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return readFromDrive(fileId, size);
}

/**
 * The form's photo of one person, fetched now: the fiche's « Récupérer la photo du formulaire »,
 * since 2026-10-23, for a photo an import could not bring. Null when it came, else why not.
 */
export async function fetchFormPhoto(eventId: string, personKey: string, fileId: string): Promise<string | null> {
  const read = await readFromDriveTwice(fileId);
  if ('unavailable' in read) return read.unavailable;
  if ('error' in read) return read.error;
  try {
    await putPhoto(eventId, personKey, read.blob, { kind: 'drive', fileId });
    return null;
  } catch (cause) {
    return message(cause);
  }
}

/**
 * The picture the crop tool frames, as large as it can be had: the form's photo asked again from
 * Drive at 1600 px when it came from there, else the square already kept (a photo dropped by hand
 * keeps no original).
 */
export async function cropSource(fileId: string | null, currentUrl: string | null): Promise<Blob> {
  if (fileId !== null) {
    const read = await readFromDriveTwice(fileId, 1600);
    if ('blob' in read) return read.blob;
    if (currentUrl === null) throw new Error('unavailable' in read ? read.unavailable : read.error);
  }
  if (currentUrl === null) throw new Error('Pas de photo à recadrer.');
  const response = await fetch(currentUrl);
  if (!response.ok) throw new Error(`La photo n'a pas pu être relue (${response.status}).`);
  return response.blob();
}

export interface PhotoSyncReport {
  fetched: number;
  /** Already held: the same Drive file, or a photo the régie chose by hand. */
  kept: number;
  failed: Array<{ volunteerKey: string; reason: string }>;
  /** Set when nothing could be fetched at all, with why: one sentence rather than a hundred. */
  unavailable: string | null;
}

/**
 * Fetches the form's photos of the people an import just applied, three at a time. Never throws:
 * a photo that fails is listed, and the import it follows is already applied either way.
 */
export async function syncFormPhotos(
  eventId: string,
  links: readonly PhotoLink[],
  onProgress?: (done: number, total: number) => void,
): Promise<PhotoSyncReport> {
  const report: PhotoSyncReport = { fetched: 0, kept: 0, failed: [], unavailable: null };
  await loadBook(eventId);
  const book = bookOf(eventId);
  if (book.status === 'error') return { ...report, unavailable: book.error };

  const todo: PhotoLink[] = [];
  for (const link of links) {
    const held = book.byHash.get(await personHash(link.volunteerKey));
    if (needsDriveFetch(held?.source ?? null, link.driveFileId)) todo.push(link);
    else report.kept += 1;
  }

  let done = 0;
  let next = 0;
  onProgress?.(0, todo.length);
  const worker = async (): Promise<void> => {
    while (next < todo.length && report.unavailable === null) {
      const link = todo[next++]!;
      const read = await readFromDriveTwice(link.driveFileId);
      if ('unavailable' in read) report.unavailable = read.unavailable;
      else if ('error' in read) report.failed.push({ volunteerKey: link.volunteerKey, reason: read.error });
      else {
        try {
          await putPhoto(eventId, link.volunteerKey, read.blob, { kind: 'drive', fileId: link.driveFileId });
          report.fetched += 1;
        } catch (cause) {
          report.failed.push({ volunteerKey: link.volunteerKey, reason: message(cause) });
        }
      }
      onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return report;
}
