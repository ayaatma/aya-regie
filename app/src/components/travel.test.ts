/**
 * « Calculer automatiquement »: the arithmetic on a known distance, and the two fetches on a
 * fake network. Nothing here touches the web.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_TRAVEL_RATES, makeCarTrip } from '../engine.ts';
import { estimateTrip, priceTrip } from './travel.ts';

test('a trip is priced from its distance, the consumption, the fuel price and the toll', () => {
  const trip = makeCarTrip({ key: 't', fuel: 'diesel', consumptionPer100: 6.5, tolls: true });
  const rates = { fuelPrices: { ...DEFAULT_TRAVEL_RATES.fuelPrices, diesel: 1.7 }, tollPerKm: 0.1 };
  const estimate = priceTrip(trip, 145, rates);
  // 1.45 × 6.5 × 1.70 = 16.02; toll 14.50.
  assert.equal(estimate.fuelCost, 16.02);
  assert.equal(estimate.tollCost, 14.5);
  assert.equal(estimate.cost, 30.52);
  assert.ok(estimate.detail.includes('145 km') && estimate.detail.includes('péage 14,50 €'));

  const free = priceTrip({ ...trip, tolls: false, fuel: 'electrique', consumptionPer100: 15 }, 100, rates);
  assert.equal(free.tollCost, 0);
  assert.equal(free.fuelCost, 15 * 0.22);
  assert.ok(free.detail.includes('kWh') && free.detail.includes('sans péage'));
});

test('the estimate geocodes both ends, asks the road distance, and names what is missing', async () => {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('nominatim')) {
      const q = decodeURIComponent(url.split('q=')[1]!);
      const point = q.startsWith('Lyon') ? { lat: '45.76', lon: '4.84' } : { lat: '45.90', lon: '6.13' };
      return new Response(JSON.stringify([point]), { status: 200 });
    }
    return new Response(JSON.stringify({ routes: [{ distance: 145_040 }] }), { status: 200 });
  }) as typeof fetch;

  const trip = makeCarTrip({ key: 't', fromAddress: 'Lyon', toVenue: true, fuel: 'diesel', consumptionPer100: 6.5 });
  const estimate = await estimateTrip(trip, '12 rue de la Salle, Annecy', DEFAULT_TRAVEL_RATES, fetcher);
  assert.equal(estimate.distanceKm, 145);
  assert.equal(calls.filter((u) => u.includes('nominatim')).length, 2);
  assert.ok(calls.some((u) => u.includes('router.project-osrm.org')));
  assert.ok(calls.some((u) => u.includes(encodeURIComponent('12 rue de la Salle, Annecy'))), "the venue stands for « lieu de l'événement »");

  await assert.rejects(
    () => estimateTrip(trip, '', DEFAULT_TRAVEL_RATES, fetcher),
    /adresse de l'événement/,
  );
  await assert.rejects(
    () => estimateTrip({ ...trip, fromAddress: '' }, 'Annecy', DEFAULT_TRAVEL_RATES, fetcher),
    /manque une adresse/,
  );
  const nowhere = (async () => new Response('[]', { status: 200 })) as typeof fetch;
  await assert.rejects(() => estimateTrip(trip, 'Annecy', DEFAULT_TRAVEL_RATES, nowhere), /introuvable/);
});
