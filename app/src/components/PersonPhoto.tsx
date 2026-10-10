/**
 * Somebody's photo at the top of their fiche, 2026-10-10, so the régie sees at a glance who a name is.
 *
 * The photo is the form's when the import fetched it from Drive, or one the régie dropped here:
 * drag a file onto the square, or « Choisir une photo » for the file dialog. A photo chosen here is
 * never replaced by the form's at a later import (see `needsDriveFetch`). Clicking the square shows
 * it larger. Not drawn at all where photos cannot be kept (the fixtures) or read (an orga code).
 *
 * NOT AN EDIT OF THE PLAN. A photo is a file in Storage, so it is not in the undo stack nor the
 * journal, and « Retirer » asks for a second click instead.
 */

import { useRef, useState, type DragEvent } from 'react';

import { usePlan } from '../store/store.tsx';
import { photosAvailable, putPhoto, removePhoto, usePhoto } from '../photos/photoStore.ts';

/** Up to two initials, for the empty square. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function PersonPhoto({ personKey, name, readOnly = false }: { personKey: string; name: string; readOnly?: boolean }) {
  const { id: eventId } = usePlan();
  const { url, source, loading, error } = usePhoto(readOnly ? null : eventId, personKey);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [large, setLarge] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!photosAvailable || readOnly || eventId === null) return null;

  const take = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== '') {
      setProblem("Ce fichier n'est pas une image.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await putPhoto(eventId, personKey, file, { kind: 'manuel', at: Date.now() });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setOver(false);
    void take(event.dataTransfer.files[0]);
  };

  const onRemove = async (): Promise<void> => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setBusy(true);
    setProblem(null);
    try {
      await removePhoto(eventId, personKey);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`person-photo${over ? ' is-over' : ''}${large ? ' is-large' : ''}`}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="person-photo-frame"
        onClick={() => url && setLarge(!large)}
        aria-label={url ? `Photo de ${name}, ${large ? 'réduire' : 'agrandir'}` : `Pas de photo pour ${name}`}
        title={url ? (large ? 'Réduire' : 'Agrandir') : 'Déposez une image ici'}
      >
        {url ? <img src={url} alt="" /> : <span className="person-photo-initials">{loading ? '' : initials(name)}</span>}
      </button>
      <div className="person-photo-side">
        <span className="person-photo-note">
          {busy
            ? 'Enregistrement…'
            : url
              ? source?.kind === 'drive'
                ? 'Photo du formulaire'
                : 'Photo déposée par la régie'
              : loading
                ? ''
                : 'Pas de photo. Déposez une image sur le carré.'}
        </span>
        <span className="person-photo-actions">
          <button type="button" className="btn is-small" disabled={busy} onClick={() => input.current?.click()}>
            {url ? 'Changer la photo' : 'Choisir une photo'}
          </button>
          {url && (
            <button type="button" className={`btn is-small${confirmRemove ? ' is-danger' : ''}`} disabled={busy} onClick={() => void onRemove()} onBlur={() => setConfirmRemove(false)}>
              {confirmRemove ? 'Confirmer le retrait' : 'Retirer'}
            </button>
          )}
        </span>
        {(problem ?? error) && <span className="person-photo-problem">{problem ?? error}</span>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
