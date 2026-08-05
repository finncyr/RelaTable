import type { Prisma } from '@prisma/client';
import { db } from './db';

/** Either the shared client or a transaction client — both expose `location`. */
type LocationClient = Pick<Prisma.TransactionClient, 'location'>;

// Offline coordinate table for common German-speaking cities so the map works
// without an online geocoder (DEC-012 — city/region precision is enough).
const CITY_COORDS: Record<string, [number, number]> = {
	berlin: [52.52, 13.405],
	hamburg: [53.5511, 9.9937],
	münchen: [48.1351, 11.582],
	muenchen: [48.1351, 11.582],
	munich: [48.1351, 11.582],
	köln: [50.9375, 6.9603],
	koeln: [50.9375, 6.9603],
	frankfurt: [50.1109, 8.6821],
	leipzig: [51.3397, 12.3731],
	stuttgart: [48.7758, 9.1829],
	dresden: [51.0504, 13.7373],
	düsseldorf: [51.2277, 6.7735],
	duesseldorf: [51.2277, 6.7735],
	hannover: [52.3759, 9.732],
	nürnberg: [49.4521, 11.0767],
	nuernberg: [49.4521, 11.0767],
	bremen: [53.0793, 8.8017],
	wien: [48.2082, 16.3738],
	zürich: [47.3769, 8.5417],
	zuerich: [47.3769, 8.5417],
	wiesbaden: [50.0782, 8.24],
	mainz: [50.0, 8.2711],
	essen: [51.4556, 7.0116],
	dortmund: [51.5136, 7.4653],
	bonn: [50.7374, 7.0982],
	mannheim: [49.4875, 8.466],
	karlsruhe: [49.0069, 8.4037],
	augsburg: [48.3705, 10.8978],
	wiesloch: [49.2955, 8.6935],
	münster: [51.9607, 7.6261],
	muenster: [51.9607, 7.6261],
	gelsenkirchen: [51.5177, 7.0857],
	mönchengladbach: [51.1805, 6.4428],
	moenchengladbach: [51.1805, 6.4428],
	braunschweig: [52.2689, 10.5268],
	chemnitz: [50.8278, 12.9214],
	kiel: [54.3233, 10.1228],
	aachen: [50.7753, 6.0839],
	halle: [51.4964, 11.9688],
	magdeburg: [52.1205, 11.6276],
	freiburg: [47.999, 7.8421],
	krefeld: [51.3388, 6.5853],
	lübeck: [53.8655, 10.6866],
	luebeck: [53.8655, 10.6866],
	oberhausen: [51.4963, 6.8638],
	erfurt: [50.9848, 11.0299],
	rostock: [54.0887, 12.1401],
	kassel: [51.3127, 9.4797],
	saarbrücken: [49.2401, 6.9969],
	saarbruecken: [49.2401, 6.9969],
	potsdam: [52.3906, 13.0645],
	ludwigshafen: [49.4811, 8.4353],
	oldenburg: [53.1435, 8.2146],
	darmstadt: [49.8728, 8.6512],
	heidelberg: [49.3988, 8.6724],
	regensburg: [49.0134, 12.1016],
	würzburg: [49.7913, 9.9534],
	wuerzburg: [49.7913, 9.9534],
	ulm: [48.4011, 9.9876],
	ingolstadt: [48.7665, 11.4257],
	offenbach: [50.1055, 8.7761],
	salzgitter: [52.1508, 10.335],
	fürth: [49.4783, 10.9903],
	fuerth: [49.4783, 10.9903],
	trier: [49.7596, 6.6441],
	göttingen: [51.5413, 9.9158],
	goettingen: [51.5413, 9.9158],
	reutlingen: [48.4914, 9.2043],
	koblenz: [50.3569, 7.5886],
	bremerhaven: [53.5396, 8.5809],
	jena: [50.9271, 11.5892],
	graz: [47.0707, 15.4395],
	linz: [48.3069, 14.2858],
	salzburg: [47.8095, 13.055],
	innsbruck: [47.2692, 11.4041],
	basel: [47.5596, 7.5886],
	genf: [46.2044, 6.1432],
	geneve: [46.2044, 6.1432],
	bern: [46.948, 7.4474],
	lausanne: [46.5197, 6.6323],
	luzern: [47.0502, 8.3093]
};

export function coordsFor(city: string): [number, number] | null {
	const k = city.trim().toLowerCase();
	// Exact match, else first token so "Frankfurt am Main" / "Berlin, DE" resolve to the base city.
	return CITY_COORDS[k] ?? CITY_COORDS[k.split(/[\s,]/)[0]] ?? null;
}

// Online fallback for every city not in the offline table above, via the same OSM data the map
// already renders. No API key needed; Nominatim just wants an identifying User-Agent.
async function geocodeOnline(city: string): Promise<[number, number] | null> {
	try {
		const res = await fetch(
			`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
			{ headers: { 'User-Agent': 'RelaTable (personal relationship tracker, self-hosted)' } }
		);
		if (!res.ok) return null;
		const [hit] = (await res.json()) as { lat: string; lon: string }[];
		return hit ? [parseFloat(hit.lat), parseFloat(hit.lon)] : null;
	} catch {
		// ponytail: offline / Nominatim down → no coords, not a hard failure. Upgrade: retry queue.
		return null;
	}
}

async function resolveCoords(city: string): Promise<[number, number] | null> {
	return coordsFor(city) ?? (await geocodeOnline(city));
}

/**
 * Find an existing Location by displayName (city) or create one, attaching coords if known.
 * Pass a transaction client to keep the write inside an enclosing transaction (JSON import preview).
 */
export async function findOrCreateLocation(cityRaw: string, client: LocationClient = db): Promise<number | null> {
	const city = cityRaw.trim();
	if (!city) return null;
	const existing = await client.location.findFirst({ where: { displayName: city } });
	if (existing) return existing.id;
	const c = await resolveCoords(city);
	const loc = await client.location.create({
		data: {
			displayName: city,
			city,
			country: null,
			latitude: c?.[0] ?? null,
			longitude: c?.[1] ?? null,
			precision: 'city'
		}
	});
	return loc.id;
}
