/**
 * Somebody's photo at the top of their fiche, 2026-10-10, so the régie sees at a glance who a name is.
 *
 * The photo is the form's when the import fetched it from Drive, or one the régie dropped here:
 * drag a file onto the square, or « Choisir une photo » for the file dialog. A photo chosen here is
 * never replaced by the form's at a later import (see `needsDriveFetch`). Clicking the square shows
 * it larger. Not drawn at all where photos cannot be kept (the fixtures) or read (an orga code).
 *
 * Since 2026-10-23: « Recadrer » frames the face by hand (`PhotoCropper`), from the form's upload
 * asked again at full size; and « Récupérer la photo du formulaire » asks Drive again for a photo
 * the form carries and an import could not bring (`formFileId`, read from the raw answers).
 *
 * NOT AN EDIT OF THE PLAN. A photo is a file in Storage, so it is not in the undo stack nor the
 * journal, and « Retirer » asks for a second click instead.
 */

import { useRef, useState, type DragEvent } from 'react';

import { usePlan } from '../store/store.tsx';
import { cropSource, fetchFormPhoto, photosAvailable, putCroppedPhoto, putPhoto, removePhoto, usePhoto } from '../photos/photoStore.ts';
import { PhotoCropper } from './PhotoCropper.tsx';

/** Up to two initials, for the empty square. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function PersonPhoto({
  personKey,
  name,
  readOnly = false,
  formFileId = null,
}: {
  personKey: string;
  name: string;
  readOnly?: boolean;
  /** The Drive file of the photo uploaded with the form, when the person sent one. */
  formFileId?: string | null;
}) {
  const { id: eventId } = usePlan();
  const { url, source, loading, error } = usePhoto(readOnly ? null : eventId, personKey);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [large, setLarge] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [cropping, setCropping] = useState(false);
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

  // The form's photo is missing, or older than the one the form now carries. A photo the régie
  // chose by hand is not offered for replacement here: « Changer la photo » is for that.
  const formMissing =
    formFileId !== null && !loading && (url === null || (source?.kind === 'drive' && source.fileId !== formFileId));

  const fetchForm = async (): Promise<void> => {
    if (formFileId === null) return;
    setBusy(true);
    setProblem(null);
    const failed = await fetchFormPhoto(eventId, personKey, formFileId);
    if (failed !== null) setProblem(`La photo du formulaire n'a pas pu être récupérée: ${failed}`);
    setBusy(false);
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
            <button type="button" className="btn is-small" disabled={busy} onClick={() => setCropping(true)}>
              Recadrer
            </button>
          )}
          {formMissing && (
            <button type="button" className="btn is-small" disabled={busy} onClick={() => void fetchForm()}>
              Récupérer la photo du formulaire
            </button>
          )}
          {url && (
            <button type="button" className={`btn is-small${confirmRemove ? ' is-danger' : ''}`} disabled={busy} onClick={() => void onRemove()} onBlur={() => setConfirmRemove(false)}>
              {confirmRemove ? 'Confirmer le retrait' : 'Retirer'}
            </button>
          )}
        </span>
        {(problem ?? error) && <span className="person-photo-problem">{problem ?? error}</span>}
      </div>
      {cropping && (
        <PhotoCropper
          name={name}
          load={() => cropSource(source?.kind === 'drive' ? source.fileId : null, url)}
          onCancel={() => setCropping(false)}
          onDone={async (square) => {
            await putCroppedPhoto(eventId, personKey, square, source ?? { kind: 'manuel', at: Date.now() });
            setCropping(false);
          }}
        />
      )}
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
