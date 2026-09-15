/**
 * Reading a PRIVATE Google Sheet for AyaRégie, 2026-09-15: the pure part of the `sheet-csv` function.
 *
 * WHY. The import used to read a sheet through its public « anyone with the link » CSV endpoint
 * (`app/src/import/sheet.ts`). A volunteer form now carries emergency contacts and health notes, and
 * a sheet like that must not be public. So the sheet is shared, read-only, with ONE Google service
 * account, and this function reads it with that account's key, which lives in the Supabase secrets
 * and nowhere else.
 *
 * PURE ON PURPOSE: no Deno API, only Web standards (fetch, WebCrypto, TextEncoder), so the tests in
 * `tools/` run it under Node and the function in `index.ts` is only the HTTP and auth shell.
 */

/** The fields of a service account's JSON key this code uses. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface SheetRef {
  documentId: string;
  gid: string | null;
}

/** Same reading as `parseSheetUrl` in the app: an editor link, a published link, or a bare id. */
export function parseSheetUrl(input: string): SheetRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return { documentId: trimmed, gid: null };
  const id = trimmed.match(/\/spreadsheets\/d\/(?:e\/)?([A-Za-z0-9_-]+)/);
  if (!id?.[1]) return null;
  const gid = trimmed.match(/[#&?]gid=([0-9]+)/);
  return { documentId: id[1], gid: gid?.[1] ?? null };
}

const base64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let binary = '';
  for (const b of raw) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The PKCS#8 bytes of a « -----BEGIN PRIVATE KEY----- » block, as Google writes it in the JSON. */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const SHEETS_READONLY = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** The signed assertion Google exchanges for an access token (OAuth 2.0 JWT bearer grant). */
export async function signedAssertion(key: ServiceAccountKey, nowSeconds: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope: SHEETS_READONLY,
    aud: key.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(key.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

/** A failure the régisseur can act on, with the HTTP status the function answers. */
export class SheetError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** An access token for the service account, from Google's token endpoint. */
export async function accessToken(key: ServiceAccountKey, fetcher: Fetch, nowSeconds: number): Promise<{ token: string; expiresAt: number }> {
  const assertion = await signedAssertion(key, nowSeconds);
  const response = await fetcher(key.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  if (!response.ok) {
    throw new SheetError(
      `Google refuse la clé du compte de service (${response.status}). La clé a peut-être été supprimée: en créer une nouvelle et la ranger dans les secrets Supabase.`,
      502,
    );
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  return { token: body.access_token, expiresAt: nowSeconds + body.expires_in };
}

/** One CSV field, quoted when it has to be, the way `parseCsv` in the importer reads it back. */
const csvField = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * The values of a tab as CSV. The API drops trailing empty cells, so every row is padded to the
 * widest one: a column that is empty at the end of a row must still be a column.
 */
export function valuesToCsv(values: readonly (readonly unknown[])[]): string {
  const width = values.reduce((max, row) => Math.max(max, row.length), 0);
  return values
    .map((row) => Array.from({ length: width }, (_, i) => csvField(row[i] === undefined || row[i] === null ? '' : String(row[i]))).join(','))
    .join('\n');
}

/**
 * The tab a link names (its gid), or the first tab, read as CSV with the values as the sheet shows
 * them (dates as « 15/09/2026 17:11:42 », like the public export did).
 */
export async function readSheetCsv(ref: SheetRef, token: string, fetcher: Fetch, serviceAccount: string): Promise<string> {
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ref.documentId)}`;
  const auth = { headers: { authorization: `Bearer ${token}` } };

  const explain = (status: number): SheetError =>
    status === 403
      ? new SheetError(`La feuille n'est pas partagée avec le compte de service. Partagez-la en lecture avec ${serviceAccount}.`, 403)
      : status === 404
        ? new SheetError("Aucune feuille à cette adresse. Vérifiez le lien copié.", 404)
        : new SheetError(`Google a répondu ${status} en lisant la feuille.`, 502);

  const meta = await fetcher(`${api}?fields=sheets.properties(sheetId,title)`, auth);
  if (!meta.ok) throw explain(meta.status);
  const sheets = ((await meta.json()) as { sheets?: Array<{ properties: { sheetId: number; title: string } }> }).sheets ?? [];
  const tab = ref.gid === null ? sheets[0] : sheets.find((s) => String(s.properties.sheetId) === ref.gid);
  if (!tab) throw new SheetError("L'onglet désigné par le lien n'existe plus dans la feuille.", 404);

  const range = encodeURIComponent(`'${tab.properties.title.replace(/'/g, "''")}'`);
  const read = await fetcher(`${api}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, auth);
  if (!read.ok) throw explain(read.status);
  const body = (await read.json()) as { values?: unknown[][] };
  return valuesToCsv(body.values ?? []);
}
