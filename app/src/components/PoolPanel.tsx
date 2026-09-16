/**
 * The pool pane: who is still to place, and who is on the waiting list.
 *
 * ONE PANE FOR THE THREE MOMENTS, since 2026-09-11, and the same tabs in each. The exploit
 * had `SidePanel` and the two phases had `PhasePool`, and they agreed on nothing: different tabs,
 * different markup, different words for the same idea, and only one of the two had any CSS at all,
 * so the montage's panel was raw browser defaults stacked in a column. The régisseur asked for one
 * panel, and one panel is also the only way the two stay the same next month.
 *
 * WHAT DIFFERS BETWEEN THE MOMENTS IS THE CONTENT OF ONE TAB. "Disponibles" means "has hours
 * nobody has used yet", which on the exploit is the volume they asked for and on a phase is the
 * presence they declared.
 *
 * "LISTE D'ATTENTE" REPLACED "À RELIRE", 2026-09-16, at the régisseur's request. Proofreading a
 * fiche is done from Personnes now, where the lines to read are red; what the grid needed beside
 * it was the people waiting for a place. A row drags onto a créneau like any other, and `assign`
 * takes the person off `Plan.reserve` in the same edit, so nobody is ever both placed and waiting.
 * The tab is the exploit's alone: the waiting list is about the exploit's volume, and a phase has
 * no such list. Putting somebody on it is still one button on their fiche (`VolunteerFiche`).
 *
 * THE PANE IS NARROW ON PURPOSE (`--panel-w`), since the same day: every pixel given to it is taken
 * from the grid. The how-to sentence that used to open the list is the tab's tooltip, and a row's
 * figure is the bare hours, the row's own tooltip saying what they are.
 *
 * ORGAS ARE IN "DISPONIBLES" IN THE THREE MOMENTS, since 2026-09-12. They were on the two phases
 * and not on the exploit, and the exploit is where an orga is put on a créneau or made responsable
 * of a pole, so the one list that lets somebody be dragged onto the grid was missing half the
 * people who can be dragged onto it. The "Qui" filter is therefore no longer phase-only either.
 * The DAY filter went the other way and left this pane: it narrows the phase grid as well as this
 * list, so it lives on that screen's toolbar. See `PoolPanelProps.day`.
 *
 * THERE IS NO "À ZÉRO" TAB ANY MORE. It was "Disponibles" filtered down to the people at zero,
 * which meant two lists to walk to be sure nobody had been missed. Being at zero is now a mark on
 * the row, in the one list.
 *
 * A PÔLE FILTER IN THE THREE MOMENTS, since 2026-09-13: "filtrer les bénévoles / orgas ayant leur
 * choix 1 ou choix 2 sur un pôle choisi, avec une indication si c'est leur choix 1 ou leur
 * choix 2". The poles offered are the EXPLOIT's, on the phases too, because a phase has no
 * choices of its own and what the régisseur is after on a montage is "les gens du bar" to set
 * the bar up. A bénévole matches through their two choices (a choice on a parent pole covers its
 * sub-poles, and a choice on a sub-pole answers for its parent); an orga has no choice and
 * matches through the pole they are responsable of. The chip says which, and only while the
 * filter is on: on the whole list it would be a symbol in front of every name.
 *
 * CLICKING A ROW CHANGES NO TAB. It fills the pane next door. That is the whole point of the
 * split: picking somebody out of "Disponibles" and reading their fiche used to mean leaving the
 * list, and then finding your place in it again. See `InfoPanel`.
 */

import { useMemo, useState } from 'react';

import { fmtHours, type PersonKind, type PhaseId } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { DRAG_MIME, type DragPayload } from './drag.ts';
import { PersonMark } from './PersonMark.tsx';
import { exploitPoolRows, phasePoolRows, poleMatchOf, type PoleMatch, type PoolRow } from './poolRows.ts';
import { sameSelection, type Selection } from './selection.ts';

export type PanelTab = 'disponibles' | 'attente';

/** Which planning is on screen. The exploit and the two phases, named as the régisseur names them. */
export type Moment = 'exploit' | PhaseId;

const ALL_KINDS = 'tous';
const ALL_POLES = '';

/** The chip's word: « choix 2 » on a ranked event, « dans ses choix » on an unranked one. */
const matchWord = (match: PoleMatch, ranked: boolean): string =>
  match === 'responsable' ? 'responsable' : ranked ? `choix ${match + 1}` : 'dans ses choix';

export interface PoolPanelProps {
  moment: Moment;
  tab: PanelTab;
  onTabChange(tab: PanelTab): void;
  /**
   * Which day of the phase the list is about, or null for the whole of it. Phases only.
   *
   * THE PICKER IS ON THE TOOLBAR, not in here, since 2026-09-12. It used to be a second select
   * inside this tab, and once the grid itself gained a day filter the screen carried two of them
   * answering the same question about the same phase. `PhaseGrid` owns the day now and hands it
   * down, so narrowing the grid to Thursday narrows this list to Thursday in the same gesture.
   */
  day?: number | null;
  selection: Selection | null;
  onSelect(selection: Selection | null): void;
  /**
   * A row picked up on the exploit, where a drag carries its payload in the dataTransfer.
   *
   * A bénévole or an orga: the payload says which, and `GridScreen` decides what a drop means.
   *
   * Absent on a phase, which drags through React state instead, because what a phase drop does
   * depends on WHERE it lands (the day under the pointer decides the hours) and the dataTransfer
   * is not readable during a dragover.
   */
  onDragStartPerson?(payload: DragPayload, event: React.DragEvent): void;
  /** A row picked up on a phase. See `PhaseDrag`. */
  onDragStartPhase?(row: PoolRow): void;
  onDragEndPool(): void;
  /**
   * Dropping a box on "Disponibles" takes the person out of it.
   *
   * ALL THREE MOMENTS SINCE 2026-09-12: a créneau of the exploit, a box of a phase. It was the
   * exploit's alone, and the régisseur asked for the same gesture everywhere, the dashed pane and
   * the bin included. Putting somebody back in the pool of available people IS unplacing them,
   * which is why this is what the tab means as a target rather than a separate control.
   */
  onDropUnassign?(): void;
  readOnly?: boolean;
}

export function PoolPanel(props: PoolPanelProps) {
  const {
    moment,
    tab,
    onTabChange,
    day = null,
    selection,
    onSelect,
    onDragStartPerson,
    onDragStartPhase,
    onDragEndPool,
    onDropUnassign,
    readOnly = false,
  } = props;

  const { plan, index, report } = useLoadedPlan();
  const [dropHot, setDropHot] = useState(false);
  const [kind, setKind] = useState<PersonKind | typeof ALL_KINDS>(ALL_KINDS);
  const [poleKey, setPoleKey] = useState<string>(ALL_POLES);

  const isPhase = moment !== 'exploit';

  const all = useMemo(
    () =>
      isPhase ? phasePoolRows(plan, index, moment as PhaseId, day) : exploitPoolRows(index, report),
    [isPhase, plan, index, report, moment, day],
  );

  const matchOf = (row: PoolRow): PoleMatch | null =>
    poleKey === ALL_POLES ? null : poleMatchOf(index, row.kind, row.personKey, poleKey);

  const byKind = kind === ALL_KINDS ? all : all.filter((row) => row.kind === kind);
  const available = poleKey === ALL_POLES ? byKind : byKind.filter((row) => matchOf(row) !== null);
  // The exploit's poles, in the order Réglages draws them, each by its full path.
  const poles = plan.poles;

  /*
   * The waiting list, by name: it is read from top to bottom, and its order must not move while
   * somebody is being placed out of it.
   */
  const waiting = useMemo(
    (): PoolRow[] =>
      isPhase
        ? []
        : report.volunteers
            .filter((entry) => entry.reserve && index.volunteerByKey.get(entry.key)?.status !== 'annule')
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            .map((entry) => ({
              id: entry.key,
              personKey: entry.key,
              kind: 'benevole',
              selection: { kind: 'benevole', volunteerKey: entry.key },
              name: entry.name,
              meta: fmtHours(entry.requestedTotalHours),
              zero: false,
              review: index.volunteerByKey.get(entry.key)?.needsReview === true,
              title:
                `${entry.name}
En liste d'attente, ${fmtHours(entry.requestedTotalHours)} demandées
` +
                "Glisser sur un créneau: la personne sort de la liste d'attente",
            })),
    [isPhase, report.volunteers, index],
  );
  // A phase has no waiting list, so a tab left open on the exploit falls back to the pool there.
  const shown: PanelTab = isPhase ? 'disponibles' : tab;

  /*
   * The one drop this panel accepts. "Disponibles" took over from the tab that used to be called
   * "À zéro": dropping a box there unplaces the person, which is exactly what putting them back in
   * the pool of available people means. It works on the three moments since 2026-09-12; the
   * screen decides what "unplace" means, since a créneau and a phase box are not removed the same
   * way. Dropping a box on the waiting list does nothing: joining it gives up every place the
   * person holds, which is the fiche's button and its warning, not a gesture a drag can miss.
   */
  const acceptDrop = (event: React.DragEvent): boolean =>
    !readOnly &&
    event.dataTransfer.types.includes(DRAG_MIME) &&
    shown === 'disponibles' &&
    onDropUnassign !== undefined;

  const rows = shown === 'disponibles' ? available : waiting;

  return (
    <aside className="panel is-pool">
      <div className="panel-tabs">
        <button
          className="panel-tab"
          aria-current={shown === 'disponibles'}
          onClick={() => onTabChange('disponibles')}
          title={
            isPhase
              ? "Les heures que ces personnes ont déclarées et que personne ne leur a encore attribuées. Glissez un nom sur un pôle: il prend les heures déclarées pour le jour visé. Déposez ici une case de la grille pour la retirer."
              : "Tout le monde à qui il reste des heures à donner. Glissez un bénévole dans un créneau, ou déposez ici une case pour la retirer de son créneau. Un orga se glisse dans un créneau pour y tenir une place, ou sur la frise d'un pôle pour en devenir responsable pendant 2 h."
          }
        >
          Disponibles ({available.length})
        </button>
        {!isPhase && (
          <button
            className="panel-tab"
            aria-current={shown === 'attente'}
            onClick={() => onTabChange('attente')}
            title="Les bénévoles en liste d'attente. Glissez un nom sur un créneau: la personne y est placée et sort de la liste d'attente."
          >
            Liste d'attente ({waiting.length})
          </button>
        )}
      </div>

      <div
        className={`panel-body ${dropHot ? 'is-drop' : ''}`}
        onDragOver={(event) => {
          if (!acceptDrop(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropHot(true);
        }}
        onDragLeave={() => setDropHot(false)}
        onDrop={(event) => {
          if (!acceptDrop(event)) return;
          event.preventDefault();
          setDropHot(false);
          onDropUnassign?.();
        }}
      >
        {shown === 'disponibles' && (
          /*
            THE SAME FILTER IN THE THREE MOMENTS, since the exploit's list gained the orgas on
            2026-09-12. It was a phase-only control while the exploit knew bénévoles alone, and
            leaving it that way would have meant one list of two kinds of person with no way to
            ask for one of them. The day filter is NOT here: it belongs to the phase screen's
            toolbar, where it narrows the grid and this list at once. See `PoolPanelProps.day`.

            No visible label: the first option of each select names its subject (« Tout le
            monde », « Tous les pôles »), and two labels above two selects cost a line in a pane
            kept narrow for the grid's sake.
          */
          <div className="pool-filters">
            <select
              className="select"
              value={kind}
              aria-label="Filtrer par type de personne"
              title="Qui"
              onChange={(event) => setKind(event.target.value as PersonKind | typeof ALL_KINDS)}
            >
              <option value={ALL_KINDS}>Tout le monde</option>
              <option value="orga">Orgas</option>
              <option value="benevole">Bénévoles</option>
            </select>
            <select
              className="select"
              value={poleKey}
              aria-label="Filtrer par pôle demandé"
              title="Pôle demandé: les bénévoles dont c'est le choix 1 ou le choix 2, et les orgas qui en sont responsables"
              onChange={(event) => setPoleKey(event.target.value)}
            >
              <option value={ALL_POLES}>Tous les pôles</option>
              {poles.map((pole) => (
                <option key={pole.key} value={pole.key}>
                  {pole.path}
                </option>
              ))}
            </select>
          </div>
        )}

        {rows.length === 0 && (
          <p className="pool-empty">
            {shown === 'disponibles' && poleKey !== ALL_POLES
              ? "Personne n'a demandé ce pôle parmi les personnes disponibles."
              : emptyWord(shown, isPhase, kind)}
          </p>
        )}

        {rows.map((row) => (
          <div
            key={row.id}
            className={
              'pool-item' +
              (sameSelection(selection, row.selection) ? ' is-picked' : '')
            }
            draggable={!readOnly}
            title={row.title}
            onClick={() => onSelect(row.selection)}
            onDragStart={(event) => {
              if (readOnly) return;
              if (isPhase) {
                // Something has to be set or Firefox refuses to start the drag at all.
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', row.id);
                onDragStartPhase?.(row);
                return;
              }
              onDragStartPerson?.(
                { kind: row.kind, personKey: row.personKey, personName: row.name, fromShiftKey: null },
                event,
              );
            }}
            onDragEnd={onDragEndPool}
          >
            <PersonMark kind={row.kind} />
            <span className="pool-item-name">{row.name}</span>
            {/*
              "À zéro" used to be a tab of its own. It is the same fact, said on the row: a chip
              until 2026-09-15, a dot since, because on a montage nearly every row carries it and
              the words cost the names their width.
            */}
            {row.zero && shown === 'disponibles' && (
              <span className="pool-zero" role="img" aria-label="à zéro" title="À zéro: rien de placé pour l'instant" />
            )}
            {shown === 'disponibles' && poleKey !== ALL_POLES && matchOf(row) !== null && (
              <span
                className={`chip is-choice ${
                  matchOf(row) === 'responsable' ? 'is-responsable'
                  : matchOf(row) === 0 || plan.poleChoicesRanked === false ? 'is-choix1' : 'is-choix2'
                }`}
                title={
                  matchOf(row) === 'responsable'
                    ? 'Responsable de ce pôle'
                    : plan.poleChoicesRanked === false
                      ? 'Ce pôle fait partie de ses choix'
                      : `Ce pôle est son ${matchWord(matchOf(row)!, true)}`
                }
              >
                {matchWord(matchOf(row)!, plan.poleChoicesRanked !== false)}
              </span>
            )}
            <span className="pool-item-meta">{row.meta}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** What an empty list says, which is never just "vide": it says why it is empty. */
function emptyWord(tab: PanelTab, isPhase: boolean, kind: PersonKind | typeof ALL_KINDS): string {
  if (tab === 'attente') return "Personne en liste d'attente.";
  // The kind comes first, and on the exploit too since its list gained the orgas: "tout le monde a
  // déjà le volume proposé" is a sentence about bénévoles, and reading it under "Orgas" would say
  // an orga had a volume.
  if (kind === 'orga') return 'Aucun orga à placer ici.';
  if (kind === 'benevole') return 'Aucun bénévole à placer ici.';
  if (!isPhase) return 'Tout le monde a déjà le volume proposé.';
  return 'Tout le monde est placé sur cette période.';
}
