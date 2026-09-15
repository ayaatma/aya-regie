/**
 * Magasin, 2026-09-15: the general equipment of the event, what is lent and by whom, where each
 * piece is, and what the bénévoles offered to bring on the form.
 *
 * A LEDGER, NOT A PLAN. The régisseur asked for a mode to « gérer le matériel général
 * dispo / prêté »: each line is typed and changed by hand, and a status is what a person says it
 * is. The offers from the form sit below the list, each one click from becoming an expected line
 * lent by that person; an offer already turned into a line says so rather than disappearing.
 */

import { useState } from 'react';

import {
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABEL,
  toCsv,
  type EquipmentItem,
  type EquipmentStatus,
} from '../engine.ts';
import { addEquipment, equipmentFromOffer, removeEquipment, setEquipment } from '../store/equipmentEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { NumberField } from '../components/NumberField.tsx';
import { downloadText, today } from '../components/download.ts';

type Filter = EquipmentStatus | 'tous' | 'prets';

export function MagasinScreen() {
  const { plan, index, edit } = useLoadedPlan();
  const [filter, setFilter] = useState<Filter>('tous');

  const lines = plan.equipment.filter((e) =>
    filter === 'tous' ? true : filter === 'prets' ? e.lender.trim() !== '' && e.status !== 'rendu' : e.status === filter,
  );
  const offers = plan.volunteers.filter((v) => (v.equipmentNote ?? '').trim() !== '' && v.status !== 'annule');
  const toReturn = plan.equipment.filter((e) => e.lender.trim() !== '' && e.status !== 'rendu').length;

  const set = (item: EquipmentItem, over: Partial<Omit<EquipmentItem, 'key'>>, what: string) =>
    edit((p) => setEquipment(p, item.key, over), `${what}: ${item.name || 'matériel'}`);

  const exportCsv = () =>
    downloadText(
      `magasin-${today()}.csv`,
      toCsv(
        ['Matériel', 'Quantité', 'Prêté par', 'État', 'Où / chez qui', 'Remarque'],
        plan.equipment.map((e) => [e.name, String(e.quantity), e.lender, EQUIPMENT_STATUS_LABEL[e.status], e.holder, e.note]),
      ),
    );

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>{plan.equipment.length} ligne{plan.equipment.length > 1 ? 's' : ''}</strong>
          {toReturn > 0 && <span className="chip is-warn">{toReturn} prêt{toReturn > 1 ? 's' : ''} à rendre</span>}
          <span className="toolbar-sep" />
          <label className="checkline">
            Afficher
            <select className="select" value={filter} aria-label="Filtrer le matériel" onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="tous">Tout</option>
              <option value="prets">Prêts pas encore rendus</option>
              {EQUIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{EQUIPMENT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <span className="toolbar-sep" />
          <button className="btn is-primary" onClick={() => edit((p) => addEquipment(p), 'matériel ajouté')}>
            Ajouter du matériel
          </button>
          <button className="btn" disabled={plan.equipment.length === 0} onClick={exportCsv}>
            Exporter
          </button>
        </div>

        <div className="screen-body">
          <section className="screen-card">
            {lines.length === 0 ? (
              <p className="panel-sub catering-empty">
                {plan.equipment.length === 0 ? 'Aucun matériel noté pour cet événement.' : 'Rien ne correspond à ce filtre.'}
              </p>
            ) : (
              <div className="screen-scroll">
                <table className="setup-table catering-table magasin-table">
                  <thead>
                    <tr>
                      <th>Matériel</th>
                      <th>Qté</th>
                      <th>Prêté par</th>
                      <th>État</th>
                      <th>Où / chez qui</th>
                      <th>Remarque</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((item) => (
                      <tr key={item.key}>
                        <td>
                          <input
                            className="select"
                            name={`equipment-name-${item.key}`}
                            autoComplete="off"
                            value={item.name}
                            placeholder="Nom du matériel"
                            aria-label="Nom du matériel"
                            onChange={(event) => set(item, { name: event.target.value }, 'nom')}
                          />
                        </td>
                        <td className="catering-count">
                          <NumberField
                            value={item.quantity}
                            ariaLabel={`Quantité de ${item.name}`}
                            name={`equipment-qty-${item.key}`}
                            onCommit={(value) => set(item, { quantity: Math.max(0, Math.round(value ?? 0)) }, 'quantité')}
                          />
                        </td>
                        <td>
                          <input
                            className="select"
                            name={`equipment-lender-${item.key}`}
                            autoComplete="off"
                            value={item.lender}
                            placeholder="L'association"
                            aria-label={`Prêté par, pour ${item.name}`}
                            title={item.lenderKind === 'benevole' && item.lenderKey ? `Bénévole: ${index.volunteerName(item.lenderKey)}` : undefined}
                            onChange={(event) => set(item, { lender: event.target.value, lenderKind: null, lenderKey: null }, 'prêteur')}
                          />
                        </td>
                        <td>
                          <select
                            className={`select magasin-status is-${item.status}`}
                            name={`equipment-status-${item.key}`}
                            value={item.status}
                            aria-label={`État de ${item.name}`}
                            onChange={(event) => set(item, { status: event.target.value as EquipmentStatus }, 'état')}
                          >
                            {EQUIPMENT_STATUSES.map((s) => (
                              <option key={s} value={s}>{EQUIPMENT_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="select"
                            name={`equipment-holder-${item.key}`}
                            autoComplete="off"
                            value={item.holder}
                            placeholder={item.status === 'sorti' ? 'Où, ou chez qui' : ''}
                            aria-label={`Où se trouve ${item.name}`}
                            onChange={(event) => set(item, { holder: event.target.value }, 'emplacement')}
                          />
                        </td>
                        <td>
                          <input
                            className="select"
                            name={`equipment-note-${item.key}`}
                            autoComplete="off"
                            value={item.note}
                            aria-label={`Remarque sur ${item.name}`}
                            onChange={(event) => set(item, { note: event.target.value }, 'remarque')}
                          />
                        </td>
                        <td>
                          <button
                            className="btn is-icon is-danger"
                            title={`Retirer ${item.name || 'cette ligne'}`}
                            onClick={() => edit((p) => removeEquipment(p, item.key), `matériel retiré: ${item.name}`)}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {offers.length > 0 && (
            <section className="screen-card">
              <div className="setup-group-head">
                <span className="setup-group-title">Proposé par les bénévoles ({offers.length})</span>
                <span className="people-meta">ce qu'ils ont répondu au formulaire, mot pour mot</span>
              </div>
              <ul className="people magasin-offers">
                {offers.map((v) => {
                  const added = plan.equipment.some((e) => e.lenderKind === 'benevole' && e.lenderKey === v.key);
                  return (
                    <li key={v.key}>
                      <strong>{index.volunteerName(v.key)}</strong>: {v.equipmentNote}{' '}
                      {added ? (
                        <span className="chip is-ok">au magasin</span>
                      ) : (
                        <button
                          className="btn is-small"
                          onClick={() => edit((p) => equipmentFromOffer(p, v.key), `matériel attendu de ${index.volunteerName(v.key)}`)}
                        >
                          Ajouter au magasin
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
