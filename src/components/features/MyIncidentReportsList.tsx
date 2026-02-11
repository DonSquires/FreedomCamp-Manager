/**
 * MyIncidentReportsList - Officer's submitted incident reports with 24-hour retention
 * Similar to ScannedVehiclesList but for incidents
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Clock,
  MapPin,
  FileText,
  Loader2,
  Download,
  Archive,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { getTimeUntilExpiry, formatTimeUntilExpiry } from '@/lib/sessionPersistence';

interface IncidentReport {
  id: string;
  incident_type: string;
  description: string;
  severity: string;
  zone_id: string;
  zone?: { name: string };
  vehicle_id: string | null;
  vehicle?: { plate_number: string };
  photos: string[];
  gps_latitude: number | null;
  gps_longitude: number | null;
  happened_at: string;
  status: string;
  court_ready: boolean;
  approved_by: string | null;
  created_at: string;
  homeless_status: string | null;
  hs_issues: boolean;
}

export function MyIncidentReportsList() {
  const { user } = useAuthStore();
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);

  // Load user's incidents (24-hour retention)
  const loadIncidents = async () => {
    if (!user?.id) return;

    setIsLoading(true);
    try {
      // Get incidents from last 24 hours only
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('incidents')
        .select(`
          *,
          zone:zones(name),
          vehicle:canonical_vehicles(plate_number)
        `)
        .eq('user_id', user.id)
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to load incidents:', error);
        toast.error('Failed to load incident reports');
        return;
      }

      setIncidents(data || []);
      console.log(`✅ Loaded ${data?.length || 0} incident reports from last 24 hours`);
    } catch (error: any) {
      console.error('Failed to load incidents:', error);
      toast.error('Failed to load incident reports');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();

    // Real-time subscription for updates
    const channel = supabase
      .channel('my_incidents')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
          filter: `user_id=eq.${user?.id}`,
        },
        () => {
          console.log('🔄 Incident updated - reloading');
          loadIncidents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Auto-refresh to update countdown timers
  useEffect(() => {
    const interval = setInterval(() => {
      // Force re-render to update countdown timers
      setIncidents(prev => [...prev]);
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  const handleExportCSV = () => {
    const headers = [
      'ID',
      'Type',
      'Severity',
      'Description',
      'Zone',
      'Vehicle',
      'Status',
      'Court Ready',
      'Photos',
      'GPS',
      'Happened At',
      'Created At',
    ];

    const rows = incidents.map(i => [
      i.id,
      i.incident_type,
      i.severity,
      i.description,
      i.zone?.name || '',
      i.vehicle?.plate_number || '',
      i.status,
      i.court_ready ? 'Yes' : 'No',
      i.photos?.length || 0,
      i.gps_latitude && i.gps_longitude ? `${i.gps_latitude},${i.gps_longitude}` : '',
      i.happened_at ? new Date(i.happened_at).toLocaleString('en-NZ') : '',
      new Date(i.created_at).toLocaleString('en-NZ'),
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_incidents_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Incident reports exported to CSV');
  };

  const handleClearAll = () => {
    if (!confirm('Clear all incident reports from this view? Reports will remain in the database.')) {
      return;
    }
    setIncidents([]);
    toast.success('View cleared - reports remain in database');
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-600" />
              My Incident Reports
            </CardTitle>
            <Badge variant="secondary">{incidents.length}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            📱 Reports available for 24 hours from submission
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {incidents.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-base">No incident reports</p>
              <p className="text-sm mt-2">Submitted reports appear here for 24 hours</p>
            </div>
          ) : (
            <>
              {/* Incident List */}
              <div className="space-y-3">
                {incidents.map((incident) => {
                  const retention = getTimeUntilExpiry(new Date(incident.created_at));
                  const isExpiringSoon = retention.totalMinutes < 60 && !retention.expired;

                  return (
                    <Card
                      key={incident.id}
                      className={`border ${
                        isExpiringSoon
                          ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                          : incident.court_ready
                          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                          : 'border-border'
                      } cursor-pointer hover:shadow-md transition-shadow`}
                      onClick={() => setSelectedIncident(incident)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <Badge variant="outline">{incident.incident_type}</Badge>
                              <Badge
                                variant={
                                  incident.severity === 'critical' || incident.severity === 'high'
                                    ? 'destructive'
                                    : 'secondary'
                                }
                              >
                                {incident.severity}
                              </Badge>
                              {incident.court_ready && (
                                <Badge className="bg-green-600 text-white">Court Ready</Badge>
                              )}
                              {incident.hs_issues && (
                                <Badge variant="destructive">H&S Issue</Badge>
                              )}
                            </div>
                            {incident.vehicle && (
                              <p className="font-mono font-bold text-lg mb-1">
                                {incident.vehicle.plate_number}
                              </p>
                            )}
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {incident.description}
                            </p>
                          </div>
                          <AlertTriangle
                            className={`h-5 w-5 shrink-0 ${
                              incident.court_ready ? 'text-green-600' : 'text-amber-500'
                            }`}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {incident.zone?.name || 'Unknown Zone'}
                          </div>
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {incident.photos?.length || 0} photos
                          </div>
                          <div className="flex items-center gap-1 col-span-2">
                            <Clock className="h-3 w-3" />
                            Submitted: {new Date(incident.created_at).toLocaleString('en-NZ')}
                          </div>
                        </div>

                        {/* Retention Timer */}
                        <div
                          className={`mt-3 pt-3 border-t flex items-center justify-between ${
                            isExpiringSoon ? 'border-red-300' : 'border-border'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Clock
                              className={`h-4 w-4 ${
                                isExpiringSoon ? 'text-red-600' : 'text-muted-foreground'
                              }`}
                            />
                            <span
                              className={`text-xs font-semibold ${
                                isExpiringSoon
                                  ? 'text-red-600'
                                  : retention.expired
                                  ? 'text-muted-foreground'
                                  : 'text-green-600'
                              }`}
                            >
                              {formatTimeUntilExpiry(new Date(incident.created_at))}
                            </span>
                          </div>
                          {isExpiringSoon && (
                            <Badge variant="destructive" className="text-xs">
                              Expiring Soon
                            </Badge>
                          )}
                        </div>

                        {/* Status */}
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground">
                            Status: <span className="font-semibold">{incident.status}</span>
                            {incident.approved_by && ' • Approved by admin'}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Export Actions */}
              <div className="grid grid-cols-2 gap-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={handleExportCSV}
                  className="h-14 touch-manipulation"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClearAll}
                  className="h-14 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 touch-manipulation"
                >
                  <Archive className="h-5 w-5 mr-2" />
                  Clear View
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Incident Details Modal (if selected) */}
      {selectedIncident && (
        <Card className="border-2 border-primary">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Incident Details</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIncident(null)}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-semibold">{selectedIncident.incident_type}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Severity</p>
                <Badge
                  variant={
                    selectedIncident.severity === 'critical' ||
                    selectedIncident.severity === 'high'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {selectedIncident.severity}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Zone</p>
                <p className="font-semibold">{selectedIncident.zone?.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Vehicle</p>
                <p className="font-mono font-bold">
                  {selectedIncident.vehicle?.plate_number || 'N/A'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {selectedIncident.description}
              </p>
            </div>

            {selectedIncident.photos && selectedIncident.photos.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  Photos ({selectedIncident.photos.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {selectedIncident.photos.map((photo, idx) => (
                    <img
                      key={idx}
                      src={photo}
                      alt={`Evidence ${idx + 1}`}
                      className="w-full h-32 object-cover rounded-lg border"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 pt-4 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Happened At</p>
                <p className="text-sm font-semibold">
                  {selectedIncident.happened_at
                    ? new Date(selectedIncident.happened_at).toLocaleString('en-NZ')
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Submitted At</p>
                <p className="text-sm font-semibold">
                  {new Date(selectedIncident.created_at).toLocaleString('en-NZ')}
                </p>
              </div>
            </div>

            {selectedIncident.court_ready && (
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-500">
                <p className="text-sm text-green-900 dark:text-green-100 font-semibold">
                  ✅ This report has been approved for court use
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
