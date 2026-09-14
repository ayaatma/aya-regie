/**
 * The pool pane: who is still to place, who is held back, and which fiches are still to proofread.
 *
 * ONE PANE FOR THE THREE MOMENTS, since 2026-09-11, and the same three tabs in each. The exploit
 * had `SidePanel` and the two phases had `PhasePool`, and they agreed on nothing: different tabs,
 * different markup, different words for the same idea, and only one of the two had any CSS at all,
 * so the montage's panel was raw browser defaults stacked in a column. The régisseur asked for one
 * panel, and one panel is also the only way the two stay the same next month.
 *
 * WHAT DIFFERS BETWEEN THE MOMENTS IS THE CONTENT OF ONE TAB. "Disponibles" means "has hours
 * nobody has used yet", which on the exploit is the volume they asked for and on a phase is the
 * presence they declared. "Réserve" and "À relire" are facts about people rather than about a
 * moment, so they read the same everywhere.
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

import type { PersonKind, PhaseId } from '../engine.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { DRAG_MIME, DRAG_MIME_ORGA, type DragPayload } from './drag.ts';
import { PersonMark } from './PersonMark.tsx';
import { volumeText } from './layout.ts';
import { exploitPoolRows, phasePoolRows, poleMatchOf, type PoleMatch, type PoolRow } from './poolRows.ts';
import { sameSelection, type Selection } from './selection.ts';

export type PanelTab = 'disponibles' | 'reserve' | 'relecture';

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
  /** Dropping a box on "Réserve" makes it a deliberate zero. Exploit only. */
  onDropReserve?(): void;
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
    onDropReserve,
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

  /** The reserve: zero hours on the exploit, deliberately. A fact about a person, shown anywhere. */
  const reserved = useMemo(
    () =>
      report.volunteers
        .filter((v) => v.reserve)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map(
          (entry): PoolRow => ({
            id: entry.key,
            personKey: entry.key,
            kind: 'benevole',
            selection: { kind: 'benevole', volunteerKey: entry.key },
            name: entry.name,
            meta: `${volumeText(entry.requestedHours, index.dayMode)} proposées`,
            zero: true,
            review: index.volunteerByKey.get(entry.key)?.needsReview === true,
            title: `${entry.name}\nEn réserve: zéro heure, volontairement.`,
          }),
        ),
    [report.volunteers, index],
  );

  /*
   * The review queue: every fiche the importer was not sure about.
   *
   * Sorted by name rather than by how many doubts each carries, because this list is walked from
   * top to bottom until it is empty, and a list that reorders itself as fiches leave it is a list
   * somebody loses their place in.
   */
  const toReview = useMemo(
    () =>
      report.volunteers
        .filter((entry) => index.volunteerByKey.get(entry.key)?.needsReview === true)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map((entry): PoolRow => {
          const doubts = index.volunteerByKey.get(entry.key)?.reviewReasons.length ?? 0;
          return {
            id: entry.key,
            personKey: entry.key,
            kind: 'benevole',
            selection: { kind: 'benevole', volunteerKey: entry.key },
            name: entry.name,
            meta: `${doubts} doute${doubts > 1 ? 's' : ''}`,
            zero: false,
            review: true,
            title: `${entry.name}\nUne réponse en texte libre a été interprétée sans certitude.`,
          };
        }),
    [report.volunteers, index],
  );

  /*
   * The two drops this panel accepts, and what each tab means as a target.
   *
   * "Disponibles" took over from the tab that used to be called "À zéro": dropping a box there
   * unplaces the person, which is exactly what putting them back in the pool of available people
   * means. It works on the three moments since 2026-09-12; the screen decides what "unplace"
   * means, since a créneau and a phase box are not removed the same way.
   *
   * "Réserve" stays the exploit's, and only the exploit's: it means zero hours on the event, and
   * a phase has no such decision to offer. The `onDropReserve` callback being absent is what says
   * so, so there is no second rule here to contradict the first.
   */
  const acceptDrop = (event: React.DragEvent): boolean => {
    if (readOnly || !event.dataTransfer.types.includes(DRAG_MIME)) return false;
    // The review queue is a list of fiches to read, not a place to put a person: dropping
    // somebody on it would be an edit nobody asked for.
    //
    // The reserve refuses an orga outright rather than accepting the drop and doing nothing. It
    // means "zéro heure sur l'exploit, volontairement", which is a decision about a volume, and an
    // orga has none: there is nothing for them to give up.
    if (tab === 'reserve') {
      return onDropReserve !== undefined && !event.dataTransfer.types.includes(DRAG_MIME_ORGA);
    }
    return tab === 'disponibles' && onDropUnassign !== undefined;
  };

  const rows = tab === 'disponibles' ? available : tab === 'reserve' ? reserved : toReview;

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button
          className="panel-tab"
          aria-current={tab === 'disponibles'}
          onClick={() => onTabChange('disponibles')}
          title={
            isPhase
              ? 'Les personnes sur place dont il reste des heures à placer'
              : 'Tout le monde à qui il reste des heures à donner'
          }
        >
          Disponibles ({available.length})
        </button>
        <button
          className="panel-tab"
          aria-current={tab === 'reserve'}
          onClick={() => onTabChange('reserve')}
          title="Zéro heure sur l'exploit, volontairement"
        >
          Réserve ({reserved.length})
        </button>
        {/*
          Only there when there is something in it. An empty queue is not a job to do, and a
          permanent "À relire (0)" teaches the régisseur to ignore the number.
        */}
        {toReview.length > 0 && (
          <button
            className="panel-tab is-review"
            aria-current={tab === 'relecture'}
            onClick={() => onTabChange('relecture')}
            title="Fiches dont une réponse en texte libre a été interprétée sans certitude"
          >
            À relire ({toReview.length})
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
          if (tab === 'reserve') onDropReserve?.();
          else onDropUnassign?.();
        }}
      >
        {tab === 'disponibles' && (
          <>
            <p className="panel-sub">
              {isPhase
                ? "Les heures que ces personnes ont déclarées et que personne ne leur a encore attribuées. Glissez un nom sur un pôle: il prend les heures déclarées pour le jour visé. Déposez ici une case de la grille pour la retirer."
                : "Glissez un bénévole dans un créneau, ou déposez ici une case pour la retirer de son créneau. Un orga se glisse dans un créneau pour y tenir une place, ou sur la frise d'un pôle pour en devenir responsable pendant 2 h."}
            </p>

            {/*
              THE SAME FILTER IN THE THREE MOMENTS, since the exploit's list gained the orgas on
              2026-09-12. It was a phase-only control while the exploit knew bénévoles alone, and
              leaving it that way would have meant one list of two kinds of person with no way to
              ask for one of them. The day filter is NOT here: it belongs to the phase screen's
              toolbar, where it narrows the grid and this list at once. See `PoolPanelProps.day`.
            */}
            <div className="pool-filters">
              <label className="pool-filter">
                <span>Qui</span>
                <select
                  className="select"
                  value={kind}
                  aria-label="Filtrer par type de personne"
                  onChange={(event) => setKind(event.target.value as PersonKind | typeof ALL_KINDS)}
                >
                  <option value={ALL_KINDS}>Tout le monde</option>
                  <option value="orga">Orgas</option>
                  <option value="benevole">Bénévoles</option>
                </select>
              </label>
              <label className="pool-filter">
                <span>Pôle demandé</span>
                <select
                  className="select"
                  value={poleKey}
                  aria-label="Filtrer par pôle demandé"
                  title="Les bénévoles dont c'est le choix 1 ou le choix 2, et les orgas qui en sont responsables"
                  onChange={(event) => setPoleKey(event.target.value)}
                >
                  <option value={ALL_POLES}>Tous les pôles</option>
                  {poles.map((pole) => (
                    <option key={pole.key} value={pole.key}>
                      {pole.path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        {tab === 'reserve' && (
          <p className="panel-sub">
            {isPhase
              ? "La réserve est une décision de l'exploit: ces personnes n'y font aucune heure. Elles peuvent tout de même venir au montage si elles l'ont dit."
              : 'Déposez ici une personne pour la mettre en réserve: zéro heure, volontairement.'}
          </p>
        )}

        {tab === 'relecture' && (
          <p className="panel-sub">
            L'import a interprété une réponse écrite en toutes lettres sans en être sûr. Ouvrez
            chaque fiche, corrigez ce qui doit l'être, puis validez-la.
          </p>
        )}

        {rows.length === 0 && (
          <p className="pool-empty">
            {tab === 'disponibles' && poleKey !== ALL_POLES
              ? "Personne n'a demandé ce pôle parmi les personnes disponibles."
              : emptyWord(tab, isPhase, kind)}
          </p>
        )}

        {rows.map((row) => (
          <div
            key={row.id}
            className={
              'pool-item' +
              (row.review && tab === 'relecture' ? ' is-review' : '') +
              (sameSelection(selection, row.selection) ? ' is-picked' : '')
            }
            draggable={!readOnly && tab === 'disponibles'}
            title={row.title}
            onClick={() => onSelect(row.selection)}
            onDragStart={(event) => {
              if (readOnly || tab !== 'disponibles') return;
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
            {/* "À zéro" used to be a tab of its own. It is the same fact, said on the row. */}
            {row.zero && tab === 'disponibles' && (
              <span className="chip is-zero" title="Rien de placé pour l'instant">
                à zéro
              </span>
            )}
            {tab === 'disponibles' && poleKey !== ALL_POLES && matchOf(row) !== null && (
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
  if (tab === 'reserve') return 'La réserve est vide.';
  if (tab === 'relecture') return 'Plus rien à relire.';
  // The kind comes first, and on the exploit too since its list gained the orgas: "tout le monde a
  // déjà le volume proposé" is a sentence about bénévoles, and reading it under "Orgas" would say
  // an orga had a volume.
  if (kind === 'orga') return 'Aucun orga à placer ici.';
  if (kind === 'benevole') return 'Aucun bénévole à placer ici.';
  if (!isPhase) return 'Tout le monde a déjà le volume proposé.';
  return 'Tout le monde est placé sur cette période.';
}



