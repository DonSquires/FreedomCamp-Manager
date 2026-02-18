/**
 * ObservationDetailModal - Full observation details with compliance data
 * Shows complete observation record with vehicle info, compliance status, evidence photos
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  MapPin,
  User,
  CheckCircle2,
  AlertTriangle,
  Flag,
  Camera,
  FileText,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';

interface ObservationDetail {
  observation_id: string;
  vehicle_id: string;
  zone_id: string;
  organization_id: string;
  recorded_at: string;
  recorded_by: string;
  source_type: string;
  is_self_contained: boolean;
  is_compliant: boolean;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  photo: string | null;
  officer_notes: string | null;
  created_at: string;
  canonical_vehicles?: {
    plate_number: string;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_color: string | null;
    homeless_status: string;
    is_flagged: boolean;
    flagged_priority: string | null;
  };
  zones?: {
    name: string;
  };
  organizations?: {
    name: string;
  };
  user_profiles?: {
    first_name: string;
    last_name: string;
  };
  compliance_results?: Array<{
    is_compliant: boolean;
    is_exempt?: boolean;
    exemption_reason?: string;
    violation_reasons: string[];
    metrics_json: any;
  }>;
}

interface ObservationDetailModalProps {
  observationId: string;
  open: boolean;
  onClose: () => void;
}

export function ObservationDetailModal({
  observationId,
  open,
  onClose,
}: ObservationDetailModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [observation, setObservation] = useState<ObservationDetail | null>(null);

  useEffect(() => {
    if (open && observationId) {
      loadObservationDetail();
    }
  }, [observationId, open]);

  const loadObservationDetail = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          *,
          zones(name),
          organizations(name),
          user_profiles!vehicle_observations_v2_recorded_by_fkey(
            first_name,
            last_name
          ),
          compliance_results(
            is_compliant,
            violation_reasons,
            metrics_json
          )
        `)
        .eq('observation_id', observationId)
        .single();

      if (error) throw error;

      // Fetch canonical vehicle details separately using plate_number
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, vehicle_color, homeless_status, is_flagged, flagged_priority')
        .eq('plate_number', data.plate_number)
        .single();

      if (vehicleError) {
        console.warn('Could not fetch canonical vehicle:', vehicleError);
      }

      // Merge canonical vehicle data
      const mergedData = {
        ...data,
        canonical_vehicles: vehicleData || null,
      };

      setObservation(mergedData as ObservationDetail);
    } catch (error: any) {
      console.error('Failed to load observation:', error);
      toast.error('Failed to load observation details');
    } finally {
      setIsLoading(false);
    }
  };

  const openInGoogleMaps = () => {
    if (observation?.gps_latitude && observation?.gps_longitude) {
      const url = `https://www.google.com/maps?q=${observation.gps_latitude},${observation.gps_longitude}`;
      window.open(url, '_blank');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5 text-primary" />
            Observation Details
          </DialogTitle>
          <DialogDescription>
            Complete observation record with compliance and vehicle information
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !observation ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>Observation not found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Vehicle Header */}
            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <VehicleProfilePhoto 
                    plateNumber={observation.canonical_vehicles?.plate_number || ''} 
                    size="lg"
                  />
                  <div className="flex-1">
                    <h2 className="text-2xl font-mono font-black mb-2">
                      {observation.canonical_vehicles?.plate_number || 'Unknown Plate'}
                    </h2>
                    {observation.canonical_vehicles && (
                      <p className="text-muted-foreground mb-3">
                        {[
                          observation.canonical_vehicles.vehicle_color,
                          observation.canonical_vehicles.vehicle_make,
                          observation.canonical_vehicles.vehicle_model
                        ].filter(Boolean).join(' ')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {/* Show Breach Status with Exemption */}
                      {(() => {
                        const hasViolations = observation.compliance_results?.some(r => r.violation_reasons && r.violation_reasons.length > 0);
                        const isExempt = observation.compliance_results?.some(r => r.is_exempt);
                        const isHomeless = observation.canonical_vehicles?.homeless_status !== 'none';
                        
                        if (hasViolations && isExempt) {
                          // Show Breach (Exempt) badge
                          return (
                            <>
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500 font-bold">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Breach (Exempt)
                              </Badge>
                            </>
                          );
                        } else if (observation.is_compliant) {
                          return (
                            <Badge variant="default">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Compliant
                            </Badge>
                          );
                        } else {
                          return (
                            <Badge variant="destructive">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Non-Compliant
                            </Badge>
                          );
                        }
                      })()}
                      
                      {/* Homeless Status Badge */}
                      {observation.canonical_vehicles?.homeless_status !== 'none' && (
                        <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 border-cyan-500 font-bold">
                          🏠 Homeless
                          {observation.canonical_vehicles.homeless_status === 'confirmed' && ' (Confirmed)'}
                          {observation.canonical_vehicles.homeless_status === 'claimed' && ' (Claimed)'}
                        </Badge>
                      )}
                      
                      {observation.is_self_contained && (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500">
                          Self-Contained
                        </Badge>
                      )}
                      {observation.canonical_vehicles?.is_flagged && (
                        <Badge variant="destructive">
                          <Flag className="h-3 w-3 mr-1" />
                          Flagged - {observation.canonical_vehicles.flagged_priority?.toUpperCase()}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Observation Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Date & Time */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Calendar className="h-4 w-4" />
                    <span className="text-xs font-semibold">Recorded At</span>
                  </div>
                  <p className="text-sm font-medium">
                    {new Date(observation.recorded_at).toLocaleString('en-NZ', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                      timeZone: 'Pacific/Auckland',
                    })}
                  </p>
                </CardContent>
              </Card>

              {/* Recorded By */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <User className="h-4 w-4" />
                    <span className="text-xs font-semibold">Recorded By</span>
                  </div>
                  <p className="text-sm font-medium">
                    {observation.user_profiles ? 
                      `${observation.user_profiles.first_name} ${observation.user_profiles.last_name}` : 
                      'Unknown Officer'}
                  </p>
                </CardContent>
              </Card>

              {/* Zone */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <MapPin className="h-4 w-4" />
                    <span className="text-xs font-semibold">Zone</span>
                  </div>
                  <p className="text-sm font-medium">{observation.zones?.name || 'Unknown Zone'}</p>
                </CardContent>
              </Card>

              {/* Organization */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <FileText className="h-4 w-4" />
                    <span className="text-xs font-semibold">Organization</span>
                  </div>
                  <p className="text-sm font-medium">{observation.organizations?.name || 'Unknown'}</p>
                </CardContent>
              </Card>

              {/* Source */}
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Source</div>
                  <Badge variant="outline">{observation.source_type}</Badge>
                </CardContent>
              </Card>

              {/* GPS Location */}
              {observation.gps_latitude && observation.gps_longitude && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <MapPin className="h-4 w-4" />
                      <span className="text-xs font-semibold">GPS Coordinates</span>
                    </div>
                    <p className="text-xs font-mono mb-2">
                      {observation.gps_latitude.toFixed(6)}, {observation.gps_longitude.toFixed(6)}
                    </p>
                    {observation.gps_accuracy && (
                      <p className="text-xs text-muted-foreground mb-2">
                        Accuracy: {observation.gps_accuracy.toFixed(1)}m
                      </p>
                    )}
                    <Button size="sm" variant="outline" onClick={openInGoogleMaps}>
                      <ExternalLink className="h-3 w-3 mr-1" />
                      View in Google Maps
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Compliance Details */}
            {observation.compliance_results && observation.compliance_results.length > 0 && (
              <Card className={`border-2 ${
                observation.compliance_results.some(r => r.is_exempt) 
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' 
                  : observation.is_compliant 
                    ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
                    : 'border-red-500 bg-red-50 dark:bg-red-950/20'
              }`}>
                <CardContent className="p-4">
                  <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                    {observation.compliance_results.some(r => r.is_exempt) ? (
                      <><AlertTriangle className="h-4 w-4 text-amber-600" /> Breach Details (Exempt)</>
                    ) : observation.is_compliant ? (
                      <><CheckCircle2 className="h-4 w-4 text-green-600" /> Compliance Details</>
                    ) : (
                      <><AlertTriangle className="h-4 w-4 text-red-600" /> Violation Details</>
                    )}
                  </h3>
                  {observation.compliance_results.map((result, idx) => (
                    <div key={idx} className="space-y-3">
                      {/* Show Exemption Notice First */}
                      {result.is_exempt && result.exemption_reason && (
                        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg border-2 border-amber-500">
                          <p className="text-sm font-bold text-amber-900 dark:text-amber-100 mb-1">
                            ⚠️ Exempt from Enforcement
                          </p>
                          <p className="text-xs text-amber-800 dark:text-amber-200">
                            {result.exemption_reason}
                          </p>
                        </div>
                      )}
                      
                      {result.violation_reasons && result.violation_reasons.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">
                            {result.is_exempt ? 'Violations (Exempt):' : 'Violations:'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {result.violation_reasons.map((reason, i) => (
                              <Badge 
                                key={i} 
                                variant={result.is_exempt ? "outline" : "destructive"} 
                                className={result.is_exempt ? "text-xs border-amber-500 text-amber-700" : "text-xs"}
                              >
                                {reason.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {result.metrics_json && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Compliance Metrics:</p>
                          <div className="grid grid-cols-2 gap-3">
                            {result.metrics_json.fine_amount !== undefined && (
                              <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border">
                                <p className="text-xs text-muted-foreground mb-1">Fine Amount</p>
                                <p className="text-lg font-bold">${result.metrics_json.fine_amount}</p>
                              </div>
                            )}
                            {result.metrics_json.month_nights !== undefined && (
                              <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border">
                                <p className="text-xs text-muted-foreground mb-1">Nights This Month</p>
                                <p className="text-lg font-bold">{result.metrics_json.month_nights}</p>
                              </div>
                            )}
                            {result.metrics_json.consecutive_nights !== undefined && (
                              <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border">
                                <p className="text-xs text-muted-foreground mb-1">Consecutive Nights</p>
                                <p className="text-lg font-bold">{result.metrics_json.consecutive_nights}</p>
                              </div>
                            )}
                            {result.metrics_json.violation_severity && (
                              <div className="p-3 bg-white dark:bg-gray-900 rounded-lg border">
                                <p className="text-xs text-muted-foreground mb-1">Severity</p>
                                <Badge variant={result.metrics_json.violation_severity === 'high' ? 'destructive' : 'secondary'}>
                                  {result.metrics_json.violation_severity.toUpperCase()}
                                </Badge>
                              </div>
                            )}
                          </div>
                          {result.metrics_json.violation_message && (
                            <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                              <p className="text-sm text-amber-900 dark:text-amber-100">
                                {result.metrics_json.violation_message}
                              </p>
                            </div>
                          )}
                          {result.metrics_json.recommended_action && (
                            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                              <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">
                                Recommended Action:
                              </p>
                              <p className="text-sm text-blue-800 dark:text-blue-200">
                                {result.metrics_json.recommended_action}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {observation.officer_notes && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-bold text-sm mb-2">Officer Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {observation.officer_notes}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Evidence Photos - Show photo field from observation */}
            {observation.photo && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Evidence Photo
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <a
                      href={observation.photo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg overflow-hidden border-2 hover:border-primary transition-colors"
                    >
                      <img
                        src={observation.photo}
                        alt="Vehicle evidence photo"
                        className="w-full h-40 object-cover"
                      />
                    </a>
                  </div>
                </CardContent>
              </Card>
            )}


          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
