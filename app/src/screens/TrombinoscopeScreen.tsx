/**
 * The trombinoscope on paper, 2026-10-24: who is who, with the form's photos.
 *
 * One document or several, as the developer asked: the whole thing (Responsables, then the Staff
 * pole by pole, then the bénévoles pole by pole), one of the three parts, every pole on its own
 * page, or a single pole with its Responsables at the top. Pick, then « Imprimer », which the
 * browser turns into a PDF; a separate file is one more pick and one more print.
 *
 * The order and the grouping are the engine's (`trombinoscope`), so this screen only draws. A
 * person without a photo gets their initials, so a missing face shows on the sheet rather than
 * leaving a hole nobody notices.
 *
 * Phone numbers are not printed: a trombinoscope is passed around, and a face with a name is
 * what it is for.
 */

import { useMemo, useState } from 'react';

import { trombiPoles, trombinoscope, type TrombiDocument, type TrombiPerson } from '../engine.ts';
import { photosAvailable, usePhoto } from '../photos/photoStore.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { printOnly } from '../components/printOnly.ts';

/** Up to two initials, for the empty square. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

function TrombiCard({ eventId, person }: { eventId: string | null; person: TrombiPerson }) {
  const { url } = usePhoto(photosAvailable ? eventId : null, person.key);
  return (
    <figure className="trombi-card">
      <div className="trombi-photo">{url ? <img src={url} alt="" /> : <span>{initials(person.name)}</span>}</div>
      <figcaption>
        <div className="trombi-name">{person.name}</div>
        {person.caption !== '' && <div className="trombi-caption">{person.caption}</div>}
      </figcaption>
    </figure>
  );
}

const FIXED: Array<{ value: string; label: string; document: TrombiDocument }> = [
  { value: 'all', label: 'Tout: Responsables, puis Staff et bénévoles par pôle', document: { kind: 'all' } },
  { value: 'responsables', label: 'Responsables seulement', document: { kind: 'responsables' } },
  { value: 'staff', label: 'Staff seulement, par pôle', document: { kind: 'staff' } },
  { value: 'benevoles', label: 'Bénévoles seulement, par pôle', document: { kind: 'benevoles' } },
  { value: 'byPole', label: 'Tous les pôles, un pôle par page', document: { kind: 'byPole' } },
];

export function TrombinoscopeScreen() {
  const { plan, id: eventId } = useLoadedPlan();
  const [choice, setChoice] = useState('all');

  // The poles offered one by one are the ones somebody is on.
  const poles = useMemo(() => trombiPoles(plan), [plan]);
  const document: TrombiDocument = useMemo(
    () => FIXED.find((f) => f.value === choice)?.document ?? { kind: 'pole', poleId: choice.replace(/^pole=/, '') },
    [choice],
  );
  const sections = useMemo(() => trombinoscope(plan, document), [plan, document]);
  const ownPages = document.kind === 'byPole' || document.kind === 'all';
  const count = new Set(sections.flatMap((s) => s.groups.flatMap((g) => g.people.map((p) => `${p.kind}:${p.key}`)))).size;

  return (
    <div className="print-screen">
      <div className="toolbar no-print">
        <strong>Trombinoscope</strong>
        <label className="checkline">
          Document{' '}
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            {FIXED.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {poles.length > 0 && (
              <optgroup label="Un seul pôle">
                {poles.map((p) => (
                  <option key={p.id} value={`pole=${p.id}`}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button className="btn is-primary" disabled={sections.length === 0} onClick={() => printOnly('trombinoscope')}>
          Imprimer
        </button>
        <span className="toolbar-note">
          {count} personne{count > 1 ? 's' : ''}. Pour un PDF, choisissez « Enregistrer au format PDF » comme imprimante; pour des
          documents séparés, choisissez-les un par un. Sans photo, les initiales s'affichent: une photo se dépose sur la fiche de la personne.
        </span>
      </div>

      <div className="print-body">
        <div className="print-sheet">
          <header className="print-head">
            <h1>Trombinoscope · {plan.name}</h1>
          </header>
          {sections.length === 0 && <p className="trombi-empty">Personne à montrer dans ce document.</p>}
          {sections.map((section, i) => (
            <section
              key={`${section.title}-${i}`}
              className={`trombi-section${ownPages ? ' is-own-page' : ''}${ownPages && i < sections.length - 1 ? ' print-page' : ''}`}
            >
              <h2>{section.title}</h2>
              {section.groups.map((group) => (
                <div key={group.id} className="trombi-group">
                  {group.title !== '' && <h3>{group.title}</h3>}
                  <div className="trombi-grid">
                    {group.people.map((person) => (
                      <TrombiCard key={`${person.kind}:${person.key}`} eventId={eventId} person={person} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
