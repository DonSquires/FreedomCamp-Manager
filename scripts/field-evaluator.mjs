/**
 * Bob's Advanced Field Evaluation Logic – Enforcement Version
 *
 * Weighted risk matrix aligned with NZ/AU legislative requirements:
 *   - Freedom Camping Act 2011
 *   - Resource Management Act 1991 (RMA) s326-328
 *   - Biosecurity Act 1993 / Biosecurity NZ Check-Clean-Dry protocol
 *   - Health & Safety at Work Act 2015 (HSWA)
 *   - ISO 31000 Risk Management (Likelihood × Consequence weighting)
 *
 * Jurisdiction awareness: when `data.lat` and `data.lng` are provided,
 * the evaluator calls jurisdiction-router.mjs and automatically overrides
 * noiseLimit, staffRatio, seizureRule, and bylaw references for that council.
 *
 * Usage:
 *   node scripts/field-evaluator.mjs                 # run built-in example
 *   node scripts/field-evaluator.mjs '{"planJson"}'  # pass raw JSON string
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSpatialContext } from './spatial-intelligence-engine.mjs';

// ---------------------------------------------------------------------------
// Acoustic False-Positive Library (Radio Agent context filter)
// ---------------------------------------------------------------------------
const ACOUSTIC_FALSE_POSITIVES = [
  { phrase: 'no danger here', meaning: 'explicit negation' },
  { phrase: "it's not an emergency", meaning: 'explicit negation' },
  { phrase: 'just joking', meaning: 'comedic dismissal' },
  { phrase: 'training exercise', meaning: 'drill context' },
  { phrase: 'false alarm', meaning: 'self-correction' },
  { phrase: 'all clear', meaning: 'resolved status' },
];

// ---------------------------------------------------------------------------
// Legislative Truth Table
// ---------------------------------------------------------------------------
const LEGISLATION = {
  FREEDOM_CAMPING: 'Freedom Camping Act 2011 – differentiate Prohibited vs Restricted zones; verify Self-Contained status before issuing infringements.',
  RMA_NOISE: 'RMA 1991 s327 – Excessive Noise Direction valid for 72 hours; threshold: unreasonably interferes with peace, comfort, and convenience.',
  BIOSECURITY: 'Biosecurity Act 1993 / Biosecurity NZ Check-Clean-Dry protocol – document breach, halt all entry until wash-down complete.',
  HSWA: 'Health & Safety at Work Act 2015 – identify, assess, eliminate or minimise risks; staff ratios must match crowd density and environmental hazards.',
  ISO_31000: 'ISO 31000 – Likelihood × Consequence matrix applied to zone classification.',
};

// ---------------------------------------------------------------------------
// Core Evaluator
// ---------------------------------------------------------------------------
const evaluateFieldRisk = (data) => {
  let score = 0;
  const prescribedSOP = [];
  const legislativeRefs = new Set();

  // 0. Jurisdiction auto-detection — resolve council-specific thresholds
  const spatialContext =
    data.lat != null && data.lng != null
      ? resolveSpatialContext({
          lat: data.lat,
          lng: data.lng,
          jobContext: data.jobContext ?? null,
          signals: { noiseLevel: data.noiseLevel ?? null },
        })
      : null;
  const jurisdiction = spatialContext?.layers?.layer1Jurisdiction ?? null;

  const effectiveNoiseLimit = jurisdiction?.noiseLimit ?? 85;
  const effectiveStaffRatio = jurisdiction?.staffRatio ?? 150;
  const effectiveSeizureRule = jurisdiction?.seizureRule ?? '2h-notice';
  const jFreedomCamping =
    jurisdiction?.bylawRefs?.freedomCamping ??
    jurisdiction?.bylaws?.freedomCamping ??
    'Freedom Camping Act 2011 s16';
  const jNoise =
    jurisdiction?.bylawRefs?.noise ??
    jurisdiction?.bylaws?.noise ??
    'RMA s327 Excessive Noise Direction';

  // 1. Freedom Camping Act compliance
  legislativeRefs.add(LEGISLATION.FREEDOM_CAMPING);
  if (data.zoneType === 'prohibited') {
    score += 50;
    prescribedSOP.push(
      `PROHIBITED ZONE: Issue infringement notice immediately. ` +
      `Cite ${jFreedomCamping}. Capture GPS + photo evidence.` +
      (effectiveSeizureRule === 'immediate'
        ? ' Immediate seizure is permitted.'
        : ` Issue ${effectiveSeizureRule} removal notice before seizure.`),
    );
  } else if (data.zoneType === 'restricted' && data.selfContained === false) {
    score += 35;
    prescribedSOP.push(
      `RESTRICTED ZONE – Non-Self-Contained vehicle: Educate first. ` +
      `If 30-minute non-compliance, issue notice under ${jFreedomCamping}.`,
    );
  }

  // 2. Environmental / Weather (HSWA risk trigger)
  const weatherLower = (data.weather || '').toLowerCase();
  if (/storm|gale|cyclone|hurricane/.test(weatherLower)) {
    score += 40;
    legislativeRefs.add(LEGISLATION.HSWA);
    prescribedSOP.push(
      'HSWA 2015: High-wind/storm risk. Site must be evacuated or sheltered. ' +
      'Document in H&S log. Suspend patrol operations until conditions improve.',
    );
  } else if (/heavy rain|flooding|flash flood/.test(weatherLower)) {
    score += 20;
    legislativeRefs.add(LEGISLATION.HSWA);
    prescribedSOP.push('Elevated rain/flood risk: confirm drainage routes and evacuation paths are clear.');
  }

  // 3. Noise & Smoke (council threshold applies)
  if ((data.noiseLevel || 0) > effectiveNoiseLimit || data.smokeVisual === 'heavy') {
    score += 35;
    legislativeRefs.add(LEGISLATION.RMA_NOISE);
    prescribedSOP.push(
      `Issue ${jNoise}. Valid for 72 hours. ` +
      `Noise threshold: ${effectiveNoiseLimit} dB${jurisdiction ? ` (${jurisdiction.name ?? jurisdiction.council})` : ''}. ` +
      'Notify Duty Officer if seizure of equipment is required. ' +
      '$500 infringement applies on non-compliance.',
    );
  }

  // 4. Bio-Security
  const bioText = (data.bioHazards || []).join(' ').toLowerCase();
  if (/contamination|outbreak|kauri dieback|didymo|foot.mouth/.test(bioText)) {
    score += 50;
    legislativeRefs.add(LEGISLATION.BIOSECURITY);
    prescribedSOP.push(
      'BIO-SECURITY ALERT: Halt all entry. Mandatory PPE. ' +
      'Follow Check-Clean-Dry protocol. Document under Biosecurity Act 1993. ' +
      'Maintain inspection log for audit trail.',
    );
  } else if (/invasive|pest zone|high.risk/.test(bioText)) {
    score += 20;
    legislativeRefs.add(LEGISLATION.BIOSECURITY);
    prescribedSOP.push(
      'High-risk biosecurity zone: mandatory wash-down at entry/exit. ' +
      'Record all vehicle movements in inspection log.',
    );
  }
  if ((data.inspectionsFailed || 0) > 0) {
    score += 50;
    legislativeRefs.add(LEGISLATION.BIOSECURITY);
    prescribedSOP.push(
      `BIO-SECURITY BREACH: ${data.inspectionsFailed} inspection(s) failed. ` +
      'Zone quarantine required. Notify Regional Council within 24 hours.',
    );
  }

  // 5. Staffing ratio (council standard applies)
  const ratio = data.peopleCount / Math.max(data.staffCount ?? 1, 1);
  legislativeRefs.add(LEGISLATION.ISO_31000);
  if (ratio > effectiveStaffRatio) {
    score += 45;
    legislativeRefs.add(LEGISLATION.HSWA);
    prescribedSOP.push(
      `CRITICAL STAFFING: 1:${Math.round(ratio)} (${jurisdiction ? (jurisdiction.name ?? jurisdiction.council) : 'national'} standard is 1:${effectiveStaffRatio}). ` +
      'Deploy backup officers immediately.',
    );
  } else if (ratio > Math.round(effectiveStaffRatio * 0.67)) {
    score += 15;
    prescribedSOP.push(`Staffing ratio 1:${Math.round(ratio)}: consider requesting additional support.`);
  }

  // 6. Historical violence
  const historyText = (data.history || []).join(' ').toLowerCase();
  if (/assault|violence|armed|weapon/.test(historyText)) {
    score += 15;
    prescribedSOP.push(
      'Historical violence recorded: enable Armed Danger Auto-Assist on all Radio Units. ' +
      'Conduct buddy-system patrol. Inform Duty Officer before approach.',
    );
  }

  // 7. Radio Agent false-positive filter
  const audioFlags = (data.audioFlags || []).map((f) => f.toLowerCase());
  const confirmed = audioFlags.filter(
    (flag) => !ACOUSTIC_FALSE_POSITIVES.some((fp) => flag.includes(fp.phrase)),
  );
  if (confirmed.length > 0) {
    score += 20;
    prescribedSOP.push(
      `RADIO ALERT: ${confirmed.length} unresolved audio signal(s) after false-positive filtering. ` +
      'Verify with officer on ground before escalating.',
    );
  }

  // 8. Burden-of-Proof check (Intake Queue)
  const evidence = {
    identity: !!data.identity,
    location: !!data.gps || !!data.zone,
    violation: !!data.bylawReference,
  };
  const missingEvidence = Object.entries(evidence)
    .filter(([, present]) => !present)
    .map(([key]) => key);
  if (missingEvidence.length > 0) {
    prescribedSOP.push(
      `INSUFFICIENT EVIDENCE: Missing – ${missingEvidence.join(', ')}. ` +
      'Flag record as "Insufficient Evidence". Do not process infringement until all three are confirmed ' +
      '(Identity, Location GPS/Zone, Violation bylaw reference).',
    );
  }

  if (spatialContext?.conflictAlerts?.length) {
    prescribedSOP.push(...spatialContext.conflictAlerts);
  }

  // Determine risk level
  const riskLevel = score > 70 ? 'CRITICAL' : score > 40 ? 'ELEVATED' : 'LOW';
  const legalAction =
    score >= 50 ? 'Infringement/Enforcement' : 'Education/Warning';

  const radioAgentMode =
    riskLevel === 'CRITICAL'
      ? { mode: 'Monitor Ambient Risk', signalWindow: 5, armedAutoAssist: true }
      : riskLevel === 'ELEVATED'
      ? { mode: 'Active Listen', signalWindow: 10, armedAutoAssist: false }
      : { mode: 'Passive', signalWindow: 30, armedAutoAssist: false };

  const legislativeFooter = [
    '---',
    '**Legislative Basis (Bob-generated SOP)**',
    ...[...legislativeRefs].map((ref) => `- ${ref}`),
    '',
    '_This assessment was generated by Bob Field Evaluator. ' +
      'All enforcement actions must be reviewed by a qualified officer before execution._',
  ].join('\n');

  return {
    riskScore: score,
    riskLevel,
    legalAction,
    legislativeRefs: [...legislativeRefs],
    prescribedSOP,
    radioAgentMode,
    evidenceCheck: evidence,
    legislativeFooter,
    jurisdiction: jurisdiction
      ? {
          council: jurisdiction.name ?? jurisdiction.council,
          id: jurisdiction.id,
          rulesPath: jurisdiction.rulesPath,
          radioAlert: spatialContext?.radioAnnouncement ?? null,
        }
      : null,
    spatialContext,
  };
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const EXAMPLE_PLAN = {
  weather: 'heavy rain, high winds',
  bioHazards: ['invasive pest zone', 'kauri dieback risk'],
  peopleCount: 600,
  staffCount: 3,
  history: ['previous trespass conflicts'],
  noiseLevel: 90,
  smokeVisual: 'heavy',
  inspectionsFailed: 1,
  selfContained: false,
  zoneType: 'restricted',
  audioFlags: ['armed man spotted'],
  lat: -41.1210,
  lng: 173.0132, // Motueka — Tasman DC (immediate seizure)
  identity: 'Vehicle ABC123',
  gps: '-41.1210,173.0132',
  bylawReference: null, // deliberately missing to demo Insufficient Evidence flag
  jobContext: {
    type: 'private-client',
    assignment: 'Site Security - Avis',
    clientId: 'avis-richmond-depot',
  },
};

export { evaluateFieldRisk, ACOUSTIC_FALSE_POSITIVES, LEGISLATION };

const isDirectExecution = (() => {
  if (!process.argv[1]) return false;
  const executedPath = path.resolve(process.argv[1]);
  const thisFilePath = fileURLToPath(import.meta.url);
  return executedPath === thisFilePath;
})();

if (isDirectExecution) {
  const input = process.argv[2] ? JSON.parse(process.argv[2]) : EXAMPLE_PLAN;
  const result = evaluateFieldRisk(input);
  console.log(JSON.stringify(result, null, 2));
}
