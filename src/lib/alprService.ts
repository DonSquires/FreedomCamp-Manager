/**
 * ALPR Service
 * Handles authenticated calls to the alpr-process Edge Function.
 * Uses a direct fetch with Authorization header to fix 403 errors,
 * and sends a base64-encoded image payload to fix 400 errors.
 */

import { supabase } from './supabase';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://xbfnlzmpumthnjmtqufp.supabase.co';

export interface ScanVehicleMetadata {
  publicUrl: string;
  hash: string;
  lat: number;
  lng: number;
  accuracy?: number;
  orgId: string;
  zoneId: string;
}

/**
 * Scan a vehicle image via the alpr-process Edge Function.
 *
 * @param file     - The image File or Blob captured from the camera.
 * @param metadata - Photo URL, hash, GPS coordinates, org/zone IDs.
 * @returns        - Parsed JSON response from the Edge Function.
 */
export async function scanVehicle(
  file: File | Blob,
  metadata: ScanVehicleMetadata
): Promise<any> {
  // 1. Get Current Session (Required for 403 Fix)
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please log in to scan vehicles.');

  // 2. Convert File to Base64 (Required for 400 Fix)
  const toBase64 = (f: File | Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(f);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  const base64Image = await toBase64(file);

  // 3. Construct Strict Payload
  const payload = {
    image: base64Image,
    photo_url: metadata.publicUrl,
    photo_hash: metadata.hash,
    // Ensure numbers are numbers
    gpsLatitude: Number(metadata.lat),
    gpsLongitude: Number(metadata.lng),
    gpsAccuracy: Number(metadata.accuracy || 0),
    // Metadata
    officerId: session.user.id,
    organizationId: metadata.orgId,
    zoneId: metadata.zoneId,
    idempotencyKey: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    // Config
    regions: ['nz'],
    mmc: true,
  };

  // 4. Send Request
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/alpr-process`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`, // THE FIX for 403
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[${response.status}] ${errorText || response.statusText}`);
  }

  return await response.json();
}
