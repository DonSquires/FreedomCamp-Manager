/**
 * LINZ Parcel Boundary Service
 * Checks if coordinates intersect with property parcel boundaries using LINZ OGC WFS API
 * Stage 2a of the 3-stage dispatch verification pipeline
 * References: LINZ Layer 50785 (NZ Primary Parcels)
 */

interface ParcelBoundaryResult {
  insideParcel: boolean;
  parcelId: string | null;
  titleReference: string | null;
  ownershipType?: string;
  area?: number; // in square meters
  error?: string;
}

const LINZ_API_KEY = import.meta.env.VITE_LINZ_DATA_SERVICE_API_KEY;

/**
 * Performs point-in-polygon spatial calculation against LINZ Primary Parcels
 * Returns parcel ownership and legal boundary information
 */
export async function checkParcelIntersection(
  lat: number,
  lng: number
): Promise<ParcelBoundaryResult> {
  try {
    if (!LINZ_API_KEY) {
      throw new Error('LINZ_DATA_SERVICE_API_KEY not configured');
    }

    // Construct OGC WFS spatial filter request mapping coordinates against LINZ Primary Parcels (Layer 50785)
    const layerId = '50785'; // NZ Primary Parcels Layer
    const cqlFilter = `INTERSECTS(shape, POINT(${lng} ${lat}))`;
    const url = `https://linz.govt.nz/services/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-${layerId}&outputFormat=json&CQL_FILTER=${encodeURIComponent(cqlFilter)}&key=${LINZ_API_KEY}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `LINZ Landonline API fallback failed with status: ${response.status}`
      );
    }

    const geoJson = await response.json();
    const features = geoJson.features || [];

    if (features.length === 0) {
      return {
        insideParcel: false,
        parcelId: null,
        titleReference: null,
      };
    }

    // Extract parcel markers directly from the primary matching feature properties
    const targetParcel = features[0];
    const parcelProps = targetParcel.properties || {};

    return {
      insideParcel: true,
      parcelId: parcelProps.id || parcelProps.parcel_number || String(targetParcel.id),
      titleReference:
        parcelProps.title_no ||
        parcelProps.land_district ||
        'No Title Reference Registered',
      ownershipType: parcelProps.ownership_type || 'Unknown',
      area: parcelProps.area_sq_meters || null,
    };
  } catch (error: any) {
    console.error('🚨 LINZ Spatial Parse Exception:', error.message);
    return {
      insideParcel: false,
      parcelId: null,
      titleReference: null,
      error: error.message,
    };
  }
}

/**
 * Batch check multiple coordinates against parcel boundaries
 */
export async function checkParcelIntersectionBatch(
  coordinates: Array<{ lat: number; lng: number }>
): Promise<ParcelBoundaryResult[]> {
  return Promise.all(
    coordinates.map(({ lat, lng }) => checkParcelIntersection(lat, lng))
  );
}

/**
 * Check if a coordinate is on a private vs public property
 * Uses ownership type field from LINZ parcel data
 */
export async function isPrivateProperty(
  lat: number,
  lng: number
): Promise<boolean> {
  const result = await checkParcelIntersection(lat, lng);

  if (!result.insideParcel) {
    return false; // Public/unregistered land
  }

  const privateIndicators = ['PRIVATE', 'FREEHOLD', 'LEASEHOLD', 'TITLE'];
  const ownershipType = (result.ownershipType || '').toUpperCase();

  return privateIndicators.some((indicator) =>
    ownershipType.includes(indicator)
  );
}
