'use strict';
/**
 * smoke-inference.js
 *
 * AI-powered smoke assessment for NZ compliance officers enforcing:
 *   - Resource Management Act 1991 (RMA s.17A) — offensive/objectionable discharge
 *   - Local Fire & Smoke Nuisance Bylaws
 *
 * Core functions:
 *   assessSmoke(imageBase64, videoFrames?, metadata?)
 *   getWeatherForLocation(lat, lng)   — re-exported from biosecurity-inference
 */

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL    = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_ENABLED  = !!OPENAI_API_KEY;

const INFERENCE_TIMEOUT_MS = parseInt(process.env.ATTR_TIMEOUT_MS || '25000', 10);

// Re-use weather helper from biosecurity module
const { getWeatherForLocation } = require('./biosecurity-inference');

// ── NZ Smoke Assessment Knowledge ─────────────────────────────────────────────
const SMOKE_SYSTEM_PROMPT = `You are an expert NZ environmental compliance officer specialising in smoke and air quality enforcement under the Resource Management Act 1991 (RMA) and local Fire & Smoke Nuisance Bylaws.

YOUR TASK: Analyse the provided image(s)/video frames showing smoke from a property and provide a formal assessment to help a field officer determine if the discharge is "offensive or objectionable" beyond the property boundary (RMA s.17A).

## ASSESSMENT CRITERIA

### 1. SMOKE OPACITY & COLOUR
- Light: Barely visible, white/light grey — typically clean wood fire or damp wood
- Moderate: Visible but translucent — potential incomplete combustion
- Heavy: Dense, opaque plume — likely prohibited materials or very wet/green waste
- Very Heavy: Thick blanket, significant visibility reduction
- Black: Confirms prohibited materials (rubber, plastics, treated timber)
- Colour indicators:
  * White/light grey = clean wood, steam from wet material
  * Dark grey/black = plastics, rubber, incomplete combustion, chemicals
  * Brown/yellow = treated timber (arsenic/chrome), green waste

### 2. PROHIBITED MATERIALS INDICATORS
Look for visual evidence of:
- Black acrid smoke → rubber tyres, bitumen, plastics
- Dark grey with chemical appearance → treated timber (H3/H4 treated), painted wood
- Heavy white steam + dark core → green waste, kitchen waste
- Rainbow/iridescent quality to smoke → chemical accelerants
- Any melting visible objects → plastics, synthetics

### 3. WIND & DRIFT ASSESSMENT
- Identify approximate wind direction from smoke movement
- Assess if smoke is drifting toward:
  * Neighbouring residential properties
  * Public roads (visibility hazard)
  * Schools, playgrounds, sensitive areas
- Note if smoke stays within property boundary vs. clearly crossing it

### 4. OFFENSIVE OR OBJECTIONABLE TEST (RMA s.17A)
Consider: Would a reasonable person find this smoke offensive or objectionable in terms of effect on their ability to use and enjoy their property?
Rate 1–5:
  1 = Clearly not offensive (brief lighting smoke, clean wood, minimal drift)
  2 = Borderline — monitor, advisory only
  3 = Likely offensive — verbal warning warranted
  4 = Offensive — abatement notice warranted
  5 = Highly offensive or prohibited materials — immediate action required

## OUTPUT FORMAT
Respond with ONLY a valid JSON object (no markdown):
{
  "smoke_opacity": "heavy",
  "smoke_color": "dark_grey",
  "smoke_continuous": true,
  "smoke_continuous_confidence": 0.8,
  "prohibited_materials_suspected": true,
  "prohibited_materials_evidence": ["dark_grey_acrid_smoke", "chemical_appearance"],
  "fire_type": "burn_off",
  "odor_category": "acrid_chemical",
  "wind_direction_visible": "SW",
  "smoke_affecting_neighbors": true,
  "smoke_affecting_road": false,
  "offensive_objectionable_rating": 4,
  "materials_checklist": {
    "treated_timber": true,
    "plastics": false,
    "rubber_tyres": false,
    "green_waste": false,
    "household_rubbish": false,
    "chemicals": false
  },
  "recommended_action": "abatement_notice",
  "checklist_prefill": {
    "smoke_opacity": "heavy",
    "smoke_color": "dark_grey",
    "smoke_continuous": true,
    "prohibited_materials_suspected": true,
    "odor_description": "acrid_chemical",
    "odor_offensive": true,
    "wind_direction": "SW",
    "smoke_affecting_neighbors": true,
    "smoke_affecting_road": false,
    "sample_recommended": true,
    "recommended_action": "abatement_notice"
  },
  "confidence": 0.82,
  "rationale": "Dark grey smoke with chemical appearance strongly suggests treated timber or chemical materials. Smoke is drifting toward adjacent residential properties. Duration appears continuous.",
  "ai_caution": "AI assessment is a screening aid. Officer must apply their professional judgment and sensory assessment before issuing any notice under RMA s.17A."
}

IMPORTANT RULES:
- If smoke is not clearly visible in the image, note this in rationale and set confidence to a low value
- Always include ai_caution
- The offensive_objectionable_rating is an AI estimate only — the officer's professional opinion governs
- Be conservative: if you cannot clearly see evidence of prohibited materials, do not flag them`;

// ── assessSmoke ───────────────────────────────────────────────────────────────
/**
 * Assess smoke from image(s) using OpenAI vision.
 *
 * @param {string}   imageBase64   Base64-encoded image
 * @param {string[]} [extraFrames] Additional base64 frames (from video)
 * @param {object}   [metadata]    Optional metadata {complaint_time, duration_reported_mins, address}
 * @returns {Promise<object>} Assessment result with checklist prefill
 */
async function assessSmoke(imageBase64, extraFrames = [], metadata = {}) {
  if (!OPENAI_ENABLED) {
    return {
      success: false,
      requires_manual_assessment: true,
      reason: 'Vision AI not configured (OPENAI_API_KEY missing)',
      checklist_prefill: null,
    };
  }

  const mimeType = imageBase64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';

  // Build context text
  let contextText = 'Please assess this smoke complaint image for NZ RMA compliance purposes.';
  if (metadata.complaint_time) {
    const t = new Date(metadata.complaint_time);
    const hour = t.getHours();
    const isOOH = hour < 7 || hour >= 22;
    contextText += ` Complaint time: ${t.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}${isOOH ? ' (out-of-hours)' : ''}.`;
  }
  if (metadata.duration_reported_mins) {
    contextText += ` Reported duration: approximately ${metadata.duration_reported_mins} minutes.`;
  }
  if (metadata.address) {
    contextText += ` Location: ${metadata.address}.`;
  }

  const userContent = [
    { type: 'text', text: contextText },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
  ];

  const framesToAdd = extraFrames.slice(0, 7);
  for (const frame of framesToAdd) {
    const frameMime = frame.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${frameMime};base64,${frame}` },
    });
  }
  if (framesToAdd.length > 0) {
    userContent[0].text += ` (${framesToAdd.length + 1} video frames provided — assess smoke continuity and opacity trend across frames)`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SMOKE_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty response from vision API');

    const parsed = JSON.parse(raw);

    return {
      success: true,
      ...parsed,
      frames_analysed: framesToAdd.length + 1,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return {
        success: false,
        requires_manual_assessment: true,
        reason: 'Vision API timeout — manual assessment required',
        checklist_prefill: null,
      };
    }
    throw err;
  }
}

// ── Smoke checklist template ──────────────────────────────────────────────────
const SMOKE_CHECKLIST_TEMPLATE = {
  smoke_opacity: null,
  smoke_color: null,
  smoke_continuous: null,
  smoke_duration_minutes: null,
  fire_type: null,
  prohibited_materials_suspected: false,
  materials_checklist: {
    treated_timber: false,
    plastics: false,
    rubber_tyres: false,
    green_waste: false,
    household_rubbish: false,
    chemicals: false,
  },
  odor_description: null,
  odor_offensive: null,
  wind_speed_kmh: null,
  wind_direction: null,
  smoke_affecting_neighbors: null,
  smoke_affecting_road: null,
  sample_taken: false,
  officer_professional_opinion: '',
  recommended_action: null,
};

module.exports = {
  assessSmoke,
  getWeatherForLocation,
  SMOKE_CHECKLIST_TEMPLATE,
};
