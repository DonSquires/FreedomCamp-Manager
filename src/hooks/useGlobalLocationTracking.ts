/**
 * Global GPS Location Tracking Hook
 * 
 * Provides continuous GPS tracking across entire app for:
 * - Officer welfare monitoring
 * - Automatic zone detection via geofencing
 * - Automatic patrol check-in/check-out
 * - Live admin tracking
 * - Photo evidence GPS watermarking
 * - Legal compliance and court-ready documentation
 * 
 * CRITICAL: This must run on ALL pages in Field Officer Portal
 */

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface GPSLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
  altitude?: number;
  heading?: number;
  speed?: number;
}

export interface Zone {
  id: string;
  name: string;
  organization_id: string;
  geometry?: any;
  location_lat?: number;
  location_lng?: number;
}

export interface ActivityUpdate {
  type: 'scanning' | 'investigating' | 'patrolling' | 'idle' | 'driving' | 'reporting';
  details?: string;
  plate_number?: string;
  zone_id?: string;
}

export function useGlobalLocationTracking(userId: string | undefined, organizationId: string | undefined) {
  const [currentLocation, setCurrentLocation] = useState<GPSLocation | null>(null);
  const [currentZone, setCurrentZone] = useState<Zone | null>(null);
  const [isTracking, setIsTracking] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);
  
  const watchIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const zonesRef = useRef<Zone[]>([]);
  const currentActivityRef = useRef<ActivityUpdate | null>(null);

  // Load zones for geofencing
  useEffect(() => {
    if (!organizationId) return;

    const loadZones = async () => {
      try {
        const { data: zones, error } = await supabase
          .from('zones')
          .select('id, name, organization_id, geometry, location_lat, location_lng')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        if (error) throw error;
        zonesRef.current = zones || [];
        console.log('✅ Loaded zones for geofencing:', zones?.length || 0);
      } catch (error: any) {
        console.error('❌ Failed to load zones:', error);
      }
    };

    loadZones();
  }, [organizationId]);

  // Find which zone the GPS coordinates are in
  const findZoneByGPS = (lat: number, lng: number): Zone | null => {
    const zones = zonesRef.current;

    // First pass: Check polygon geofences (most accurate)
    for (const zone of zones) {
      if (zone.geometry && zone.geometry.type === 'Polygon') {
        const coordinates = zone.geometry.coordinates[0];
        if (isPointInPolygon(lat, lng, coordinates)) {
          return zone;
        }
      }
    }

    // Second pass: Check point + radius (100m) for zones without polygons
    for (const zone of zones) {
      if (zone.location_lat && zone.location_lng && !zone.geometry) {
        const distance = calculateDistance(lat, lng, zone.location_lat, zone.location_lng);
        if (distance <= 100) {
          return zone;
        }
      }
    }

    return null; // Outside all geofenced zones
  };

  // Point-in-polygon algorithm
  const isPointInPolygon = (lat: number, lng: number, polygon: number[][]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];

      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Haversine distance calculation
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  // Send location update to database for admin live tracking
  const sendLocationUpdate = async (location: GPSLocation, zone: Zone | null, activity: ActivityUpdate | null) => {
    if (!userId) return;

    try {
      // Update officer_activity_log with GPS and current activity
      await supabase.from('officer_activity_log').insert({
        user_id: userId,
        organization_id: organizationId,
        activity_type: activity?.type || 'idle',
        gps_latitude: location.latitude,
        gps_longitude: location.longitude,
        gps_accuracy: location.accuracy,
        metadata: {
          zone_id: zone?.id,
          zone_name: zone?.name,
          activity_details: activity?.details,
          plate_number: activity?.plate_number,
          altitude: location.altitude,
          heading: location.heading,
          speed: location.speed,
        },
      });
    } catch (error: any) {
      console.error('❌ Failed to send location update:', error);
    }
  };

  // Handle zone change (auto patrol check-in/check-out)
  const handleZoneChange = async (newZone: Zone | null, oldZone: Zone | null) => {
    if (!userId) return;

    // Zone entry - check for assigned patrols
    if (newZone && newZone.id !== oldZone?.id) {
      console.log('📍 Entered zone:', newZone.name);

      try {
        const today = new Date().toISOString().split('T')[0];

        // Check for assigned patrol
        const { data: patrol, error } = await supabase
          .from('patrols')
          .select('*')
          .eq('zone_id', newZone.id)
          .eq('assigned_to', userId)
          .eq('patrol_date', today)
          .in('status', ['scheduled', 'in_progress'])
          .single();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        if (patrol && !patrol.checked_in_at) {
          // Auto check-in
          const { error: updateError } = await supabase
            .from('patrols')
            .update({
              checked_in_at: new Date().toISOString(),
              check_in_location_lat: currentLocation?.latitude,
              check_in_location_lng: currentLocation?.longitude,
              status: 'in_progress',
            })
            .eq('id', patrol.id);

          if (!updateError) {
            toast.success(`Auto checked in to patrol: ${newZone.name}`);
          }
        }
      } catch (error: any) {
        console.error('❌ Auto patrol check-in failed:', error);
      }
    }

    // Zone exit - complete patrol if applicable
    if (oldZone && (!newZone || newZone.id !== oldZone.id)) {
      console.log('📍 Exited zone:', oldZone.name);

      try {
        const { data: patrol, error } = await supabase
          .from('patrols')
          .select('*')
          .eq('zone_id', oldZone.id)
          .eq('assigned_to', userId)
          .eq('status', 'in_progress')
          .single();

        if (error && error.code !== 'PGRST116') {
          throw error;
        }

        if (patrol) {
          // Auto complete patrol
          const { error: updateError } = await supabase
            .from('patrols')
            .update({
              completed_at: new Date().toISOString(),
              status: 'completed',
            })
            .eq('id', patrol.id);

          if (!updateError) {
            toast.info(`Auto completed patrol: ${oldZone.name}`);
          }
        }
      } catch (error: any) {
        console.error('❌ Auto patrol completion failed:', error);
      }
    }
  };

  // Start GPS tracking
  useEffect(() => {
    if (!isTracking || !userId) {
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsError('GPS not supported on this device');
      return;
    }

    console.log('🌍 Starting global GPS tracking...');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;

        // Validate GPS accuracy (court-ready evidence requires good accuracy)
        if (accuracy > 100) {
          setGpsError(`GPS accuracy poor: ${accuracy.toFixed(0)}m (need ≤100m)`);
          return;
        } else {
          setGpsError(null);
        }

        const location: GPSLocation = {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date(),
          altitude: altitude || undefined,
          heading: heading || undefined,
          speed: speed || undefined,
        };

        setCurrentLocation(location);

        // Find which zone we're in
        const detectedZone = findZoneByGPS(latitude, longitude);
        
        // Zone change detection
        if (detectedZone?.id !== currentZone?.id) {
          handleZoneChange(detectedZone, currentZone);
          setCurrentZone(detectedZone);
        }

        // Send location update every 10 seconds (not every GPS ping)
        const now = Date.now();
        if (now - lastUpdateRef.current >= 10000) {
          sendLocationUpdate(location, detectedZone, currentActivityRef.current);
          lastUpdateRef.current = now;
        }
      },
      (error) => {
        console.error('❌ GPS error:', error);
        setGpsError(error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        console.log('🛑 Stopping GPS tracking');
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isTracking, userId, currentZone]);

  // Public method to update current activity
  const updateActivity = (activity: ActivityUpdate) => {
    currentActivityRef.current = activity;
    
    // Immediately send activity update
    if (currentLocation) {
      sendLocationUpdate(currentLocation, currentZone, activity);
    }
  };

  return {
    currentLocation,
    currentZone,
    isTracking,
    setIsTracking,
    gpsError,
    updateActivity,
  };
}
