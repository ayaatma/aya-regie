/**
 * Reading ONE photo a volunteer uploaded through the Google Form, 2026-10-10: the pure part of the
 * `drive-photo` function.
 *
 * WHY. A Google Forms file upload lands in the form owner's Drive, private, and the export only
 * carries a link (`https://drive.google.com/open?id=<id>`). The browser cannot read that file: it
 * is not shared with anybody. The folder of uploads is shared, read-only, with the SAME service
 * account that reads the private sheet (`../sheet-csv`), and this function reads a file with it.
 * The régisseur's browser then shrinks the picture and keeps the small copy in the private
 * Supabase bucket `photos`; the original never leaves Drive for good.
 *
 * A THUMBNAIL FIRST. Drive renders its own thumbnail of an image upload, at the size asked, and it
 * does so for formats a browser cannot draw: an iPhone sends HEIC, which no canvas reads. So the
 * thumbnail, asked at 800 px, is both lighter and more readable than the file. The file itself is
 * only the fallback, for a format a browser draws, when Drive has no thumbnail yet.
 *
 * PURE ON PURPOSE, like `../sheet-csv/core.ts`: Web standards only, tested under Node in
 * `tools/src/drive-photo.test.ts`.
 */

export const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';

/** The formats a browser's canvas can draw, so the file itself is worth sending when no thumbnail exists. */
const DRAWABLE = /^image\/(jpeg|png|webp|gif|bmp)$/;

/** Larger than any phone photo; a file past this is not a photo worth a fiche. */
export const MAX_BYTES = 15 * 1024 * 1024;

/** The size the thumbnail is asked at, in pixels on its long side. The app keeps 320. */
const THUMBNAIL_SIZE = 800;

/** A failure the régisseur can act on, with the HTTP status the function answers. */
export class PhotoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** A Drive file id as the export writes it: letters, digits, `-` and `_`. */
export const isDriveFileId = (value: string): boolean => /^[A-Za-z0-9_-]{10,200}$/.test(value);

type Fetch = typeof fetch;

/** A thumbnail link sized as asked: Drive ends it with `=s220`, and the number is the size. */
export function sizedThumbnail(link: string, size: number = THUMBNAIL_SIZE): string {
  return /=s\d+(-c)?$/.test(link) ? link.replace(/=s\d+(-c)?$/, `=s${size}`) : `${link}=s${size}`;
}

/** The bytes of the photo and their type, thumbnail first, the file itself if it can be drawn. */
export async function readDrivePhoto(
  fileId: string,
  token: string,
  fetcher: Fetch,
  serviceAccount: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!isDriveFileId(fileId)) throw new PhotoError("Ce n'est pas un identifiant de fichier Drive.", 400);
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const api = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;

  const meta = await fetcher(`${api}?fields=mimeType,size,thumbnailLink&supportsAllDrives=true`, auth);
  if (meta.status === 403 || meta.status === 404) {
    // Drive answers 404 for a file that exists but is not shared with the caller.
    throw new PhotoError(
      `Photo inaccessible. Partagez le dossier des photos du formulaire (dans le Drive du formulaire) en lecture avec ${serviceAccount}.`,
      403,
    );
  }
  if (!meta.ok) throw new PhotoError(`Google a répondu ${meta.status} en cherchant la photo.`, 502);
  const info = (await meta.json()) as { mimeType?: string; size?: string; thumbnailLink?: string };

  if (info.thumbnailLink) {
    const thumbnail = await fetcher(sizedThumbnail(info.thumbnailLink), auth);
    const type = thumbnail.headers.get('content-type') ?? '';
    if (thumbnail.ok && type.startsWith('image/')) {
      return { bytes: new Uint8Array(await thumbnail.arrayBuffer()), contentType: type.split(';')[0]! };
    }
  }

  const mimeType = info.mimeType ?? '';
  if (!DRAWABLE.test(mimeType)) {
    throw new PhotoError(
      mimeType.startsWith('image/')
        ? `Drive n'a pas encore de miniature de cette photo (${mimeType}), et ce format ne se lit pas dans un navigateur. Réessayez plus tard, ou déposez une photo à la main.`
        : "Ce fichier n'est pas une image.",
      422,
    );
  }
  if (Number(info.size ?? 0) > MAX_BYTES) throw new PhotoError('Photo trop lourde (plus de 15 Mo): déposez-la à la main.', 413);

  const file = await fetcher(`${api}?alt=media&supportsAllDrives=true`, auth);
  if (!file.ok) throw new PhotoError(`Google a répondu ${file.status} en lisant la photo.`, 502);
  return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: mimeType };
}
