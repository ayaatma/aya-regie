/**
 * Prints one section of a stacked tab, 2026-10-24. The Export tab has two printable sections since
 * the trombinoscope joined the plannings, and `window.print()` alone would put both on paper. The
 * section to keep is named on the root element for the time of the print; the stylesheet hides
 * every other `.stack-section` while it is set.
 */
export function printOnly(sectionId: string): void {
  const root = document.documentElement;
  root.dataset.printOnly = sectionId;
  const done = (): void => {
    delete root.dataset.printOnly;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
