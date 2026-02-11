/**
 * ScannedVehiclesList Component
 * Interactive color-coded list of scanned vehicles with status indicators
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Activity,
  Home,
  Clock,
  MapPin,
} from 'lucide-react';
import { SessionScan } from './SessionList';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatTimeUntilExpiry, getTimeUntilExpiry } from '@/lib/sessionPersistence';
import { useState, useEffect } from 'react';

interface ScannedVehiclesListProps {
  scans: SessionScan[];
  onSelectScan: (scan: SessionScan) => void;
  selectedScanId?: string;
}

export function ScannedVehiclesList({
  scans,
  onSelectScan,
  selectedScanId,
}: ScannedVehiclesListProps) {
  const [, setTick] = useState(0);
  
  // Update time remaining every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 60000); // Update every minute
    
    return () => clearInterval(interval);
  }, []);
  
  const getStatusColor = (scan: SessionScan) => {
    // Priority order: Flagged > Non-compliant > Homeless > Compliant
    if (scan.isFlagged) return 'border-red-500 bg-red-50 dark:bg-red-950/20';
    if (!scan.isCompliant) return 'border-amber-500 bg-amber-50 dark:bg-amber-950/20';
    if (scan.isHomeless) return 'border-blue-500 bg-blue-50 dark:bg-blue-950/20';
    return 'border-green-500 bg-green-50 dark:bg-green-950/20';
  };

  const getStatusIcon = (scan: SessionScan) => {
    if (scan.isFlagged) return <Flag className="h-5 w-5 text-red-600" />;
    if (!scan.isCompliant) return <AlertTriangle className="h-5 w-5 text-amber-600" />;
    if (scan.isHomeless) return <Home className="h-5 w-5 text-blue-600" />;
    return <CheckCircle2 className="h-5 w-5 text-green-600" />;
  };

  const getStatusBadge = (scan: SessionScan) => {
    if (scan.isFlagged) return <Badge variant="destructive" className="text-xs">🚩 Flagged</Badge>;
    if (!scan.isCompliant) return <Badge variant="default" className="bg-amber-500 text-xs">⚠️ Breach</Badge>;
    if (scan.isHomeless) return <Badge variant="default" className="bg-blue-500 text-xs">🏕️ Homeless</Badge>;
    if (scan.requiresFollowup) return <Badge variant="secondary" className="text-xs">⏰ Follow-up</Badge>;
    return <Badge variant="outline" className="text-green-600 text-xs">✓ Compliant</Badge>;
  };

  return (
    <Card className="h-full flex flex-col border-2">
      <CardHeader className="pb-3 border-b flex-shrink-0">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Scanned Vehicles</span>
          <Badge variant="secondary">{scans.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Click to view and edit details
        </p>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden">
        {scans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Activity className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <p className="text-base font-semibold text-muted-foreground">
              No vehicles scanned yet
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Scans will appear here
            </p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-3 space-y-2">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className={cn(
                    'p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md active:scale-[0.98]',
                    getStatusColor(scan),
                    selectedScanId === scan.id && 'ring-2 ring-primary shadow-lg'
                  )}
                  onClick={() => onSelectScan(scan)}
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                      {getStatusIcon(scan)}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Plate Number - Prominent */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xl font-black tracking-tight">
                          {scan.plateNumber}
                        </p>
                        {getStatusBadge(scan)}
                      </div>

                      {/* Vehicle Details */}
                      {(scan.vehicleMake || scan.vehicleModel || scan.vehicleColor) && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {[scan.vehicleColor, scan.vehicleMake, scan.vehicleModel]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}

                      {/* Zone & Time */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate max-w-24">{scan.zoneName}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatDistanceToNow(scan.timestamp, { addSuffix: true })}</span>
                        </div>
                      </div>

                      {/* Additional Status Indicators */}
                      <div className="flex flex-wrap gap-1.5">
                        {/* 24-hour retention timer */}
                        <Badge 
                          variant={getTimeUntilExpiry(scan.timestamp).totalMinutes < 60 ? 'destructive' : 'outline'}
                          className="text-[10px] px-1.5 py-0.5"
                        >
                          ⏱️ {formatTimeUntilExpiry(scan.timestamp)}
                        </Badge>
                        
                        {scan.isSelfContained && (
                          <Badge variant="outline" className="text-xs bg-white dark:bg-gray-900">
                            Self-Contained
                          </Badge>
                        )}
                        {scan.hasHSIssue && (
                          <Badge variant="default" className="bg-orange-500 text-xs">
                            H&S Issue
                          </Badge>
                        )}
                        {scan.priorObservationsCount && scan.priorObservationsCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {scan.priorObservationsCount} prior
                          </Badge>
                        )}
                        {scan.gpsAccuracy && scan.gpsAccuracy > 50 && (
                          <Badge variant="outline" className="text-amber-600 text-xs">
                            ⚠️ GPS: {scan.gpsAccuracy.toFixed(0)}m
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
