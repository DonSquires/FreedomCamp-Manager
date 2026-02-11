/**
 * Vehicle Analysis Helper
 * Handles AI-powered vehicle detail extraction and canonical vehicle management
 */

import { supabase } from './supabase';

interface CanonicalVehicleDetails {
  vehicle_id: string;
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  profile_photo_url: string | null;
}

interface VehicleAnalysisResult {
  vehicleId: string;
  details: CanonicalVehicleDetails;
  wasAnalyzed: boolean;
}

/**
 * Get or create canonical vehicle with AI-analyzed details
 * This is the main function to call when recording a vehicle observation
 * 
 * @param plateNumber - License plate number
 * @param photoUrl - Optional photo URL to analyze if vehicle is new
 * @returns Canonical vehicle details and whether AI analysis was performed
 */
export async function getOrAnalyzeCanonicalVehicle(
  plateNumber: string,
  photoUrl?: string
): Promise<VehicleAnalysisResult> {
  if (!plateNumber) {
    throw new Error('Plate number is required');
  }

  // Check if canonical vehicle exists
  const { data: existing, error: fetchError } = await supabase
    .from('canonical_vehicles')
    .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, profile_photo_url')
    .eq('plate_number', plateNumber.trim().toUpperCase())
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Failed to fetch canonical vehicle:', fetchError);
    throw new Error('Failed to check vehicle records');
  }

  // If vehicle exists with details, return it (no analysis needed)
  if (existing?.vehicle_make && existing?.vehicle_model) {
    console.log(`✅ Using existing vehicle details for ${plateNumber}`);
    return {
      vehicleId: existing.vehicle_id,
      details: existing as CanonicalVehicleDetails,
      wasAnalyzed: false,
    };
  }

  // If vehicle exists but no details, and we have a photo, analyze it
  if (existing && photoUrl) {
    console.log(`🔍 Analyzing photo to populate details for ${plateNumber}`);
    
    try {
      const { data: analysisResult, error: analysisError } = await supabase.functions.invoke(
        'analyze-vehicle-photo',
        {
          body: {
            plateNumber: plateNumber.trim().toUpperCase(),
            photoUrl,
            vehicleId: existing.vehicle_id,
          },
        }
      );

      if (analysisError) {
        console.error('AI analysis failed:', analysisError);
        // Return existing vehicle without analysis
        return {
          vehicleId: existing.vehicle_id,
          details: existing as CanonicalVehicleDetails,
          wasAnalyzed: false,
        };
      }

      // Fetch updated vehicle details
      const { data: updated } = await supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, profile_photo_url')
        .eq('vehicle_id', existing.vehicle_id)
        .single();

      return {
        vehicleId: existing.vehicle_id,
        details: updated as CanonicalVehicleDetails,
        wasAnalyzed: true,
      };
    } catch (error) {
      console.error('Error during vehicle analysis:', error);
      // Return existing vehicle without analysis
      return {
        vehicleId: existing.vehicle_id,
        details: existing as CanonicalVehicleDetails,
        wasAnalyzed: false,
      };
    }
  }

  // Vehicle doesn't exist - create it (will be analyzed later when photo is available)
  console.log(`🆕 Creating new canonical vehicle for ${plateNumber}`);
  
  const { data: newVehicle, error: createError } = await supabase
    .from('canonical_vehicles')
    .insert({
      plate_number: plateNumber.trim().toUpperCase(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      total_observations: 0,
    })
    .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, profile_photo_url')
    .single();

  if (createError) {
    console.error('Failed to create canonical vehicle:', createError);
    throw new Error('Failed to create vehicle record');
  }

  // If we have a photo for the new vehicle, analyze it now
  if (photoUrl) {
    try {
      await supabase.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber: plateNumber.trim().toUpperCase(),
          photoUrl,
          vehicleId: newVehicle.vehicle_id,
        },
      });

      // Fetch updated details
      const { data: analyzed } = await supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, profile_photo_url')
        .eq('vehicle_id', newVehicle.vehicle_id)
        .single();

      return {
        vehicleId: newVehicle.vehicle_id,
        details: analyzed as CanonicalVehicleDetails,
        wasAnalyzed: true,
      };
    } catch (error) {
      console.error('Failed to analyze new vehicle photo:', error);
    }
  }

  return {
    vehicleId: newVehicle.vehicle_id,
    details: newVehicle as CanonicalVehicleDetails,
    wasAnalyzed: false,
  };
}

/**
 * Trigger AI analysis for a specific vehicle
 * Use this to manually re-analyze a vehicle or force analysis
 * 
 * @param plateNumber - License plate number
 * @param photoUrl - Photo URL to analyze
 * @param forceUpdate - Force update even if details already exist
 */
export async function analyzeVehiclePhoto(
  plateNumber: string,
  photoUrl: string,
  forceUpdate: boolean = false
): Promise<boolean> {
  try {
    const { data: vehicle } = await supabase
      .from('canonical_vehicles')
      .select('vehicle_id, vehicle_make, vehicle_model')
      .eq('plate_number', plateNumber.trim().toUpperCase())
      .single();

    if (!vehicle) {
      throw new Error('Vehicle not found');
    }

    // Skip if details exist and not forcing update
    if (!forceUpdate && vehicle.vehicle_make && vehicle.vehicle_model) {
      console.log(`ℹ️ Vehicle ${plateNumber} already has details, skipping analysis`);
      return false;
    }

    const { error } = await supabase.functions.invoke('analyze-vehicle-photo', {
      body: {
        plateNumber: plateNumber.trim().toUpperCase(),
        photoUrl,
        vehicleId: vehicle.vehicle_id,
      },
    });

    if (error) {
      console.error('AI analysis failed:', error);
      return false;
    }

    console.log(`✅ Successfully analyzed vehicle ${plateNumber}`);
    return true;
  } catch (error) {
    console.error('Error analyzing vehicle photo:', error);
    return false;
  }
}
