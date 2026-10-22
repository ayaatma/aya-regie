/**
 * Réglages > Mails de test, 2026-10-22: the address every « Envoyer un test » sends to. Stored on
 * the régisseur's account, not on the event (see `mail/testMail.tsx`); the login address until
 * another is typed. Saved on blur or Entrée.
 */

import { useEffect, useState } from 'react';

import { saveTestAddress, useTestAddress } from '../mail/testMail.tsx';
import { SetupSection } from './SetupSection.tsx';

export function TestMailCard() {
  const stored = useTestAddress();
  const [draft, setDraft] = useState(stored);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  useEffect(() => setDraft(stored), [stored]);

  const save = async (): Promise<void> => {
    if (draft.trim() === stored.trim()) return;
    const error = await saveTestAddress(draft);
    setMessage(error ? { text: error, bad: true } : { text: 'Adresse de test enregistrée.', bad: false });
  };

  return (
    <SetupSection className="setup-test-mail" title="Mails de test" meta={stored === '' ? 'aucune adresse' : stored}>
      <p className="people-meta setup-orgas-note">
        Avant un envoi groupé, « Envoyer un test » envoie à cette adresse le mail exact d'une des personnes
        (son planning, son lien), avec « [TEST] » devant l'objet. Rien n'est noté sur la fiche de la
        personne. L'adresse est propre à votre compte: chaque régisseur ou régisseuse a la sienne.
      </p>
      <div className="mail-template">
        <label className="field">
          <span className="field-label">Adresse de test</span>
          <input
            className="select"
            type="email"
            name="test-mail-address"
            autoComplete="email"
            placeholder="moi@exemple.org"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage(null);
            }}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        </label>
        {message && <p className={`people-meta ${message.bad ? 'is-bad' : 'is-ok'}`}>{message.text}</p>}
      </div>
    </SetupSection>
  );
}
