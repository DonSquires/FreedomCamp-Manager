// Auto-Zone Creation with Intelligent Naming
// Uses reverse geocoding to suggest new zones when officers record observations
// in parent zones or areas without specific zones

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const NOMINATIM_API = 'https://nominatim.openstreetmap.org';

interface SuggestZoneRequest {
  observation_id: string;
  gps_latitude: number;
  gps_longitude: number;
  organization_id: string;
  parent_zone_id?: string;
  user_id: string;
}

interface ReverseGeocodeResult {
  name?: string;
  display_name: string;
  address: {
    road?: string;
    suburb?: string;
    park?: string;
    amenity?: string;
    leisure?: string;
    tourism?: string;
    place?: string;
    city?: string;
    town?: string;
  };
  type: string;
  category: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const requestData: SuggestZoneRequest = await req.json();
    console.log('Zone suggestion request:', requestData);

    // Step 1: Reverse geocode the location
    const geocodeUrl = `${NOMINATIM_API}/reverse?` + 
      `lat=${requestData.gps_latitude}&` +
      `lon=${requestData.gps_longitude}&` +
      `format=json&` +
      `addressdetails=1&` +
      `zoom=18`;

    console.log('Calling Nominatim API:', geocodeUrl);

    const geocodeResponse = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'FreedomCampManager/1.0',
        'Accept': 'application/json',
      },
    });

    if (!geocodeResponse.ok) {
      throw new Error(`Geocoding failed: ${geocodeResponse.statusText}`);
    }

    const geocodeData: ReverseGeocodeResult = await geocodeResponse.json();
    console.log('Geocode result:', geocodeData);

    // Step 2: Generate intelligent zone name
    const zoneName = generateZoneName(geocodeData);
    const locationDescription = generateDescription(geocodeData);
    const locationType = categorizeLocation(geocodeData);
    const confidenceScore = calculateConfidence(geocodeData);

    console.log('Generated zone name:', zoneName, 'Type:', locationType, 'Confidence:', confidenceScore);

    // Step 3: Check if similar zone already exists
    const { data: existingZones, error: zoneCheckError } = await supabaseClient
      .from('zones')
      .select('id, name, location_lat, location_lng')
      .eq('organization_id', requestData.organization_id)
      .eq('is_active', true);

    if (zoneCheckError) {
      console.error('Zone check error:', zoneCheckError);
    }

    // Check for duplicate nearby zones (within 100m)
    const DUPLICATE_THRESHOLD_METERS = 100;
    const nearbyZone = existingZones?.find((zone) => {
      if (!zone.location_lat || !zone.location_lng) return false;
      const distance = calculateDistance(
        requestData.gps_latitude,
        requestData.gps_longitude,
        Number(zone.location_lat),
        Number(zone.location_lng)
      );
      return distance < DUPLICATE_THRESHOLD_METERS;
    });

    if (nearbyZone) {
      console.log('Nearby zone found:', nearbyZone.name);
      return new Response(
        JSON.stringify({
          success: false,
          reason: 'duplicate',
          existing_zone: nearbyZone,
          message: `Zone "${nearbyZone.name}" already exists nearby (within ${DUPLICATE_THRESHOLD_METERS}m)`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Create zone suggestion
    const { data: suggestion, error: suggestionError } = await supabaseClient
      .from('zone_creation_suggestions')
      .insert({
        organization_id: requestData.organization_id,
        parent_zone_id: requestData.parent_zone_id,
        suggested_name: zoneName,
        suggested_description: locationDescription,
        center_lat: requestData.gps_latitude,
        center_lng: requestData.gps_longitude,
        suggested_geometry: generateApproximatePolygon(
          requestData.gps_latitude,
          requestData.gps_longitude,
          locationType
        ),
        observation_count: 1,
        first_observation_id: requestData.observation_id,
        triggering_observations: [requestData.observation_id],
        location_type: locationType,
        confidence_score: confidenceScore,
        reverse_geocode_result: geocodeData,
        status: confidenceScore >= 0.8 ? 'auto_created' : 'pending',
      })
      .select()
      .single();

    if (suggestionError) {
      console.error('Suggestion creation error:', suggestionError);
      throw suggestionError;
    }

    console.log('Zone suggestion created:', suggestion);

    // Step 5: Auto-create zone if high confidence
    if (confidenceScore >= 0.8) {
      console.log('High confidence - auto-creating zone');
      
      const { data: newZone, error: zoneError } = await supabaseClient
        .from('zones')
        .insert({
          organization_id: requestData.organization_id,
          parent_zone_id: requestData.parent_zone_id,
          name: zoneName,
          description: locationDescription,
          location_lat: requestData.gps_latitude,
          location_lng: requestData.gps_longitude,
          geometry: generateApproximatePolygon(
            requestData.gps_latitude,
            requestData.gps_longitude,
            locationType
          ),
          zone_type: 'auto_generated',
          auto_created_from_observation: requestData.observation_id,
          needs_admin_review: false,
          boundary_source: 'approximated',
          is_active: true,
        })
        .select()
        .single();

      if (zoneError) {
        console.error('Zone creation error:', zoneError);
        // Don't fail the request - suggestion is still created
      } else {
        console.log('Zone auto-created:', newZone);
        
        // Update suggestion with created zone ID
        await supabaseClient
          .from('zone_creation_suggestions')
          .update({ created_zone_id: newZone.id })
          .eq('id', suggestion.id);

        return new Response(
          JSON.stringify({
            success: true,
            auto_created: true,
            zone: newZone,
            suggestion: suggestion,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Return pending suggestion for admin review
    return new Response(
      JSON.stringify({
        success: true,
        auto_created: false,
        suggestion: suggestion,
        message: `Zone suggestion created: "${zoneName}" (requires admin review)`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in suggest-new-zone:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateZoneName(geocode: ReverseGeocodeResult): string {
  const addr = geocode.address;

  // Priority 1: Named locations (parks, landmarks)
  if (addr.park) return addr.park;
  if (addr.amenity) return addr.amenity;
  if (addr.leisure) return addr.leisure;
  if (addr.tourism) return addr.tourism;
  if (geocode.name && geocode.category === 'natural') return geocode.name;

  // Priority 2: Roads with suburb
  if (addr.road && addr.suburb) {
    return `${addr.road}, ${addr.suburb}`;
  }

  // Priority 3: Just road
  if (addr.road) return addr.road;

  // Priority 4: Suburb or place
  if (addr.suburb) return `${addr.suburb} Area`;
  if (addr.place) return addr.place;

  // Fallback: Use display name first part
  const firstPart = geocode.display_name.split(',')[0];
  return firstPart || 'Unnamed Location';
}

function generateDescription(geocode: ReverseGeocodeResult): string {
  const addr = geocode.address;
  const parts: string[] = [];

  if (addr.road) parts.push(addr.road);
  if (addr.suburb) parts.push(addr.suburb);
  if (addr.city || addr.town) parts.push(addr.city || addr.town || '');

  return parts.length > 0 
    ? `Located at ${parts.join(', ')}`
    : `Near ${geocode.display_name.split(',').slice(0, 2).join(', ')}`;
}

function categorizeLocation(geocode: ReverseGeocodeResult): string {
  const addr = geocode.address;
  const category = geocode.category;
  const type = geocode.type;

  // Specific location types
  if (addr.park || category === 'leisure' || type === 'park') return 'park';
  if (addr.amenity === 'parking' || type === 'parking') return 'parking_lot';
  if (category === 'natural' || type === 'beach') return 'beach';
  if (addr.road && !addr.park && !addr.amenity) return 'street';
  if (category === 'amenity') return 'facility';

  return 'general';
}

function calculateConfidence(geocode: ReverseGeocodeResult): number {
  let confidence = 0.5; // Base confidence

  // High confidence indicators
  if (geocode.address.park) confidence += 0.3;
  if (geocode.address.amenity) confidence += 0.2;
  if (geocode.address.leisure) confidence += 0.2;
  if (geocode.name && geocode.category === 'natural') confidence += 0.3;

  // Medium confidence
  if (geocode.address.road && geocode.address.suburb) confidence += 0.2;

  // Low confidence penalty
  if (!geocode.address.park && !geocode.address.amenity && !geocode.address.road) {
    confidence -= 0.2;
  }

  return Math.min(Math.max(confidence, 0.1), 1.0);
}

function generateApproximatePolygon(
  lat: number,
  lng: number,
  locationType: string
): object {
  // Generate circular polygon based on location type
  const radiusMeters = locationType === 'park' ? 100 : 
                       locationType === 'parking_lot' ? 50 : 
                       locationType === 'beach' ? 150 : 75;

  const points = 8; // 8-sided polygon
  const earthRadius = 6371000; // meters

  const coordinates: number[][] = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    const newLat = lat + (dy / earthRadius) * (180 / Math.PI);
    const newLng = lng + (dx / earthRadius) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);

    coordinates.push([newLng, newLat]);
  }

  // Close the polygon
  coordinates.push(coordinates[0]);

  return {
    type: 'Polygon',
    coordinates: [coordinates],
  };
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
