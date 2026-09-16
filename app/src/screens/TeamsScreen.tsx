/**
 * Logistique > Équipes: « fonctionnement en équipe », the teams, and their composition.
 *
 * A TAB OF ITS OWN SINCE 2026-09-16, out of Réglages, at the régisseur's request: a team is a group
 * of people to manage, not a setting read once. Each team is a card listing its members, each name
 * opening the fiche in Personnes, with how much of their work the current plan has them do
 * together. Members are added from the list below each team or from a person's fiche; the grid
 * rings a selected bénévole's teammates.
 */

import { useState } from 'react';

import { fmtHours } from '../engine.ts';
import { addTeam, removeTeam, setTeam, setTeamsEnabled, setVolunteerTeam } from '../store/teamEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { useNavigation } from '../components/personNav.ts';

export function TeamsScreen() {
  const { plan, index, report, edit } = useLoadedPlan();
  const nav = useNavigation();
  const [adding, setAdding] = useState<Record<string, string>>({});
  const unteamed = plan.volunteers
    .filter((v) => !v.teamKey || !plan.teams.some((t) => t.key === v.teamKey))
    .map((v) => ({ key: v.key, name: index.volunteerName(v.key) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {plan.teams.length} équipe{plan.teams.length > 1 ? 's' : ''}
          </strong>
          <label className="checkline">
            <input
              type="checkbox"
              name="teams-enabled"
              checked={plan.teamsEnabled}
              onChange={(event) => {
                const on = event.target.checked;
                edit((p) => setTeamsEnabled(p, on), on ? 'fonctionnement en équipe activé' : 'fonctionnement en équipe désactivé');
              }}
            />
            Fonctionnement en équipe
          </label>
          <span className="toolbar-sep" />
          <button className="btn is-primary" onClick={() => edit((p) => addTeam(p), 'équipe ajoutée')}>
            Ajouter une équipe
          </button>
        </div>

        <div className="screen-body">
          <p className="screen-card-note">
            Activé, le calcul garde au maximum chaque équipe sur les mêmes créneaux (Réglages avancés,
            « membre d'équipe sans son équipe »). Jamais bloquant: un créneau peut réunir une équipe
            incomplète et une autre personne. Sur la grille, sélectionner une case entoure ses
            coéquipiers.
          </p>

          {plan.teams.length === 0 && <p className="panel-sub catering-empty">Aucune équipe pour cet événement.</p>}

          {plan.teams.map((team) => {
            const members = plan.volunteers
              .filter((v) => v.teamKey === team.key)
              .sort((a, b) => index.volunteerName(a.key).localeCompare(index.volunteerName(b.key), 'fr'));
            const figures = report.teams.find((t) => t.key === team.key);
            return (
              <section key={team.key} className="screen-card">
                <div className="setup-group-head">
                  <input
                    className="select"
                    name={`team-name-${team.key}`}
                    autoComplete="off"
                    value={team.name}
                    aria-label="Nom de l'équipe"
                    onChange={(event) => edit((p) => setTeam(p, team.key, { name: event.target.value }), `équipe ${team.name}`)}
                  />
                  <select
                    className="select"
                    name={`team-pole-${team.key}`}
                    aria-label={`Pôle habituel de ${team.name}`}
                    value={team.poleKey ?? ''}
                    onChange={(event) =>
                      edit((p) => setTeam(p, team.key, { poleKey: event.target.value === '' ? null : event.target.value }), `pôle de ${team.name}`)
                    }
                  >
                    <option value="">Pôle habituel: aucun</option>
                    {plan.poles.map((p) => (
                      <option key={p.key} value={p.key}>{p.path}</option>
                    ))}
                  </select>
                  <span className="people-meta">
                    {members.length} membre(s)
                    {figures && figures.hours > 0 ? ` · ${fmtHours(figures.hours - figures.aloneHours)} ensemble sur ${fmtHours(figures.hours)}` : ''}
                  </span>
                  <div className="setup-group-actions">
                    <button
                      className="btn is-icon is-danger"
                      title={`Retirer ${team.name} (ses membres restent placés, sans équipe)`}
                      onClick={() => edit((p) => removeTeam(p, team.key), `équipe ${team.name} retirée`)}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {members.length > 0 && (
                  <div className="screen-scroll">
                    <table className="setup-table catering-table">
                      <thead>
                        <tr>
                          <th>Nom</th>
                          <th>Téléphone</th>
                          <th>Heures placées</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((v) => {
                          const name = index.volunteerName(v.key);
                          const placed = report.volunteers.find((r) => r.key === v.key)?.assignedHours ?? 0;
                          return (
                            <tr key={v.key}>
                              <td>
                                {nav ? (
                                  <button
                                    className="btn is-link"
                                    title="Ouvrir sa fiche dans Personnes"
                                    onClick={() => nav.openPerson({ kind: 'benevole', key: v.key })}
                                  >
                                    {name}
                                  </button>
                                ) : (
                                  name
                                )}
                              </td>
                              <td>{v.phone !== '' ? <a href={`tel:${v.phone}`}>{v.phone}</a> : ''}</td>
                              <td className="catering-count">{fmtHours(placed)}</td>
                              <td>
                                <button
                                  className="btn is-icon"
                                  title={`Retirer ${name} de ${team.name}`}
                                  aria-label={`Retirer ${name} de ${team.name}`}
                                  onClick={() => edit((p) => setVolunteerTeam(p, v.key, null), `${name} hors de ${team.name}`)}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="team-members catering-empty">
                  <select
                    className="select is-inline"
                    name={`team-add-${team.key}`}
                    aria-label={`Ajouter un membre à ${team.name}`}
                    value={adding[team.key] ?? ''}
                    onChange={(event) => {
                      const key = event.target.value;
                      if (key === '') return;
                      edit((p) => setVolunteerTeam(p, key, team.key), `${index.volunteerName(key)} dans ${team.name}`);
                      setAdding({ ...adding, [team.key]: '' });
                    }}
                  >
                    <option value="">Ajouter un membre…</option>
                    {unteamed.map((v) => (
                      <option key={v.key} value={v.key}>{v.name}</option>
                    ))}
                  </select>
                </p>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
