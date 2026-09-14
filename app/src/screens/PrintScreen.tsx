/**
 * The paper version: every schedule, printable.
 *
 * On the night the network is a marquee full of phones and one overloaded hotspot, so the plan
 * has to exist on paper. Three documents come out of the same plan, and the régisseur picks
 * which ones to print:
 *
 *   - one sheet per pole, which is what a pole organiser pins up and reads all evening,
 *   - one line per volunteer, which is what the welcome desk uses when somebody arrives,
 *   - the reserve, which is the list you call from when somebody does not.
 *
 * The layout is print-first: what you see on screen is the sheet, at the width it will be
 * printed, so nothing surprising happens between the button and the paper. Everything the
 * régisseur clicks carries `no-print` and disappears.
 *
 * Volunteer phone numbers are off by default and opt-in per print. They are personal data
 * collected to run one evening, and a pinned-up sheet is a broadcast. The organisers' own numbers
 * are always there: reaching the person in charge is the point of the sheet.
 */

import { useMemo, useState } from 'react';

import {
  brevoContactsCsv,
  eventFills,
  fmtHours,
  phaseDayParts,
  allPlacements,
  phasePeople,
  toClock,
  toLabel,
  type Phase,
  type PhaseId,
  type Plan,
  type Pole,
  type Volunteer,
} from '../engine.ts';
import { downloadText, fileSlug, today } from '../components/download.ts';
import { poleColours } from '../components/poleColours.ts';
import { organiserName, preferenceLabel, slotLabel } from '../components/labels.ts';
import { useLoadedPlan } from '../store/store.tsx';

interface PrintOptions {
  poles: boolean;
  volunteers: boolean;
  phases: boolean;
  reserve: boolean;
  phones: boolean;
}

const DEFAULTS: PrintOptions = {
  poles: true,
  volunteers: true,
  reserve: true,
  phones: false,
  // On by default only in the sense that the sheets exist: a phase that is off prints nothing.
  phases: true,
};

const byName = (a: Volunteer, b: Volunteer): number =>
  `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr');

/**
 * The file that carries the access codes out to the mailing tool.
 *
 * A volunteer's code is generated here and never typed into the form, so until it reaches them
 * the whole volunteer view is unreachable. This file is that bridge: one row per contact, with
 * their own code, ready to import into Brevo as a contact attribute and then merge into a mail.
 *
 * IT SITS ON THE PRINT SCREEN because this is the "get the planning out of the tool" moment: the
 * sheets go up on the wall and the codes go out by mail, and both happen once the planning is
 * settled.
 *
 * The two counts under the button are the point of it. A volunteer with no address is not in the
 * file, and a volunteer sharing an address with somebody else would have their code overwritten
 * by that person's, since a contact import keys on the address. Neither is rare enough to leave
 * to chance, and neither shows up anywhere else.
 */
function CodesExport({ plan }: { plan: Plan }) {
  const out = useMemo(() => brevoContactsCsv(plan), [plan]);
  const [done, setDone] = useState(false);

  return (
    <div className="toolbar no-print codes-export">
      <strong>Codes d'accès</strong>
      <span className="toolbar-note">
        Un fichier de contacts pour Brevo: adresse, prénom, nom, code, et le nombre de créneaux
        pour n'envoyer « voici ton planning » qu'aux personnes qui en ont un. À l'import, associez
        la colonne <code>CODE_ACCES</code> à l'attribut du même nom.
      </span>
      <button
        className="btn is-primary"
        disabled={out.sent === 0}
        onClick={() => {
          downloadText(`${fileSlug(plan.name)}-codes-${today()}.csv`, out.csv);
          setDone(true);
        }}
      >
        Exporter {out.sent} contact{out.sent > 1 ? 's' : ''}
      </button>

      {done && <span className="toolbar-note">Fichier téléchargé.</span>}

      {out.withoutEmail.length > 0 && (
        <span className="toolbar-note is-bad">
          {out.withoutEmail.length === 1
            ? "1 bénévole n'a pas d'adresse mail et n'est pas dans le fichier"
            : `${out.withoutEmail.length} bénévoles n'ont pas d'adresse mail et ne sont pas dans le fichier`}
          : {out.withoutEmail.join(', ')}. Leur code est sur les feuilles imprimées.
        </span>
      )}

      {out.sharedEmails.length > 0 && (
        <span className="toolbar-note is-bad">
          Adresse partagée par plusieurs personnes: {out.sharedEmails.join(', ')}. L'outil d'envoi
          ne garde qu'un contact par adresse, donc un seul des codes survivra. À traiter à la main.
        </span>
      )}
    </div>
  );
}

export function PrintScreen() {
  const { plan, index, report } = useLoadedPlan();
  const [options, setOptions] = useState<PrintOptions>(DEFAULTS);

  const colours = useMemo(() => poleColours(plan.poles), [plan.poles]);
  const roots = useMemo(() => plan.poles.filter((p) => p.parentKey === null), [plan.poles]);

  const placed = useMemo(
    () => [...plan.volunteers].filter((v) => index.shiftsOf(v.key).length > 0).sort(byName),
    [plan.volunteers, index],
  );
  const reserve = useMemo(
    () => [...plan.volunteers].filter((v) => index.shiftsOf(v.key).length === 0).sort(byName),
    [plan.volunteers, index],
  );

  const toggle = (key: keyof PrintOptions) =>
    setOptions((current) => ({ ...current, [key]: !current[key] }));

  const anyPhase = plan.montage.enabled || plan.demontage.enabled;
  const nothing =
    !options.poles && !options.volunteers && !options.reserve && !(options.phases && anyPhase);

  return (
    <div className="screen is-wide print-screen">
      <div className="screen-main">
        <CodesExport plan={plan} />
        <div className="toolbar no-print">
          <strong>Impression</strong>
          <label className="checkline">
            <input type="checkbox" checked={options.poles} onChange={() => toggle('poles')} />
            Une feuille par pôle
          </label>
          {anyPhase && (
            <label className="checkline">
              <input type="checkbox" checked={options.phases} onChange={() => toggle('phases')} />
              Montage et démontage
            </label>
          )}
          <label className="checkline">
            <input
              type="checkbox"
              checked={options.volunteers}
              onChange={() => toggle('volunteers')}
            />
            Planning de chaque bénévole
          </label>
          <label className="checkline">
            <input type="checkbox" checked={options.reserve} onChange={() => toggle('reserve')} />
            Liste de réserve
          </label>
          <label className="checkline" title="Données personnelles: à n'imprimer que si la feuille reste entre les mains des responsables.">
            <input type="checkbox" checked={options.phones} onChange={() => toggle('phones')} />
            Téléphones des bénévoles
          </label>
          <button className="btn is-primary" disabled={nothing} onClick={() => window.print()}>
            Imprimer
          </button>
          <span className="toolbar-note">
            Ce que vous voyez ici est la feuille. Les téléphones des bénévoles sont des données
            personnelles: ne cochez la case que si la feuille reste entre les mains des
            responsables.
          </span>
        </div>

        <div className="print-body">
          <div className="print-sheet">
            <header className="print-head">
              <h1>{plan.name}</h1>
              <p>
                {toLabel(plan.startISO, 0)} à {toLabel(plan.startISO, plan.lengthHours)} ·{' '}
                {roots.length} pôles · {plan.shifts.length} créneaux ·{' '}
                {fmtHours(report.summary.assignedHours)} couvertes sur{' '}
                {fmtHours(report.summary.demandHours)}
              </p>
              <p className="print-meta">
                Imprimé le {new Date().toLocaleDateString('fr-FR')} à{' '}
                {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.
                Un planning imprimé est une photo: il ne se met pas à jour.
              </p>
            </header>

            {nothing && (
              <p className="panel-sub no-print">Rien à imprimer: cochez au moins une section.</p>
            )}

            {options.poles &&
              roots.map((root) => (
                <PoleSheet
                  key={root.key}
                  root={root}
                  colour={colours.get(root.key) ?? '#333333'}
                  phones={options.phones}
                />
              ))}

            {options.volunteers && (
              <VolunteerSheet people={placed} phones={options.phones} plan={plan} />
            )}

            {options.reserve && <ReserveSheet people={reserve} phones={options.phones} plan={plan} />}

            {options.phases && <PhaseSheet id="montage" />}
            {options.phases && <PhaseSheet id="demontage" />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One pole, one sheet: its organisers, then every shift of every sub-pole in order. */
function PoleSheet({ root, colour, phones }: { root: Pole; colour: string; phones: boolean }) {
  const { plan, index } = useLoadedPlan();

  const leaves = plan.poles.filter((p) => index.isLeaf(p.key) && index.isUnder(p.key, root.key));
  const organisers = index.leadersOn(root.key);

  return (
    <section className="print-page">
      <h2 className="print-pole" style={{ color: colour }}>
        {root.name}
      </h2>

      <p className="print-organisers">
        {organisers.length === 0
          ? 'Aucun responsable de pôle enregistré.'
          : organisers
              .map(({ organiser, role }) => {
                const hours =
                  role.start !== null && role.end !== null && role.end > role.start
                    ? ` (${toClock(plan.startISO, role.start)} à ${toClock(plan.startISO, role.end)})`
                    : '';
                const tel = organiser.phone.trim() === '' ? '' : ` ${organiser.phone}`;
                return `${organiserName(organiser)}${tel}${hours}`;
              })
              .join(' · ')}
      </p>

      {leaves.map((pole) => {
        const shifts = plan.shifts
          .filter((s) => s.poleKey === pole.key)
          .sort((a, b) => a.start - b.start);

        return (
          <div key={pole.key} className="print-block">
            <h3>{leaves.length > 1 || pole.key !== root.key ? index.polePath(pole.key) : 'Créneaux'}</h3>

            {shifts.length === 0 ? (
              <p className="print-empty">Aucun créneau.</p>
            ) : (
              <table className="print-table">
                <thead>
                  <tr>
                    <th className="print-col-when">Créneau</th>
                    <th className="print-col-count">Effectif</th>
                    <th>Bénévoles</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => {
                    const people = [...index.assigneesOf(shift.key)].sort(byName);
                    const missing = shift.headcount - people.length;
                    return (
                      <tr key={shift.key}>
                        <td className="print-col-when">
                          {toClock(plan.startISO, shift.start)} à {toClock(plan.startISO, shift.end)}
                        </td>
                        <td className="print-col-count">
                          {people.length}/{shift.headcount}
                          {missing > 0 && <strong className="print-missing"> manque {missing}</strong>}
                        </td>
                        <td>
                          {people.length === 0 ? (
                            <span className="print-empty">personne</span>
                          ) : (
                            people
                              .map(
                                (v) =>
                                  `${v.firstName} ${v.lastName}${phones && v.phone.trim() !== '' ? ` ${v.phone}` : ''}`,
                              )
                              .join(', ')
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Everyone who works, one line each, in the order the welcome desk reads a name. */
function VolunteerSheet({
  people,
  phones,
  plan,
}: {
  people: Volunteer[];
  phones: boolean;
  plan: Plan;
}) {
  const { index } = useLoadedPlan();

  return (
    <section className="print-page">
      <h2>Planning de chaque bénévole</h2>
      <p className="print-meta">{people.length} bénévoles placés.</p>

      <table className="print-table">
        <thead>
          <tr>
            <th>Nom</th>
            {phones && <th className="print-col-tel">Téléphone</th>}
            <th className="print-col-count">Total</th>
            <th>Créneaux</th>
          </tr>
        </thead>
        <tbody>
          {people.map((volunteer) => {
            const shifts = [...index.shiftsOf(volunteer.key)].sort((a, b) => a.start - b.start);
            return (
              <tr key={volunteer.key}>
                <td>
                  {volunteer.lastName.toUpperCase()} {volunteer.firstName}
                  {/*
                    The registered name first, because this sheet is read against an identity,
                    and the surname after it, because somebody at the desk says "Titi" and
                    whoever is holding the sheet has to find them.
                  */}
                  {volunteer.nickname.trim() !== '' && ` (${volunteer.nickname})`}
                </td>
                {phones && <td className="print-col-tel">{volunteer.phone}</td>}
                <td className="print-col-count">{fmtHours(index.hoursOf(volunteer.key))}</td>
                <td>
                  {shifts
                    .map(
                      (shift) =>
                        `${toClock(plan.startISO, shift.start)} à ${toClock(plan.startISO, shift.end)} ${index.polePath(shift.poleKey)}`,
                    )
                    .join(' · ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The reserve, which is a list you call, so it carries what you need to call from it.
 *
 * Their answers are on it too. Somebody who said "soirée, pas la nuit, 6 h" is worth calling at
 * 21h and not at 03h, and that is exactly the judgement being made when this sheet is used.
 */
function ReserveSheet({
  people,
  phones,
  plan,
}: {
  people: Volunteer[];
  phones: boolean;
  plan: Plan;
}) {
  return (
    <section className="print-page">
      <h2>Réserve</h2>
      <p className="print-meta">
        {people.length} bénévoles sans créneau. Ce sont les gens à appeler quand il manque
        quelqu'un.
      </p>

      {people.length === 0 ? (
        <p className="print-empty">Personne: tout le monde est placé.</p>
      ) : (
        <table className="print-table">
          <thead>
            <tr>
              <th>Nom</th>
              {phones && <th className="print-col-tel">Téléphone</th>}
              <th className="print-col-count">Demandé</th>
              <th>Disponibilité</th>
            </tr>
          </thead>
          <tbody>
            {people.map((volunteer) => (
              <tr key={volunteer.key}>
                <td>
                  {volunteer.lastName.toUpperCase()} {volunteer.firstName}
                  {/*
                    The registered name first, because this sheet is read against an identity,
                    and the surname after it, because somebody at the desk says "Titi" and
                    whoever is holding the sheet has to find them.
                  */}
                  {volunteer.nickname.trim() !== '' && ` (${volunteer.nickname})`}
                </td>
                {phones && <td className="print-col-tel">{volunteer.phone}</td>}
                <td className="print-col-count">
                  {fmtHours(volunteer.requestedHours)}
                  {plan.volume.scope === 'day' ? ' / jour' : ''}
                </td>
                <td>
                  {preferenceLabel(plan.preferenceSlots, volunteer.preferredSlotId)}
                  {volunteer.refusedSlotIds.length > 0 &&
                    `, pas ${volunteer.refusedSlotIds
                      .map((id) => slotLabel(plan.slots, id))
                      .join(', ')}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * One sheet per phase: who is where, half-day by half-day, and what each événement needs.
 *
 * WHAT IT PRINTS IS WHAT THE GRID DRAWS, derived boxes included. Somebody who said they are on
 * site from Thursday and was never placed anywhere in particular appears under Général on every
 * half-day they are there, exactly as on screen: on paper as on the grid, the answer to "who is
 * here on Friday morning" has to be everybody, not only the people somebody thought to place.
 *
 * A phase that is off prints nothing at all, not an empty page.
 */
function PhaseSheet({ id }: { id: PhaseId }) {
  const { plan, index } = useLoadedPlan();
  const phase: Phase = id === 'montage' ? plan.montage : plan.demontage;
  if (!phase.enabled) return null;

  const parts = phaseDayParts(phase);
  const people = phasePeople(phase, plan.organisers, plan.volunteers);
  const boxes = allPlacements(phase);
  const fills = eventFills(phase);

  const nameOf = (kind: string, key: string): string => {
    if (kind === 'orga') {
      const found = plan.organisers.find((o) => o.key === key);
      return found ? `${found.firstName} ${found.lastName}`.trim() : key;
    }
    return index.volunteerShortName(key);
  };

  return (
    <section className="print-page">
      <h2 className="print-pole">{phase.label || (id === 'montage' ? 'Montage' : 'Démontage')}</h2>
      <p className="print-organisers">
        {people.length} personne(s) sur place. Ce qui est écrit ici est ce que porte la grille,
        cases venues du formulaire comprises.
      </p>

      {fills.length > 0 && (
        <table className="print-table">
          <thead>
            <tr>
              <th>Événement</th>
              <th className="print-col-count">Horaire</th>
              <th className="print-col-count">Monde</th>
              <th>Qui</th>
            </tr>
          </thead>
          <tbody>
            {fills.map(({ event, taken, missing }) => (
              <tr key={event.key}>
                <td>{event.label}</td>
                <td className="print-col-count">
                  {toClock(phase.startISO, event.start)} à {toClock(phase.startISO, event.end)}
                </td>
                <td className="print-col-count">
                  {event.headcount === 0 ? taken : `${taken} / ${event.headcount}`}
                  {missing > 0 ? ` (-${missing})` : ''}
                </td>
                <td>
                  {boxes
                    .filter((b) => b.eventKey === event.key)
                    .map((b) => nameOf(b.personKind, b.personKey))
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {parts.map((part) => (
        <div key={part.key} className="print-phase-part">
          <h3 className="print-phase-when">
            {part.label} · {toClock(phase.startISO, part.start)} à{' '}
            {toClock(phase.startISO, part.end)}
          </h3>
          <table className="print-table">
            <tbody>
              {phase.poles.map((pole) => {
                const here = boxes.filter(
                  (b) => b.poleKey === pole.key && b.start < part.end && part.start < b.end,
                );
                if (here.length === 0) return null;
                return (
                  <tr key={pole.key}>
                    <td className="print-col-tel">{pole.name}</td>
                    <td>{here.map((b) => nameOf(b.personKind, b.personKey)).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
