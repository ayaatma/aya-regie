/**
 * Réglages: the shape of the event, as opposed to who works when.
 *
 * The scheduling rules, the poles and their sub-poles, the shifts of each pole, the colour a
 * pole is drawn in, and the people who run it. Everything the grid then takes as given.
 *
 * Grouped by root pole, because that is the unit two of these belong to. The colour is one: Bar,
 * Bar / Service and Bar / Plonge are one place with three stations, so the picker sits on the
 * root and the whole subtree follows. Pole organisers are the other: you call the head of the bar,
 * not the head of the plonge.
 *
 * SEVERAL EDITS HERE DESTROY ASSIGNMENTS. Deleting a pole deletes its shifts, deleting a shift
 * removes the people standing in it, and regenerating a pole's shifts does both. None of it is
 * quiet: every one of those buttons says how many shifts and how many placements would go before
 * it does anything, and nobody is ever moved somewhere else to tidy up.
 */

import { useMemo, useState } from 'react';

import {
  fmtHours,
  type Pole,
  type LeaderRole,
  type Shift,
} from '../engine.ts';
import { setHeadcount, setPoleColour } from '../store/edits.ts';
import {
  addLeaderOnPole,
  assignOrganiserToPole,
  addPole,
  addShift,
  canMovePole,
  removeLeaderRole,
  deletePole,
  deleteShift,
  duplicatePole,
  movePole,
  poleCopyPreview,
  poleRemovalCost,
  regenerateCost,
  regenerateShifts,
  renamePole,
  defaultShiftHours,
  setPoleDefaults,
  setOrganiserWindow,
  setShiftWindow,
  updateOrganiser,
} from '../store/setupEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { isColour, poleColours } from '../components/poleColours.ts';
import { ClockField } from '../components/ClockField.tsx';
import { organiserName } from '../components/labels.ts';
import { slideEnd } from '../components/clock.ts';
import { EventCard } from './EventCard.tsx';
import { SlotsCard } from './SlotsCard.tsx';
import { PhaseCard } from './PhaseCard.tsx';
import { CateringCard } from './CateringCard.tsx';
import { TicketingCard, TravelCard } from './TicketingCard.tsx';
import { ApplicationStepsCard } from './ApplicationStepsCard.tsx';
import { SkillsCard } from './SkillsCard.tsx';
import { SkillPicker } from '../components/SkillPicker.tsx';
import { setPoleSkills } from '../store/skillEdits.ts';
import { AdvancedSettingsCard } from './AdvancedSettingsCard.tsx';

/** What to say under a organiser's two hour fields, including while only one is filled. */
function organiserWindowState(role: LeaderRole): 'unset' | 'partial' | 'incoherent' | 'ok' {
  if (role.start === null && role.end === null) return 'unset';
  if (role.start === null || role.end === null) return 'partial';
  return role.end > role.start ? 'ok' : 'incoherent';
}

/**
 * What sits after the two fields. The fields say the hours themselves now, so this says the one
 * thing they cannot: how long that is, or what is missing.
 */
function organiserWindowLabel(role: LeaderRole): string {
  switch (organiserWindowState(role)) {
    case 'ok':
      return `sur place ${fmtHours(role.end! - role.start!)}`;
    case 'partial':
      return 'horaires incomplets';
    case 'incoherent':
      return 'la fin doit être après le début';
    default:
      return 'horaires non fixés';
  }
}

interface PoleGroup {
  root: Pole;
  colour: string;
  leaves: Pole[];
}

export function SetupScreen() {
  const { plan, index, report, edit } = useLoadedPlan();
  const [openPole, setOpenPole] = useState<string | null>(null);
  /**
   * Which pole groups are unfolded. Empty on arrival, like every other section of this screen.
   *
   * A SET OF WHAT IS OPEN, not one key like `openPole` above. Two different questions: `openPole`
   * is which sub-pole's shifts are being edited, and only one of those is useful at a time;
   * comparing two poles' contents side by side is exactly what somebody does here.
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setOpenGroups((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [newRoot, setNewRoot] = useState('');

  const colours = useMemo(() => poleColours(plan.poles), [plan.poles]);

  const groups = useMemo<PoleGroup[]>(
    () =>
      plan.poles
        .filter((p) => p.parentKey === null)
        .map((root) => ({
          root,
          colour: colours.get(root.key) ?? '#888888',
          leaves: plan.poles.filter((p) => index.isLeaf(p.key) && index.isUnder(p.key, root.key)),
        })),
    [plan.poles, index, colours],
  );

  const shiftsByPole = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of plan.shifts) {
      const list = map.get(shift.poleKey);
      if (list) list.push(shift);
      else map.set(shift.poleKey, [shift]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [plan.shifts]);

  const shiftReports = useMemo(
    () => new Map(report.shifts.map((s) => [s.key, s])),
    [report.shifts],
  );

  // The event says how long it runs, but the grid never hides work: a shift or a set left past
  // the end after the event was shortened still has to be reachable.
  const eventHours = useMemo(
    () =>
      Math.max(
        plan.lengthHours,
        plan.shifts.reduce((max, s) => Math.max(max, s.end), 0),
        plan.artists.reduce((max, a) => Math.max(max, a.end), 0),
      ),
    [plan.lengthHours, plan.shifts, plan.artists],
  );

  return (
    <div className="screen is-wide">
      <div className="screen-main">
        <div className="toolbar">
          <strong>
            {groups.length} pôles, {plan.shifts.length} créneaux, {plan.organisers.length} responsables de pôle
          </strong>
          <span className="toolbar-note">
            Rien n'est recalculé après une modification ici. Un créneau raccourci ou une règle
            durcie fait passer en rouge ce qui ne va plus, plutôt que de déplacer quelqu'un.
          </span>
        </div>

        <div className="setup-list">
          <EventCard />

          <SlotsCard />

          {/*
            No Orgas, Équipes or Activités annexes card since 2026-09-16: an orga's code is on their
            fiche in Personnes, and the two others are tabs of Logistique.
          */}
          <ApplicationStepsCard />

          <SkillsCard />

          {/*
            The two phases, between the people and the poles of the exploit. They are settings of
            the same kind as the event's own dates, and they are read far less often than the
            poles below, which is why they sit above them rather than at the top.
          */}
          <PhaseCard id="montage" />
          <PhaseCard id="demontage" />

          {/*
            The catering, after the three moments it feeds: its services are hours of the clock
            that fall across all of them, so the phases have to be configured before these figures
            mean anything on screen.
          */}
          <CateringCard />
          <TicketingCard />
          <TravelCard />

          {groups.map((group) => (
            <section
              key={group.root.key}
              className="setup-group"
              style={{ '--pole': group.colour } as React.CSSProperties}
            >
              <div className="setup-group-head">
                {/*
                  The caret is a control of its own here rather than the whole head, because this
                  head is not a label: it holds a colour picker, the pole's name as an editable
                  field, and three buttons. A `<button>` wrapped around a `<input type="color">`
                  is invalid markup and behaves differently in every browser.
                */}
                <button
                  type="button"
                  className="setup-group-toggle is-caret"
                  aria-expanded={openGroups.has(group.root.key)}
                  aria-label={`${openGroups.has(group.root.key) ? 'Replier' : 'Déplier'} le pôle ${group.root.name}`}
                  onClick={() => toggleGroup(group.root.key)}
                >
                  <span className="setup-caret" aria-hidden="true">
                    {openGroups.has(group.root.key) ? '▾' : '▸'}
                  </span>
                </button>

                <label className="setup-colour" title={`Couleur du pôle ${group.root.name}`}>
                  <input
                    type="color"
                    value={group.colour}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!isColour(value)) return;
                      edit(
                        (p) => setPoleColour(p, group.root.key, value),
                        `couleur du pôle ${group.root.name}`,
                      );
                    }}
                  />
                </label>

                {/*
                  autoComplete off, and a name Chrome cannot read as a person's.

                  Picking a Google-suggested address for a pole organiser was filling THIS field
                  with the name attached to that address, silently renaming the pole. Chrome
                  autofills a whole contact section by guessing at fields, and an unnamed text
                  input next to an email input is a name field as far as it is concerned. The
                  organiser inputs below now declare what they are, so the guessing stops.
                */}
                <input
                  className="setup-name"
                  name={`pole-title-${group.root.key}`}
                  autoComplete="off"
                  value={group.root.name}
                  aria-label={`Nom du pôle ${group.root.name}`}
                  onChange={(event) =>
                    edit(
                      (p) => renamePole(p, group.root.key, event.target.value),
                      `renommage du pôle ${group.root.name}`,
                    )
                  }
                />

                <span className="people-meta">
                  {group.leaves.length > 1 ? `${group.leaves.length} sous-pôles` : 'sans sous-pôle'}
                </span>

                <div className="setup-group-actions">
                  {group.root.colour && (
                    <button
                      className="btn is-icon"
                      title="Revenir à la couleur par défaut"
                      onClick={() =>
                        edit(
                          (p) => setPoleColour(p, group.root.key, null),
                          `couleur par défaut du pôle ${group.root.name}`,
                        )
                      }
                    >
                      ↺
                    </button>
                  )}
                  <AddChild
                    label="Sous-pôle"
                    onAdd={(name) =>
                      edit((p) => addPole(p, name, group.root.key), `sous-pôle ${name}`)
                    }
                  />
                  <DeletePole poleKey={group.root.key} name={group.root.name} />
                </div>
              </div>

              <div className="setup-group-body" hidden={!openGroups.has(group.root.key)}>
                <Organisers
                  poleKey={group.root.key}
                  poleName={group.root.name}
                  eventHours={eventHours}
                />

                {group.leaves.map((pole) => (
                  <PoleRow
                    key={pole.key}
                    pole={pole}
                    isRoot={pole.key === group.root.key}
                    shifts={shiftsByPole.get(pole.key) ?? []}
                    eventHours={eventHours}
                    open={openPole === pole.key}
                    onToggle={() => setOpenPole(openPole === pole.key ? null : pole.key)}
                    assignedOf={(key) => shiftReports.get(key)?.assigned ?? 0}
                  />
                ))}
              </div>
            </section>
          ))}

          <div className="setup-add-root">
            <input
              className="select"
              placeholder="Nom d'un nouveau pôle"
              value={newRoot}
              onChange={(event) => setNewRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || newRoot.trim() === '') return;
                edit((p) => addPole(p, newRoot, null), `pôle ${newRoot.trim()}`);
                setNewRoot('');
              }}
            />
            <button
              className="btn"
              disabled={newRoot.trim() === ''}
              onClick={() => {
                edit((p) => addPole(p, newRoot, null), `pôle ${newRoot.trim()}`);
                setNewRoot('');
              }}
            >
              Ajouter un pôle
            </button>
          </div>

          {/*
            Last, as the régisseur asked: the rules and weights every other screen is judged by,
            read rarely and changed more rarely still. The four thresholds of the former « Règles
            de planning » card live on their criterion's row here.
          */}
          <AdvancedSettingsCard />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One pole row: its defaults, its shifts
// ---------------------------------------------------------------------------

/** Exported so a test can render one pole open: the screen keeps them collapsed by default. */
export function PoleRow({
  pole,
  isRoot,
  shifts,
  eventHours,
  open,
  onToggle,
  assignedOf,
}: {
  pole: Pole;
  isRoot: boolean;
  shifts: Shift[];
  eventHours: number;
  open: boolean;
  onToggle(): void;
  assignedOf(shiftKey: string): number;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const need = shifts.reduce((total, s) => total + s.headcount * (s.end - s.start), 0);

  return (
    <div className="setup-pole">
      <div className="setup-pole-line">
        <button className="setup-pole-head" aria-expanded={open} onClick={onToggle}>
          <span className="setup-caret">{open ? '▾' : '▸'}</span>
          <span className="setup-pole-name">{isRoot ? 'Créneaux du pôle' : pole.name}</span>
          <span className="people-meta">
            {shifts.length} créneaux · {fmtHours(need)} nécessaires
          </span>
        </button>
        {!isRoot && (
          <>
            <MovePole poleKey={pole.key} name={pole.name} />
            <DuplicatePole poleKey={pole.key} name={pole.name} />
            <DeletePole poleKey={pole.key} name={pole.name} />
          </>
        )}
      </div>

      {open && (
        <div className="setup-detail">
          <div className="setup-defaults">
            {!isRoot && (
              <label className="rule is-inline">
                <span className="rule-label">Nom</span>
                <input
                  className="setup-name"
                  name={`pole-title-${pole.key}`}
                  autoComplete="off"
                  value={pole.name}
                  onChange={(event) =>
                    edit((p) => renamePole(p, pole.key, event.target.value), `renommage de ${pole.name}`)
                  }
                />
              </label>
            )}

            <label className="rule is-inline">
              <span className="rule-label">Effectif par défaut</span>
              <input
                type="number"
                min={0}
                max={40}
                value={pole.defaultHeadcount}
                onChange={(event) =>
                  edit(
                    (p) => setPoleDefaults(p, pole.key, { defaultHeadcount: Number(event.target.value) }),
                    `effectif par défaut de ${pole.name}`,
                  )
                }
              />
              <span className="rule-hint">
                Copié dans un créneau à sa création, et plus jamais relu: changer ce chiffre ne
                réécrit pas les créneaux déjà réglés à la main.
              </span>
            </label>

            <label className="rule is-inline">
              <span className="rule-label">Durée par défaut d'un créneau</span>
              <span className="rule-input">
                <input
                  type="number"
                  min={0.5}
                  max={12}
                  step={0.5}
                  value={defaultShiftHours(pole)}
                  onChange={(event) =>
                    edit(
                      (p) =>
                        setPoleDefaults(p, pole.key, {
                          defaultShiftHours: Number(event.target.value),
                        }),
                      `durée par défaut de ${pole.name}`,
                    )
                  }
                />
                <span className="rule-suffix">h</span>
              </span>
              <span className="rule-hint">
                Appliquée au prochain créneau ajouté à ce pôle. Elle ne touche aucun créneau
                existant: c'est le levier principal pour que les bénévoles fassent 4 h d'affilée
                plutôt que deux fois 2 h.
              </span>
            </label>

            <label className="rule is-inline">
              <span className="rule-label">Expérimentés minimum</span>
              <input
                type="number"
                min={0}
                max={10}
                value={pole.minExperienced}
                onChange={(event) =>
                  edit(
                    (p) => setPoleDefaults(p, pole.key, { minExperienced: Number(event.target.value) }),
                    `expérimentés minimum de ${pole.name}`,
                  )
                }
              />
            </label>

            <label className="checkline">
              <input
                type="checkbox"
                checked={pole.allowAllDebutants}
                onChange={(event) =>
                  edit(
                    (p) => setPoleDefaults(p, pole.key, { allowAllDebutants: event.target.checked }),
                    `débutants sur ${pole.name}`,
                  )
                }
              />
              Un créneau entier de débutants est acceptable
            </label>

            {/*
              Whether the two jobs fit into one pair of hands, which is a fact about THIS pole.
              The régisseur put it in those terms on 2026-09-12: on some poles the responsable has
              to stay free, on others they can run the pole and hold a créneau of it at once.
              Signalled when contradicted, never refused: see `PlanIndex.supportOnlyBreaches`.
            */}
            <label className="checkline">
              <input
                type="checkbox"
                checked={pole.leaderSupportOnly === true}
                onChange={(event) =>
                  edit(
                    (p) => setPoleDefaults(p, pole.key, { leaderSupportOnly: event.target.checked }),
                    `responsable de ${pole.name} en support`,
                  )
                }
              />
              Le responsable reste en support, sans créneau sur ce pôle
            </label>

            {plan.skills.length > 0 && (
              <div className="rule">
                <span className="rule-label">Compétences demandées</span>
                <SkillPicker
                  skills={plan.skills}
                  value={pole.requiredSkills ?? []}
                  name={`pole-skill-${pole.key}`}
                  onChange={(skills) => edit((p) => setPoleSkills(p, pole.key, skills), `compétences demandées sur ${pole.name}`)}
                />
                <span className="rule-hint">Valent aussi pour ses sous-pôles.</span>
              </div>
            )}
          </div>

          <Regenerate pole={pole} shifts={shifts} eventHours={eventHours} />

          <table className="setup-table">
            <thead>
              <tr>
                <th>Début</th>
                <th>Fin</th>
                <th>Durée</th>
                <th>Placés</th>
                <th>Nécessaire</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const assigned = assignedOf(shift.key);
                return (
                  <tr key={shift.key}>
                    <td>
                      <HourInput
                        value={shift.start}
                        max={eventHours}
                        startISO={plan.startISO}
                        label={`Début du créneau ${index.shiftLabel(shift)}`}
                        hint="Déplacer le début déplace le créneau entier: la fin suit, la durée ne change pas."
                        onChange={(value) =>
                          edit(
                            // The créneau moves, it does not stretch. Nobody is moved with it:
                            // whoever no longer fits turns red, as after any edit here.
                            (p) =>
                              setShiftWindow(
                                p,
                                shift.key,
                                value,
                                slideEnd(shift.start, shift.end, value),
                              ),
                            `horaire du créneau ${index.shiftLabel(shift)}`,
                          )
                        }
                      />
                    </td>
                    <td>
                      <HourInput
                        value={shift.end}
                        max={eventHours}
                        startISO={plan.startISO}
                        label={`Fin du créneau ${index.shiftLabel(shift)}`}
                        hint="Déplacer la fin change la durée du créneau. Le début ne bouge pas."
                        onChange={(value) =>
                          edit(
                            (p) => setShiftWindow(p, shift.key, shift.start, value),
                            `horaire du créneau ${index.shiftLabel(shift)}`,
                          )
                        }
                      />
                    </td>
                    <td>{fmtHours(shift.end - shift.start)}</td>
                    <td className={assigned === shift.headcount ? '' : 'is-bad'}>{assigned}</td>
                    <td>
                      <input
                        className="setup-number"
                        type="number"
                        min={0}
                        max={40}
                        value={shift.headcount}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          edit(
                            (p) => setHeadcount(p, shift.key, value),
                            `effectif du créneau ${index.shiftLabel(shift)}`,
                          );
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn is-icon is-danger"
                        title={
                          assigned > 0
                            ? `Supprimer ce créneau et retirer les ${assigned} personnes qui y sont`
                            : 'Supprimer ce créneau'
                        }
                        onClick={() =>
                          edit(
                            (p) => deleteShift(p, shift.key),
                            `suppression du créneau ${index.shiftLabel(shift)}`,
                          )
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button
            className="btn"
            onClick={() => {
              const last = shifts[shifts.length - 1];
              const start = last ? Math.min(last.end, eventHours - 0.5) : 0;
              edit((p) => addShift(p, pole.key, start), `créneau ajouté sur ${pole.name}`);
            }}
          >
            Ajouter un créneau
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * An hour of the event, typed as the clock the régisseur reads.
 *
 * A thin wrapper over `ClockField`: the plan stores hours from the start, and nothing above this
 * line needs to know that the field speaks 24 h wall clock. See `ClockField.tsx`.
 */
function HourInput({
  value,
  max,
  startISO,
  label,
  hint,
  onChange,
}: {
  value: number;
  max: number;
  startISO: string;
  label: string;
  hint?: string;
  onChange(value: number): void;
}) {
  return (
    <ClockField
      value={value}
      maxHours={max}
      startISO={startISO}
      ariaLabel={label}
      hint={hint}
      narrow
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
    />
  );
}

/**
 * Rebuilding a pole's shifts as a regular series.
 *
 * The lever the solver cannot pull. Its weights can keep somebody in one place for four hours,
 * but they cannot make four hours contiguous when the pole is cut into two-hour pieces and the
 * neighbouring piece is full. Shift length decides that, and it is a property of the pole.
 *
 * Destructive, so it says the price first and asks twice.
 */
function Regenerate({
  pole,
  shifts,
  eventHours,
}: {
  pole: Pole;
  shifts: Shift[];
  eventHours: number;
}) {
  const { plan, edit } = useLoadedPlan();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(shifts[0]?.start ?? 0);
  const [to, setTo] = useState(shifts[shifts.length - 1]?.end ?? eventHours);
  // Seeded from the pole's own default, which is the setting this tool is really about.
  const [block, setBlock] = useState(
    shifts[0] ? shifts[0].end - shifts[0].start : defaultShiftHours(pole),
  );

  const cost = regenerateCost(plan, pole.key);
  const count = block > 0 && to > from ? Math.ceil((to - from) / block) : 0;

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Régénérer les créneaux de ce pôle
      </button>
    );
  }

  return (
    <div className="setup-regen">
      <p className="panel-sub">
        Remplace les {cost.shifts} créneaux de ce pôle par une série régulière. C'est le réglage
        qui décide si les bénévoles font 4 h d'affilée ou deux fois 2 h.
      </p>

      {/*
        These two do NOT slide each other, unlike every other pair of hours in Réglages. They are
        not a window with a length to preserve, they are the two ends of the span to fill: typing
        "de 14h" on a pole that runs until 06h means starting later, not finishing at 08h.
      */}
      <div className="setup-regen-row">
        <label className="rule is-inline">
          <span className="rule-label">De</span>
          <HourInput
            value={from}
            max={eventHours}
            startISO={plan.startISO}
            label="Début de la série"
            onChange={setFrom}
          />
        </label>
        <label className="rule is-inline">
          <span className="rule-label">À</span>
          <HourInput
            value={to}
            max={eventHours}
            startISO={plan.startISO}
            label="Fin de la série"
            onChange={setTo}
          />
        </label>
        <label className="rule is-inline">
          <span className="rule-label">Durée d'un créneau</span>
          <input
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={block}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) setBlock(value);
            }}
          />
          <span className="rule-suffix">h</span>
        </label>
      </div>

      <p className={cost.assignments > 0 ? 'alert is-bad' : 'panel-sub'}>
        {count} créneaux de {fmtHours(block)} seraient créés.
        {cost.assignments > 0
          ? ` ${cost.assignments} affectation(s) seraient perdues: personne n'est déplacé ailleurs, elles disparaissent.`
          : ' Aucune affectation ne serait perdue.'}
      </p>

      <div className="setup-regen-row">
        <button
          className={`btn ${cost.assignments > 0 ? 'is-danger' : 'is-primary'}`}
          disabled={count === 0}
          onClick={() => {
            edit(
              (p) => regenerateShifts(p, pole.key, { from, to, block }),
              `créneaux régénérés sur ${pole.name}`,
            );
            setOpen(false);
          }}
        >
          Régénérer
        </button>
        <button className="btn" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/**
 * Up and down among the siblings, because the order of the poles is the order every screen draws.
 *
 * The lanes of the grid, the printed schedules and this list all read `plan.poles` in order, and
 * that order survives the round trip through the database. So this is the one control on this
 * screen that changes nothing at all: no key, no créneau, no affectation, personne.
 */
function MovePole({ poleKey, name }: { poleKey: string; name: string }) {
  const { plan, edit } = useLoadedPlan();

  return (
    <>
      <button
        className="btn is-icon"
        disabled={!canMovePole(plan, poleKey, -1)}
        title={`Monter ${name}`}
        aria-label={`Monter ${name}`}
        onClick={() => edit((p) => movePole(p, poleKey, -1), `${name} remonté dans la liste`)}
      >
        ▲
      </button>
      <button
        className="btn is-icon"
        disabled={!canMovePole(plan, poleKey, 1)}
        title={`Descendre ${name}`}
        aria-label={`Descendre ${name}`}
        onClick={() => edit((p) => movePole(p, poleKey, 1), `${name} descendu dans la liste`)}
      >
        ▼
      </button>
    </>
  );
}

/**
 * Duplicating a pole: additive, so it says what it will make and then makes it.
 *
 * No second click, unlike everything destructive on this screen, because there is nothing to
 * lose and the undo of the toolbar takes it straight back. The tooltip carries the two things
 * worth knowing beforehand: the name the copy gets, and that it comes with the créneaux and
 * without the bénévoles.
 */
function DuplicatePole({ poleKey, name }: { poleKey: string; name: string }) {
  const { plan, edit } = useLoadedPlan();
  const copy = poleCopyPreview(plan, poleKey);
  if (!copy) return null;

  return (
    <button
      className="btn is-icon"
      title={`Dupliquer en "${copy.name}": ${copy.shifts} créneaux aux mêmes horaires, et personne dedans`}
      aria-label={`Dupliquer ${name}`}
      onClick={() => edit((p) => duplicatePole(p, poleKey), `duplication de ${name}`)}
    >
      ⧉
    </button>
  );
}

/** Deleting a pole, with the cost stated before the second click. */
function DeletePole({ poleKey, name }: { poleKey: string; name: string }) {
  const { plan, edit } = useLoadedPlan();
  const [armed, setArmed] = useState(false);
  const cost = poleRemovalCost(plan, poleKey);

  if (!armed) {
    return (
      <button className="btn is-icon is-danger" title={`Supprimer ${name}`} onClick={() => setArmed(true)}>
        ✕
      </button>
    );
  }

  return (
    <span className="setup-confirm">
      <span className="setup-confirm-text">
        Supprime {cost.poles > 1 ? `${cost.poles} pôles` : 'ce pôle'}, {cost.shifts} créneaux et{' '}
        {cost.assignments} affectation(s).
        {cost.choices > 0 &&
          ` ${cost.choices} bénévole(s) l'avaient choisi ou refusé: leur réponse est conservée telle quelle.`}
      </span>
      <button
        className="btn is-danger"
        onClick={() => edit((p) => deletePole(p, poleKey), `suppression du pôle ${name}`)}
      >
        Supprimer
      </button>
      <button className="btn" onClick={() => setArmed(false)}>
        Annuler
      </button>
    </span>
  );
}

/** A small "add a named thing" control, used for sub-poles. */
function AddChild({ label, onAdd }: { label: string; onAdd(name: string): void }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }

  const commit = () => {
    if (name.trim() === '') return;
    onAdd(name);
    setName('');
    setOpen(false);
  };

  return (
    <span className="setup-confirm">
      <input
        className="select"
        autoFocus
        placeholder={`Nom du ${label.toLowerCase()}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <button className="btn is-primary" disabled={name.trim() === ''} onClick={commit}>
        Ajouter
      </button>
      <button className="btn" onClick={() => setOpen(false)}>
        Annuler
      </button>
    </span>
  );
}

/**
 * Who runs this pole, and how to reach them.
 *
 * Attached to the root pole, because you call the head of the bar and not the head of the
 * plonge. They are not volunteers: they carry no availability, no volume and no choices, and
 * nothing ever assigns them to a shift.
 */
function Organisers({
  poleKey,
  poleName,
  eventHours,
}: {
  poleKey: string;
  poleName: string;
  eventHours: number;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const organisers = index.leadersOn(poleKey);

  /*
   * Everybody already recorded, offered for this pole. Nobody is excluded from the list, not
   * even somebody who already runs this pole: a organiser present from 14h to 18h and again from
   * 22h to 02h is two roles on one pole, and refusing the second would leave no way to say it.
   */
  const others = plan.organisers;

  return (
    <div className="setup-organisers">
      <span className="panel-section-title">Responsables de pôle</span>

      {/*
        These three declare what they hold, which is what stops the pole name above being
        renamed. Chrome autofills a contact by guessing at nearby fields; once the name, phone
        and email say so themselves, it fills them and leaves everything else alone.
      */}
      {organisers.map(({ organiser, role }) => (
        // Keyed on the role. One person can hold two of them here, and two rows sharing the
        // person's key would collapse into one as far as React is concerned.
        <div key={role.key} className="setup-organiser">
          {/*
            The name is split in two since 2026-09-09, because a organiser now fills in a form that
            asks for both and because the organisers' own screen sorts on the surname. Editing
            either here edits the PERSON: the same organiser running the bar and the plonge is one
            row in the plan, so a correction made on one pole shows on the other, which is the
            point of having split them.
          */}
          <input
            className="setup-name is-half"
            name={`organiser-first-${role.key}`}
            autoComplete="given-name"
            value={organiser.firstName}
            placeholder="Prénom"
            aria-label="Prénom du responsable"
            onChange={(event) =>
              edit(
                (p) => updateOrganiser(p, organiser.key, { firstName: event.target.value }),
                `responsable de pôle ${poleName}`,
              )
            }
          />
          <input
            className="setup-name is-half"
            name={`organiser-last-${role.key}`}
            autoComplete="family-name"
            value={organiser.lastName}
            placeholder="Nom"
            aria-label="Nom du responsable"
            onChange={(event) =>
              edit(
                (p) => updateOrganiser(p, organiser.key, { lastName: event.target.value }),
                `responsable de pôle ${poleName}`,
              )
            }
          />
          <input
            className="select"
            type="tel"
            name={`organiser-tel-${role.key}`}
            autoComplete="tel"
            placeholder="Téléphone"
            value={organiser.phone}
            onChange={(event) =>
              edit(
                (p) => updateOrganiser(p, organiser.key, { phone: event.target.value }),
                `téléphone de ${organiserName(organiser)}`,
              )
            }
          />
          <input
            className="select"
            type="email"
            name={`organiser-email-${role.key}`}
            autoComplete="email"
            placeholder="Adresse e-mail"
            value={organiser.email}
            onChange={(event) =>
              edit(
                (p) => updateOrganiser(p, organiser.key, { email: event.target.value }),
                `e-mail de ${organiserName(organiser)}`,
              )
            }
          />

          {/*
            Their hours, which is the useful part on the night: the grid draws a band above the
            pole so "the bar has nobody in charge between 02h and 04h" is visible rather than
            worked out. No rule reads them, and leaving them empty is a normal answer.
          */}
          <span className="clock-range">
            <ClockField
              value={role.start}
              maxHours={eventHours}
              startISO={plan.startISO}
              allowEmpty
              narrow
              placeholder="de"
              ariaLabel={`Heure d'arrivée de ${organiserName(organiser)}`}
              hint="Déplacer l'arrivée décale le départ d'autant, tant que les deux sont remplis."
              name={`organiser-start-${role.key}`}
              onChange={(value) =>
                edit(
                  // The window slides, like every other pair of hours here. Half a window has no
                  // length to keep, so there is nothing to slide and the other half stays put.
                  (p) =>
                    setOrganiserWindow(
                      p,
                      role.key,
                      value,
                      value !== null && role.start !== null && role.end !== null
                        ? slideEnd(role.start, role.end, value)
                        : role.end,
                    ),
                  `horaires de ${organiserName(organiser)}`,
                )
              }
            />
            <span className="clock-range-sep">→</span>
            <ClockField
              value={role.end}
              maxHours={eventHours}
              startISO={plan.startISO}
              allowEmpty
              narrow
              placeholder="à"
              ariaLabel={`Heure de départ de ${organiserName(organiser)}`}
              hint="Déplacer le départ change la durée de présence. L'arrivée ne bouge pas."
              name={`organiser-end-${role.key}`}
              onChange={(value) =>
                edit(
                  (p) => setOrganiserWindow(p, role.key, role.start, value),
                  `horaires de ${organiserName(organiser)}`,
                )
              }
            />
            {/*
              A half-entered window is a normal state while typing, and an incoherent one is worth
              naming rather than leaving as a band that mysteriously fails to appear.
            */}
            <span className={`rule-suffix ${organiserWindowState(role) === 'incoherent' ? 'is-bad' : ''}`}>
              {organiserWindowLabel(role)}
            </span>
          </span>

          {/*
            Takes this pole off them, and nothing else. The person stays in the plan with their
            other poles, their coordinates and their access code: somebody handing the plonge
            over is not somebody leaving the event, and the two used to be the same click.
          */}
          <button
            className="btn is-icon is-danger"
            title={`Retirer ${organiserName(organiser)} du pôle ${poleName}`}
            onClick={() =>
              edit(
                (p) => removeLeaderRole(p, role.key),
                `${organiserName(organiser)} retiré du pôle ${poleName}`,
              )
            }
          >
            ✕
          </button>
        </div>
      ))}

      <div className="setup-organiser-add">
        <AddChild
          label="Responsable de pôle"
          onAdd={(name) =>
            edit((p) => addLeaderOnPole(p, poleKey, name), `responsable de pôle ${name}`)
          }
        />

        {/*
          The second door, and the reason organisers were split from their poles: most of them run
          more than one. Without this, putting the head of the bar in charge of the plonge means
          typing their name again and creating a second, unrelated person.
        */}
        {others.length > 0 && (
          <select
            className="select"
            aria-label="Ajouter un responsable déjà enregistré"
            value=""
            onChange={(event) => {
              const key = event.target.value;
              if (key === '') return;
              const person = others.find((l) => l.key === key);
              edit(
                (p) => assignOrganiserToPole(p, key, poleKey),
                `${person ? organiserName(person) : 'responsable'} ajouté au pôle ${poleName}`,
              );
            }}
          >
            <option value="">Ajouter quelqu'un déjà enregistré…</option>
            {others.map((person) => (
              <option key={person.key} value={person.key}>
                {organiserName(person)}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
