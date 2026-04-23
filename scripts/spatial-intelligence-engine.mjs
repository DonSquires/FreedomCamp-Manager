/**
 * Bob Spatial Intelligence Engine
 *
 * Multi-layer geofence resolution with overlap handling and job-context tie-breakers.
 * Layer priority (highest to lowest):
 *   4) Client Site
 *   3) Specialist Zone
 *   2) Patrol Zone
 *   1) Jurisdiction
 *
 * Core rule set:
 *   - Job First: private client assignment can lock context to client SOPs.
 *   - Most Specific Wins: specialist zone overrides patrol/jurisdiction.
 *   - Conflict Alert: private site + public bylaw trigger -> notify officer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

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

const polygonArea = (polygon) => {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    area += (xj + xi) * (yj - yi);
  }
  return Math.abs(area / 2);
};

const pickMostSpecific = (matches) => {
  if (matches.length <= 1) return matches[0] ?? null;
  return [...matches].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0];
};

// Layer 1: Jurisdiction
const JURISDICTIONS = [
  {
    layer: 1,
    type: 'jurisdiction',
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
    rulesPath: 'docs/rules/tasman-dc.md',
    bylawRefs: {
      noise: 'Tasman District Council Excessive Noise Directions / RMA s327',
      freedomCamping: 'Tasman District Council Freedom Camping Bylaw 2015',
    },
  },
  {
    layer: 1,
    type: 'jurisdiction',
    name: 'Auckland Council',
    id: 'auckland-council',
    polygon: [
      [-36.2000, 174.1000],
      [-36.2000, 175.2000],
      [-37.2000, 175.2000],
      [-37.2000, 174.1000],
    ],
    noiseLimit: 75,
    staffRatio: 150,
    seizureRule: '2h-notice',
    rulesPath: 'docs/rules/auckland-council.md',
    bylawRefs: {
      noise: 'Auckland Council Noise Control Bylaw / RMA s327',
      freedomCamping: 'Auckland Council Freedom Camping Bylaw 2015',
    },
  },
];

const GENERIC_JURISDICTION = {
  layer: 1,
  type: 'jurisdiction',
  name: 'Generic / No Jurisdiction Detected',
  id: 'generic',
  noiseLimit: 80,
  staffRatio: 150,
  seizureRule: '2h-notice',
  rulesPath: 'docs/rules/generic.md',
  bylawRefs: {
    noise: 'RMA 1991 s327 (national baseline)',
    freedomCamping: 'Freedom Camping Act 2011 (national baseline)',
  },
};

// Layer 2: Patrol zones
const PATROL_ZONES = [
  {
    layer: 2,
    type: 'patrol-zone',
    name: 'Beat 4 - Richmond Central',
    id: 'beat-4-richmond-central',
    polygon: [
      [-41.3200, 173.1450],
      [-41.3200, 173.2200],
      [-41.3900, 173.2200],
      [-41.3900, 173.1450],
    ],
    templatePath: 'docs/templates/tasman-dc/patrol-beat-4.md',
    checkpoints: 'Randomized checkpoints every 20-40 minutes.',
  },
];

// Layer 3: Specialist zones
const SPECIALIST_ZONES = [
  {
    layer: 3,
    type: 'specialist-zone',
    name: 'Freedom Camping Restricted Zone - Richmond Foreshore',
    id: 'fc-restricted-richmond-foreshore',
    polygon: [
      [-41.3260, 173.1720],
      [-41.3260, 173.1910],
      [-41.3430, 173.1910],
      [-41.3430, 173.1720],
    ],
    mode: 'ENFORCEMENT_MODE',
    templatePath: 'docs/templates/tasman-dc/freedom-camping-restricted.md',
    infringementTemplate: 'Freedom camping restricted zone infringement template (self-contained check mandatory).',
  },
];

// Layer 4: Client sites (static fallback)
const STATIC_CLIENT_SITES = [
  {
    layer: 4,
    type: 'client-site',
    name: 'Avis Car Rental Depot - Richmond',
    id: 'avis-richmond-depot',
    clientType: 'private-enterprise',
    polygon: [
      [-41.3270, 173.1750],
      [-41.3270, 173.1840],
      [-41.3365, 173.1840],
      [-41.3365, 173.1750],
    ],
    sopPath: 'docs/templates/clients/avis-car-rental/sop.md',
    accessCodeRef: 'Use client access code from secure vault: AVIS_RICHMOND_GATE_CODE',
    terminology: ['asset-protection', 'depot-perimeter', 'handover-lane'],
  },
];

const loadImportedClientSites = () => {
  const registryPath = path.join(workspaceRoot, 'data', 'client-geofence-registry.json');
  if (!fs.existsSync(registryPath)) return [];

  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed.records) ? parsed.records : [];

    return records
      .filter((r) => Array.isArray(r.polygon) && r.polygon.length >= 3)
      .map((r) => ({
        layer: 4,
        type: 'client-site',
        name: r.name,
        id: r.id,
        clientType: r.clientType || 'private-enterprise',
        polygon: r.polygon,
        sopPath: r.sopPath || null,
        accessCodeRef: r.accessCodeRef || 'Client access control procedure required.',
        terminology: Array.isArray(r.terminology) ? r.terminology : [],
        jobModes: Array.isArray(r.jobModes) ? r.jobModes : [],
        compliance: r.compliance || null,
      }));
  } catch {
    return [];
  }
};

const CLIENT_SITES = (() => {
  const imported = loadImportedClientSites();
  const merged = [...STATIC_CLIENT_SITES, ...imported];
  const deduped = [];
  const seen = new Set();

  for (const site of merged) {
    if (!site?.id || seen.has(site.id)) continue;
    seen.add(site.id);
    deduped.push(site);
  }

  return deduped;
})();

const isPrivateClientJob = (jobContext, client) => {
  if (!jobContext || !client) return false;
  const type = (jobContext.type || '').toLowerCase();
  const assignment = (jobContext.assignment || '').toLowerCase();
  const clientId = (jobContext.clientId || '').toLowerCase();

  return (
    type.includes('private-client') ||
    assignment.includes('site security') ||
    assignment.includes('client site') ||
    clientId === client.id
  );
};

/**
 * Resolve all active geofence layers for a coordinate and optional job context.
 *
 * @param {object} input
 * @param {number} input.lat
 * @param {number} input.lng
 * @param {object} [input.jobContext]
 * @param {object} [input.signals] - operational signals (noiseLevel, etc)
 */
export const resolveSpatialContext = ({ lat, lng, jobContext = null, signals = {} }) => {
  const jurisdictionMatches = JURISDICTIONS.filter((z) => isPointInPolygon([lat, lng], z.polygon));
  const patrolMatches = PATROL_ZONES.filter((z) => isPointInPolygon([lat, lng], z.polygon));
  const specialistMatches = SPECIALIST_ZONES.filter((z) => isPointInPolygon([lat, lng], z.polygon));
  const clientMatches = CLIENT_SITES.filter((z) => isPointInPolygon([lat, lng], z.polygon));

  const layer1Jurisdiction = pickMostSpecific(jurisdictionMatches) ?? GENERIC_JURISDICTION;
  const layer2Patrol = pickMostSpecific(patrolMatches);
  const layer3Specialist = pickMostSpecific(specialistMatches);
  const layer4Client = pickMostSpecific(clientMatches);

  const stack = [
    layer1Jurisdiction,
    layer2Patrol,
    layer3Specialist,
    layer4Client,
  ].filter(Boolean);

  const conflictAlerts = [];

  const clientJobLock = isPrivateClientJob(jobContext, layer4Client);
  if (layer4Client && signals.noiseLevel != null && signals.noiseLevel > layer1Jurisdiction.noiseLimit) {
    conflictAlerts.push(
      `Note: You are on private property, but the Noise Nuisance Bylaw (${layer1Jurisdiction.name}) still applies to this radius.`
    );
  }

  let activeMode = 'JURISDICTION_BASELINE';
  let activeProfile = layer1Jurisdiction;
  let tieBreakerReason = 'Layer 1 baseline only.';

  if (clientJobLock && layer4Client) {
    activeMode = 'CLIENT_SITE_SECURITY';
    activeProfile = layer4Client;
    tieBreakerReason = 'Job First: private client assignment locked to client SOPs.';
  } else if (layer3Specialist) {
    activeMode = layer3Specialist.mode || 'SPECIALIST_ENFORCEMENT';
    activeProfile = layer3Specialist;
    tieBreakerReason = 'Most Specific Wins: specialist zone overrides patrol/jurisdiction.';
  } else if (layer2Patrol) {
    activeMode = 'PATROL_MODE';
    activeProfile = layer2Patrol;
    tieBreakerReason = 'Patrol zone active; jurisdiction still applies as legal baseline.';
  }

  const effectiveRules = {
    jurisdictionRulesPath: layer1Jurisdiction.rulesPath,
    patrolTemplatePath: layer2Patrol?.templatePath ?? null,
    specialistTemplatePath: layer3Specialist?.templatePath ?? null,
    clientSopPath: layer4Client?.sopPath ?? null,
  };

  const radioAnnouncement =
    `Jurisdiction Update: Now operating under ${layer1Jurisdiction.name} bylaws.` +
    (layer4Client && clientJobLock
      ? ` Active job context locked to ${layer4Client.name} private client SOPs.`
      : ' All infringement templates have been updated.');

  return {
    coordinate: { lat, lng },
    stack,
    activeMode,
    activeProfile,
    tieBreakerReason,
    effectiveRules,
    conflictAlerts,
    jobContext: jobContext ?? null,
    layers: {
      layer1Jurisdiction,
      layer2Patrol,
      layer3Specialist,
      layer4Client,
    },
    thresholds: {
      noiseLimit: layer1Jurisdiction.noiseLimit,
      staffRatio: layer1Jurisdiction.staffRatio,
      seizureRule: layer1Jurisdiction.seizureRule,
    },
    radioAnnouncement,
    references: {
      linz: 'https://data.linz.govt.nz/',
      awsGeofences: 'https://docs.aws.amazon.com/location/latest/developerguide/geofences.html',
      localGovernmentAct2002: 'https://www.legislation.govt.nz/act/public/2002/0084/latest/DLM170873.html',
    },
  };
};

export const detectSpatialHandover = (prevContext, nextContext) => {
  const events = [];
  if (!prevContext) {
    events.push({ type: 'ENTER', mode: nextContext.activeMode, details: 'Initial context acquired.' });
    return events;
  }

  if (prevContext.layers.layer1Jurisdiction.id !== nextContext.layers.layer1Jurisdiction.id) {
    events.push({
      type: 'JURISDICTION_CHANGE',
      from: prevContext.layers.layer1Jurisdiction.name,
      to: nextContext.layers.layer1Jurisdiction.name,
    });
  }

  if ((prevContext.layers.layer4Client?.id || null) !== (nextContext.layers.layer4Client?.id || null)) {
    events.push({
      type: 'CLIENT_SITE_CHANGE',
      from: prevContext.layers.layer4Client?.name || 'none',
      to: nextContext.layers.layer4Client?.name || 'none',
    });
  }

  if (prevContext.activeMode !== nextContext.activeMode) {
    events.push({
      type: 'MODE_SWITCH',
      from: prevContext.activeMode,
      to: nextContext.activeMode,
      reason: nextContext.tieBreakerReason,
    });
  }

  return events;
};

const args = process.argv.slice(2);
if (args.length >= 2) {
  const lat = Number(args[0]);
  const lng = Number(args[1]);
  const assignment = args[2] || 'Site Security - Avis';
  const context = resolveSpatialContext({
    lat,
    lng,
    jobContext: {
      type: 'private-client',
      assignment,
      clientId: 'avis-richmond-depot',
    },
    signals: { noiseLevel: 84 },
  });
  console.log(JSON.stringify(context, null, 2));
}
