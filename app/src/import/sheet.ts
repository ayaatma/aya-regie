/**
 * Turning a Google Sheet link into something the browser is allowed to fetch.
 *
 * The régisseur copies the address out of their browser bar. That address is an editor page, not
 * data, so it has to be rewritten into an export endpoint.
 *
 * WHICH ENDPOINT, and why this one. Checked against Google in September 2026:
 *
 *   /export?format=csv    answers 307 to googleusercontent, which does send
 *                         `Access-Control-Allow-Origin: *`. It works, through a redirect.
 *   /gviz/tq?tqx=out:csv  answers 200 directly, echoing the caller's origin in
 *                         `Access-Control-Allow-Origin`. No redirect at all.
 *
 * The second is used because a request that never redirects has one less thing to break, and
 * because the redirect target is a hostname Google is free to change. Both need the sheet to be
 * readable without signing in, which for a form response sheet means "share with anyone who has
 * the link". Nothing here can authenticate, and it deliberately does not try: a tool that asks
 * for a Google account password is a tool nobody should give one to.
 *
 * A PRIVATE SHEET FIRST, SINCE 2026-09-15. A form carrying emergency contacts and health notes must
 * not be public, so the sheet is shared read-only with the association's Google service account and
 * read by the Supabase function `sheet-csv` (`supabase/functions/sheet-csv`), which holds the key.
 * The public endpoint stays as the fallback while that function is not deployed or not configured,
 * so nothing breaks the day this ships ahead of its setup.
 */

import { getSupabase, supabaseConfigured } from '../persistence/supabaseClient.ts';

/** The document id and tab of a pasted Google Sheets address. */
export interface SheetRef {
  documentId: string;
  /** The tab, when the link names one. A sheet's first tab is `0`. */
  gid: string | null;
}

export function parseSheetUrl(input: string): SheetRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  // A bare document id, which is what somebody pastes when they have copied only part of it.
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return { documentId: trimmed, gid: null };

  const id = trimmed.match(/\/spreadsheets\/d\/(?:e\/)?([A-Za-z0-9_-]+)/);
  if (!id?.[1]) return null;

  // The tab is in the fragment on an editor link and in the query on a published one.
  const gid = trimmed.match(/[#&?]gid=([0-9]+)/);
  return { documentId: id[1], gid: gid?.[1] ?? null };
}

/** The CSV endpoint for a pasted link, or null when the link is not a Google Sheet. */
export function csvUrlFromSheet(input: string): string | null {
  const ref = parseSheetUrl(input);
  if (!ref) return null;
  const gid = ref.gid === null ? '' : `&gid=${ref.gid}`;
  return `https://docs.google.com/spreadsheets/d/${ref.documentId}/gviz/tq?tqx=out:csv${gid}`;
}

/**
 * What the private reader answered: the CSV, a failure to show as is (the function ran and said
 * why, typically « not shared with the service account »), or `unavailable` when there is no
 * function to ask (not deployed, not configured, no network), which falls back to the public link.
 */
export type PrivateRead = { csv: string } | { error: string } | { unavailable: true };

export type PrivateReader = (url: string) => Promise<PrivateRead>;

/** The `sheet-csv` Supabase function, with the régisseur's session. */
export const readThroughFunction: PrivateReader = async (url) => {
  if (!supabaseConfigured) return { unavailable: true };
  try {
    const { data, error } = await getSupabase().functions.invoke<string>('sheet-csv', { body: { url } });
    if (!error) return { csv: typeof data === 'string' ? data : '' };
    const response = (error as { context?: unknown }).context;
    if (!(response instanceof Response)) return { unavailable: true };
    let body: { error?: string; serviceAccount?: string } = {};
    try {
      body = (await response.clone().json()) as typeof body;
    } catch {
      // Not our JSON: the gateway answering for a function that does not exist.
    }
    // Not deployed (the gateway's 404) or deployed without its key (our 503): use the public link.
    if (response.status === 503 || body.error === undefined) return { unavailable: true };
    return { error: body.error };
  } catch {
    return { unavailable: true };
  }
};

/**
 * Fetches the sheet as CSV text: privately through the service account when the tool can, through
 * the public link otherwise.
 *
 * A private read that FAILED for a reason (the sheet is not shared with the account) still tries the
 * public link, because a sheet shared by link is readable that way; if that fails too, the private
 * reason is the one shown, since it says what to do: share the sheet with the account.
 */
export async function fetchSheetCsv(input: string, reader: PrivateReader = readThroughFunction): Promise<string> {
  const url = csvUrlFromSheet(input);
  if (!url) {
    throw new Error(
      "Ce lien n'est pas une feuille Google Sheets. Copiez l'adresse depuis la barre du navigateur.",
    );
  }

  const privately = await reader(input.trim());
  if ('csv' in privately) return privately.csv;
  try {
    return await fetchPublicCsv(url);
  } catch (cause) {
    if ('error' in privately) throw new Error(privately.error);
    throw cause;
  }
}

/**
 * The public « anyone with the link » endpoint.
 *
 * A sheet that is not shared answers with an HTML sign-in page rather than an error, so the
 * content type is checked: "your file arrived and it is a login form" is the one failure that
 * would otherwise be reported as a broken import file.
 */
async function fetchPublicCsv(url: string): Promise<string> {

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      'La feuille est injoignable. Vérifiez la connexion, et que la feuille est partagée avec ' +
        '"tous les utilisateurs disposant du lien".',
    );
  }

  if (!response.ok) {
    throw new Error(
      `Google a répondu ${response.status}. La feuille doit être partagée avec "tous les ` +
        'utilisateurs disposant du lien" pour être lue sans connexion.',
    );
  }

  const text = await response.text();
  if (/^\s*</.test(text)) {
    throw new Error(
      'Google a renvoyé une page de connexion au lieu des données. La feuille est privée: ' +
        'passez-la en partage par lien.',
    );
  }
  return text;
}
