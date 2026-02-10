/**
 * Geofence Utilities - Enhanced with auto-detection and sticky zone selection
 * Handles geofence detection and point-in-polygon calculations
 */

interface Point {
  lat: number;
  lng: number;
}

interface Zone {
  id: string;
  name: string;
  organization_id: string;
  geometry?: {
    type: 'Polygon' | 'Point';
    coordinates: number[][][] | number[];
    radius?: number; // For circle geofences
  };
  location_lat?: number;
  location_lng?: number;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const { lat, lng } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Convert GeoJSON polygon to Point array
 */
export function geoJsonToPoints(geometry: any): Point[] | null {
  if (!geometry || geometry.type !== 'Polygon') return null;

  const coordinates = geometry.coordinates[0]; // First ring is outer boundary
  return coordinates.map((coord: number[]) => ({
    lng: coord[0],
    lat: coord[1],
  }));
}

/**
 * Calculate distance between two GPS coordinates in meters (Haversine formula)
 */
export function calculateDistance(point1: Point, point2: Point): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const dLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((point1.lat * Math.PI) / 180) *
      Math.cos((point2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

/**
 * Find zone that contains the given GPS point (client-side)
 * Priority: 1) Exact geofence match, 2) Proximity to center, 3) "Other Location"
 */
export function findZoneByLocation(
  point: Point,
  zones: Zone[],
  proximityThresholdMeters: number = 500
): Zone | null {
  console.log('🔍 Finding zone for location:', point);
  console.log('📍 Available zones:', zones.length);

  // Filter out "Other Location" from geofence matching
  const geofencedZones = zones.filter(z => z.name !== 'Other Location');
  const otherLocation = zones.find(z => z.name === 'Other Location');

  // First try: exact geofence match (polygon)
  for (const zone of geofencedZones) {
    if (zone.geometry && zone.geometry.type === 'Polygon') {
      const polygon = geoJsonToPoints(zone.geometry);
      if (polygon && isPointInPolygon(point, polygon)) {
        console.log('✅ Found zone via polygon geofence:', zone.name);
        return zone;
      }
    }
  }

  // Second try: circle geofence match
  for (const zone of geofencedZones) {
    if (zone.geometry && zone.geometry.type === 'Point' && zone.geometry.radius) {
      const center: Point = {
        lng: (zone.geometry.coordinates as number[])[0],
        lat: (zone.geometry.coordinates as number[])[1],
      };
      const distance = calculateDistance(point, center);
      if (distance <= zone.geometry.radius) {
        console.log(`✅ Found zone via circle geofence: ${zone.name} (${Math.round(distance)}m from center)`);
        return zone;
      }
    }
  }

  // Third try: proximity to zone center point (if geofence not available)
  let closestZone: Zone | null = null;
  let minDistance = proximityThresholdMeters;

  for (const zone of geofencedZones) {
    if (zone.location_lat && zone.location_lng) {
      const zoneCenter: Point = {
        lat: parseFloat(zone.location_lat.toString()),
        lng: parseFloat(zone.location_lng.toString()),
      };

      const distance = calculateDistance(point, zoneCenter);

      if (distance < minDistance) {
        minDistance = distance;
        closestZone = zone;
      }
    }
  }

  if (closestZone) {
    console.log(`✅ Found zone via proximity: ${closestZone.name} (${Math.round(minDistance)}m away)`);
    return closestZone;
  }

  // Fourth: No match found - return "Other Location" if available
  if (otherLocation) {
    console.log('⚠️ No geofence match - using "Other Location"');
    return otherLocation;
  }

  console.log('❌ No zone found for this location');
  return null;
}

/**
 * Get current GPS location with high accuracy
 */
export function getCurrentLocation(
  onSuccess: (position: GeolocationPosition) => void,
  onError: (error: GeolocationPositionError) => void,
  options?: PositionOptions
): number {
  if (!('geolocation' in navigator)) {
    onError({
      code: 0,
      message: 'Geolocation not supported',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);
    return -1;
  }

  return navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
    ...options,
  });
}

/**
 * Stop watching GPS location
 */
export function stopWatchingLocation(watchId: number): void {
  if (watchId !== -1 && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Sticky zone storage - persists zone selection until officer leaves geofence
 */
const STICKY_ZONE_KEY = 'fc_sticky_zone';
const STICKY_ZONE_TIMESTAMP_KEY = 'fc_sticky_zone_timestamp';
const STICKY_ZONE_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours max stickiness

interface StickyZone {
  zoneId: string;
  zoneName: string;
  organizationId: string;
  timestamp: number;
}

export function getStickyZone(): StickyZone | null {
  try {
    const stored = localStorage.getItem(STICKY_ZONE_KEY);
    if (!stored) return null;

    const stickyZone: StickyZone = JSON.parse(stored);
    const now = Date.now();
    
    // Check if expired (4 hours)
    if (now - stickyZone.timestamp > STICKY_ZONE_EXPIRY_MS) {
      clearStickyZone();
      return null;
    }

    return stickyZone;
  } catch (error) {
    console.error('Failed to get sticky zone:', error);
    return null;
  }
}

export function setStickyZone(zone: { id: string; name: string; organization_id: string }): void {
  try {
    const stickyZone: StickyZone = {
      zoneId: zone.id,
      zoneName: zone.name,
      organizationId: zone.organization_id,
      timestamp: Date.now(),
    };
    localStorage.setItem(STICKY_ZONE_KEY, JSON.stringify(stickyZone));
    console.log('📌 Sticky zone set:', zone.name);
  } catch (error) {
    console.error('Failed to set sticky zone:', error);
  }
}

export function clearStickyZone(): void {
  try {
    localStorage.removeItem(STICKY_ZONE_KEY);
    console.log('🧹 Sticky zone cleared');
  } catch (error) {
    console.error('Failed to clear sticky zone:', error);
  }
}

/**
 * Verify if officer is still in sticky zone's geofence
 * If not, clear sticky zone
 */
export function verifyStickyZone(currentLocation: Point, zones: Zone[]): boolean {
  const stickyZone = getStickyZone();
  if (!stickyZone) return false;

  const zone = zones.find(z => z.id === stickyZone.zoneId);
  if (!zone) {
    clearStickyZone();
    return false;
  }

  const detectedZone = findZoneByLocation(currentLocation, zones);
  
  // If current location matches sticky zone, keep it
  if (detectedZone?.id === stickyZone.zoneId) {
    return true;
  }

  // If now in different zone or "Other Location", clear sticky zone
  console.log('🚶 Officer left sticky zone:', stickyZone.zoneName);
  clearStickyZone();
  return false;
}
