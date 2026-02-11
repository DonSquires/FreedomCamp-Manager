import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface VehiclePhoto {
  plate_number: string;
  profile_photo: string | null;
  photo_count: number;
  latest_photo_date: string | null;
}

/**
 * Get the best profile photo for a vehicle based on AI selection
 * Falls back to most recent photo if no AI selection available
 * Selection criteria:
 * 1. AI-selected profile photo from canonical_vehicles (if available)
 * 2. Most recent record with a photo (fallback)
 */
export function useVehicleProfilePhoto(plateNumber: string) {
  return useQuery({
    queryKey: ['vehicle_profile_photo', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return null;

      // First, check if we have an AI-selected profile photo in canonical_vehicles
      const { data: canonical } = await supabase
        .from('canonical_vehicles')
        .select('profile_photo_url, profile_photo_score, profile_photo_updated_at')
        .eq('plate_number', plateNumber.trim())
        .single();

      // If we have an AI-selected photo, use it
      if (canonical?.profile_photo_url) {
        return {
          url: canonical.profile_photo_url,
          recorded_at: canonical.profile_photo_updated_at || new Date().toISOString(),
          total_photos: 1,
          score: canonical.profile_photo_score,
          is_ai_selected: true,
        };
      }

      // Fallback: Fetch all records for this plate number that have photos
      const { data: records, error } = await supabase
        .from('vehicle_records')
        .select('evidence_photos, recorded_at')
        .ilike('plate_number', plateNumber.trim())
        .not('evidence_photos', 'is', null)
        .order('recorded_at', { ascending: false });

      if (error) throw error;
      if (!records || records.length === 0) return null;

      // Find the most recent record with photos
      for (const record of records) {
        const photos = record.evidence_photos as string[];
        if (photos && Array.isArray(photos) && photos.length > 0) {
          // Return the first photo from the most recent record
          return {
            url: photos[0],
            recorded_at: record.recorded_at,
            total_photos: photos.length,
            is_ai_selected: false,
          };
        }
      }

      return null;
    },
    enabled: !!plateNumber,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

/**
 * Get profile photos for multiple vehicles at once (batch query)
 */
export function useVehicleProfilePhotos(plateNumbers: string[]) {
  return useQuery({
    queryKey: ['vehicle_profile_photos', plateNumbers.sort().join(',')],
    queryFn: async () => {
      if (!plateNumbers || plateNumbers.length === 0) return {};

      const photoMap: Record<string, { url: string; recorded_at: string; total_photos: number } | null> = {};

      // Process each plate number
      for (const plate of plateNumbers) {
        const { data: records } = await supabase
          .from('vehicle_records')
          .select('evidence_photos, recorded_at')
          .ilike('plate_number', plate.trim())
          .not('evidence_photos', 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(5); // Only check last 5 records for performance

        if (records && records.length > 0) {
          // Find first record with photos
          for (const record of records) {
            const photos = record.evidence_photos as string[];
            if (photos && Array.isArray(photos) && photos.length > 0) {
              photoMap[plate] = {
                url: photos[0],
                recorded_at: record.recorded_at,
                total_photos: photos.length,
              };
              break;
            }
          }
        }

        if (!photoMap[plate]) {
          photoMap[plate] = null;
        }
      }

      return photoMap;
    },
    enabled: plateNumbers.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Get all photos for a vehicle across all records
 */
export function useVehicleAllPhotos(plateNumber: string) {
  return useQuery({
    queryKey: ['vehicle_all_photos', plateNumber],
    queryFn: async () => {
      if (!plateNumber) return [];

      const { data: records, error } = await supabase
        .from('vehicle_records')
        .select('id, evidence_photos, recorded_at, zone:zones(name)')
        .ilike('plate_number', plateNumber.trim())
        .not('evidence_photos', 'is', null)
        .order('recorded_at', { ascending: false });

      if (error) throw error;
      if (!records) return [];

      // Flatten all photos with metadata
      const allPhotos: Array<{
        url: string;
        recorded_at: string;
        record_id: string;
        zone_name: string | null;
      }> = [];

      records.forEach(record => {
        const photos = record.evidence_photos as string[];
        if (photos && Array.isArray(photos)) {
          photos.forEach(url => {
            allPhotos.push({
              url,
              recorded_at: record.recorded_at,
              record_id: record.id,
              zone_name: (record.zone as any)?.name || null,
            });
          });
        }
      });

      return allPhotos;
    },
    enabled: !!plateNumber,
  });
}
