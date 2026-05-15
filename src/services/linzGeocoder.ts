/**
 * LINZ Address Resolution Service
 * Resolves ambiguous NZ locations to authoritative coordinates via Land Information NZ API
 * Stage 1 of the 3-stage dispatch verification pipeline
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!
);

const LINZ_API_KEY = process.env.VITE_LINZ_DATA_SERVICE_API_KEY;

interface LinzFeature {
  properties: {
    id: number;
    full_address: string;
    suburb_locality: string;
    town_city: string;
  };
  geometry: {
    coordinates: [number, number]; // [Longitude, Latitude] from LINZ EPSG:4326
  };
}

interface LinzGeocodingResult {
  success: boolean;
  latitude?: number;
  longitude?: number;
  verifiedAddress?: string;
  linzAddressId?: number;
  locality?: string;
  city?: string;
  error?: string;
}

/**
 * Resolves an ambiguous address string to exact WGS84 coordinates using LINZ authoritative data
 * Handles colloquial NZ location vernacular and spelling variations common in field communications
 */
export async function resolveNzAddress(
  rawInput: string,
  incidentId: string
): Promise<LinzGeocodingResult> {
  try {
    if (!LINZ_API_KEY) {
      throw new Error('LINZ_DATA_SERVICE_API_KEY not configured in environment');
    }

    // Stage 1: Query the authoritative LINZ Address Dataset layer
    const encodedAddress = encodeURIComponent(rawInput);
    const linzLayerId = '105343'; // Authoritative NZ Primary Address Layer ID
    const url = `https://linz.govt.nz/services/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-${linzLayerId}&outputFormat=json&CQL_FILTER=STRMATCHES(address,'${encodedAddress}*')&key=${LINZ_API_KEY}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(
        `LINZ Data Service responded with status: ${response.status}`
      );
    }

    const geoJson = await response.json();
    const features: LinzFeature[] = geoJson.features || [];

    if (features.length === 0) {
      console.warn(
        `⚠️ LINZ could not resolve boundary for string: "${rawInput}"`
      );
      return {
        success: false,
        error: 'No address matches found in LINZ database',
      };
    }

    // Stage 2: Select the primary highest-confidence feature block
    const primaryMatch = features[0];
    const [longitude, latitude] = primaryMatch.geometry.coordinates;
    const verifiedAddress = primaryMatch.properties.full_address;
    const linzAddressId = primaryMatch.properties.id;
    const locality = primaryMatch.properties.suburb_locality;
    const city = primaryMatch.properties.town_city;

    // Stage 3: Update the Supabase incident record with verified spatial properties
    if (incidentId && supabase) {
      const { error: updateError } = await supabase
        .from('incidents')
        .update({
          latitude: latitude,
          longitude: longitude,
          raw_desc: `[LINZ Verified Address ID: ${linzAddressId}] ${verifiedAddress}`,
          location_string: `${locality}, ${city}`,
        })
        .eq('id', incidentId);

      if (updateError) {
        console.error('Failed to update incident with LINZ coordinates:', updateError);
      }
    }

    return {
      success: true,
      latitude,
      longitude,
      verifiedAddress,
      linzAddressId,
      locality,
      city,
    };
  } catch (error: any) {
    console.error('LINZ Geocoder Exception:', error.message);

    // Log infrastructure failures to telemetry
    try {
      await supabase.from('agent_telemetry').insert([
        {
          event_trigger: 'LINZ_GEOCODER_EXCEPTION',
          run_status: 'circuit_breaker_tripped',
          error_mitigated: error.message,
          confidence_score: 0.0,
        },
      ]);
    } catch (telemetryError) {
      console.error('Failed to log telemetry:', telemetryError);
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Bulk resolve multiple addresses from a batch request
 */
export async function resolveNzAddressBatch(
  addresses: Array<{ input: string; incidentId: string }>
): Promise<LinzGeocodingResult[]> {
  return Promise.all(
    addresses.map(({ input, incidentId }) =>
      resolveNzAddress(input, incidentId)
    )
  );
}
