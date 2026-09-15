/**
 * Le Magasin, 2026-09-15: the equipment of the event and where each piece is. Plain records the
 * régisseur keeps; nothing reads them to plan anything.
 */

import type { EquipmentItem, Plan } from '../engine.ts';

function nextKey(plan: Plan): string {
  const taken = new Set(plan.equipment.map((e) => e.key));
  let n = plan.equipment.length + 1;
  while (taken.has(`materiel-${n}`)) n++;
  return `materiel-${n}`;
}

export function addEquipment(plan: Plan, over: Partial<Omit<EquipmentItem, 'key'>> = {}): Plan {
  const item: EquipmentItem = {
    key: nextKey(plan),
    name: '',
    quantity: 1,
    lender: '',
    lenderKind: null,
    lenderKey: null,
    status: 'stock',
    holder: '',
    note: '',
    ...over,
  };
  return { ...plan, equipment: [...plan.equipment, item] };
}

export function setEquipment(plan: Plan, key: string, over: Partial<Omit<EquipmentItem, 'key'>>): Plan {
  return { ...plan, equipment: plan.equipment.map((e) => (e.key === key ? { ...e, ...over } : e)) };
}

export function removeEquipment(plan: Plan, key: string): Plan {
  return { ...plan, equipment: plan.equipment.filter((e) => e.key !== key) };
}

/**
 * What a bénévole offered on the form, turned into an expected item lent by them. The sentence is
 * the name until somebody tidies it, which is the honest starting point: it is what they wrote.
 */
export function equipmentFromOffer(plan: Plan, volunteerKey: string): Plan {
  const v = plan.volunteers.find((x) => x.key === volunteerKey);
  const offer = (v?.equipmentNote ?? '').trim();
  if (!v || offer === '') return plan;
  return addEquipment(plan, {
    name: offer,
    lender: `${v.firstName} ${v.lastName}`.trim(),
    lenderKind: 'benevole',
    lenderKey: v.key,
    status: 'attendu',
  });
}
