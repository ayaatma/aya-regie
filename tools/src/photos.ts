/**
 * The photos of the trombinoscope, 2026-10-10: the pure part, shared by the importer and the app.
 *
 * WHERE A PHOTO COMES FROM. Two ways, and the régisseur asked for both: the form's file upload
 * question, which Google exports as Drive links (`https://drive.google.com/open?id=<id>`), and a
 * file dropped on a fiche by the régie. Both end up as one small square image per person in the
 * private Supabase Storage bucket `photos`, never in the plan document and never in this public
 * repository. The app side is `app/src/photos/`.
 *
 * WHY THE NAME OF A STORED PHOTO SAYS WHERE IT CAME FROM. A re-import must not fetch again what it
 * already holds, and must never replace a photo the régie chose by hand with the form's. Both are
 * read off the object's name (`<person>--drive-<id>.webp` or `<person>--manuel-<time>.webp`), so
 * one listing of the event's folder answers both questions for everybody at once.
 */

/** Every Drive file id in an answer: a file upload question may hold several links, comma-separated. */
export function driveFileIds(answer: string): string[] {
  const ids: string[] = [];
  const pattern = /(?:[?&]id=|\/file\/d\/|\/d\/)([A-Za-z0-9_-]{10,})/g;
  for (const match of answer.matchAll(pattern)) {
    if (!ids.includes(match[1]!)) ids.push(match[1]!);
  }
  return ids;
}

/** Where a stored photo came from, read back from its object name. */
export type PhotoSource = { kind: 'drive'; fileId: string } | { kind: 'manuel'; at: number };

const SOURCE = /^([0-9a-f]+)--(drive-([A-Za-z0-9_-]+)|manuel-(\d+))\.(webp|jpg)$/;

/** The object name for a person (already hashed) and a source. */
export function photoObjectName(personHash: string, source: PhotoSource, extension: 'webp' | 'jpg' = 'webp'): string {
  const tag = source.kind === 'drive' ? `drive-${source.fileId}` : `manuel-${source.at}`;
  return `${personHash}--${tag}.${extension}`;
}

/** The person and source of an object name, or null for a name this tool did not write. */
export function parsePhotoObjectName(name: string): { personHash: string; source: PhotoSource } | null {
  const match = name.match(SOURCE);
  if (!match) return null;
  const source: PhotoSource = match[3] !== undefined ? { kind: 'drive', fileId: match[3] } : { kind: 'manuel', at: Number(match[4]) };
  return { personHash: match[1]!, source };
}

/**
 * Whether the form's photo should be fetched for somebody, given what the store holds for them.
 *
 * A photo the régie put there by hand is never replaced: they chose it, often because the form's
 * was unusable. The same Drive file is never fetched twice. A different Drive file is a new
 * submission with a new photo, and replaces the old one.
 */
export function needsDriveFetch(held: PhotoSource | null, driveFileId: string): boolean {
  if (held === null) return true;
  if (held.kind === 'manuel') return false;
  return held.fileId !== driveFileId;
}

/**
 * The square kept from a picture of `width` by `height`: the whole short side, centred across,
 * and a little above the middle down a portrait, where a face usually is.
 */
export function squareCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  const x = Math.round((width - size) / 2);
  const y = Math.round((height - size) * 0.3);
  return { x, y, size };
}
