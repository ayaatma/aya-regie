/**
 * Handing a file to the régisseur, from the browser.
 *
 * There is no server to fetch it from: everything this tool produces is computed in the page, so
 * a download is a blob and a link that clicks itself. The object URL is released on the next
 * frame rather than immediately, because Firefox has been known to cancel a download whose URL
 * was revoked in the same tick.
 */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Appended on purpose: a link that is not in the document does not click in every browser.
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** "2026-09-08", for a filename that sorts by date in a downloads folder. */
export const today = (): string => new Date().toISOString().slice(0, 10);

/** "Loto Tekno 2027" becomes "loto-tekno-2027": the event's own name at the head of a file name. */
export const fileSlug = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'planning';
