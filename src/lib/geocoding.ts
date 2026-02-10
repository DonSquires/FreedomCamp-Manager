/**
 * Geocoding Utilities - Reverse geocode GPS coordinates to addresses
 * Uses OpenStreetMap Nominatim API (no API key required)
 */

export interface ReverseGeocodeResult {
  formattedAddress: string;
  street?: string;
  suburb?: string;
  city?: string;
  region?: string;
  country?: string;
  postcode?: string;
}

/**
 * Reverse geocode GPS coordinates to address using OpenStreetMap Nominatim
 * Free service, no API key required
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?` +
      `format=json&lat=${latitude}&lon=${longitude}&` +
      `addressdetails=1&zoom=18`,
      {
        headers: {
          'User-Agent': 'FreedomCampManager/1.0', // Required by Nominatim
        },
      }
    );

    if (!response.ok) {
      console.error('Reverse geocoding failed:', response.statusText);
      return null;
    }

    const data = await response.json();

    if (!data || data.error) {
      console.error('Reverse geocoding error:', data?.error);
      return null;
    }

    const address = data.address || {};

    // Build formatted address from components
    const components: string[] = [];
    
    if (address.house_number) components.push(address.house_number);
    if (address.road) components.push(address.road);
    if (address.suburb) components.push(address.suburb);
    if (address.city || address.town || address.village) {
      components.push(address.city || address.town || address.village);
    }
    if (address.postcode) components.push(address.postcode);

    const formattedAddress = components.length > 0
      ? components.join(', ')
      : data.display_name || 'Unknown location';

    return {
      formattedAddress,
      street: address.road || address.pedestrian,
      suburb: address.suburb || address.neighbourhood,
      city: address.city || address.town || address.village,
      region: address.state || address.region,
      country: address.country,
      postcode: address.postcode,
    };
  } catch (error) {
    console.error('Reverse geocoding exception:', error);
    return null;
  }
}

/**
 * Format GPS coordinates as human-readable string
 */
export function formatCoordinates(latitude: number, longitude: number): string {
  const latDir = latitude >= 0 ? 'N' : 'S';
  const lngDir = longitude >= 0 ? 'E' : 'W';
  return `${Math.abs(latitude).toFixed(6)}°${latDir}, ${Math.abs(longitude).toFixed(6)}°${lngDir}`;
}
