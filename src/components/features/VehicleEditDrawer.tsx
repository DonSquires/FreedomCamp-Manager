/**
 * VehicleEditDrawer Component
 * Edit drawer for modifying scanned vehicle details and creating reports
 * With navigation controls to cycle through multiple flagged vehicles
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  X,
  Save,
  Camera,
  FileText,
  Activity,
  Wrench,
  Flag,
  Home,
  AlertTriangle,
  MapPin,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  XCircle,
  Loader2,
} from 'lucide-react';
import greenStickerImage from '@/assets/green-self-contained-sticker.png';
import blueStickerImage from '@/assets/blue-self-contained-sticker.jpg';
import { cn } from '@/lib/utils';
import { SessionScan } from './SessionList';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useZones } from '@/hooks/useZones';

interface VehicleEditDrawerProps {
  scan: SessionScan;
  onClose: () => void;
  onUpdate: (updatedScan: SessionScan) => void;
  onCreateIncident: () => void;
  onCreateHSReport: () => void;
  onCreateMaintenanceReport: () => void;
  // Navigation props
  showNavigation?: boolean;
  currentIndex?: number;
  totalVehicles?: number;
  onPrevious?: () => void;
  onNext?: () => void;
}

export function VehicleEditDrawer({
  scan,
  onClose,
  onUpdate,
  onCreateIncident,
  onCreateHSReport,
  onCreateMaintenanceReport,
  showNavigation = false,
  currentIndex = 0,
  totalVehicles = 1,
  onPrevious,
  onNext,
}: VehicleEditDrawerProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState(scan.zoneId);
  const [selfContained, setSelfContained] = useState<'green' | 'blue' | 'none'>(
    scan.isSelfContained ? 'green' : 'none'
  );
  const [hasHomelessClaim, setHasHomelessClaim] = useState(scan.homelessClaimed || false);
  const [requiresAdminFollowup, setRequiresAdminFollowup] = useState(scan.requiresFollowup || false);
  const [additionalNotes, setAdditionalNotes] = useState(scan.notes || '');
  const [hasViewedPreviousNotes, setHasViewedPreviousNotes] = useState(false);
  const [previousNotes, setPreviousNotes] = useState<Array<{
    observation_id: string;
    officer_notes: string;
    recorded_at: string;
    recorded_by_name: string;
    zone_name: string;
  }>>([]);
  const [showPreviousNotes, setShowPreviousNotes] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);
  // Load zones for this organization
  const { zones, isLoading: zonesLoading } = useZones(scan.organizationId);

  const loadPreviousNotes = async () => {
    if (!scan.plateNumber) return;
    
    setLoadingNotes(true);
    try {
      const { data, error } = await supabase
        .rpc('get_vehicle_notes_history', {
          p_plate_number: scan.plateNumber,
          p_limit: 10,
        });

      if (error) throw error;
      
      setPreviousNotes(data || []);
      setShowPreviousNotes(true);
      setHasViewedPreviousNotes(true);
      
      if (data && data.length > 0) {
        toast.success(`Loaded ${data.length} previous note${data.length !== 1 ? 's' : ''}`);
      } else {
        toast.info('No previous notes found for this vehicle');
      }
    } catch (error: any) {
      console.error('Failed to load previous notes:', error);
      toast.error('Failed to load previous notes');
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleSave = async () => {
    if (!scan.observationId) {
      toast.error('Cannot update: Observation ID missing');
      return;
    }

    setIsSaving(true);

    try {
      const { error: observationError } = await supabase
        .from('observations')
        .update({
          zone_id: selectedZoneId,
          officer_notes: additionalNotes || null,
          has_notes: !!additionalNotes,
          notes_reference_previous: hasViewedPreviousNotes,
        })
        .eq('observation_id', scan.observationId);

      if (observationError) throw observationError;

      const updatedZone = zones?.find(z => z.id === selectedZoneId);
      const updatedScan: SessionScan = {
        ...scan,
        zoneId: selectedZoneId,
        zoneName: updatedZone?.name || scan.zoneName,
        isSelfContained: selfContained !== 'none',
        homelessClaimed: hasHomelessClaim,
        requiresFollowup: requiresAdminFollowup,
        notes: additionalNotes,
      };

      onUpdate(updatedScan);
      toast.success('Vehicle details updated');
      onClose();
    } catch (error: any) {
      console.error('Failed to update vehicle:', error);
      toast.error('Failed to save changes: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[500px] bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
              {scan.isFlagged ? (
                <Flag className="h-5 w-5 text-red-600" />
              ) : !scan.isCompliant ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold font-mono">{scan.plateNumber}</h2>
              <p className="text-sm text-muted-foreground">
                {formatDistanceToNow(scan.timestamp, { addSuffix: true })}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {showNavigation && totalVehicles > 1 && (
          <div className="flex items-center justify-between p-3 border-b bg-amber-50 dark:bg-amber-950/20">
            <Button variant="outline" size="sm" onClick={onPrevious} disabled={currentIndex === 0} className="h-9 px-3">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <div className="text-sm font-semibold">
              <span className="text-primary">{currentIndex + 1}</span>
              <span className="text-muted-foreground"> of {totalVehicles}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onNext} disabled={currentIndex === totalVehicles - 1} className="h-9 px-3">
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 pb-24">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            <Card className="border-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Vehicle Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {scan.vehicleMake && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Make/Model:</span>
                    <span className="font-semibold text-sm">
                      {[scan.vehicleMake, scan.vehicleModel].filter(Boolean).join(' ')}
                    </span>
                  </div>
                )}
                {scan.vehicleColor && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Color:</span>
                    <span className="font-semibold text-sm">{scan.vehicleColor}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Detection:</span>
                  <Badge variant="outline" className="text-xs">
                    {scan.detectionMethod?.toUpperCase() || 'MANUAL'}
                  </Badge>
                </div>
                {scan.priorObservationsCount !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Prior Visits:</span>
                    <Badge variant="secondary" className="text-xs">
                      {scan.priorObservationsCount}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              {scan.isFlagged && <Badge variant="destructive">🚩 Flagged Vehicle</Badge>}
              {!scan.isCompliant && <Badge variant="default" className="bg-amber-500">⚠️ Breach Alert</Badge>}
              {scan.isHomeless && <Badge variant="default" className="bg-blue-500">🏕️ Homeless</Badge>}
              {scan.hasHSIssue && <Badge variant="default" className="bg-orange-500">H&S Issue</Badge>}
            </div>

            <div className="space-y-4">

              <div className="space-y-2">
                <Label htmlFor="zone">Zone</Label>
                {zonesLoading ? (
                  <div className="text-sm text-muted-foreground">Loading zones...</div>
                ) : !zones || zones.length === 0 ? (
                  <div className="text-sm text-red-600">No zones available</div>
                ) : (
                  <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
                    <SelectTrigger>
                      <SelectValue>
                        {zones.find(z => z.id === selectedZoneId)?.name || 'Select zone'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Rest of the form fields remain the same... */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="homeless-claim" className="text-sm font-semibold">Homeless Claim</Label>
                  <p className="text-xs text-muted-foreground">Occupant claims homeless status</p>
                </div>
                <Switch id="homeless-claim" checked={hasHomelessClaim} onCheckedChange={setHasHomelessClaim} />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="admin-followup" className="text-sm font-semibold">Requires Admin Follow-up</Label>
                  <p className="text-xs text-muted-foreground">Flag for manager review</p>
                </div>
                <Switch id="admin-followup" checked={requiresAdminFollowup} onCheckedChange={setRequiresAdminFollowup} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Add observations, occupant details, or other relevant information..."
                  rows={4}
                  className="resize-none text-sm"
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="border-t bg-background">
          <div className="grid grid-cols-3 gap-2 p-3 border-b bg-muted/20">
            <Button variant="outline" size="sm" className="h-10 text-xs flex-col gap-1 py-1" onClick={onCreateIncident}>
              <FileText className="h-4 w-4" />
              <span>Incident</span>
            </Button>
            <Button variant="outline" size="sm" className="h-10 text-xs flex-col gap-1 py-1" onClick={onCreateHSReport}>
              <Activity className="h-4 w-4" />
              <span>H&S</span>
            </Button>
            <Button variant="outline" size="sm" className="h-10 text-xs flex-col gap-1 py-1" onClick={onCreateMaintenanceReport}>
              <Wrench className="h-4 w-4" />
              <span>Maintenance</span>
            </Button>
          </div>
          
          <div className="p-3 flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1 h-12">Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="flex-1 h-12">
              {isSaving ? (
                <>
                  <Save className="h-5 w-5 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
