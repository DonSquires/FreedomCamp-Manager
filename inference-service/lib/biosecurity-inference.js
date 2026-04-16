'use strict';
/**
 * biosecurity-inference.js
 *
 * AI-powered plant identification and density estimation for NZ biosecurity
 * compliance officers. Primarily targets:
 *   - Chilean Needlegrass (Nassella neesiana) — Unwanted Organism under
 *     Biosecurity Act 1993
 *   - Nassella trichotoma (Serrated Tussock) — also controlled
 *   - Other invasive Nassella/Stipa species and common NZ weed grasses
 *
 * Core functions:
 *   identifyPlants(imageBase64, videoFrames?, gpsContext?)
 *   getWeatherForLocation(lat, lng, timestamp?)
 *
 * Uses OpenAI vision (gpt-4o) via OPENAI_BASE_URL. Falls back gracefully
 * when vision API is unavailable.
 */

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL    = process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_ENABLED  = !!OPENAI_API_KEY;

const INFERENCE_TIMEOUT_MS = parseInt(process.env.ATTR_TIMEOUT_MS || '25000', 10);

// ── NZ Weed Identification Knowledge Base ─────────────────────────────────────
const BIOSECURITY_SYSTEM_PROMPT = `You are an expert NZ biosecurity compliance officer and plant identification specialist with deep knowledge of invasive grass species in New Zealand.

YOUR PRIMARY TASK: Analyse the provided image(s) and identify any invasive or notable plant species visible, with a particular focus on:

## TARGET SPECIES (High Priority)

### 1. Chilean Needlegrass (Nassella neesiana) — TOP PRIORITY
- An Unwanted Organism under NZ Biosecurity Act 1993
- Also known as: CNG, Chilean needle grass, Nassella neesiana
- KEY IDENTIFIERS:
  * LEAVES: Bright yellow-green, very harsh/rough texture when touched, 2–4mm wide, flat to loosely rolled
  * SEED HEADS (October–December): Reddish-purple nodding spikelets, fade to light brown at maturity
  * THE NEEDLE: Each seed has a sharp 10mm pointed tip (the "needle") that can pierce skin and wool
  * THE AWN: Long (30–50mm), twisted, hairy awn attached to seed — designed to hook onto animals/clothing
  * BASAL SEEDS (cleistogenes): CRITICAL — hidden seeds at base of leaf sheaths and inside stem nodes. Plant reproduces even when mown/grazed.
  * HEIGHT: Typically 40–120cm when flowering
  * GROWTH: Perennial tussock-forming grass, forms dense clumps

### 2. Nassella trichotoma (Serrated Tussock)
- Also controlled under NZ regional pest management plans
- IDENTIFIERS: Rolled/inrolled fine leaves, twisted appearance, typically grey-green
- Forms dense tussocks, very fine leaf blades, serrated margin

### 3. Nassella hyalina (Argentine needle grass)
- Similar to CNG, check awn length and leaf texture

## ALSO IDENTIFY (if present)
- Nasella neesiana (other varieties)
- Pennisetum clandestinum (Kikuyu grass) — invasive in NZ
- Hieracium (hawkweeds) — common NZ invasive
- Other notable invasive weed species
- Native/non-target tussock grasses (for context/comparison):
  * Chionochloa rubra (red tussock) — NATIVE, should NOT be confused with CNG
  * Festuca novae-zelandiae — native fescue

## DENSITY ESTIMATION GUIDELINES
- Count visible stems/plants and estimate coverage area
- Provide plants per square metre (plants/m²)
- Density categories: isolated (1 plant), low (<5/m²), medium (5–20/m²), high (20–50/m²), dense (>50/m²)
- Note if it is a single leaf or strand vs. established patch

## EVIDENCE FEATURES TO LOOK FOR
- Seed head morphology (colour, shape, awn presence/length)
- Leaf colour and texture (yellow-green is distinctive for CNG)
- Growth habit (tussock-forming, clump size)
- Base of plant (cleistogenes visibility)
- Environmental context (stockyard, fenceline, vehicle area, paddock)

## OUTPUT FORMAT
Respond with ONLY a valid JSON object (no markdown) with this exact structure:
{
  "species": [
    {
      "name": "nassella_neesiana",
      "common_name": "Chilean Needlegrass",
      "confidence": 0.85,
      "count_estimate": 12,
      "density_per_m2": 4.5,
      "stage": "seeding",
      "evidence_features": ["reddish_purple_seed_heads", "harsh_yellow_green_leaves", "awn_visible"],
      "notes": "Clear seed heads visible, typical CNG morphology"
    }
  ],
  "dominant_species": "nassella_neesiana",
  "total_density_per_m2": 4.5,
  "patch_assessment": "Established patch approximately 3m², moderate density. Multiple seeding plants present — high dispersal risk.",
  "seed_heads_present": true,
  "basal_seeds_visible": false,
  "awn_visible": true,
  "leaf_texture_harsh": true,
  "infestation_stage": "seeding",
  "weather_visible": true,
  "wind_direction_visible": "NW",
  "location_type": "fenceline",
  "buffer_zone_risk": true,
  "stock_welfare_risk": false,
  "recommended_action": "notice_of_direction",
  "checklist_prefill": {
    "seed_heads_present": true,
    "basal_seeds_present": false,
    "cleistogenes_present": false,
    "leaf_texture_harsh": true,
    "awn_visible": true,
    "infestation_stage": "seeding",
    "location_type": "fenceline",
    "buffer_zone_breached": true,
    "stock_welfare_risk": false,
    "sample_recommended": true
  },
  "confidence": 0.85,
  "rationale": "High confidence based on distinctive reddish-purple nodding seed heads, harsh yellow-green leaf texture, and visible awns. Plant morphology is consistent with CNG at seeding stage.",
  "single_plant_or_strand": false,
  "requires_lab_confirmation": false,
  "ai_caution": "AI identification is a screening aid only. Officer must confirm species identification before issuing notices."
}

IMPORTANT RULES:
- If no target invasive species are visible, return an empty species array and dominant_species: null
- If a single leaf/strand is visible with insufficient detail, set single_plant_or_strand: true and requires_lab_confirmation: true
- confidence must be 0.0–1.0. Be conservative — grass ID is difficult without handling the plant
- Always include ai_caution reminding the officer to confirm the ID
- If the image quality is too poor to assess, return confidence: 0 and explain in rationale`;

// ── identifyPlants ────────────────────────────────────────────────────────────
/**
 * Identify plant species from image(s) using OpenAI vision.
 *
 * @param {string}   imageBase64   Base64-encoded image (JPEG/PNG)
 * @param {string[]} [extraFrames] Additional base64 frames (from video)
 * @param {object}   [gpsContext]  Optional GPS context {lat, lng, region}
 * @returns {Promise<object>} Identification result with checklist prefill
 */
async function identifyPlants(imageBase64, extraFrames = [], gpsContext = null) {
  if (!OPENAI_ENABLED) {
    return {
      success: false,
      requires_manual_identification: true,
      reason: 'Vision AI not configured (OPENAI_API_KEY missing)',
      checklist_prefill: null,
    };
  }

  const mimeType = imageBase64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';

  // Build user content — primary image + up to 7 extra frames
  const userContent = [
    {
      type: 'text',
      text: gpsContext
        ? `Please identify any invasive plant species in this image. Location context: region=${gpsContext.region || 'unknown'}, coordinates approximately (${gpsContext.lat?.toFixed(4)}, ${gpsContext.lng?.toFixed(4)}). Focus on Chilean Needlegrass (CNG/Nassella neesiana) and other NZ controlled species.`
        : 'Please identify any invasive plant species in this image. Focus on Chilean Needlegrass (CNG/Nassella neesiana) and other NZ controlled species.',
    },
    {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBase64}` },
    },
  ];

  // Add extra frames (video keyframes) — cap at 7 additional to stay within context limits
  const framesToAdd = extraFrames.slice(0, 7);
  for (const frame of framesToAdd) {
    const frameMime = frame.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${frameMime};base64,${frame}` },
    });
  }

  if (framesToAdd.length > 0) {
    userContent[0].text += ` (${framesToAdd.length + 1} frames from video provided for density assessment)`;
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
          { role: 'system', content: BIOSECURITY_SYSTEM_PROMPT },
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
        requires_manual_identification: true,
        reason: 'Vision API timeout — manual identification required',
        checklist_prefill: null,
      };
    }
    throw err;
  }
}

// ── getWeatherForLocation ─────────────────────────────────────────────────────
/**
 * Fetch current/historical weather for a NZ location.
 * Uses Open-Meteo (free, no API key required, excellent NZ coverage).
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string|null} [isoTimestamp] ISO timestamp for historical data; null = current
 * @returns {Promise<object>} Weather conditions
 */
async function getWeatherForLocation(lat, lng, isoTimestamp = null) {
  if (!lat || !lng) {
    return { available: false, reason: 'No GPS coordinates provided' };
  }

  try {
    // Open-Meteo — free, no key, NZ-optimised
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('current', 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code');
    url.searchParams.set('timezone', 'Pacific/Auckland');
    url.searchParams.set('wind_speed_unit', 'kmh');

    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) return { available: false, reason: `Weather API returned ${resp.status}` };

    const data = await resp.json();
    const c = data?.current;
    if (!c) return { available: false, reason: 'No current weather data in response' };

    // Convert WMO weather code to human description
    const conditions = wmoDescription(c.weather_code);

    // Convert wind direction degrees to compass bearing
    const windDir = degreesToCompass(c.wind_direction_10m);

    return {
      available: true,
      temp_c: c.temperature_2m,
      wind_speed_kmh: c.wind_speed_10m,
      wind_direction: windDir,
      wind_direction_degrees: c.wind_direction_10m,
      rainfall_mm: c.precipitation,
      conditions,
      weather_code: c.weather_code,
      observed_at: c.time,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

function degreesToCompass(degrees) {
  if (degrees == null) return null;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(degrees / 22.5) % 16;
  return dirs[idx];
}

function wmoDescription(code) {
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Icy fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow',
    80: 'Light showers', 81: 'Moderate showers', 82: 'Heavy showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
  };
  return map[code] || `Weather code ${code}`;
}

// ── Biosecurity checklist template ────────────────────────────────────────────
const BIOSECURITY_CHECKLIST_TEMPLATE = {
  species_confirmed: null,
  seed_heads_present: null,
  basal_seeds_present: null,
  cleistogenes_present: null,
  leaf_texture_harsh: null,
  awn_visible: null,
  infestation_stage: null,
  location_type: null,
  density_category: null,
  patch_area_m2: null,
  buffer_zone_breached: null,
  management_plan_current: null,
  pathway_evidence: '',
  sample_taken: false,
  stock_welfare_risk: null,
  weather_captured: false,
};

module.exports = {
  identifyPlants,
  getWeatherForLocation,
  BIOSECURITY_CHECKLIST_TEMPLATE,
};
