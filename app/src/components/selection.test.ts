/**
 * What a selection is about, and who it is about.
 *
 * Tested on its own because it is what decides the RINGS on a grid: get it wrong and the
 * régisseur is told somebody is somewhere they are not. The rest of `selection.ts` is a type.
 *
 *   npm test    (in app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sameSelection, selectedPerson, selectedVolunteerKey } from './selection.ts';

const boxes = [
  { key: 'a1', personKind: 'orga', personKey: 'o1' },
  { key: 'a2', personKind: 'orga', personKey: 'o1' },
  { key: 'a3', personKind: 'benevole', personKey: 'v7' },
];

test('a box says who is in it, so the rest of that person lights up with it', () => {
  assert.deepEqual(selectedPerson({ kind: 'case', phaseId: 'montage', assignmentKey: 'a2' }, boxes), {
    kind: 'orga',
    key: 'o1',
  });
});

test('somebody picked out of a list is the same answer, which is why the rings agree', () => {
  assert.deepEqual(selectedPerson({ kind: 'orga', organiserKey: 'o1' }, boxes), {
    kind: 'orga',
    key: 'o1',
  });
  assert.deepEqual(selectedPerson({ kind: 'benevole', volunteerKey: 'v7' }, boxes), {
    kind: 'benevole',
    key: 'v7',
  });
});

test('a bénévole and an orga sharing a key are not the same person', () => {
  // Two files, two key spaces: nothing stops `o1` existing in both. Comparing the key alone
  // would ring a volunteer's boxes because an orga was selected.
  const same = [{ key: 'a9', personKind: 'benevole', personKey: 'o1' }];
  const who = selectedPerson({ kind: 'orga', organiserKey: 'o1' }, same);
  assert.equal(who!.kind, 'orga');
  assert.notEqual(who!.kind, same[0]!.personKind);
});

test('a créneau, an événement, a box that is gone and nothing at all are about nobody', () => {
  assert.equal(selectedPerson(null, boxes), null);
  assert.equal(selectedPerson({ kind: 'creneau', shiftKey: 's1', fill: false }, boxes), null);
  assert.equal(
    selectedPerson({ kind: 'evenement', phaseId: 'montage', eventKey: 'e1', fill: false }, boxes),
    null,
  );
  // A box deleted under the selection: nobody, rather than a stale name.
  assert.equal(
    selectedPerson({ kind: 'case', phaseId: 'montage', assignmentKey: 'parti' }, boxes),
    null,
  );
});

test('the exploit still reads only a bénévole out of a selection', () => {
  assert.equal(selectedVolunteerKey({ kind: 'benevole', volunteerKey: 'v7' }), 'v7');
  assert.equal(selectedVolunteerKey({ kind: 'orga', organiserKey: 'o1' }), null);
  assert.equal(sameSelection({ kind: 'orga', organiserKey: 'o1' }, { kind: 'orga', organiserKey: 'o1' }), true);
});
