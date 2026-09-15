/**
 * Réglages > Équipes, 2026-09-15: « fonctionnement en équipe », the teams, and their composition.
 *
 * The composition is read here at a glance, member by member, with how much of their work the
 * current plan has them do together. Members are added from the list below each team or from a
 * person's fiche; the grid rings a selected bénévole's teammates.
 */

import { useState } from 'react';

import { fmtHours } from '../engine.ts';
import { addTeam, removeTeam, setTeam, setTeamsEnabled, setVolunteerTeam } from '../store/teamEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { SetupSection } from './SetupSection.tsx';

export function TeamsCard() {
  const { plan, index, report, edit } = useLoadedPlan();
  const [adding, setAdding] = useState<Record<string, string>>({});
  const unteamed = plan.volunteers
    .filter((v) => !v.teamKey || !plan.teams.some((t) => t.key === v.teamKey))
    .map((v) => ({ key: v.key, name: index.volunteerName(v.key) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return (
    <SetupSection
      className="setup-teams"
      title="Équipes"
      meta={`${plan.teamsEnabled ? 'fonctionnement en équipe' : 'désactivé'} · ${plan.teams.length} équipe(s)`}
      actions={
        <div className="setup-group-actions">
          <label className="setup-toggle">
            <input
              type="checkbox"
              name="teams-enabled"
              checked={plan.teamsEnabled}
              onChange={(event) => {
                const on = event.target.checked;
                edit((p) => setTeamsEnabled(p, on), on ? 'fonctionnement en équipe activé' : 'fonctionnement en équipe désactivé');
              }}
            />
            <span>Activer</span>
          </label>
        </div>
      }
    >
      <p className="people-meta setup-orgas-note">
        Activé, le calcul garde au maximum chaque équipe sur les mêmes créneaux (Réglages avancés,
        « membre d'équipe sans son équipe »). Jamais bloquant: un créneau peut réunir une équipe
        incomplète et une autre personne. Sur la grille, sélectionner une case entoure ses coéquipiers.
      </p>
      {plan.teams.map((team) => {
        const members = plan.volunteers.filter((v) => v.teamKey === team.key);
        const figures = report.teams.find((t) => t.key === team.key);
        return (
          <div key={team.key} className="team-row">
            <div className="setup-ticket-row">
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
              <button
                className="btn is-icon is-danger"
                title={`Retirer ${team.name} (ses membres restent placés, sans équipe)`}
                onClick={() => edit((p) => removeTeam(p, team.key), `équipe ${team.name} retirée`)}
              >
                ✕
              </button>
            </div>
            <p className="team-members">
              {members.map((v) => (
                <span key={v.key} className="chip">
                  {index.volunteerName(v.key)}
                  <button
                    type="button"
                    className="chip-remove"
                    title={`Retirer ${index.volunteerName(v.key)} de ${team.name}`}
                    aria-label={`Retirer ${index.volunteerName(v.key)} de ${team.name}`}
                    onClick={() => edit((p) => setVolunteerTeam(p, v.key, null), `${index.volunteerName(v.key)} hors de ${team.name}`)}
                  >
                    ✕
                  </button>
                </span>
              ))}
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
          </div>
        );
      })}
      <p>
        <button className="btn" onClick={() => edit((p) => addTeam(p), 'équipe ajoutée')}>
          Ajouter une équipe
        </button>
      </p>
    </SetupSection>
  );
}
