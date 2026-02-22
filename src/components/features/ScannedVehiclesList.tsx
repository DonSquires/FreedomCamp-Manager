/**
 * ScannedVehiclesList Component
 * Interactive color-coded list of scanned vehicles with:
 * - 24-hour edit/delete window
 * - Organization-wide view toggle
 * - Filter by breach/homeless/at-risk
 * - Visual highlighting for own scans
 * - COMPREHENSIVE NULL SAFETY with staged loading
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
  
  const [myScans, setMyScans] = useState<OrgScan[]>([]);
  const [orgScans, setOrgScans] = useState<OrgScan[]>([]);
  const [isLoadingMyScans, setIsLoadingMyScans] = useState(false);
  const [isLoadingOrgScans, setIsLoadingOrgScans] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  
  const [scanToDelete, setScanToDelete] = useState<SessionScan | OrgScan | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // ✅ STAGE 1: Initial data validation and cleanup
  useEffect(() => {
    // Validate incoming scans data
    const validScans = Array.isArray(scans) ? scans.filter(s => {
      if (!s || typeof s !== 'object') {
        console.warn('⚠️ Invalid scan detected and filtered:', s);
        return false;
      }
      return true;
    }) : [];
    
    console.log(`✅ ScannedVehiclesList initialized: ${validScans.length}/${scans?.length || 0} valid scans`);
    
    // Mark initialization complete after brief delay
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 100);
    
    return () => clearTimeout(timer);
  }, [scans?.length]);
  
  // Update time remaining every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, []);
  
  // Load my scans when switching to my view
  useEffect(() => {
    if (viewMode === 'my_scans') {
      loadMyScans();
      
      // Auto-refresh every 30 seconds when in my view
      const refreshInterval = setInterval(() => {
        loadMyScans();
      }, 30000);
      
      return () => clearInterval(refreshInterval);
    }
  }, [viewMode]);
  
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
  
  const loadMyScans = async () => {
    if (!user?.id) return;
    
    setIsLoadingMyScans(true);
    try {
      const { data, error } = await supabase.rpc('get_my_scans_24h', {
        p_user_id: user.id,
      });
      
      if (error) throw error;
      setMyScans(data || []);
      console.log(`✅ Loaded ${data?.length || 0} scans from database`);
    } catch (error: any) {
      console.error('Failed to load my scans:', error);
      toast.error('Failed to load your scans');
    } finally {
      setIsLoadingMyScans(false);
    }
  };
  
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
        .from('observations')
        .delete()
        .eq('id', observationId);
      
      if (error) throw error;
      
      toast.success('Scan deleted successfully');
      setShowDeleteConfirm(false);
      setScanToDelete(null);
      
      // ✅ FIX: Reload data and notify parent component to refresh
      if (viewMode === 'my_scans') {
        await loadMyScans();
      } else {
        await loadOrgScans();
      }
      
      // Notify parent to refresh their data source
      if (onScanDeleted) {
        onScanDeleted();
        console.log('✅ Notified parent to refresh after delete');
      }
    } catch (error: any) {
      console.error('Failed to delete scan:', error);
      toast.error('Failed to delete scan: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };
  
  const getStatusColor = (scan: SessionScan | OrgScan) => {
    if (!scan) return '';
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
    if (!scan) return null;
    const isFlagged = 'isFlagged' in scan ? scan.isFlagged : scan.is_flagged;
    const isCompliant = 'isCompliant' in scan ? scan.isCompliant : scan.is_compliant;
    const isHomeless = 'isHomeless' in scan ? scan.isHomeless : scan.is_homeless;
    
    if (isFlagged) return <Flag className="h-5 w-5 text-red-600" />;
    if (!isCompliant) return <AlertTriangle className="h-5 w-5 text-amber-600" />;
    if (isHomeless) return <Home className="h-5 w-5 text-cyan-600" />;
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  };

  const getStatusBadge = (scan: SessionScan | OrgScan) => {
    if (!scan) return null;
    const isFlagged = 'isFlagged' in scan ? scan.isFlagged : scan.is_flagged;
    const isCompliant = 'isCompliant' in scan ? scan.isCompliant : scan.is_compliant;
    const isHomeless = 'isHomeless' in scan ? scan.isHomeless : scan.is_homeless;
    const isAtRisk = 'is_at_risk' in scan ? scan.is_at_risk : false;
    const requiresFollowup = 'requiresFollowup' in scan ? scan.requiresFollowup : false;
    
    // Priority: Flagged > Breach (with homeless check) > At Risk > Homeless > Followup > Compliant
    if (isFlagged) return <Badge variant="destructive" className="text-xs">🚩 Flagged</Badge>;
    
    // If not compliant and homeless - show "At Risk (Exempt)"
    if (!isCompliant && isHomeless) {
      return <Badge variant="default" className="bg-purple-500 text-xs">⚠️ At Risk (FC Exempt)</Badge>;
    }
    
    // If not compliant and not homeless - show "Breach"
    if (!isCompliant) {
      return <Badge variant="default" className="bg-amber-500 text-xs">⚠️ Breach</Badge>;
    }
    
    // At risk (approaching breach threshold)
    if (isAtRisk && !isHomeless) {
      return <Badge variant="default" className="bg-yellow-500 text-xs">🟡 At Risk</Badge>;
    }
    
    // At risk but homeless exempt
    if (isAtRisk && isHomeless) {
      return <Badge variant="default" className="bg-purple-400 text-xs">🟡 At Risk (FC Exempt)</Badge>;
    }
    
    // Homeless and compliant
    if (isHomeless) {
      return <Badge variant="default" className="bg-cyan-500 text-xs">🏕️ Homeless (FC Exempt)</Badge>;
    }
    
    if (requiresFollowup) return <Badge variant="secondary" className="text-xs">⏰ Follow-up</Badge>;
    return <Badge variant="outline" className="text-green-600 text-xs">✓ Compliant</Badge>;
  };
  
  const canEditDelete = (scan: SessionScan | OrgScan) => {
    if (!scan) return { canEdit: false, canDelete: false, hoursRemaining: 0 };
    
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
  
  // ✅ DEFENSIVE: Multi-stage validation and filtering
  const getValidScans = (): (SessionScan | OrgScan)[] => {
    try {
      // STAGE 1: Select data source
      const rawScans = viewMode === 'my_scans' ? myScans : orgScans;
      
      // STAGE 2: Validate array
      if (!Array.isArray(rawScans)) {
        console.error('❌ Invalid scans data - not an array:', rawScans);
        return [];
      }
      
      // STAGE 3: Filter and validate each item
      const validScans = rawScans.filter((scan): scan is SessionScan | OrgScan => {
        // Check 1: Not null or undefined
        if (scan == null) {
          console.warn('⚠️ Null/undefined scan filtered');
          return false;
        }
        
        // Check 2: Is object
        if (typeof scan !== 'object') {
          console.warn('⚠️ Non-object scan filtered:', typeof scan);
          return false;
        }
        
        // Check 3: Has required properties
        const hasPlateNumber = ('plateNumber' in scan && scan.plateNumber) || 
                               ('plate_number' in scan && scan.plate_number);
        
        if (!hasPlateNumber) {
          console.warn('⚠️ Scan missing plate number filtered:', scan);
          return false;
        }
        
        return true;
      });
      
      return validScans;
    } catch (error) {
      console.error('❌ Error filtering scans:', error);
      return [];
    }
  };
  
  const displayedScans = getValidScans();
  
  // ✅ EARLY RETURN: Show initialization loader
  if (isInitializing) {
    return (
      <Card className="h-full flex flex-col border-2">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base">Scanned Vehicles</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Initializing...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

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
          {(viewMode === 'my_scans' && isLoadingMyScans) || (viewMode === 'org_scans' && isLoadingOrgScans) ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm text-muted-foreground">
                {viewMode === 'my_scans' ? 'Loading your scans...' : 'Loading organization scans...'}
              </p>
            </div>
          ) : displayedScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Activity className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <p className="text-base font-semibold text-muted-foreground">
                {viewMode === 'my_scans' ? 'No scans in last 24 hours' : 'No organization scans'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {viewMode === 'my_scans' ? 'Your scans from the last 24 hours will appear here' : 'No organization scans in last 24 hours'}
              </p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {displayedScans.map((scan, index) => {
                  // ✅ COMPREHENSIVE VALIDATION: Triple-check before rendering
                  try {
                    // Validation 1: Null check
                    if (!scan || typeof scan !== 'object') {
                      console.error(`❌ Invalid scan at index ${index}:`, scan);
                      return null;
                    }
                    
                    // Validation 2: Extract plate number with fallback
                    let plateNumber: string = 'UNKNOWN';
                    if ('plateNumber' in scan && typeof scan.plateNumber === 'string') {
                      plateNumber = scan.plateNumber;
                    } else if ('plate_number' in scan && typeof scan.plate_number === 'string') {
                      plateNumber = scan.plate_number;
                    }
                    
                    // Validation 3: If still no plate number, skip this scan
                    if (plateNumber === 'UNKNOWN') {
                      console.error(`❌ Scan at index ${index} missing plate number:`, scan);
                      return null;
                    }
                    
                    // ✅ Safe extraction of all properties
                    const editInfo = canEditDelete(scan);
                    const zoneName = ('zoneName' in scan ? scan.zoneName : scan.zone_name) || 'Unknown Zone';
                    const timestamp = ('timestamp' in scan ? scan.timestamp : scan.recorded_at) || new Date();
                    const scanId = ('id' in scan ? scan.id : scan.observation_id) || `scan-${index}`;
                    const isOwnScan = 'is_own_scan' in scan ? scan.is_own_scan : true;
                    const officerName = 'officer_name' in scan ? scan.officer_name : null;
                    const vehicleMake = 'vehicleMake' in scan ? scan.vehicleMake : scan.vehicle_make;
                    const vehicleModel = 'vehicleModel' in scan ? scan.vehicleModel : scan.vehicle_model;
                    const vehicleColor = 'vehicleColor' in scan ? scan.vehicleColor : scan.vehicle_color;
                    
                    // ✅ Render with validated data
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
                  } catch (error) {
                    // ✅ Error boundary for individual scan rendering
                    console.error(`❌ Error rendering scan at index ${index}:`, error, scan);
                    return null;
                  }
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
              <strong>Plate:</strong> {scanToDelete && ('plateNumber' in scanToDelete ? scanToDelete.plateNumber : scanToDelete.plate_number)}
              <br />
              <strong>Zone:</strong> {scanToDelete && ('zoneName' in scanToDelete ? scanToDelete.zoneName : scanToDelete.zone_name)}
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
