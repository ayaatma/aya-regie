/**
 * Logistique > Activités annexes: the pré-montage, the weekends of preparation or déco.
 *
 * A TAB OF ITS OWN SINCE 2026-09-16, out of Réglages, at the régisseur's request: what is read
 * here is people, not a setting, so each activity is a list of the people keen on it, one line per
 * person, the name opening their fiche in Personnes. No grid on purpose (decided 2026-09-15): what
 * is needed is who is keen, with a way to reach them, and a CSV to send round.
 *
 * The label is what the import looks for in the form's headers: « Pré-montage » finds « ... nous
 * aider sur le pré-montage aussi ? », and a yes to it puts the person on the list.
 */

import { useState } from 'react';

import { toCsv, type SideActivity } from '../engine.ts';
import { addSideActivity, removeSideActivity, setSideActivity, sideActivityPeople } from '../store/sideActivityEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { downloadText, today } from '../components/download.ts';
import { PersonMark } from '../components/PersonMark.tsx';
import { useNavigation } from '../components/personNav.ts';

export function SideActivitiesScreen() {
  const { plan, edit } = useLoadedPlan();
  const nav = useNavigation();
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
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {plan.sideActivities.length === 0
              ? 'Aucune activité annexe'
              : plan.sideActivities.map((a) => `${a.label} (${sideActivityPeople(plan, a.key).length})`).join(' · ')}
          </strong>
          <span className="toolbar-sep" />
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
          <button className="btn is-primary" disabled={label.trim() === ''} onClick={add}>
            Ajouter une activité
          </button>
        </div>

        <div className="screen-body">
          <p className="screen-card-note">
            Pré-montage, week-ends de préparation ou de déco: pas de grille, la liste des personnes
            partantes. L'import coche une personne quand elle répond « oui » à une question dont
            l'intitulé contient le nom de l'activité. On coche ou décoche aussi depuis la fiche de
            la personne.
          </p>

          {plan.sideActivities.map((activity) => {
            const people = sideActivityPeople(plan, activity.key);
            return (
              <section key={activity.key} className="screen-card">
                <div className="setup-group-head">
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
                  <div className="setup-group-actions">
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
                </div>

                {people.length === 0 ? (
                  <p className="panel-sub catering-empty">Personne pour l'instant.</p>
                ) : (
                  <div className="screen-scroll">
                    <table className="setup-table catering-table">
                      <thead>
                        <tr>
                          <th>Nom</th>
                          <th>Statut</th>
                          <th>Téléphone</th>
                          <th>E-mail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p) => {
                          const name = `${p.firstName} ${p.lastName}`.trim() || 'Sans nom';
                          return (
                            <tr key={`${p.kind}|${p.key}`}>
                              <td>
                                <PersonMark kind={p.kind} />{' '}
                                {nav ? (
                                  <button
                                    className="btn is-link"
                                    title="Ouvrir sa fiche dans Personnes"
                                    onClick={() => nav.openPerson({ kind: p.kind, key: p.key })}
                                  >
                                    {name}
                                  </button>
                                ) : (
                                  name
                                )}
                              </td>
                              <td>{p.kind === 'orga' ? 'Orga' : 'Bénévole'}</td>
                              <td>{p.phone !== '' ? <a href={`tel:${p.phone}`}>{p.phone}</a> : ''}</td>
                              <td>{p.email !== '' ? <a href={`mailto:${p.email}`}>{p.email}</a> : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
