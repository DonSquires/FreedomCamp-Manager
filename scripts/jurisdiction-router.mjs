/**
 * Bob's Geo-Router — Jurisdictional Handover Logic
 *
 * Determines the active NZ territorial authority (council) from a GPS coordinate
 * and returns the correct enforcement templates, bylaw rules, and notification text.
 *
 * Polygon boundaries are simplified bounding approximations derived from
 * LINZ Territorial Authority data (https://data.linz.govt.nz/).
 * For production, replace polygons with the full LINZ Shapefile GeoJSON export
 * from https://koordinates.com/layer/1110-nz-territorial-authorities/
 *
 * Point-in-polygon uses the Ray Casting algorithm (Jordan curve theorem).
 *
 * Usage:
 *   node scripts/jurisdiction-router.mjs <lat> <lng>
 *   node scripts/jurisdiction-router.mjs -36.8485 174.7633
 *
 *   Or import:
 *   import { getActiveJurisdiction } from './jurisdiction-router.mjs';
 *   const j = getActiveJurisdiction(-41.27, 173.28);
 */

// ---------------------------------------------------------------------------
// Point-in-polygon — Ray Casting (works for non-convex polygons)
// ---------------------------------------------------------------------------

/**
 * Returns true if [lat, lng] is inside the polygon.
 * polygon is an array of [lat, lng] pairs (last point need not repeat first).
 * @param {[number,number]} point
 * @param {[number,number][]} polygon
 * @returns {boolean}
 */
const isPointInPolygon = ([lat, lng], polygon) => {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

// ---------------------------------------------------------------------------
// Jurisdiction Registry
//
// Each entry:
//   name        – official council name
//   id          – slug used for template/rules paths
//   polygon     – simplified [lat, lng] boundary (clockwise)
//   noiseLimit  – dB threshold for RMA Excessive Noise Direction
//   staffRatio  – 1:N max public-to-officer ratio
//   seizureRule – immediate | 2h-notice | 24h-notice
//   bylaws      – short references Bob quotes in radio responses
// ---------------------------------------------------------------------------

const JURISDICTIONS = [
  {
    name: 'Auckland Council',
    id: 'auckland-council',
    // Approximate outer boundary of the Auckland region
    polygon: [
      [-36.2000, 174.1000],
      [-36.2000, 175.2000],
      [-37.2000, 175.2000],
      [-37.2000, 174.1000],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: '2h-notice',
    bylaws: {
      freedomCamping: 'Auckland Council Freedom Camping Bylaw 2015',
      noise: 'Auckland Council Noise Control Bylaw / RMA s327',
      camping: 'Auckland Council Public Places Bylaw 2015',
    },
  },
  {
    name: 'Wellington City Council',
    id: 'wellington-city',
    polygon: [
      [-41.1500, 174.6000],
      [-41.1500, 174.9500],
      [-41.4000, 174.9500],
      [-41.4000, 174.6000],
    ],
    noiseLimit: 70,
    staffRatio: 120,
    seizureRule: '2h-notice',
    bylaws: {
      freedomCamping: 'Wellington City Council Freedom Camping Bylaw 2021',
      noise: 'Wellington City Council Noise Control Policy / RMA s327',
      camping: 'Wellington City Council Public Places Bylaw',
    },
  },
  {
    name: 'Christchurch City Council',
    id: 'christchurch-city',
    polygon: [
      [-43.3500, 172.3500],
      [-43.3500, 172.8500],
      [-43.6500, 172.8500],
      [-43.6500, 172.3500],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: 'immediate',
    bylaws: {
      freedomCamping: 'Christchurch City Council Freedom Camping Bylaw 2012',
      noise: 'RMA s327 Excessive Noise Direction',
      camping: 'Christchurch City Council Public Places Bylaw',
    },
  },
  {
    name: 'Tasman District Council',
    id: 'tasman-dc',
    polygon: [
      [-40.5000, 172.1000],
      [-40.5000, 173.5000],
      [-41.7500, 173.5000],
      [-41.7500, 172.1000],
    ],
    noiseLimit: 80,
    staffRatio: 200,
    seizureRule: 'immediate',
    bylaws: {
      freedomCamping: 'Tasman District Council Freedom Camping Bylaw 2015',
      noise: 'Tasman District Council Excessive Noise Directions / RMA s327',
      camping: 'Tasman District Council Public Places Bylaw',
    },
  },
  {
    name: 'Nelson City Council',
    id: 'nelson-city',
    polygon: [
      [-41.1500, 173.1000],
      [-41.1500, 173.4000],
      [-41.4000, 173.4000],
      [-41.4000, 173.1000],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: '2h-notice',
    bylaws: {
      freedomCamping: 'Nelson City Council Freedom Camping Bylaw 2015',
      noise: 'RMA s327 Excessive Noise Direction',
      camping: 'Nelson City Council Public Places Bylaw',
    },
  },
  {
    name: 'Queenstown-Lakes District Council',
    id: 'queenstown-lakes',
    polygon: [
      [-44.0000, 168.0000],
      [-44.0000, 169.5000],
      [-45.5000, 169.5000],
      [-45.5000, 168.0000],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: '2h-notice',
    bylaws: {
      freedomCamping: 'Queenstown-Lakes District Council Freedom Camping Bylaw 2011',
      noise: 'RMA s327 Excessive Noise Direction',
      camping: 'Queenstown-Lakes District Council Public Places Bylaw',
    },
  },
  {
    name: 'Dunedin City Council',
    id: 'dunedin-city',
    polygon: [
      [-45.5000, 169.8000],
      [-45.5000, 170.8000],
      [-46.3000, 170.8000],
      [-46.3000, 169.8000],
    ],
    noiseLimit: 70,
    staffRatio: 150,
    seizureRule: '2h-notice',
    bylaws: {
      freedomCamping: 'Dunedin City Council Freedom Camping Bylaw 2015',
      noise: 'RMA s327 Excessive Noise Direction',
      camping: 'Dunedin City Council Public Places Bylaw',
    },
  },
  {
    name: 'Whangarei District Council',
    id: 'whangarei-dc',
    polygon: [
      [-35.5000, 173.6000],
      [-35.5000, 174.5000],
      [-36.3000, 174.5000],
      [-36.3000, 173.6000],
    ],
    noiseLimit: 80,
    staffRatio: 200,
    seizureRule: 'immediate',
    bylaws: {
      freedomCamping: 'Whangarei District Council Freedom Camping Bylaw 2012',
      noise: 'RMA s327 Excessive Noise Direction',
      camping: 'Whangarei District Council Public Places Bylaw',
    },
  },
];

// ---------------------------------------------------------------------------
// Fallback — used when no jurisdiction polygon matches
// ---------------------------------------------------------------------------

const GENERIC_JURISDICTION = {
  name: 'Generic / No Jurisdiction Detected',
  id: 'generic',
  noiseLimit: 80,
  staffRatio: 150,
  seizureRule: '2h-notice',
  bylaws: {
    freedomCamping: 'Freedom Camping Act 2011 (national baseline)',
    noise: 'RMA 1991 s327 (national baseline)',
    camping: 'Local Government Act 2002',
  },
};

// ---------------------------------------------------------------------------
// Core router
// ---------------------------------------------------------------------------

/**
 * Returns the active jurisdiction profile for the given GPS coordinate.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {{
 *   council: string,
 *   id: string,
 *   templatePath: string,
 *   rulesPath: string,
 *   noiseLimit: number,
 *   staffRatio: number,
 *   seizureRule: string,
 *   bylaws: object,
 *   radioAlert: string,
 *   linzDataUrl: string,
 * }}
 */
export const getActiveJurisdiction = (lat, lng) => {
  const match = JURISDICTIONS.find((j) => isPointInPolygon([lat, lng], j.polygon));
  const j = match ?? GENERIC_JURISDICTION;

  return {
    council: j.name,
    id: j.id,
    templatePath: `docs/templates/${j.id}/`,
    rulesPath: `docs/rules/${j.id}.md`,
    noiseLimit: j.noiseLimit,
    staffRatio: j.staffRatio,
    seizureRule: j.seizureRule,
    bylaws: j.bylaws,
    radioAlert:
      `Jurisdiction Update: Now operating under ${j.name} bylaws. ` +
      `All infringement templates have been updated. ` +
      (j.seizureRule === 'immediate'
        ? 'Note: Immediate seizure is permitted for prohibited sites.'
        : j.seizureRule === '2h-notice'
        ? 'Note: A 2-hour removal notice is required before seizure.'
        : 'Note: A 24-hour removal notice is required before seizure.'),
    linzDataUrl:
      'https://data.linz.govt.nz/ — source of truth for NZ administrative boundaries (Territorial Authority Shapefiles).',
  };
};

/**
 * Detect if a patrol route (array of [lat,lng] waypoints) crosses a
 * jurisdictional boundary. Returns an array of crossing events.
 *
 * @param {[number,number][]} waypoints
 * @returns {{ waypointIndex: number, from: string, to: string }[]}
 */
export const detectBorderCrossings = (waypoints) => {
  const crossings = [];
  let prev = null;

  for (let i = 0; i < waypoints.length; i++) {
    const [lat, lng] = waypoints[i];
    const current = getActiveJurisdiction(lat, lng);

    if (prev && prev.id !== current.id) {
      crossings.push({
        waypointIndex: i,
        from: prev.council,
        to: current.council,
        warning:
          `Warning: This route enters ${current.council} at waypoint ${i}. ` +
          `Ensure officers are briefed on ${current.bylaws.noise} and ` +
          `${current.bylaws.freedomCamping}.`,
      });
    }
    prev = current;
  }

  return crossings;
};

/**
 * Enrich an incident record with the active jurisdiction at time of event.
 * Ensures every Intake Queue record is tagged with the correct legal framework.
 *
 * @param {object} incident
 * @param {number} incident.lat
 * @param {number} incident.lng
 * @returns {object} incident with `jurisdiction` field appended
 */
export const tagIncidentJurisdiction = (incident) => {
  const j = getActiveJurisdiction(incident.lat, incident.lng);
  return {
    ...incident,
    jurisdiction: {
      council: j.council,
      id: j.id,
      bylaws: j.bylaws,
      seizureRule: j.seizureRule,
      taggedAt: new Date().toISOString(),
    },
  };
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length >= 2) {
  const lat = parseFloat(args[0]);
  const lng = parseFloat(args[1]);

  if (isNaN(lat) || isNaN(lng)) {
    console.error('Usage: node scripts/jurisdiction-router.mjs <lat> <lng>');
    process.exit(1);
  }

  const result = getActiveJurisdiction(lat, lng);
  console.log(JSON.stringify(result, null, 2));
} else {
  // Demo: test all registered council centres + a border crossing patrol route
  console.log('\n=== Jurisdiction Router — Demo ===\n');

  const samples = [
    { label: 'Auckland CBD', lat: -36.8485, lng: 174.7633 },
    { label: 'Wellington CBD', lat: -41.2865, lng: 174.7762 },
    { label: 'Christchurch CBD', lat: -43.5320, lng: 172.6364 },
    { label: 'Nelson CBD', lat: -41.2706, lng: 173.2840 },
    { label: 'Motueka (Tasman DC)', lat: -41.1210, lng: 173.0132 },
    { label: 'Queenstown', lat: -45.0312, lng: 168.6626 },
    { label: 'Remote (Fiordland)', lat: -45.4200, lng: 167.7100 },
  ];

  for (const s of samples) {
    const j = getActiveJurisdiction(s.lat, s.lng);
    console.log(`[${s.label}] → ${j.council}`);
    console.log(`  Noise limit: ${j.noiseLimit} dB | Staff ratio: 1:${j.staffRatio} | Seizure: ${j.seizureRule}`);
    console.log(`  Radio alert: ${j.radioAlert}\n`);
  }

  console.log('=== Border Crossing Detection Demo ===\n');
  const patrolRoute = [
    [-41.1200, 173.0100], // Motueka, Tasman DC
    [-41.2000, 173.1500], // Moving south-east toward Nelson
    [-41.2706, 173.2840], // Nelson City
  ];
  const crossings = detectBorderCrossings(patrolRoute);
  if (crossings.length > 0) {
    crossings.forEach((c) => console.log(`Crossing at waypoint ${c.waypointIndex}:\n  ${c.warning}\n`));
  } else {
    console.log('No border crossings detected on this route.\n');
  }
}
