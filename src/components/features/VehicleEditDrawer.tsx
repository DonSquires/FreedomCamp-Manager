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
    scan.isSelfContained ? 'green' : 'none' // Default to green if self-contained, TODO: detect blue vs green from notes
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
  
  const { zones, isLoading: zonesLoading } = useZones(scan.organizationId);

  const selectedZone = zones?.find(z => z.id === selectedZoneId);

  // Load previous notes when requested
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
      // Update vehicle observation (NEW SCHEMA: vehicle_observations_v2)
      const { error: observationError } = await supabase
        .from('vehicle_observations_v2')
        .update({
          zone_id: selectedZoneId,
          officer_notes: additionalNotes || null,
          has_notes: !!additionalNotes,
          notes_reference_previous: hasViewedPreviousNotes,
        })
        .eq('observation_id', scan.observationId);

      if (observationError) throw observationError;

      // Build notes with sticker information
      const stickerNote = selfContained === 'green' 
        ? 'GREEN sticker verified' 
        : selfContained === 'blue' 
        ? 'BLUE sticker (NZS 5465) verified' 
        : 'NOT self-contained - no sticker';
      
      const updatedNotes = additionalNotes 
        ? `${additionalNotes} • ${stickerNote}` 
        : stickerNote;

      // ✅ CANONICAL ARCHITECTURE: Only update vehicle_observations
      // Removed deprecated vehicle_records table usage (deprecated as of migration 20250127)

      // Update local scan object
      const updatedScan: SessionScan = {
        ...scan,
        zoneId: selectedZoneId,
        zoneName: selectedZone?.name || scan.zoneName,
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[500px] bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
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
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-10 w-10"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation Bar (if multiple vehicles) */}
        {showNavigation && totalVehicles > 1 && (
          <div className="flex items-center justify-between p-3 border-b bg-amber-50 dark:bg-amber-950/20">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrevious}
              disabled={currentIndex === 0}
              className="h-9 px-3"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <div className="text-sm font-semibold">
              <span className="text-primary">{currentIndex + 1}</span>
              <span className="text-muted-foreground"> of {totalVehicles}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onNext}
              disabled={currentIndex === totalVehicles - 1}
              className="h-9 px-3"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Content */}
        <ScrollArea className="flex-1 pb-24">
          <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
            {/* Vehicle Info Card */}
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

            {/* Status Badges */}
            <div className="flex flex-wrap gap-2">
              {scan.isFlagged && (
                <Badge variant="destructive">🚩 Flagged Vehicle</Badge>
              )}
              {!scan.isCompliant && (
                <Badge variant="default" className="bg-amber-500">⚠️ Breach Alert</Badge>
              )}
              {scan.isHomeless && (
                <Badge variant="default" className="bg-blue-500">🏕️ Homeless</Badge>
              )}
              {scan.hasHSIssue && (
                <Badge variant="default" className="bg-orange-500">H&S Issue</Badge>
              )}
            </div>

            {/* Editable Fields */}
            <div className="space-y-4">
              {/* Zone Selector */}
              <div className="space-y-2">
                <Label htmlFor="zone">Zone</Label>
                <select
                  id="zone"
                  value={selectedZoneId}
                  onChange={(e) => setSelectedZoneId(e.target.value)}
                  disabled={zonesLoading}
                  className="w-full p-2 rounded-md border bg-background text-sm"
                >
                  {zones?.map(zone => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Self-Contained Sticker Verification */}
              <div className="space-y-3 p-4 rounded-lg border-2 bg-muted/30">
                <div>
                  <Label className="text-sm font-bold">Self-Contained Sticker Verification</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select the matching sticker if vehicle is self-contained. Only one can be selected.
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  {/* Green Sticker */}
                  <button
                    type="button"
                    onClick={() => setSelfContained(selfContained === 'green' ? 'none' : 'green')}
                    className={cn(
                      "relative rounded-xl border-4 p-3 transition-all touch-manipulation",
                      selfContained === 'green'
                        ? "border-green-500 bg-green-50 dark:bg-green-950/30 shadow-lg scale-[1.05] ring-4 ring-green-300"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-green-400"
                    )}
                  >
                    <div className="aspect-square rounded-lg flex items-center justify-center mb-2 relative overflow-hidden shadow-lg bg-white">
                      <img 
                        src={greenStickerImage} 
                        alt="Green self-contained sticker"
                        className={cn(
                          "w-full h-full object-contain rounded-lg p-1",
                          selfContained !== 'green' && "opacity-70"
                        )}
                      />
                      {selfContained === 'green' && (
                        <div className="absolute top-1 right-1 bg-green-600 rounded-full p-1 shadow-lg">
                          <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={3} />
                        </div>
                      )}
                      {selfContained !== 'green' && selfContained !== 'none' && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
                          <XCircle className="h-12 w-12 text-white/90 drop-shadow-lg" strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                    <p className={cn(
                      "text-xs font-semibold text-center",
                      selfContained === 'green' 
                        ? "text-green-700 dark:text-green-300 font-black"
                        : "text-gray-600 dark:text-gray-400"
                    )}>
                      Green Sticker
                    </p>
                  </button>

                  {/* Blue Sticker */}
                  <button
                    type="button"
                    onClick={() => setSelfContained(selfContained === 'blue' ? 'none' : 'blue')}
                    className={cn(
                      "relative rounded-xl border-4 p-3 transition-all touch-manipulation",
                      selfContained === 'blue'
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg scale-[1.05] ring-4 ring-blue-300"
                        : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400"
                    )}
                  >
                    <div className="aspect-square rounded-lg flex items-center justify-center mb-2 relative overflow-hidden shadow-lg bg-white">
                      <img 
                        src={blueStickerImage} 
                        alt="Blue self-contained sticker (NZS 5465)"
                        className={cn(
                          "w-full h-full object-contain rounded-lg p-1",
                          selfContained !== 'blue' && "opacity-70"
                        )}
                      />
                      {selfContained === 'blue' && (
                        <div className="absolute top-1 right-1 bg-blue-600 rounded-full p-1 shadow-lg">
                          <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={3} />
                        </div>
                      )}
                      {selfContained !== 'blue' && selfContained !== 'none' && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
                          <XCircle className="h-12 w-12 text-white/90 drop-shadow-lg" strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                    <p className={cn(
                      "text-xs font-semibold text-center",
                      selfContained === 'blue'
                        ? "text-blue-700 dark:text-blue-300 font-black"
                        : "text-gray-600 dark:text-gray-400"
                    )}>
                      Blue Sticker (NZS 5465)
                    </p>
                  </button>
                </div>

                {/* Self-Contained Status Badge */}
                {selfContained === 'green' && (
                  <div className="bg-green-50 dark:bg-green-950/30 border-2 border-green-500 rounded-xl p-4 text-center">
                    <p className="text-base font-black text-green-700 dark:text-green-300 flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      ✓ Self-Contained (GREEN Sticker)
                    </p>
                  </div>
                )}
                {selfContained === 'blue' && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-500 rounded-xl p-4 text-center">
                    <p className="text-base font-black text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-5 w-5" />
                      ✓ Self-Contained (BLUE Sticker NZS 5465)
                    </p>
                  </div>
                )}
                {selfContained === 'none' && (
                  <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-500 rounded-xl p-4 text-center">
                    <p className="text-base font-black text-red-600 dark:text-red-400 flex items-center justify-center gap-2">
                      <XCircle className="h-5 w-5" />
                      ✗ NOT Self-Contained
                    </p>
                  </div>
                )}
              </div>

              {/* Homeless Claim Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="homeless-claim" className="text-sm font-semibold">
                    Homeless Claim
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Occupant claims homeless status
                  </p>
                </div>
                <Switch
                  id="homeless-claim"
                  checked={hasHomelessClaim}
                  onCheckedChange={setHasHomelessClaim}
                />
              </div>

              {/* Admin Follow-up Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="admin-followup" className="text-sm font-semibold">
                    Requires Admin Follow-up
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Flag for manager review
                  </p>
                </div>
                <Switch
                  id="admin-followup"
                  checked={requiresAdminFollowup}
                  onCheckedChange={setRequiresAdminFollowup}
                />
              </div>

              {/* Previous Notes Viewer - NEW FEATURE */}
              {scan.priorObservationsCount > 0 && (
                <div className="space-y-3 p-4 rounded-lg border-2 bg-blue-50 dark:bg-blue-950/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-bold text-blue-900 dark:text-blue-100">
                        Previous Officer Notes
                      </Label>
                      <p className="text-xs text-blue-700 dark:text-blue-200 mt-1">
                        {scan.priorObservationsCount} previous observation{scan.priorObservationsCount !== 1 ? 's' : ''} on record
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadPreviousNotes}
                      disabled={loadingNotes}
                      className="h-9"
                    >
                      {loadingNotes ? (
                        <>
                          <Save className="h-4 w-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4 mr-2" />
                          View Notes
                        </>
                      )}
                    </Button>
                  </div>
                  
                  {showPreviousNotes && previousNotes.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {previousNotes.map((note) => (
                        <div key={note.observation_id} className="p-3 bg-white dark:bg-gray-900 rounded-lg border">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground">
                                {new Date(note.recorded_at).toLocaleDateString('en-NZ', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {note.recorded_by_name} • {note.zone_name}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                            {note.officer_notes}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {hasViewedPreviousNotes && (
                    <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Previous notes reviewed
                    </div>
                  )}
                </div>
              )}

              {/* Additional Notes */}
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

            {/* Action Buttons - Moved to fixed bottom on mobile */}
          </div>
        </ScrollArea>

        {/* Footer - Fixed bottom with action buttons */}
        <div className="border-t bg-background">
          {/* Action Buttons Row - Compact on mobile */}
          <div className="grid grid-cols-3 gap-2 p-3 border-b bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              className="h-10 text-xs flex-col gap-1 py-1 touch-manipulation"
              onClick={() => {
                console.log('🔘 Incident button clicked');
                onCreateIncident();
              }}
            >
              <FileText className="h-4 w-4" />
              <span className="leading-none">Incident</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 text-xs flex-col gap-1 py-1 touch-manipulation"
              onClick={() => {
                console.log('🔘 H&S button clicked');
                onCreateHSReport();
              }}
            >
              <Activity className="h-4 w-4" />
              <span className="leading-none">H&S</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 text-xs flex-col gap-1 py-1 touch-manipulation"
              onClick={() => {
                console.log('🔘 Maintenance button clicked');
                onCreateMaintenanceReport();
              }}
            >
              <Wrench className="h-4 w-4" />
              <span className="leading-none">Maintenance</span>
            </Button>
          </div>
          
          {/* Save/Cancel Row */}
          <div className="p-3 flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 h-12"
            >
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
