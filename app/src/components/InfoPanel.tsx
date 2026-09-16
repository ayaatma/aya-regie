/**
 * "Info sélection": the pane that says what was just clicked, whatever kind of thing it was.
 *
 * A PANE AND NOT A TAB, since 2026-09-11, and that is the point of it. What is now here used to be
 * the exploit's "Bénévole" tab, sharing one column with the lists people are picked from: reading
 * about somebody meant leaving the list you had found them in, and then finding your place in it
 * again. The two questions are asked at the same moment, so they are answered side by side. See
 * `PoolPanel`.
 *
 * NOT JUST A BÉNÉVOLE. The régisseur clicks a box and expects to be told what is in it, and a
 * montage box holds an orga as often as a bénévole. Before this, clicking one opened an unnamed
 * block with a pole selector in it, under the grid, with nothing saying which of the two files the
 * name came from. Five things can be selected now, each with its own body below: a bénévole, an
 * orga, a créneau of the exploit, a box of a phase, an événement of a phase.
 *
 * A BOX SHOWS THE PERSON IT HOLDS, in full, under the box's own hours. That is what the régisseur
 * asked for in so many words: clicking a case shows the fiche, the same one the exploit shows.
 *
 * NOTHING HERE IS A SILENT MUTATION. The two buttons that change anything, taking a box off the
 * grid and putting somebody into a place to fill, both say what they do and both go through
 * `edit`, so they land in the undo stack and in the journal. Clicking never decides on its own,
 * which is the mistake this panel was built to undo: a click on an événement's occupant used to
 * remove them from the événement on the spot.
 */

import { useState } from 'react';

import {
  allPlacements,
  eventFills,
  fmtHours,
  phaseIssues,
  phasePeople,
  toClock,
  toLabel,
  type PersonKind,
  type Phase,
  type PhaseId,
} from '../engine.ts';
import { addOrganiserToShift, removeOrganiserFromShift } from '../store/edits.ts';
import { removeLeaderRole } from '../store/setupEdits.ts';
import { assignWindow, setPhaseAssignment, setPhaseEvent } from '../store/phaseEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from './labels.ts';
import { OrganiserFiche } from './OrganiserFiche.tsx';
import { PersonMark } from './PersonMark.tsx';
import { useNavigation } from './personNav.ts';
import type { Selection } from './selection.ts';
import { VolunteerFiche } from './VolunteerFiche.tsx';

/** Where the folded state is remembered, per browser. A convenience, so a failure costs nothing. */
const COLLAPSED_KEY = 'aya-regie.info-panel.collapsed';

const readCollapsed = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Whether the pane is folded, remembered across the three moments and across reloads.
 *
 * FOLDABLE SINCE 2026-09-15, on the régisseur's request: the two panes on the right were taking
 * the grid's room. Folding leaves a strip the width of a button, and the SCREEN'S GRID COLUMN
 * follows through `:has()` in the stylesheet (`.screen.has-info:has(> .panel.is-info.is-collapsed)`)
 * rather than a prop threaded through `GridScreen` and `PhaseGrid`. A selection made while folded
 * does not unfold it: folding is a decision, and the strip carries a dot saying something is there.
 */
function useCollapsed(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const set = (value: boolean): void => {
    setCollapsed(value);
    try {
      globalThis.localStorage?.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      // Private window or blocked storage: the pane still folds, it just forgets on reload.
    }
  };
  return [collapsed, set];
}

export function InfoPanel({
  selection,
  onSelect,
  readOnly = false,
}: {
  selection: Selection | null;
  onSelect(selection: Selection | null): void;
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useCollapsed();

  if (collapsed) {
    return (
      <aside className="panel is-info is-collapsed">
        <button
          className="panel-unfold"
          title="Déplier le volet Info sélection"
          aria-label="Déplier le volet Info sélection"
          onClick={() => setCollapsed(false)}
        >
          <span aria-hidden>«</span>
          <span className="panel-unfold-label">Info sélection</span>
          {selection !== null && (
            <span className="panel-unfold-dot" title="Un élément est sélectionné" />
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="panel is-info">
      <div className="panel-tabs is-single">
        <span className="panel-tab is-title" aria-current>
          Info sélection
        </span>
        {selection !== null && (
          <button
            className="panel-tab is-close"
            title="Ne plus rien sélectionner"
            onClick={() => onSelect(null)}
          >
            ✕
          </button>
        )}
        <button
          className="panel-tab is-close"
          title="Replier le volet"
          aria-label="Replier le volet Info sélection"
          onClick={() => setCollapsed(true)}
        >
          »
        </button>
      </div>

      <div className="panel-body">
        {selection === null ? (
          <p className="pool-empty">
            Cliquez une case de la grille, un créneau, un événement, ou un nom dans la liste à
            gauche. Ce qui est sélectionné est décrit ici.
          </p>
        ) : (
          <Body selection={selection} onSelect={onSelect} readOnly={readOnly} />
        )}
      </div>
    </aside>
  );
}

function Body({
  selection,
  onSelect,
  readOnly,
}: {
  selection: Selection;
  onSelect(selection: Selection | null): void;
  readOnly: boolean;
}) {
  switch (selection.kind) {
    case 'benevole':
      return <BenevoleBody volunteerKey={selection.volunteerKey} readOnly={readOnly} />;
    case 'orga':
      return <OrgaBody organiserKey={selection.organiserKey} onSelect={onSelect} readOnly={readOnly} />;
    case 'creneau':
      return (
        <CreneauBody
          shiftKey={selection.shiftKey}
          fill={selection.fill}
          onSelect={onSelect}
          readOnly={readOnly}
        />
      );
    case 'case':
      return (
        <CaseBody
          phaseId={selection.phaseId}
          assignmentKey={selection.assignmentKey}
          onSelect={onSelect}
          readOnly={readOnly}
        />
      );
    case 'evenement':
      return (
        <EvenementBody
          phaseId={selection.phaseId}
          eventKey={selection.eventKey}
          fill={selection.fill}
          onSelect={onSelect}
          readOnly={readOnly}
        />
      );
  }
}

/** The head every body opens with: what this is, and what it is called. */
function Head({
  what,
  name,
  kind,
}: {
  what: string;
  name: string;
  kind?: PersonKind;
}) {
  return (
    <>
      <p className="panel-kind">{what}</p>
      <h2 className="panel-title">
        {kind && <PersonMark kind={kind} />}
        {name}
      </h2>
    </>
  );
}

function BenevoleBody({ volunteerKey, readOnly }: { volunteerKey: string; readOnly: boolean }) {
  const { index } = useLoadedPlan();
  const volunteer = index.volunteerByKey.get(volunteerKey);
  if (!volunteer) return <p className="pool-empty">Ce bénévole n'est plus dans le plan.</p>;

  return (
    <>
      <Head what="Bénévole" name={index.volunteerName(volunteerKey)} kind="benevole" />
      {!readOnly && <OpenInPeople kind="benevole" personKey={volunteerKey} />}
      <VolunteerFiche volunteerKey={volunteerKey} readOnly={readOnly} />
    </>
  );
}

/**
 * The way to the whole fiche, on the Personnes tab: the door's fields, the change of status. Only
 * inside the shell, which provides the navigation; the read-only orga view has no such tab.
 */
function OpenInPeople({ kind, personKey }: { kind: PersonKind; personKey: string }) {
  const nav = useNavigation();
  if (!nav) return null;
  return (
    <p>
      <button
        className="btn is-small"
        title="La fiche entière, avec la billetterie et le changement de statut"
        onClick={() => nav.openPerson({ kind, key: personKey })}
      >
        Ouvrir dans Personnes
      </button>
    </p>
  );
}

/**
 * An orga: the fiche itself, plus everywhere they are written down.
 *
 * An orga is under none of the volunteers' rules, so there is no report to show and nothing can be
 * illegal about their day. What a régisseur wants instead is the list: which créneaux of the
 * exploit they hold a place in, and which boxes they have on each phase.
 */
function OrgaBody({
  organiserKey,
  onSelect,
  readOnly,
}: {
  organiserKey: string;
  onSelect(selection: Selection | null): void;
  readOnly: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const person = plan.organisers.find((o) => o.key === organiserKey);
  if (!person) return <p className="pool-empty">Cet orga n'est plus dans le plan.</p>;

  const shifts = plan.organiserShifts.filter((s) => s.organiserKey === organiserKey);
  const roles = index.polesLedBy(organiserKey);

  return (
    <>
      <Head what="Orga" name={organiserName(person)} kind="orga" />
      {!readOnly && <OpenInPeople kind="orga" personKey={organiserKey} />}
      <p className="panel-sub">
        Un orga n'est soumis à aucune règle d'heures et le solveur ne le place jamais. Tout ce qui
        est ici se corrige: ce que le formulaire a dit n'est qu'un point de départ.
      </p>

      {/*
        The poles this person runs, with their hours and a way back out.

        The way IN is a drag onto the pole's frise since 2026-09-12, so the way out has to be
        somewhere a régisseur will look for it, which is the pane describing the person. It used
        to be a chip and nothing else, with Réglages as the only place a role could be undone.
      */}
      {roles.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-title">Responsable de</p>
          {roles.map((role) => (
            <p key={role.key}>
              <span className="chip">
                {index.poleByKey.get(role.poleKey)?.path ?? role.poleKey}
              </span>{' '}
              <span className="pool-item-meta">
                {role.start === null || role.end === null
                  ? 'horaires non réglés'
                  : `${index.label(role.start)} → ${index.label(role.end)}`}
              </span>{' '}
              {!readOnly && (
                <button
                  className="btn is-small"
                  title="Cette personne n'est plus responsable de ce pôle. Elle reste orga."
                  onClick={() =>
                    edit(
                      (p) => removeLeaderRole(p, role.key),
                      `${organiserName(person)} n'est plus responsable de ${
                        index.poleByKey.get(role.poleKey)?.path ?? role.poleKey
                      }`,
                    )
                  }
                >
                  Retirer
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      {/*
        A reader gets the facts, never the fields. A pole organiser reading the montage needs to
        know who this is and how to reach them; what they must not get is a form that would
        silently fail, since their session has no write access at all. See `GridScreenProps`.
      */}
      {readOnly ? (
        <dl className="kv">
          {person.phone !== '' && (
            <>
              <dt>Téléphone</dt>
              <dd>{person.phone}</dd>
            </>
          )}
          {person.email !== '' && (
            <>
              <dt>E-mail</dt>
              <dd>{person.email}</dd>
            </>
          )}
          {person.diet !== '' && (
            <>
              <dt>Régime</dt>
              <dd>{person.diet}</dd>
            </>
          )}
          {person.allergies !== '' && (
            <>
              <dt>Allergies</dt>
              <dd>{person.allergies}</dd>
            </>
          )}
          {person.note !== '' && (
            <>
              <dt>Remarques</dt>
              <dd>{person.note}</dd>
            </>
          )}
        </dl>
      ) : (
        <OrganiserFiche organiserKey={organiserKey} />
      )}

      <div className="panel-section">
        <p className="panel-section-title">Sur l'exploit</p>
        {shifts.length === 0 ? (
          <p className="pool-empty">Aucun créneau de l'exploit.</p>
        ) : (
          shifts.map((shift) => {
            const found = index.shiftByKey.get(shift.shiftKey);
            return (
              <p key={shift.shiftKey}>
                <button
                  className="link-button"
                  onClick={() => onSelect({ kind: 'creneau', shiftKey: shift.shiftKey, fill: false })}
                >
                  {found ? index.polePath(found.poleKey) : shift.shiftKey}
                </button>{' '}
                <span className="pool-item-meta">
                  {found ? `${index.label(found.start)} → ${index.label(found.end)}` : ''}
                </span>
              </p>
            );
          })
        )}
      </div>

      <PhaseBoxes personKind="orga" personKey={organiserKey} onSelect={onSelect} />
    </>
  );
}

/** Where somebody stands on the montage and on the démontage, as links to each box. */
function PhaseBoxes({
  personKind,
  personKey,
  onSelect,
}: {
  personKind: PersonKind;
  personKey: string;
  onSelect(selection: Selection | null): void;
}) {
  const { plan } = useLoadedPlan();
  const phases = (['montage', 'demontage'] as const).filter(
    (id) => (id === 'montage' ? plan.montage : plan.demontage).enabled,
  );
  if (phases.length === 0) return null;

  return (
    <>
      {phases.map((id) => {
        const phase: Phase = id === 'montage' ? plan.montage : plan.demontage;
        const mine = phase.assignments
          .filter((a) => a.personKind === personKind && a.personKey === personKey)
          .sort((a, b) => a.start - b.start);
        return (
          <div className="panel-section" key={id}>
            <p className="panel-section-title">
              {phase.label || (id === 'montage' ? 'Montage' : 'Démontage')}
            </p>
            {mine.length === 0 ? (
              <p className="pool-empty">Aucune case.</p>
            ) : (
              mine.map((a) => (
                <p key={a.key}>
                  <button
                    className="link-button"
                    onClick={() => onSelect({ kind: 'case', phaseId: id, assignmentKey: a.key })}
                  >
                    {toLabel(phase.startISO, a.start)} → {toClock(phase.startISO, a.end)}
                  </button>{' '}
                  <span className="pool-item-meta">
                    {phase.poles.find((p) => p.key === a.poleKey)?.name ??
                      phase.events.find((e) => e.key === a.eventKey)?.label ??
                      '?'}
                  </span>
                </p>
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * A créneau of the exploit: its pole, its hours, who stands in it, and what is wrong with it.
 *
 * `fill` means the régisseur clicked one of its places to fill. The only thing that can go into
 * one from here is an orga, which is exactly what the old floating picker offered: a bénévole is
 * placed by the solver or dragged in from the pool, because every rule this tool has applies to
 * them and a list that ignored those rules would be a trap.
 */
function CreneauBody({
  shiftKey,
  fill,
  onSelect,
  readOnly,
}: {
  shiftKey: string;
  fill: boolean;
  onSelect(selection: Selection | null): void;
  readOnly: boolean;
}) {
  const { plan, index, report, edit } = useLoadedPlan();
  const shift = index.shiftByKey.get(shiftKey);
  const detail = report.shifts.find((s) => s.key === shiftKey);
  if (!shift || !detail) return <p className="pool-empty">Ce créneau n'est plus dans le plan.</p>;

  const here = new Set(detail.orgas.map((o) => o.key));
  /*
   * Responsables of this pole who are supposed to stay in support and are standing here anyway.
   *
   * Said in the panel as well as on the box, because the box only has a tooltip and this is a
   * sentence: which pole expects what, and the fact that nothing was refused. See
   * `Pole.leaderSupportOnly`.
   */
  const inSupport = index.supportOnlyBreaches().filter((b) => b.shift.key === shiftKey);

  return (
    <>
      <Head what="Créneau" name={detail.polePath} />
      <p className="panel-sub">
        {detail.label} · {fmtHours(shift.end - shift.start)} · {detail.assigned} sur{' '}
        {shift.headcount}
      </p>

      {inSupport.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-title">À surveiller</p>
          {inSupport.map((breach) => (
            <div key={breach.role.key} className="issue is-tier2">
              {organiserName(breach.organiser)} est responsable de{' '}
              {index.polePath(breach.pole.key)}, qui attend son responsable en support, sans
              créneau. Rien n'a été retiré: si les deux tiennent dans une paire de mains, décochez
              l'option sur le pôle dans Réglages.
            </div>
          ))}
        </div>
      )}

      {detail.issues.length > 0 && (
        <div className="panel-section">
          <p className="panel-section-title">Signalements</p>
          {detail.issues.map((issue, i) => (
            <div key={i} className={`issue ${issue.tier === 2 ? 'is-tier2' : ''}`}>
              <span className="issue-code">{issue.code}</span>
              {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="panel-section">
        <p className="panel-section-title">Qui y est</p>
        {detail.orgas.map((orga) => (
          <p key={`orga-${orga.key}`}>
            <button
              className="link-button"
              onClick={() => onSelect({ kind: 'orga', organiserKey: orga.key })}
            >
              <PersonMark kind="orga" />
              {orga.name}
            </button>
            {!readOnly && (
              <>
                {' '}
                <button
                  className="btn is-small"
                  onClick={() =>
                    edit(
                      (p) => removeOrganiserFromShift(p, orga.key, shiftKey),
                      `${orga.name} retiré·e d'un créneau`,
                    )
                  }
                >
                  Retirer
                </button>
              </>
            )}
          </p>
        ))}
        {detail.stars.map((star) => (
          <p key={star.volunteerKey}>
            <button
              className="link-button"
              onClick={() => onSelect({ kind: 'benevole', volunteerKey: star.volunteerKey })}
            >
              {star.name}
            </button>
          </p>
        ))}
        {detail.missing > 0 && (
          <p className="pool-item-meta">
            {detail.missing} place{detail.missing > 1 ? 's' : ''} à pourvoir
          </p>
        )}
      </div>

      {/*
        ALWAYS OFFERED, not only on a place to fill, since 2026-09-12.

        It used to appear only when the régisseur had clicked one of the créneau's dashed "à
        pourvoir" boxes, so on a créneau that was already full, or one clicked anywhere else, the
        pane offered no way to add an orga at all: "je ne vois pas dans le volet de droite de
        moyen d'ajouter un orga sur une case". A créneau over its headcount is a legitimate thing
        to write here, exactly as it is for a bénévole, and the grid draws the overflow in red
        rather than refusing it.

        `fill` still changes the wording, because clicking a hole is a narrower question than
        clicking the créneau.
      */}
      {!readOnly && (
        <div className="panel-section">
          <p className="panel-section-title">
            {fill ? 'Mettre un orga à cette place' : 'Ajouter un orga à ce créneau'}
          </p>
          <p className="panel-sub">
            Un orga placé ici tient une place comme un bénévole et ne compte dans aucune règle
            d'heures. Un bénévole se glisse depuis la liste des disponibles; un orga se glisse de
            la même façon, ou se choisit ci-dessous.
            {detail.missing === 0 &&
              ' Ce créneau est déjà complet: une personne de plus y sera dessinée en sureffectif.'}
          </p>
          {plan.organisers.length === 0 && (
            <p className="pool-empty">Aucun orga dans le plan. Ils s'ajoutent dans Réglages.</p>
          )}
          {plan.organisers.length > 0 && plan.organisers.filter((o) => !here.has(o.key)).length === 0 && (
            <p className="pool-empty">Tous les orgas sont déjà sur ce créneau.</p>
          )}
          {plan.organisers
            .filter((o) => !here.has(o.key))
            .map((orga) => (
              <div
                key={orga.key}
                className="pool-item"
                role="button"
                onClick={() =>
                  edit(
                    (p) => addOrganiserToShift(p, orga.key, shiftKey),
                    `${organiserName(orga)} sur un créneau`,
                  )
                }
              >
                <PersonMark kind="orga" />
                <span className="pool-item-name">{organiserName(orga)}</span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}

/**
 * One box of a phase grid: the hours, the pole, what contradicts a declaration, and the person.
 *
 * THE HOURS ARE READ HERE AND SET ON THE GRID. Trimming is a drag on the box's own edge, which is
 * the gesture a phase is actually worked with, so the panel states the window rather than offering
 * two more fields to type it into. The pole is the other way round: dragging between lanes is how
 * it is usually changed, and the selector is for the case where the right lane is off screen.
 */
function CaseBody({
  phaseId,
  assignmentKey,
  onSelect,
  readOnly,
}: {
  phaseId: PhaseId;
  assignmentKey: string;
  onSelect(selection: Selection | null): void;
  readOnly: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const phase: Phase = phaseId === 'montage' ? plan.montage : plan.demontage;
  const box = phase.assignments.find((a) => a.key === assignmentKey);
  if (!box) return <p className="pool-empty">Cette case n'est plus sur la grille.</p>;

  const name =
    box.personKind === 'orga'
      ? (() => {
          const found = plan.organisers.find((o) => o.key === box.personKey);
          return found ? organiserName(found) : box.personKey;
        })()
      : index.volunteerShortName(box.personKey);

  const issues = phaseIssues(phase, plan.organisers, plan.volunteers, plan.skills).filter(
    (issue) => issue.assignmentKey === assignmentKey,
  );
  const where =
    phase.poles.find((p) => p.key === box.poleKey)?.name ??
    phase.events.find((e) => e.key === box.eventKey)?.label ??
    '?';

  return (
    <>
      <Head
        what={`Case · ${phase.label || (phaseId === 'montage' ? 'Montage' : 'Démontage')}`}
        name={name}
        kind={box.personKind}
      />
      <p className="panel-sub">
        {box.personKind === 'orga' ? 'Orga' : 'Bénévole'} · {where} ·{' '}
        {toLabel(phase.startISO, box.start)} → {toClock(phase.startISO, box.end)} ·{' '}
        {fmtHours(box.end - box.start)}
      </p>

      {issues.map((issue, i) => (
        <p key={i} className="issue">
          {issue.message}
        </p>
      ))}

      {!readOnly && (
        <>
          <label className="rule">
            <span className="rule-label">Pôle</span>
            <select
              className="select"
              value={box.poleKey}
              disabled={box.eventKey !== ''}
              aria-label={`Pôle de ${name}`}
              onChange={(event) =>
                edit(
                  (p) => setPhaseAssignment(p, phaseId, assignmentKey, { poleKey: event.target.value }),
                  `pôle de ${name}`,
                )
              }
            >
              {phase.poles.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.name}
                </option>
              ))}
            </select>
            <span className="rule-hint">
              Les heures se règlent en tirant les bords de la case sur la grille.
            </span>
          </label>

          <button
            className="btn is-danger"
            onClick={() => {
              edit(
                (p) =>
                  assignWindow(
                    p,
                    phaseId,
                    { kind: box.personKind, key: box.personKey },
                    null,
                    box.start,
                    box.end,
                  ),
                `case de ${name} retirée`,
              );
              onSelect(
                box.personKind === 'orga'
                  ? { kind: 'orga', organiserKey: box.personKey }
                  : { kind: 'benevole', volunteerKey: box.personKey },
              );
            }}
          >
            Retirer cette case
          </button>
        </>
      )}

      {/* The person themselves, in full, which is what a click on a box is usually asking for. */}
      <div className="panel-section panel-divider">
        {box.personKind === 'orga' ? (
          <OrgaBody organiserKey={box.personKey} onSelect={onSelect} readOnly={readOnly} />
        ) : (
          <BenevoleBody volunteerKey={box.personKey} readOnly={readOnly} />
        )}
      </div>
    </>
  );
}

/**
 * An événement of a phase: the one thing on these two grids that has a number of people to find.
 *
 * `fill` means a place to fill was clicked. Who is offered is who is ON SITE while it happens:
 * placing somebody who has not said they are coming would be the tool deciding for them that they
 * are there, which is the one thing a declaration must never become.
 */
function EvenementBody({
  phaseId,
  eventKey,
  fill,
  onSelect,
  readOnly,
}: {
  phaseId: PhaseId;
  eventKey: string;
  fill: boolean;
  onSelect(selection: Selection | null): void;
  readOnly: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const phase: Phase = phaseId === 'montage' ? plan.montage : plan.demontage;
  const event = phase.events.find((e) => e.key === eventKey);
  const fillState = eventFills(phase).find((f) => f.event.key === eventKey);
  if (!event || !fillState) return <p className="pool-empty">Cet événement n'existe plus.</p>;

  const inside = allPlacements(phase).filter((b) => b.eventKey === eventKey);
  const taken = new Set(inside.map((b) => `${b.personKind}|${b.personKey}`));
  const nameOf = (kind: PersonKind, key: string): string => {
    if (kind !== 'orga') return index.volunteerShortName(key);
    const found = plan.organisers.find((o) => o.key === key);
    return found ? organiserName(found) : key;
  };

  const here = phasePeople(phase, plan.organisers, plan.volunteers).filter(
    (person) =>
      !taken.has(`${person.kind}|${person.key}`) &&
      person.presence.some((w) => w.start < event.end && event.start < w.end),
  );

  return (
    <>
      <Head
        what={`Événement · ${phase.label || (phaseId === 'montage' ? 'Montage' : 'Démontage')}`}
        name={event.label}
      />
      <p className="panel-sub">
        {toLabel(phase.startISO, event.start)} → {toClock(phase.startISO, event.end)} ·{' '}
        {fillState.taken} sur {event.headcount}
        {fillState.missing > 0 ? ` · ${fillState.missing} à pourvoir` : ' · complet'}
      </p>

      {/*
        Renamed here since 2026-09-16: the grid's « mode édition » creates an événement called
        « Nouvel événement » and opens it in this pane, so the name has to be typable right here.
      */}
      {!readOnly && (
        <label className="rule">
          <span className="rule-label">Nom</span>
          <input
            className="select"
            name={`evenement-label-${event.key}`}
            autoComplete="off"
            value={event.label}
            aria-label="Nom de l'événement"
            onChange={(changed) =>
              edit(
                (p) => setPhaseEvent(p, phaseId, event.key, { label: changed.target.value }),
                `nom de l'événement ${event.label}`,
              )
            }
          />
        </label>
      )}

      <div className="panel-section">
        <p className="panel-section-title">Qui y est</p>
        {inside.length === 0 && <p className="pool-empty">Personne pour l'instant.</p>}
        {inside.map((box) => (
          <p key={box.assignmentKey}>
            <button
              className="link-button"
              onClick={() =>
                onSelect({ kind: 'case', phaseId, assignmentKey: box.assignmentKey })
              }
            >
              <PersonMark kind={box.personKind} />
              {nameOf(box.personKind, box.personKey)}
            </button>{' '}
            {!readOnly && (
              <button
                className="btn is-small"
                title={`Retirer de ${event.label}. La personne reste sur la phase.`}
                onClick={() =>
                  edit(
                    (p) =>
                      assignWindow(
                        p,
                        phaseId,
                        { kind: box.personKind, key: box.personKey },
                        null,
                        box.start,
                        box.end,
                      ),
                    `${nameOf(box.personKind, box.personKey)} retiré·e de ${event.label}`,
                  )
                }
              >
                Retirer
              </button>
            )}
          </p>
        ))}
      </div>

      {fill && !readOnly && (
        <div className="panel-section">
          <p className="panel-section-title">Mettre quelqu'un à cette place</p>
          <p className="panel-sub">
            Les personnes sur place à ce moment. En choisir une l'y place et la retire d'où elle
            était pendant ce temps.
          </p>
          {here.length === 0 && <p className="pool-empty">Personne n'est sur place à ce moment.</p>}
          {here.map((person) => (
            <div
              key={`${person.kind}-${person.key}`}
              className="pool-item"
              role="button"
              onClick={() =>
                edit(
                  (p) =>
                    assignWindow(
                      p,
                      phaseId,
                      { kind: person.kind, key: person.key },
                      { kind: 'event', eventKey },
                      event.start,
                      event.end,
                    ),
                  `${nameOf(person.kind, person.key)} sur ${event.label}`,
                )
              }
            >
              <PersonMark kind={person.kind} />
              <span className="pool-item-name">{nameOf(person.kind, person.key)}</span>
              <span className="pool-item-meta">
                {person.kind === 'orga' ? 'orga' : 'bénévole'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
