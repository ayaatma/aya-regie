/**
 * « Calculer automatiquement »: what a car journey costs, from the map and the event's rates.
 *
 * WHAT IS FETCHED AND WHAT IS NOT. The DISTANCE comes from the web: the two addresses are
 * geocoded by OpenStreetMap's Nominatim and the road distance between them asked of the public
 * OSRM router. Both are free, keyless and rate-limited, which is fine for a régisseur pricing a
 * dozen journeys and would not be for anything automatic. The PRICES do not come from the web:
 * a litre's price is the association's own figure, typed in Réglages (`Plan.travel`), because
 * the pump price on the day of the reimbursement is not something a tool should guess.
 *
 * The result is a figure the régisseur can overwrite, and a breakdown they can read: nothing
 * here is stored except what the fiche then writes into the trip.
 */

import type { CarTrip, TravelRates } from '../engine.ts';

export interface TripEstimate {
  distanceKm: number;
  fuelCost: number;
  tollCost: number;
  cost: number;
  /** "145 km · 6,5 L/100 km × 1,70 €/L = 16,02 € · péage 14,50 €", for the tooltip. */
  detail: string;
}

interface Point {
  lat: number;
  lon: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

async function geocode(address: string, fetcher: typeof fetch): Promise<Point> {
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const response = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`adresse introuvable (${response.status}): ${address}`);
  const rows = (await response.json()) as Array<{ lat: string; lon: string }>;
  const first = rows[0];
  if (!first) throw new Error(`adresse introuvable: ${address}`);
  return { lat: Number(first.lat), lon: Number(first.lon) };
}

async function roadKm(from: Point, to: Point, fetcher: typeof fetch): Promise<number> {
  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`itinéraire indisponible (${response.status})`);
  const body = (await response.json()) as { routes?: Array<{ distance: number }> };
  const metres = body.routes?.[0]?.distance;
  if (metres === undefined) throw new Error('itinéraire introuvable entre ces deux adresses');
  return Math.round(metres / 100) / 10;
}

const euro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

/** The cost from a known distance: the arithmetic alone, for the test and for a typed distance. */
export function priceTrip(trip: CarTrip, distanceKm: number, rates: TravelRates): TripEstimate {
  const unit = trip.fuel === 'electrique' ? 'kWh' : 'L';
  const price = rates.fuelPrices[trip.fuel];
  const fuelCost = Math.round((distanceKm / 100) * trip.consumptionPer100 * price * 100) / 100;
  const tollCost = trip.tolls ? Math.round(distanceKm * rates.tollPerKm * 100) / 100 : 0;
  const cost = Math.round((fuelCost + tollCost) * 100) / 100;
  const detail =
    `${distanceKm} km · ${String(trip.consumptionPer100).replace('.', ',')} ${unit}/100 km × ` +
    `${String(price).replace('.', ',')} €/${unit} = ${euro(fuelCost)}` +
    (trip.tolls ? ` · péage ${euro(tollCost)}` : ' · sans péage');
  return { distanceKm, fuelCost, tollCost, cost, detail };
}

/**
 * The whole estimate: geocode both ends, ask the road distance, price it.
 *
 * `venue` is the event's address, which "lieu de l'événement" on either end stands for; an
 * empty one is an error worth naming rather than a journey to nowhere.
 */
export async function estimateTrip(
  trip: CarTrip,
  venue: string,
  rates: TravelRates,
  fetcher: typeof fetch = fetch,
): Promise<TripEstimate> {
  const fromAddress = trip.fromVenue ? venue : trip.fromAddress;
  const toAddress = trip.toVenue ? venue : trip.toAddress;
  if (fromAddress.trim() === '' || toAddress.trim() === '') {
    throw new Error(
      (trip.fromVenue || trip.toVenue) && venue.trim() === ''
        ? "l'adresse de l'événement n'est pas renseignée dans Réglages"
        : 'il manque une adresse',
    );
  }
  const [from, to] = await Promise.all([geocode(fromAddress, fetcher), geocode(toAddress, fetcher)]);
  const distanceKm = await roadKm(from, to, fetcher);
  return priceTrip(trip, distanceKm, rates);
}
