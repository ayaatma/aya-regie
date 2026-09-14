/**
 * Every orga as a person: their form answers, their poles, when they are on site, and their code.
 *
 * THE ORGAS, NOT THE RESPONSABLES. Being a responsable is holding a pole, which is what the card
 * inside each pole group is for ("qui tient le bar, et à quelle heure"). This is the other half,
 * which belongs to no pole: what somebody eats, how to reach them, when they arrive for the
 * montage, until when they stay for the démontage, and the credential that opens the planning.
 * Most people in this list run no pole at all, and that is the normal case since 2026-09-10.
 *
 * ISSUING A CODE IS THE ONLY PLACE IN THE TOOL THAT CREATES ONE. Not creating an orga, not
 * importing the form, not converting an old plan. It is a button, pressed per person, on purpose,
 * because an orga's code opens the whole planning including every volunteer's contact details.
 */

import { useState } from 'react';

import { ORGANISER_CODE_LENGTH } from '../engine.ts';
import { toLabel } from '../engine.ts';
import { OrganiserFiche } from '../components/OrganiserFiche.tsx';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from '../components/labels.ts';
import { clearOrganiserCode, deleteOrganiser, giveOrganiserCode, updateOrganiser } from '../store/setupEdits.ts';
import { SetupSection } from './SetupSection.tsx';

export function OrganisersCard() {
  const { plan, index, edit } = useLoadedPlan();
  /** Which person is being asked to confirm a destructive answer, and to which question. */
  const [confirming, setConfirming] = useState<{ key: string; what: 'code' | 'delete' } | null>(
    null,
  );
  /** Whose fiche is open. One at a time: the list is what this card is for. */
  const [open, setOpen] = useState<string | null>(null);

  const withCode = plan.organisers.filter((l) => l.accessCode !== '').length;

  return (
    <SetupSection
      className="setup-orgas"
      title="Orgas"
      meta={`${plan.organisers.length} personne(s) · ${withCode} avec un code d'accès`}
    >

      {plan.organisers.length === 0 ? (
        <p className="people-meta setup-orgas-note">
          Aucun orga enregistré. Ils arrivent par l'onglet Import, avec leur propre formulaire, ou
          se saisissent à la main sur chaque pôle ci-dessous. Un orga à qui on confie un pôle
          devient responsable de ce pôle, et se choisit dans cette liste.
        </p>
      ) : (
        <p className="people-meta setup-orgas-note">
          Le code d'accès ouvre <strong>tout le planning en lecture seule</strong>, coordonnées
          des bénévoles comprises. Il est personnel: en régénérer un annule immédiatement le
          précédent, ce qui est aussi la façon de rattraper un code transmis par erreur.
        </p>
      )}

      <div className="setup-orgas-list">
        {plan.organisers.map((person) => {
          const roles = index.polesLedBy(person.key);
          const poles = roles
            .map((r) => index.poleByKey.get(r.poleKey)?.path ?? r.poleKey)
            .join(', ');
          const asking = confirming?.key === person.key ? confirming.what : null;

          return (
            <div key={person.key} className="setup-organiser-row">
              <div className="setup-organiser-who">
                <strong>{organiserName(person) || 'Sans nom'}</strong>
                <span className="people-meta">
                  {poles === '' ? "aucun pôle attribué" : poles}
                </span>
                <span className="people-meta">
                  {person.email || 'sans adresse'}
                  {person.phone !== '' && ` · ${person.phone}`}
                </span>
                {/*
                  Shown for the same reason the volunteers' import keeps them: somebody has to
                  order the food, and these two are the only fields on the organisers' form that
                  nobody else in the tool would ever read.
                */}
                {(person.diet !== '' || person.allergies !== '') && (
                  <span className="people-meta">
                    {person.diet !== '' && person.diet}
                    {person.diet !== '' && person.allergies !== '' && ' · '}
                    {person.allergies !== '' && `allergies: ${person.allergies}`}
                  </span>
                )}

                {/*
                  When this person is on site, per phase. Nothing is assumed: an orga who has not
                  said when they arrive is on no grid at all, which is why the empty answer reads
                  "pas là" rather than "toute la durée".
                */}
                <span className="people-meta">
                  <PhaseSummary organiserKey={person.key} id="montage" />
                  <PhaseSummary organiserKey={person.key} id="demontage" />
                </span>
              </div>

              <div className="setup-organiser-code">
                {person.accessCode === '' ? (
                  <span className="people-meta">Pas de code</span>
                ) : (
                  <code className="organiser-code">{person.accessCode}</code>
                )}
              </div>

              <div className="setup-organiser-actions">
                <button
                  className="btn"
                  aria-expanded={open === person.key}
                  onClick={() => setOpen(open === person.key ? null : person.key)}
                  title="Corriger ses informations, son arrivée et son pôle"
                >
                  {open === person.key ? 'Fermer' : 'Modifier'}
                </button>
                {asking === 'code' ? (
                  <span className="setup-confirm">
                    <span className="people-meta">
                      Le code actuel cessera de fonctionner immédiatement.
                    </span>
                    <button
                      className="btn is-danger"
                      onClick={() => {
                        edit(
                          (p) => giveOrganiserCode(p, person.key),
                          `nouveau code pour ${organiserName(person)}`,
                        );
                        setConfirming(null);
                      }}
                    >
                      Régénérer
                    </button>
                    <button className="btn" onClick={() => setConfirming(null)}>
                      Annuler
                    </button>
                  </span>
                ) : asking === 'delete' ? (
                  <span className="setup-confirm">
                    <span className="people-meta">
                      {roles.length > 0
                        ? `Retire cette personne et ses ${roles.length} pôle(s).`
                        : 'Retire cette personne du planning.'}
                    </span>
                    <button
                      className="btn is-danger"
                      onClick={() => {
                        edit(
                          (p) => deleteOrganiser(p, person.key),
                          `retrait de ${organiserName(person)}`,
                        );
                        setConfirming(null);
                      }}
                    >
                      Retirer
                    </button>
                    <button className="btn" onClick={() => setConfirming(null)}>
                      Annuler
                    </button>
                  </span>
                ) : (
                  <>
                    {person.accessCode === '' ? (
                      <button
                        className="btn is-primary is-small"
                        title={`Tire un code de ${ORGANISER_CODE_LENGTH} caractères, à lui transmettre`}
                        onClick={() =>
                          edit(
                            (p) => giveOrganiserCode(p, person.key),
                            `code d'accès pour ${organiserName(person)}`,
                          )
                        }
                      >
                        Générer un code
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn is-small"
                          onClick={() => setConfirming({ key: person.key, what: 'code' })}
                        >
                          Régénérer
                        </button>
                        <button
                          className="btn is-small"
                          title="Retire son accès sans la retirer du planning"
                          onClick={() =>
                            edit(
                              (p) => clearOrganiserCode(p, person.key),
                              `accès retiré à ${organiserName(person)}`,
                            )
                          }
                        >
                          Révoquer
                        </button>
                      </>
                    )}
                    <button
                      className="btn is-icon is-danger"
                      title={`Retirer ${organiserName(person)}`}
                      onClick={() => setConfirming({ key: person.key, what: 'delete' })}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>

              <div className="setup-organiser-fields">
                <input
                  className="select"
                  type="email"
                  name={`resp-email-${person.key}`}
                  autoComplete="email"
                  placeholder="Adresse e-mail"
                  value={person.email}
                  onChange={(event) =>
                    edit(
                      (p) => updateOrganiser(p, person.key, { email: event.target.value }),
                      `e-mail de ${organiserName(person)}`,
                    )
                  }
                />
                <input
                  className="select"
                  name={`resp-diet-${person.key}`}
                  autoComplete="off"
                  placeholder="Régime alimentaire"
                  value={person.diet}
                  onChange={(event) =>
                    edit(
                      (p) => updateOrganiser(p, person.key, { diet: event.target.value }),
                      `régime de ${organiserName(person)}`,
                    )
                  }
                />
                <input
                  className="select"
                  name={`resp-allerg-${person.key}`}
                  autoComplete="off"
                  placeholder="Allergies"
                  value={person.allergies}
                  onChange={(event) =>
                    edit(
                      (p) => updateOrganiser(p, person.key, { allergies: event.target.value }),
                      `allergies de ${organiserName(person)}`,
                    )
                  }
                />
              </div>
              {open === person.key && (
                <div className="setup-organiser-fiche">
                  <OrganiserFiche organiserKey={person.key} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SetupSection>
  );
}

/** One line saying whether this orga is on a phase, without opening their fiche. */
function PhaseSummary({ organiserKey, id }: { organiserKey: string; id: 'montage' | 'demontage' }) {
  const { plan } = useLoadedPlan();
  const phase = id === 'montage' ? plan.montage : plan.demontage;
  const person = plan.organisers.find((o) => o.key === organiserKey);
  if (!person || !phase.enabled) return null;

  const at = id === 'montage' ? person.montageFrom : person.demontageUntil;
  const label = phase.label || (id === 'montage' ? 'Montage' : 'Démontage');
  if (at === null) return <>{`${label}: non · `}</>;

  const poleKey = (id === 'montage' ? person.montagePoleKeys : person.demontagePoleKeys)[0];
  const pole = phase.poles.find((p) => p.key === poleKey)?.name ?? 'Général';
  return <>{`${label}: ${toLabel(phase.startISO, at)}, ${pole} · `}</>;
}
