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
 */

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
 * Fetches the sheet as CSV text.
 *
 * A sheet that is not shared answers with an HTML sign-in page rather than an error, so the
 * content type is checked: "your file arrived and it is a login form" is the one failure that
 * would otherwise be reported as a broken import file.
 */
export async function fetchSheetCsv(input: string): Promise<string> {
  const url = csvUrlFromSheet(input);
  if (!url) {
    throw new Error(
      "Ce lien n'est pas une feuille Google Sheets. Copiez l'adresse depuis la barre du navigateur.",
    );
  }

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
