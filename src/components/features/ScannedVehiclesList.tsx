/**
 * ScannedVehiclesList Component
 * Interactive color-coded list of scanned vehicles with:
 * - 24-hour edit/delete window
 * - Organization-wide view toggle
 * - Filter by breach/homeless/at-risk
 * - Visual highlighting for own scans
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Activity,
  Home,
  Clock,
  MapPin,
  Users,
  User,
  Edit,
  Trash2,
  Loader2,
} from 'lucide-react';
import { SessionScan } from './SessionList';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatTimeUntilExpiry, getTimeUntilExpiry } from '@/lib/sessionPersistence';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

interface ScannedVehiclesListProps {
  scans: SessionScan[];
  onSelectScan: (scan: SessionScan) => void;
  selectedScanId?: string;
  organizationId?: string;
  onScanDeleted?: () => void;
}

interface OrgScan {
  observation_id: string;
  plate_number: string;
  zone_name: string;
  recorded_at: string;
  officer_name: string;
  is_breach: boolean;
  is_compliant: boolean;
  is_homeless: boolean;
  is_flagged: boolean;
  is_at_risk: boolean;
  is_own_scan: boolean;
  can_edit: boolean;
  can_delete: boolean;
  hours_remaining: number;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  photo?: string;
}

export function ScannedVehiclesList({
  scans,
  onSelectScan,
  selectedScanId,
  organizationId,
  onScanDeleted,
}: ScannedVehiclesListProps) {
  const { user } = useAuthStore();
  const [, setTick] = useState(0);
  const [viewMode, setViewMode] = useState<'my_scans' | 'org_scans'>('my_scans');
  const [filterBreaches, setFilterBreaches] = useState(false);
  const [filterHomeless, setFilterHomeless] = useState(false);
  const [filterAtRisk, setFilterAtRisk] = useState(false);
  
  const [orgScans, setOrgScans] = useState<OrgScan[]>([]);
  const [isLoadingOrgScans, setIsLoadingOrgScans] = useState(false);
  
  const [scanToDelete, setScanToDelete] = useState<SessionScan | OrgScan | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Update time remaining every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, []);
  
  // Load org scans when switching to org view
  useEffect(() => {
    if (viewMode === 'org_scans') {
      loadOrgScans();
      
      // Auto-refresh every 30 seconds when in org view
      const refreshInterval = setInterval(() => {
        loadOrgScans();
      }, 30000);
      
      return () => clearInterval(refreshInterval);
    }
  }, [viewMode, filterBreaches, filterHomeless, filterAtRisk]);
  
  const loadOrgScans = async () => {
    if (!user?.id) return;
    
    setIsLoadingOrgScans(true);
    try {
      const { data, error } = await supabase.rpc('get_org_scans_24h', {
        p_user_id: user.id,
        p_filter_breaches: filterBreaches,
        p_filter_homeless: filterHomeless,
        p_filter_at_risk: filterAtRisk,
      });
      
      if (error) throw error;
      setOrgScans(data || []);
    } catch (error: any) {
      console.error('Failed to load org scans:', error);
      toast.error('Failed to load organization scans');
    } finally {
      setIsLoadingOrgScans(false);
    }
  };
  
  const handleDelete = async () => {
    if (!scanToDelete) return;
    
    setIsDeleting(true);
    try {
      const observationId = 'observation_id' in scanToDelete 
        ? scanToDelete.observation_id 
        : scanToDelete.observationId;
      
      if (!observationId) {
        toast.error('Cannot delete: No observation ID');
        return;
      }
      
      const { error } = await supabase
        .from('vehicle_observations_v2')
        .delete()
        .eq('observation_id', observationId);
      
      if (error) throw error;
      
      toast.success('Scan deleted successfully');
      setShowDeleteConfirm(false);
      setScanToDelete(null);
      
      // Reload data
      if (viewMode === 'org_scans') {
        await loadOrgScans();
      }
      
      // Notify parent
      if (onScanDeleted) {
        onScanDeleted();
      }
    } catch (error: any) {
      console.error('Failed to delete scan:', error);
      toast.error('Failed to delete scan: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };
  
  const getStatusColor = (scan: SessionScan | OrgScan) => {
    const isFlagged = 'isFlagged' in scan ? scan.isFlagged : scan.is_flagged;
    const isCompliant = 'isCompliant' in scan ? scan.isCompliant : scan.is_compliant;
    const isHomeless = 'isHomeless' in scan ? scan.isHomeless : scan.is_homeless;
    const isOwnScan = 'is_own_scan' in scan ? scan.is_own_scan : true;
    
    // Own scans get blue border
    if (isOwnScan && viewMode === 'org_scans') {
      return 'border-blue-500 bg-blue-50 dark:bg-blue-950/20 ring-2 ring-blue-200';
    }
    
    // Priority order: Flagged > Non-compliant > Homeless > Compliant
    if (isFlagged) return 'border-red-500 bg-red-50 dark:bg-red-950/20';
    if (!isCompliant) return 'border-amber-500 bg-amber-50 dark:bg-amber-950/20';
    if (isHomeless) return 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/20';
    return 'border-green-500 bg-green-50 dark:bg-green-950/20';
  };

  const getStatusIcon = (scan: SessionScan | OrgScan) => {
    const isFlagged = 'isFlagged' in scan ? scan.isFlagged : scan.is_flagged;
    const isCompliant = 'isCompliant' in scan ? scan.isCompliant : scan.is_compliant;
    const isHomeless = 'isHomeless' in scan ? scan.isHomeless : scan.is_homeless;
    
    if (isFlagged) return <Flag className="h-5 w-5 text-red-600" />;
    if (!isCompliant) return <AlertTriangle className="h-5 w-5 text-amber-600" />;
    if (isHomeless) return <Home className="h-5 w-5 text-cyan-600" />;
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  };

  const getStatusBadge = (scan: SessionScan | OrgScan) => {
    const isFlagged = 'isFlagged' in scan ? scan.isFlagged : scan.is_flagged;
    const isCompliant = 'isCompliant' in scan ? scan.isCompliant : scan.is_compliant;
    const isHomeless = 'isHomeless' in scan ? scan.isHomeless : scan.is_homeless;
    const requiresFollowup = 'requiresFollowup' in scan ? scan.requiresFollowup : false;
    
    if (isFlagged) return <Badge variant="destructive" className="text-xs">🚩 Flagged</Badge>;
    if (!isCompliant) return <Badge variant="default" className="bg-amber-500 text-xs">⚠️ Breach</Badge>;
    if (isHomeless) return <Badge variant="default" className="bg-cyan-500 text-xs">🏕️ Homeless (FC Exempt)</Badge>;
    if (requiresFollowup) return <Badge variant="secondary" className="text-xs">⏰ Follow-up</Badge>;
    return <Badge variant="outline" className="text-green-600 text-xs">✓ Compliant</Badge>;
  };
  
  const canEditDelete = (scan: SessionScan | OrgScan) => {
    if ('can_edit' in scan) {
      return {
        canEdit: scan.can_edit,
        canDelete: scan.can_delete,
        hoursRemaining: scan.hours_remaining,
      };
    }
    
    // For SessionScan, calculate from timestamp
    const timeInfo = getTimeUntilExpiry(scan.timestamp);
    const hoursRemaining = timeInfo.totalMinutes / 60;
    
    return {
      canEdit: hoursRemaining > 0,
      canDelete: hoursRemaining > 0,
      hoursRemaining,
    };
  };
  
  const displayedScans = viewMode === 'my_scans' ? scans : orgScans;

  return (
    <>
      <Card className="h-full flex flex-col border-2">
        <CardHeader className="pb-3 border-b flex-shrink-0">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Scanned Vehicles</span>
            <Badge variant="secondary">{displayedScans.length}</Badge>
          </CardTitle>
          
          {/* View Mode Toggle */}
          <div className="flex gap-2 mt-3">
            <Button
              variant={viewMode === 'my_scans' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('my_scans')}
              className="flex-1"
            >
              <User className="h-3 w-3 mr-2" />
              My Scans
            </Button>
            <Button
              variant={viewMode === 'org_scans' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('org_scans')}
              className="flex-1"
            >
              <Users className="h-3 w-3 mr-2" />
              All (24h)
            </Button>
          </div>
          
          {/* Filters (org view only) */}
          {viewMode === 'org_scans' && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Button
                variant={filterBreaches ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterBreaches(!filterBreaches)}
                className="text-xs"
              >
                🚨 Breaches
              </Button>
              <Button
                variant={filterHomeless ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterHomeless(!filterHomeless)}
                className="text-xs"
              >
                🏠 Homeless
              </Button>
              <Button
                variant={filterAtRisk ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterAtRisk(!filterAtRisk)}
                className="text-xs"
              >
                ⚠️ At Risk
              </Button>
            </div>
          )}
          
          <p className="text-xs text-muted-foreground mt-2">
            {viewMode === 'my_scans' 
              ? 'Click to view and edit details. 24h edit/delete window.'
              : 'Organization scans from last 24 hours. Blue border = yours.'}
          </p>
        </CardHeader>
        
        <CardContent className="p-0 flex-1 overflow-hidden">
          {isLoadingOrgScans ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">Loading organization scans...</p>
            </div>
          ) : displayedScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Activity className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <p className="text-base font-semibold text-muted-foreground">
                {viewMode === 'my_scans' ? 'No vehicles scanned yet' : 'No organization scans'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {viewMode === 'my_scans' ? 'Scans will appear here' : 'No scans in last 24 hours'}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {displayedScans.map((scan) => {
                  const editInfo = canEditDelete(scan);
                  const plateNumber = 'plateNumber' in scan ? scan.plateNumber : scan.plate_number;
                  const zoneName = 'zoneName' in scan ? scan.zoneName : scan.zone_name;
                  const timestamp = 'timestamp' in scan ? scan.timestamp : scan.recorded_at;
                  const scanId = 'id' in scan ? scan.id : scan.observation_id;
                  const isOwnScan = 'is_own_scan' in scan ? scan.is_own_scan : true;
                  const officerName = 'officer_name' in scan ? scan.officer_name : null;
                  const vehicleMake = 'vehicleMake' in scan ? scan.vehicleMake : scan.vehicle_make;
                  const vehicleModel = 'vehicleModel' in scan ? scan.vehicleModel : scan.vehicle_model;
                  const vehicleColor = 'vehicleColor' in scan ? scan.vehicleColor : scan.vehicle_color;
                  
                  return (
                    <div
                      key={scanId}
                      className={cn(
                        'p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md active:scale-[0.98]',
                        getStatusColor(scan),
                        selectedScanId === scanId && 'ring-2 ring-primary shadow-lg'
                      )}
                      onClick={() => {
                        if ('observation_id' in scan) {
                          // Convert OrgScan to SessionScan for onSelectScan
                          const sessionScan: SessionScan = {
                            id: scan.observation_id,
                            plateNumber: scan.plate_number,
                            zoneName: scan.zone_name,
                            zoneId: '', // Not available from org scan
                            organizationId: organizationId || '',
                            timestamp: scan.recorded_at,
                            isCompliant: scan.is_compliant,
                            isFlagged: scan.is_flagged,
                            vehicleMake: scan.vehicle_make,
                            vehicleModel: scan.vehicle_model,
                            vehicleColor: scan.vehicle_color,
                            observationId: scan.observation_id,
                            detectionMethod: 'alpr',
                            isSelfContained: false,
                            isHomeless: scan.is_homeless,
                            hasHSIssue: false,
                            requiresFollowup: false,
                          };
                          onSelectScan(sessionScan);
                        } else {
                          onSelectScan(scan);
                        }
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">
                          {getStatusIcon(scan)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Plate Number - Prominent */}
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-mono text-xl font-black tracking-tight">
                              {plateNumber}
                            </p>
                            {getStatusBadge(scan)}
                          </div>

                          {/* Vehicle Details */}
                          {(vehicleMake || vehicleModel || vehicleColor) && (
                            <p className="text-sm text-muted-foreground line-clamp-1">
                              {[vehicleColor, vehicleMake, vehicleModel]
                                .filter(Boolean)
                                .join(' ')}
                            </p>
                          )}

                          {/* Zone & Time */}
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              <span className="truncate max-w-24">{zoneName}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span>{formatDistanceToNow(new Date(timestamp), { addSuffix: true })}</span>
                            </div>
                          </div>
                          
                          {/* Officer Name (org view only) */}
                          {viewMode === 'org_scans' && officerName && (
                            <div className="flex items-center gap-1 text-xs">
                              {isOwnScan ? (
                                <Badge variant="secondary" className="text-xs">You</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">{officerName}</Badge>
                              )}
                            </div>
                          )}

                          {/* Additional Status Indicators */}
                          <div className="flex flex-wrap gap-1.5">
                            {/* 24-hour edit window timer */}
                            {editInfo.hoursRemaining > 0 && (
                              <Badge 
                                variant={editInfo.hoursRemaining < 1 ? 'destructive' : 'outline'}
                                className="text-[10px] px-1.5 py-0.5"
                              >
                                ⏱️ {Math.floor(editInfo.hoursRemaining)}h to edit
                              </Badge>
                            )}
                            
                            {'isSelfContained' in scan && scan.isSelfContained && (
                              <Badge variant="outline" className="text-xs bg-white dark:bg-gray-900">
                                Self-Contained
                              </Badge>
                            )}
                            {'hasHSIssue' in scan && scan.hasHSIssue && (
                              <Badge variant="default" className="bg-orange-500 text-xs">
                                H&S Issue
                              </Badge>
                            )}
                            {'priorObservationsCount' in scan && scan.priorObservationsCount && scan.priorObservationsCount > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {scan.priorObservationsCount} prior
                              </Badge>
                            )}
                          </div>
                          
                          {/* Edit/Delete Actions (only if can edit) */}
                          {editInfo.canEdit && (
                            <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onSelectScan('observation_id' in scan ? {
                                  id: scan.observation_id,
                                  plateNumber: scan.plate_number,
                                  zoneName: scan.zone_name,
                                  zoneId: '',
                                  organizationId: organizationId || '',
                                  timestamp: scan.recorded_at,
                                  isCompliant: scan.is_compliant,
                                  isFlagged: scan.is_flagged,
                                  vehicleMake: scan.vehicle_make,
                                  vehicleModel: scan.vehicle_model,
                                  vehicleColor: scan.vehicle_color,
                                  observationId: scan.observation_id,
                                  detectionMethod: 'alpr',
                                  isSelfContained: false,
                                  isHomeless: scan.is_homeless,
                                  hasHSIssue: false,
                                  requiresFollowup: false,
                                } : scan)}
                                className="flex-1"
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setScanToDelete(scan);
                                  setShowDeleteConfirm(true);
                                }}
                              >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Delete
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scan?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scan? This action cannot be undone.
              <br /><br />
              <strong>Plate:</strong> {'plateNumber' in scanToDelete! ? scanToDelete!.plateNumber : scanToDelete?.plate_number}
              <br />
              <strong>Zone:</strong> {'zoneName' in scanToDelete! ? scanToDelete!.zoneName : scanToDelete?.zone_name}
              <br /><br />
              <em className="text-xs text-muted-foreground">
                Note: Deletion will be logged for audit purposes.
              </em>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setScanToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Scan
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
