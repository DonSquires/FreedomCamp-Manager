/**
 * VehicleDetailsView - Comprehensive vehicle profile with history
 * Shows full observation history, compliance timeline, flagged status, and evidence
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  X,
  MapPin,
  Calendar,
  Flag,
  CheckCircle2,
  AlertTriangle,
  Image as ImageIcon,
  FileText,
  Loader2,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { SessionScan } from './SessionList';

interface VehicleDetailsViewProps {
  scan: SessionScan;
  onClose: () => void;
}

interface Observation {
  observation_id: string;
  recorded_at: string;
  zone_id: string;
  zones?: { name: string };
  is_compliant: boolean;
  gps_latitude: number | null;
  gps_longitude: number | null;
  photo: string | null;
  officer_notes: string | null;
  has_notes: boolean;
  notes_reference_previous: boolean;
  recorded_by_name: string | null;
}

interface VehicleInfo {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  is_flagged: boolean;
  flagged_reason: string | null;
  flagged_priority: string | null;
  homeless_status: string;
  homeless_confirmed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  total_observations: number;
  total_notes: number;
  last_note_preview: string | null;
}

export function VehicleDetailsView({ scan, onClose }: VehicleDetailsViewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [vehicleInfo, setVehicleInfo] = useState<VehicleInfo | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  useEffect(() => {
    loadVehicleDetails();
  }, [scan.vehicleId]);

  const loadVehicleDetails = async () => {
    setIsLoading(true);
    try {
      // Load vehicle info from NEW SCHEMA (plate_number is PK)
      const { data: vehicle, error: vehicleError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', scan.plateNumber)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicleInfo(vehicle);

      // Load observations from observations (NEW SCHEMA)
      const { data: obs, error: obsError } = await supabase
        .from('observations')
        .select(`
          observation_id,
          recorded_at,
          zone_id,
          zones (name),
          is_compliant,
          gps_latitude,
          gps_longitude,
          photo,
          officer_notes,
          has_notes,
          notes_reference_previous,
          user_profiles!observations_user_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq('plate_number', scan.plateNumber)
        .order('recorded_at', { ascending: false })
        .limit(50);

      if (obsError) throw obsError;
      
      // Format observations
      const formattedObs = (obs || []).map(o => ({
        ...o,
        recorded_by_name: o.user_profiles
          ? `${(o.user_profiles as any).first_name} ${(o.user_profiles as any).last_name}`
          : null,
      }));
      
      setObservations(formattedObs);

    } catch (error: any) {
      console.error('Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <Card className="w-full max-w-4xl max-h-[90vh]">
          <CardContent className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-muted-foreground">Loading vehicle details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!vehicleInfo) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-4xl my-8">
        <CardHeader className="sticky top-0 bg-card z-10 border-b">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl font-mono">{vehicleInfo.plate_number}</CardTitle>
              {vehicleInfo.vehicle_make && (
                <p className="text-sm text-muted-foreground">
                  {vehicleInfo.vehicle_color && `${vehicleInfo.vehicle_color} `}
                  {vehicleInfo.vehicle_make} {vehicleInfo.vehicle_model}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Status Badges */}
          <div className="flex flex-wrap gap-2">
            {vehicleInfo.is_flagged && (
              <Badge variant="destructive" className="gap-1">
                <Flag className="h-3 w-3" />
                Flagged - {vehicleInfo.flagged_priority}
              </Badge>
            )}
            {vehicleInfo.homeless_status === 'confirmed' && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Homeless Confirmed
              </Badge>
            )}
            {vehicleInfo.homeless_status === 'claimed' && (
              <Badge variant="outline">
                Homeless Claimed
              </Badge>
            )}
            {vehicleInfo.total_notes > 0 && (
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" />
                {vehicleInfo.total_notes} Note{vehicleInfo.total_notes !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {/* Flagged Reason */}
          {vehicleInfo.is_flagged && vehicleInfo.flagged_reason && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                ⚠️ Flagged Vehicle Alert
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">
                {vehicleInfo.flagged_reason}
              </p>
            </div>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Total Observations</p>
              <p className="text-2xl font-black">{vehicleInfo.total_observations}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">First Seen</p>
              <p className="text-sm font-semibold">
                {new Date(vehicleInfo.first_seen_at).toLocaleDateString('en-NZ')}
              </p>
            </div>
            <div className="p-4 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
              <p className="text-sm font-semibold">
                {new Date(vehicleInfo.last_seen_at).toLocaleDateString('en-NZ')}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="history">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="history">
                <Clock className="h-4 w-4 mr-2" />
                History
              </TabsTrigger>
              <TabsTrigger value="photos">
                <ImageIcon className="h-4 w-4 mr-2" />
                Photos
              </TabsTrigger>
              <TabsTrigger value="timeline">
                <Calendar className="h-4 w-4 mr-2" />
                Timeline
              </TabsTrigger>
            </TabsList>

            {/* Observation History */}
            <TabsContent value="history" className="space-y-3 max-h-96 overflow-y-auto">
              {observations.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  No observation history found
                </p>
              ) : (
                observations.map((obs) => (
                  <div key={obs.observation_id} className="p-4 border rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm font-semibold">
                            {obs.zones?.name || 'Unknown Zone'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(obs.recorded_at).toLocaleString('en-NZ', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                            timeZone: 'Pacific/Auckland',
                          })}
                        </p>
                        {obs.recorded_by_name && (
                          <p className="text-xs text-muted-foreground">
                            Recorded by {obs.recorded_by_name}
                          </p>
                        )}
                      </div>
                      <Badge variant={obs.is_compliant ? 'default' : 'destructive'}>
                        {obs.is_compliant ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Compliant
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Non-Compliant
                          </>
                        )}
                      </Badge>
                    </div>
                    {obs.has_notes && obs.officer_notes && (
                      <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-700">
                        <div className="flex items-start gap-2">
                          <FileText className="h-3 w-3 text-blue-600 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">Officer Notes:</p>
                            <p className="text-xs text-blue-800 dark:text-blue-200">
                              {obs.officer_notes}
                            </p>
                            {obs.notes_reference_previous && (
                              <p className="text-[10px] text-blue-600 dark:text-blue-300 mt-1">
                                ✓ Officer reviewed previous notes
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </TabsContent>

            {/* Photos Gallery */}
            <TabsContent value="photos" className="space-y-3">
              <div className="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {observations
                  .filter(obs => obs.photo)
                  .map((obs, idx: number) => (
                    <button
                      key={obs.observation_id}
                      onClick={() => setSelectedPhoto(obs.photo)}
                      className="relative aspect-square group"
                    >
                      <img
                        src={obs.photo!}
                        alt={`Evidence ${idx + 1}`}
                        className="w-full h-full object-cover rounded-lg border group-hover:border-primary transition-colors"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-lg flex items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {obs.has_notes && (
                        <div className="absolute top-1 right-1 bg-blue-600 rounded-full p-1">
                          <FileText className="h-3 w-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
              </div>
              {observations.filter(obs => obs.photo).length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">
                  No photos available
                </p>
              )}
            </TabsContent>

            {/* Compliance Timeline */}
            <TabsContent value="timeline" className="space-y-4 max-h-96 overflow-y-auto">
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />
                {observations.map((obs, idx) => (
                  <div key={obs.observation_id} className="relative pl-12 pb-8">
                    <div
                      className={`absolute left-2.5 w-3 h-3 rounded-full ${
                        obs.is_compliant ? 'bg-green-500' : 'bg-red-500'
                      }`}
                    />
                    <div className="text-sm">
                      <p className="font-semibold">
                        {new Date(obs.recorded_at).toLocaleDateString('en-NZ', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {obs.zones?.name || 'Unknown Zone'} •{' '}
                        {obs.is_compliant ? 'Compliant' : 'Non-Compliant'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          {/* Quick Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button variant="outline" className="flex-1">
              <FileText className="h-4 w-4 mr-2" />
              Add Note
            </Button>
            <Button variant="outline" className="flex-1">
              <Flag className="h-4 w-4 mr-2" />
              Flag Vehicle
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Photo Viewer Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]"
          onClick={() => setSelectedPhoto(null)}
        >
          <img
            src={selectedPhoto}
            alt="Full size"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  );
}
