/**
 * IncidentCreationForm - Create incident reports from scans
 * Pre-populated with vehicle details, zone, GPS, and photo evidence
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { SessionScan } from './SessionList';
import { IncidentSubmittedModal } from './IncidentSubmittedModal';
import { findZoneByLocation } from '@/lib/geofence';
import { useAuthStore } from '@/stores/authStore';

interface IncidentCreationFormProps {
  scan: SessionScan;
  onClose: () => void;
  onSuccess?: (incidentId: string) => void;
}

const INCIDENT_TYPES = [
  'Trespassing',
  'Vandalism',
  'Theft',
  'Suspicious Activity',
  'Noise Complaint',
  'Environmental Hazard',
  'Property Damage',
  'Unauthorized Camping',
  'Other',
];

const SEVERITY_LEVELS = [
  { value: 'low', label: 'Low', color: 'bg-blue-500' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-500' },
  { value: 'high', label: 'High', color: 'bg-red-500' },
  { value: 'critical', label: 'Critical', color: 'bg-purple-500' },
];

export function IncidentCreationForm({ scan, onClose, onSuccess }: IncidentCreationFormProps) {
  const { user } = useAuthStore();
  const [incidentType, setIncidentType] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [submittedIncidentId, setSubmittedIncidentId] = useState<string | null>(null);
  const [detectedZone, setDetectedZone] = useState<{ id: string; name: string; organizationId: string } | null>(null);
  const [zones, setZones] = useState<{ id: string; name: string; organization_id: string }[]>([]);

  // Load zones on mount for geofence detection
  useState(() => {
    const loadZonesAndDetect = async () => {
      try {
        // Get user's organization
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (!profile?.organization_id) return;

        // Load all zones for this organization
        const { data: zonesData, error } = await supabase
          .from('zones')
          .select('id, name, organization_id, geometry, location_lat, location_lng')
          .eq('organization_id', profile.organization_id)
          .eq('is_active', true);

        if (error) {
          console.error('Failed to load zones:', error);
          return;
        }

        if (zonesData) {
          setZones(zonesData);
          
          // Try to get current GPS location and detect zone
          if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const point = {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                };
                
                const zone = findZoneByLocation(point, zonesData);
                if (zone) {
                  setDetectedZone({
                    id: zone.id,
                    name: zone.name,
                    organizationId: zone.organization_id,
                  });
                  console.log('📍 Auto-detected zone from GPS:', zone.name);
                  toast.info(`📍 Zone auto-detected: ${zone.name}`, { duration: 3000 });
                }
              },
              (error) => {
                console.warn('GPS detection failed:', error);
              },
              { enableHighAccuracy: true, timeout: 5000 }
            );
          }
        }
      } catch (error) {
        console.error('Failed to load zones for geofence detection:', error);
      }
    };
    
    loadZonesAndDetect();
  });

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      setPhotos(prev => [...prev, ...Array.from(files)]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!incidentType || !description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload photos to storage
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `incidents/${Date.now()}_${Math.random().toString(36).slice(2)}_${photo.name}`;
        const { error: uploadError } = await supabase.storage
          .from('incident-evidence')
          .upload(fileName, photo);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('incident-evidence')
          .getPublicUrl(fileName);

        photoUrls.push(publicUrl);
      }

      // Get current GPS location
      let gpsLocation: { lat: number; lng: number; accuracy?: number } | null = null;
      let linkedObservationId: string | null = null;
      
      if ('geolocation' in navigator) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
            });
          });
          gpsLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
        } catch (error) {
          console.warn('GPS not available, searching for observation:', error);
        }
      }

      // If GPS not available, find observation from SAME SHIFT and use its GPS
      if (!gpsLocation) {
        console.log('🔍 Searching for observation in same shift to link GPS coordinates...');
        
        // Get incident time in NZ timezone
        const incidentTime = new Date();
        const nzTime = new Date(incidentTime.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
        const hour = nzTime.getHours();
        const isNightShift = hour >= 18 || hour < 6;
        
        // Calculate shift boundaries (6:00-18:00 day, 18:00-06:00 night)
        const shiftStart = new Date(nzTime);
        if (isNightShift && hour < 6) {
          // Night shift that started yesterday at 18:00
          shiftStart.setDate(shiftStart.getDate() - 1);
          shiftStart.setHours(18, 0, 0, 0);
        } else if (isNightShift) {
          // Night shift starting today at 18:00
          shiftStart.setHours(18, 0, 0, 0);
        } else {
          // Day shift starting today at 06:00
          shiftStart.setHours(6, 0, 0, 0);
        }
        
        const shiftEnd = new Date(shiftStart);
        shiftEnd.setHours(shiftStart.getHours() + 12); // 12-hour shift period

        console.log('🕐 Shift period:', {
          shiftType: isNightShift ? 'night' : 'day',
          start: shiftStart.toISOString(),
          end: shiftEnd.toISOString(),
        });

        // Query for observations of this vehicle in the SAME SHIFT period
        const { data: observations, error: obsError } = await supabase
          .from('observations')
          .select('observation_id, gps_latitude, gps_longitude, gps_accuracy, recorded_at, zone_id, plate_number')
          .eq('plate_number', scan.plateNumber)
          .eq('zone_id', scan.zoneId) // Same zone
          .gte('recorded_at', shiftStart.toISOString())
          .lte('recorded_at', shiftEnd.toISOString())
          .not('gps_latitude', 'is', null)
          .not('gps_longitude', 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(5);

        if (obsError) {
          console.error('Failed to query observations:', obsError);
        } else if (observations && observations.length > 0) {
          // Use the most recent observation from the SAME SHIFT
          const recentObs = observations[0];
          gpsLocation = {
            lat: Number(recentObs.gps_latitude),
            lng: Number(recentObs.gps_longitude),
            accuracy: recentObs.gps_accuracy ? Number(recentObs.gps_accuracy) : undefined,
          };
          linkedObservationId = recentObs.observation_id;
          
          console.log('✅ Found observation GPS from same shift:', {
            observationId: linkedObservationId,
            lat: gpsLocation.lat,
            lng: gpsLocation.lng,
            recordedAt: recentObs.recorded_at,
            shiftPeriod: isNightShift ? 'night (18:00-06:00)' : 'day (06:00-18:00)',
          });
          
          toast.info(`GPS linked from same ${isNightShift ? 'night' : 'day'} shift observation`, {
            duration: 3000,
          });
        } else {
          console.warn('⚠️ No observations with GPS found in same shift period');
          toast.warning('No GPS available from current shift - incident will be created without location');
        }
      }

      // Use detected zone if available (from GPS), otherwise fall back to scan zone
      const finalZoneId = detectedZone?.id || scan.zoneId;
      const finalOrgId = detectedZone?.organizationId || scan.organizationId;
      
      // Create incident record with observation link and GPS source tracking
      const shiftType = (() => {
        const h = new Date().getHours();
        return (h >= 18 || h < 6) ? 'night' : 'day';
      })();
      
      const incidentData: any = {
        organization_id: finalOrgId,
        zone_id: finalZoneId,
        plate_number: scan.plateNumber,
        incident_type: incidentType,
        description: linkedObservationId 
          ? `${description}\n\n📍 GPS coordinates sourced from observation ${linkedObservationId.slice(0, 8)}... recorded during same ${shiftType} shift (${shiftType === 'night' ? '18:00-06:00' : '06:00-18:00'}).${detectedZone ? `\n🌍 Zone auto-detected from GPS: ${detectedZone.name}` : ''}`
          : `${description}${detectedZone ? `\n\n🌍 Zone auto-detected from GPS: ${detectedZone.name}` : ''}`,
        severity,
        status: 'pending',
        photos: photoUrls,
        gps_latitude: gpsLocation?.lat || null,
        gps_longitude: gpsLocation?.lng || null,
        gps_accuracy: gpsLocation?.accuracy || null,
        happened_at: new Date().toISOString(),
        court_ready: false,
      };

      const { data: incident, error: incidentError } = await supabase
        .from('incidents')
        .insert(incidentData)
        .select('id')
        .single();

      if (incidentError) throw incidentError;

      // If we linked to an observation, log it in description for audit trail
      if (linkedObservationId) {
        console.log('✅ Incident created with linked observation GPS:', {
          incidentId: incident.id,
          observationId: linkedObservationId,
          gpsLat: gpsLocation?.lat,
          gpsLng: gpsLocation?.lng,
        });
      }
      
      // Show submission notification modal instead of toast
      setSubmittedIncidentId(incident.id);
      setShowSubmittedModal(true);
    } catch (error: any) {
      console.error('Failed to create incident:', error);
      toast.error('Failed to create incident: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle modal acknowledgement
  const handleAcknowledge = () => {
    setShowSubmittedModal(false);
    onSuccess?.(submittedIncidentId!);
    onClose();
  };

  const handleUpdate = () => {
    setShowSubmittedModal(false);
    // Keep form open for updates
  };

  if (showSubmittedModal && submittedIncidentId) {
    return (
      <IncidentSubmittedModal
        incidentId={submittedIncidentId}
        plateNumber={scan.plateNumber}
        incidentType={incidentType}
        onAcknowledge={handleAcknowledge}
        onUpdate={handleUpdate}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-card z-10 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Create Incident Report
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Pre-populated Vehicle Info */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Vehicle</p>
                <p className="text-lg font-mono font-bold">{scan.plateNumber}</p>
                {scan.vehicleMake && (
                  <p className="text-xs text-muted-foreground">
                    {scan.vehicleColor && `${scan.vehicleColor} `}
                    {scan.vehicleMake} {scan.vehicleModel}
                  </p>
                )}
              </div>
              <Badge variant={scan.isCompliant ? 'default' : 'destructive'}>
                {scan.isCompliant ? 'Compliant' : 'Non-Compliant'}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {detectedZone ? (
                  <span className="text-green-600 dark:text-green-400 font-semibold">
                    {detectedZone.name} (Auto-detected)
                  </span>
                ) : (
                  scan.zoneName
                )}
              </div>
              <div>
                {scan.timestamp.toLocaleString('en-NZ', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Pacific/Auckland',
                })}
              </div>
            </div>
            {detectedZone && detectedZone.id !== scan.zoneId && (
              <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-700 dark:text-green-300">
                  📍 Your GPS location detected you in <strong>{detectedZone.name}</strong> zone. This will be used for the incident report.
                </p>
              </div>
            )}
          </div>

          {/* Incident Type */}
          <div>
            <Label htmlFor="incident-type">
              Incident Type <span className="text-red-500">*</span>
            </Label>
            <Select value={incidentType} onValueChange={setIncidentType}>
              <SelectTrigger id="incident-type" className="mt-1">
                <SelectValue placeholder="Select incident type" />
              </SelectTrigger>
              <SelectContent>
                {INCIDENT_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Severity */}
          <div>
            <Label htmlFor="severity">Severity Level</Label>
            <div className="grid grid-cols-4 gap-2 mt-2">
              {SEVERITY_LEVELS.map(level => (
                <button
                  key={level.value}
                  onClick={() => setSeverity(level.value)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    severity === level.value
                      ? `border-primary ${level.color} text-white`
                      : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <p className="text-sm font-semibold">{level.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide detailed description of the incident..."
              className="mt-1 min-h-32"
            />
          </div>

          {/* Photo Upload */}
          <div>
            <Label>Additional Evidence Photos</Label>
            <div className="mt-2 space-y-3">
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
                id="photo-upload"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('photo-upload')?.click()}
                className="w-full"
              >
                <Camera className="h-4 w-4 mr-2" />
                Add Photos ({photos.length})
              </Button>

              {/* Photo Previews */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-24 object-cover rounded-lg border"
                      />
                      <button
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !incidentType || !description.trim()}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Create Incident
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
