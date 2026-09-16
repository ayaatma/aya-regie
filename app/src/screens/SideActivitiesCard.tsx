/**
 * Réglages > Activités annexes, 2026-09-15: the pré-montage, the weekends of preparation or déco.
 * No grid on purpose (the régisseur's decision): what is needed is who is keen, with a way to
 * reach them. Each activity lists its people and exports them as a CSV.
 *
 * The label is what the import looks for in the form's headers: « Pré-montage » finds « ... nous
 * aider sur le pré-montage aussi ? », and a yes to it puts the person on the list.
 */

import { useState } from 'react';

import { toCsv, type SideActivity } from '../engine.ts';
import { addSideActivity, removeSideActivity, setSideActivity, sideActivityPeople } from '../store/sideActivityEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { downloadText, today } from '../components/download.ts';
import { SetupSection } from './SetupSection.tsx';

export function SideActivitiesCard() {
  const { plan, edit } = useLoadedPlan();
  const [label, setLabel] = useState('');

  const add = () => {
    if (label.trim() === '') return;
    edit((p) => addSideActivity(p, label), `activité ${label.trim()}`);
    setLabel('');
  };

  const exportList = (activity: SideActivity) => {
    const people = sideActivityPeople(plan, activity.key);
    const csv = toCsv(
      ['Nom', 'Prénom', 'Statut', 'Téléphone', 'E-mail'],
      people.map((p) => [p.lastName, p.firstName, p.kind === 'orga' ? 'Orga' : 'Bénévole', p.phone, p.email]),
    );
    const slug = activity.label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadText(`${slug || 'activite'}-${today()}.csv`, csv);
  };

  return (
    <SetupSection
      className="setup-side-activities"
      title="Activités annexes"
      meta={plan.sideActivities.length === 0 ? 'aucune' : plan.sideActivities.map((a) => `${a.label} (${sideActivityPeople(plan, a.key).length})`).join(' · ')}
    >
      <p className="people-meta setup-orgas-note">
        Pré-montage, week-ends de préparation ou de déco: pas de grille, une liste des personnes
        partantes. L'import coche une personne quand elle répond « oui » à une question dont
        l'intitulé contient le nom de l'activité.
      </p>
      {plan.sideActivities.map((activity) => {
        const people = sideActivityPeople(plan, activity.key);
        return (
          <div key={activity.key} className="team-row">
            <div className="setup-ticket-row">
              <input
                className="select"
                name={`activity-label-${activity.key}`}
                autoComplete="off"
                value={activity.label}
                aria-label="Nom de l'activité"
                onChange={(event) => edit((p) => setSideActivity(p, activity.key, { label: event.target.value }), `activité ${activity.label}`)}
              />
              <input
                className="select"
                name={`activity-when-${activity.key}`}
                autoComplete="off"
                value={activity.when}
                placeholder="Quand (10 au 12 septembre)"
                aria-label={`Dates de ${activity.label}`}
                onChange={(event) => edit((p) => setSideActivity(p, activity.key, { when: event.target.value }), `dates de ${activity.label}`)}
              />
              <span className="people-meta">{people.length} partant·e·s</span>
              <button className="btn is-small" disabled={people.length === 0} onClick={() => exportList(activity)}>
                Exporter
              </button>
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${activity.label} (décoche tout le monde)`}
                onClick={() => edit((p) => removeSideActivity(p, activity.key), `activité ${activity.label} retirée`)}
              >
                ✕
              </button>
            </div>
            <p className="team-members">
              {people.length === 0 ? (
                <span className="people-meta">Personne pour l'instant.</span>
              ) : (
                people.map((p) => (
                  <span key={`${p.kind}|${p.key}`} className="chip" title={[p.phone, p.email].filter(Boolean).join(' · ')}>
                    {p.firstName} {p.lastName}
                    {p.kind === 'orga' ? ' (orga)' : ''}
                  </span>
                ))
              )}
            </p>
          </div>
        );
      })}
      <span className="setup-confirm">
        <input
          className="select"
          placeholder="Nom d'une activité"
          name="new-side-activity"
          autoComplete="off"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
        />
        <button className="btn" disabled={label.trim() === ''} onClick={add}>
          Ajouter une activité
        </button>
      </span>
    </SetupSection>
  );
}
