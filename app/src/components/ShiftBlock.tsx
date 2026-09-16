/**
 * One shift on the grid, drawn as one box per volunteer needed.
 *
 * This is the mental model the whole screen is built on, stated 2026-09-07: a shift needing 5
 * people draws 5 boxes and each box holds one person. It is also exactly what an `Assignment`
 * row is, so nothing has to be translated between what is on screen and what is stored.
 *
 * A shift carrying more people than its headcount draws every one of them. The extra box reads
 * as `sureffectif` in red, which is the point: the tool shows the overflow, it never hides a
 * person to make a figure look right.
 *
 * THE COLOURS, and what each one is allowed to mean.
 *
 *   Red belongs to one box, never to a person. It means this volunteer, on this shift, breaks a
 *   rule. Somebody placed during a set they asked not to miss has a problem with that evening
 *   shift; their afternoon box stays plain, because there is nothing wrong with it. The engine
 *   attributes issues down to the box so this screen never has to guess.
 *
 *   A problem with the shift's composition is drawn on the shift, not on its people. Nothing but
 *   débutants is one shift missing an experienced pair of hands, not five faulty volunteers.
 *
 *   A missing person is not red. An unstaffed shift is a gap in the plan, not an illegal one,
 *   and the dashed "à pourvoir" boxes already say so. Spending red on it would leave nothing
 *   to say "this is against the rules".
 *
 *   A long day, 6 h or 8 h, IS NOT A COLOUR AT ALL SINCE 2026-09-12. It was a three-pixel orange
 *   stripe down the left edge of the box, in two shades, and it asked the eye to tell four colour
 *   codes apart on a surface that is already tinted by pole. It is an emoji beside the name now,
 *   which is a label and cannot be confused with an alarm. See `volumeMark`.
 *
 *   The pole colour tints the block, so a glance down the grid reads as places.
 */

import { memo } from 'react';

import {
  SHIFT_SCOPED,
  TIER2,
  fmtHours,
  type ShiftReport,
  type Shift,
  type VolunteerColour,
} from '../engine.ts';
import { DRAG_MIME, type DragPayload } from './drag.ts';
import { PersonMark } from './PersonMark.tsx';
import { BOX_GAP, BOX_H, levelLabel, starsFor, volumeLabel, volumeMark } from './layout.ts';

export type VolumeBand = Exclude<VolunteerColour, 'rouge'>;

export interface ShiftBlockProps {
  shift: Shift;
  report: ShiftReport;
  left: number;
  width: number;
  /** `#rrggbb` for this shift's pole. */
  poleColour: string;
  /** `volunteerKey|shiftKey` for every locked assignment in the plan. */
  lockedKeys: ReadonlySet<string>;
  /** The 6 h / 8 h band per volunteer, from validate(). Never recomputed here. */
  volumeBands: ReadonlyMap<string, VolumeBand>;
  selectedVolunteerKey: string | null;
  /** People the selected volunteer asked to work with. Highlighted in the buddy colour. */
  buddyKeys: ReadonlySet<string>;
  /** The selected volunteer's teammates, when the event works in teams. Ringed dashed. */
  teammateKeys?: ReadonlySet<string>;
  /** True while something is being dragged, whatever it is. */
  dragActive: boolean;
  /** Whether the dragged person may legally take a place here, per the engine. */
  legalTarget: boolean;
  draggingKey: string | null;
  isDropShift: boolean;
  /** The occupied box under the pointer, when it is one of this shift's. */
  dropBoxVolunteerKey: string | null;
  /** Which row the arrow keys are standing on, when the cursor is in this shift. */
  cursorIndex: number | null;
  onSelect(volunteerKey: string | null): void;
  /** Clicking a box also moves the keyboard cursor there, so the two never disagree. */
  onFocusBox(shiftKey: string, index: number): void;
  onToggleLock(volunteerKey: string, shiftKey: string): void;
  onDragStartBox(payload: DragPayload, event: React.DragEvent): void;
  /** Draws the boxes with nothing that moves them. See `GridScreenProps.readOnly`. */
  readOnly?: boolean;
  onDragEndBox(): void;
  onDropOnShift(shiftKey: string): void;
  onDropOnBox(volunteerKey: string, shiftKey: string): void;
  onEnterShift(shiftKey: string | null): void;
  onEnterBox(key: string | null): void;
  /** The créneau whose own description is open in the info pane, so it can be outlined. */
  selectedShiftKey: string | null;
  /**
   * The créneau itself was clicked, rather than one of the people in it.
   *
   * `fill` says it was one of its places to fill: the panel then also offers who to put there,
   * which is where the floating orga picker went. A click on the créneau's background is the
   * other way in, and it is how "what is this créneau, who is in it, what is wrong with it" gets
   * answered without a tooltip.
   */
  onSelectShift(shiftKey: string, fill: boolean): void;
  /**
   * An orga standing in this créneau was clicked.
   *
   * Orgas are drawn here because they take a place, and only because of that: they carry no
   * level, no volume and no signalement, so their rows are plain. Everything else about them
   * lives on their fiche, which this opens. See `OrganiserShift`.
   */
  onSelectOrga(organiserKey: string): void;
  onRemoveOrga(organiserKey: string, shiftKey: string): void;
  /**
   * Orgas in this créneau who are responsable of a pole that wants its responsable in support.
   *
   * Orange and never red, and never a refusal: the pole says the two jobs do not fit in one pair
   * of hands (`Pole.leaderSupportOnly`), and the régisseur may nonetheless have decided this on
   * the night. Computed once for the plan by `PlanIndex.supportOnlyBreaches` and handed down, so
   * this component holds no opinion of its own about it.
   */
  supportOnlyOrgaKeys?: ReadonlySet<string>;
  /**
   * Which row each place of this créneau holds, computed over the whole pole's lane.
   *
   * WHY IT COMES FROM OUTSIDE. Somebody working two créneaux in a row has to be drawn on the
   * same row in both, and this component sees one créneau: the question belongs to the lane.
   * See `laneRows`. Absent means the old behaviour, everybody in report order.
   */
  slots?: ReadonlyArray<string | null>;
}

function ShiftBlockImpl(props: ShiftBlockProps) {
  const {
    shift,
    report,
    left,
    width,
    poleColour,
    lockedKeys,
    volumeBands,
    selectedVolunteerKey,
    buddyKeys,
    teammateKeys,
    dragActive,
    legalTarget,
    draggingKey,
    isDropShift,
    dropBoxVolunteerKey,
    cursorIndex,
    onSelect,
    onFocusBox,
    onToggleLock,
    onDragStartBox,
    readOnly = false,
    onDragEndBox,
    onDropOnShift,
    onDropOnBox,
    onEnterShift,
    onEnterBox,
    selectedShiftKey,
    onSelectShift,
    onSelectOrga,
    onRemoveOrga,
    supportOnlyOrgaKeys,
    slots,
  } = props;

  /*
   * A problem with the shift itself is drawn on the shift, not on the people standing in it.
   *
   * A créneau of nothing but débutants is not five faulty volunteers, it is one shift missing an
   * experienced pair of hands, and outlining five boxes would say the opposite. Red for illegal,
   * dashed orange for a tier 2 problem, matching the box legend exactly.
   *
   * ONLY `SHIFT_SCOPED` CODES COUNT HERE, and that filter is the whole point. `report.issues`
   * carries every issue that names this shift, a person's own signalements included, so a single
   * volunteer with a contrariety used to put a dashed orange border around the whole créneau: it
   * said "something is wrong with this shift" when the shift was fine and one box already said
   * so itself. What is left is the composition: nothing but débutants, not enough experience, a
   * shift too long, and the tier 1 sureffectif.
   *
   * Being short of people is neither: the dashed "à pourvoir" boxes already say it, which is why
   * the two vide / incomplet codes drop out even though they are shift-scoped.
   */
  const shiftIssues = report.issues.filter(
    (issue) =>
      SHIFT_SCOPED.has(issue.code) &&
      issue.code !== TIER2.creneauVide &&
      issue.code !== TIER2.creneauIncomplet,
  );

  const illegalShift = shiftIssues.some((issue) => issue.tier === 1);
  const warnedShift = !illegalShift && shiftIssues.length > 0;

  const className = [
    'shift',
    isDropShift ? 'is-target' : '',
    dragActive && !legalTarget ? 'is-illegal' : '',
    illegalShift ? 'is-flagged' : '',
    warnedShift ? 'is-warned' : '',
    shift.key === selectedShiftKey ? 'is-picked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * The places of this créneau, top to bottom.
   *
   * A key is somebody standing there, null is a place to fill. Built from the lane's layout when
   * it has one, so that two créneaux in a row keep their people on the same lines.
   */
  const places: ReadonlyArray<string | null> =
    slots ??
    [
      ...report.stars.map((entry) => entry.volunteerKey),
      ...Array.from({ length: report.missing }, () => null),
    ];

  const height =
    Math.max(shift.headcount, places.length + report.orgas.length) * (BOX_H + BOX_GAP);

  // The headcount lives in the tooltip now that the counter strip is gone, along with whatever
  // is wrong with the shift, so the border always has its explanation one hover away.
  return (
    <div
      className={className}
      style={{ left, width, height, '--pole': poleColour } as React.CSSProperties}
      title={
        `${report.polePath}\n${report.label}\n` +
        `${fmtHours(shift.end - shift.start)}, ${report.assigned} sur ${shift.headcount}` +
        shiftIssues.map((issue) => `\n${issue.message}`).join('')
      }
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
        // Stopping here is what makes the grid's own background a bin: everything that is a real
        // target swallows the event, so whatever reaches the scroll container landed on nothing.
        event.stopPropagation();
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => onEnterShift(shift.key)}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
        event.stopPropagation();
        event.preventDefault();
        onDropOnShift(shift.key);
      }}
      // A click on the créneau's own background, between or beside its boxes. Every box inside
      // stops the event, so this only ever fires for the créneau itself.
      onClick={() => onSelectShift(shift.key, false)}
    >
      {/*
        The orgas first, above the volunteers. They are the places already held: reading the
        créneau top to bottom then says "these two are covered by orgas, this one is still to
        fill", which is the order the régisseur decides in.
      */}
      {report.orgas.map((orga) => {
        const inSupport = supportOnlyOrgaKeys?.has(orga.key) === true;
        return (
        <div
          key={`orga-${orga.key}`}
          className={`box is-orga-box${inSupport ? ' is-warned' : ''}`}
          role="button"
          // Draggable since 2026-09-12, like a volunteer's box: an orga put on the wrong créneau
          // was removed with the ✕ and placed again from the list, which is two gestures for what
          // reads as one. Never locked: a place held by an orga carries no padlock.
          draggable={!readOnly}
          title={
            `${orga.name}\nOrga, placé·e à la main. Ne compte dans aucune règle d'heures.` +
            (inSupport
              ? "\nCe pôle attend son responsable en support, sans créneau. Rien n'a été retiré."
              : '') +
            '\nCliquer pour voir sa fiche, glisser pour changer de créneau'
          }
          onClick={(event) => {
            event.stopPropagation();
            onSelectOrga(orga.key);
          }}
          onDragStart={(event) => {
            event.stopPropagation();
            onDragStartBox(
              {
                kind: 'orga',
                personKey: orga.key,
                personName: orga.name,
                fromShiftKey: shift.key,
              },
              event,
            );
          }}
          onDragEnd={onDragEndBox}
        >
          <span className="box-name">
            <PersonMark kind="orga" />
            {orga.short}
          </span>
          {!readOnly && (
            <span
              className="box-lock is-button"
              role="button"
              tabIndex={-1}
              title="Retirer cet orga du créneau"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveOrga(orga.key, shift.key);
              }}
            >
              ✕
            </span>
          )}
        </div>
        );
      })}

      {places.map((who, place) => {
        if (who === null) {
          return (
            <div
              key={`vide-${place}`}
              className="box is-empty"
              // A place to fill is also the place an orga is put: one click, on the hole itself.
              // Empty boxes are not drop targets, so the click costs nothing that existed before.
              role={readOnly ? undefined : 'button'}
              title={readOnly ? undefined : 'À pourvoir. Cliquer pour y mettre un orga.'}
              onClick={
                readOnly
                  ? undefined
                  : (event) => {
                      event.stopPropagation();
                      onSelectShift(shift.key, true);
                    }
              }
            >
              Vide
            </div>
          );
        }

        const entry = report.stars.find((star) => star.volunteerKey === who);
        if (!entry) return null;
        /*
         * The cursor and the keyboard walk the report's own order, not the drawn order: the two
         * would otherwise disagree the moment a place is left empty in the middle of a créneau.
         */
        const row = report.stars.indexOf(entry);
        const boxKey = `${entry.volunteerKey}|${shift.key}`;
        const locked = lockedKeys.has(boxKey);
        const band = volumeBands.get(entry.volunteerKey) ?? 'aucune';
        const selected = entry.volunteerKey === selectedVolunteerKey;
        // The one box that was actually picked, as opposed to the same person's other boxes. The
        // cursor and the selection are kept in step by GridScreen (clicking a box moves the cursor
        // there, moving the cursor selects whoever stands in it), so this is exactly one box.
        const picked = selected && row === cursorIndex;
        const buddy = !selected && buddyKeys.has(entry.volunteerKey);
        const teammate = !selected && !buddy && (teammateKeys?.has(entry.volunteerKey) ?? false);
        const stars = starsFor(entry.level);

        // Attributed by the engine to this box and no other, so a problem on somebody's evening
        // shift leaves their afternoon box alone.
        const illegal = entry.issues.some((issue) => issue.tier === 1);
        const warned = !illegal && entry.issues.length > 0;

        const boxClass = [
          'box',
          locked ? 'is-locked' : '',
          illegal ? 'is-illegal' : '',
          warned ? 'is-warned' : '',
          selected ? 'is-kin' : '',
          picked ? 'is-picked' : '',
          buddy ? 'is-buddy' : '',
          teammate ? 'is-teammate' : '',
          entry.volunteerKey === draggingKey ? 'is-dragging' : '',
          entry.volunteerKey === dropBoxVolunteerKey ? 'is-swap-target' : '',
          // No colour of its own: the cursor box is the picked box, which is already blue. The
          // class is only what GridScreen scrolls into view when the keys move the cursor away.
          row === cursorIndex ? 'is-cursor' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const bandNote = band === 'aucune' ? '' : `\n${volumeLabel(band)}`;
        const issueNote = entry.issues.map((issue) => `\n${issue.message}`).join('');
        const buddyNote = buddy ? '\nBinôme demandé avec la personne sélectionnée' : '';

        return (
          <div
            key={boxKey}
            className={boxClass}
            draggable={!locked && !readOnly}
            title={`${entry.name}\n${levelLabel(entry.level)}${locked ? '\nVerrouillé' : ''}${bandNote}${buddyNote}${issueNote}`}
            // Clicking a box selects the person, and clicking them again leaves them selected: a
            // second look at somebody is not a request to stop looking. Letting go is done on the
            // grid's own background, or with Échap.
            onClick={(event) => {
              // The créneau underneath is selectable too, so a click on a person has to stop
              // here or it would be read as a click on the créneau a moment later.
              event.stopPropagation();
              onFocusBox(shift.key, row);
              onSelect(entry.volunteerKey);
            }}
            onDragStart={(event) =>
              onDragStartBox(
                {
                  kind: 'benevole',
                  personKey: entry.volunteerKey,
                  personName: entry.name,
                  fromShiftKey: shift.key,
                  locked,
                },
                event,
              )
            }
            onDragEnd={onDragEndBox}
            onDragEnter={(event) => {
              event.stopPropagation();
              onEnterBox(boxKey);
            }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
              // A pinned box is not an exchange target either, since an exchange would move it.
              // Letting the event through means the drop lands on the shift instead, which is
              // an ordinary placement and leaves the pinned person alone.
              if (locked) return;
              // Stopping here is what makes a drop onto an occupied box an exchange rather than
              // one more person crammed into the shift underneath.
              event.stopPropagation();
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_MIME) || locked) return;
              event.stopPropagation();
              event.preventDefault();
              onDropOnBox(entry.volunteerKey, shift.key);
            }}
          >
            <span className="box-name">{entry.short}</span>
            {/*
              A long day is a glyph and no longer an orange stripe. See `volumeMark`: the grid
              already spends red on "illegal" and blue on "selected", and two more oranges three
              pixels wide asked the eye to tell four colour codes apart.
            */}
            {band !== 'aucune' && (
              <span className="box-volume" title={volumeLabel(band)}>
                {volumeMark(band)}
              </span>
            )}
            {stars && <span className="box-stars">{stars}</span>}
            {/*
              A reader still sees that a place is pinned, because that is information about the
              plan, but is offered no way to change it. Under `readOnly` the padlock is drawn
              only when it is closed: an open padlock that does nothing reads as a broken button,
              while its absence reads as "nothing to say here", which is the truth.
            */}
            {readOnly ? (
              locked && (
                <span className="box-lock" title="Place verrouillée">
                  🔒
                </span>
              )
            ) : (
              <span
                className={`box-lock ${locked ? '' : 'is-button'}`}
                role="button"
                tabIndex={-1}
                title={locked ? 'Déverrouiller cette place' : 'Verrouiller cette place'}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLock(entry.volunteerKey, shift.key);
                }}
              >
                {locked ? '🔒' : '🔓'}
              </span>
            )}
          </div>
        );
      })}

    </div>
  );
}

export const ShiftBlock = memo(ShiftBlockImpl);
