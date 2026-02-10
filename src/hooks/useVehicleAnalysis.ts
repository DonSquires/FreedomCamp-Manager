/**
 * Hook: useVehicleAnalysis
 * Provides access to AI vehicle analysis and canonical vehicle management
 */

import { useState } from 'react';
import { getOrAnalyzeCanonicalVehicle, analyzeVehiclePhoto } from '@/lib/vehicleAnalysis';

interface UseVehicleAnalysisResult {
  getVehicleDetails: (plateNumber: string, photoUrl?: string) => Promise<{
    vehicleId: string;
    make: string | null;
    model: string | null;
    color: string | null;
    profilePhoto: string | null;
    wasAnalyzed: boolean;
  } | null>;
  triggerAnalysis: (plateNumber: string, photoUrl: string, force?: boolean) => Promise<boolean>;
  isAnalyzing: boolean;
}

export function useVehicleAnalysis(): UseVehicleAnalysisResult {
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const getVehicleDetails = async (plateNumber: string, photoUrl?: string) => {
    if (!plateNumber) return null;

    setIsAnalyzing(true);
    try {
      const result = await getOrAnalyzeCanonicalVehicle(plateNumber, photoUrl);
      
      return {
        vehicleId: result.vehicleId,
        make: result.details.vehicle_make,
        model: result.details.vehicle_model,
        color: result.details.vehicle_color,
        profilePhoto: result.details.profile_photo_url,
        wasAnalyzed: result.wasAnalyzed,
      };
    } catch (error) {
      console.error('Failed to get vehicle details:', error);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const triggerAnalysis = async (
    plateNumber: string,
    photoUrl: string,
    force: boolean = false
  ): Promise<boolean> => {
    setIsAnalyzing(true);
    try {
      const success = await analyzeVehiclePhoto(plateNumber, photoUrl, force);
      return success;
    } finally {
      setIsAnalyzing(false);
    }
  };

  return {
    getVehicleDetails,
    triggerAnalysis,
    isAnalyzing,
  };
}
