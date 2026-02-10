import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { OrganizationSelector } from '@/components/features/OrganizationSelector';
import { useZones } from '@/hooks/useZones';
import { useAuthStore } from '@/stores/authStore';
import { MapPin, Shield, AlertTriangle, CheckCircle, Clock, RefreshCw, Loader2, Download, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function ZoneCoverage() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';
  const { data: zones = [], isLoading: zonesLoading } = useZones();
  const [patrols, setPatrols] = useState<any[]>([]);
  const [breaches, setBreaches] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  
  // Date range filters
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30); // Last 30 days by default
    return date.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadFilteredData();
  }, [dateFrom, dateTo]);

  const loadFilteredData = async () => {
    setIsLoading(true);
    try {
      // Load patrols with date filter
      const { data: patrolsData, error: patrolsError } = await supabase
        .from('patrols')
        .select('*')
        .gte('patrol_date', dateFrom)
        .lte('patrol_date', dateTo)
        .order('patrol_date', { ascending: false });

      if (patrolsError) throw patrolsError;
      setPatrols(patrolsData || []);

      // Load breaches with date filter
      const { data: breachesData, error: breachesError } = await supabase
        .from('breach_alerts')
        .select('*')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: false });

      if (breachesError) throw breachesError;
      setBreaches(breachesData || []);
    } catch (error: any) {
      console.error('Failed to load filtered data:', error);
      toast.error('Failed to load zone coverage data');
    } finally {
      setIsLoading(false);
    }
  };

  const getZoneStats = (zoneId: string) => {
    const zonePatrols = patrols.filter(p => p.zone_id === zoneId);
    const activePatrol = zonePatrols.find(p => p.status === 'in_progress');
    const scheduledPatrols = zonePatrols.filter(p => p.status === 'scheduled');
    const zoneBreaches = breaches.filter(b => b.zone_id === zoneId && (b.status === 'pending' || b.status === 'notified'));

    return {
      hasActivePatrol: !!activePatrol,
      scheduledCount: scheduledPatrols.length,
      breachCount: zoneBreaches.length,
      lastPatrol: zonePatrols.filter(p => p.status === 'completed').sort((a, b) => 
        new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()
      )[0],
    };
  };

  if (zonesLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Zone Coverage Overview</h2>
          <p className="text-muted-foreground">Monitor patrol coverage and compliance across all zones</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadFilteredData} variant="outline" size="lg" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <RefreshCw className="h-5 w-5 mr-2" />}
            Refresh
          </Button>
          <Button onClick={() => toast.success('Export CSV')} variant="outline" size="lg" className="bg-green-600 text-white hover:bg-green-700 h-12 px-6">
            <Download className="h-5 w-5 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Master Organization Selector */}
      {isMaster && (
        <Card className="border-4 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 shadow-lg">
          <CardHeader className="bg-blue-100 dark:bg-blue-900/50">
            <CardTitle className="text-lg flex items-center gap-2 text-blue-900 dark:text-blue-100">
              <Filter className="h-6 w-6" />
              🎯 Master Organization Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <OrganizationSelector
              selectedOrg={selectedOrg}
              onOrgChange={setSelectedOrg}
              organizations={organizations}
              setOrganizations={setOrganizations}
            />
          </CardContent>
        </Card>
      )}

      {/* Date Range Filters */}
      <Card className="border-2 border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Date Range Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date-from" className="text-sm font-semibold">From Date</Label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="date-to" className="text-sm font-semibold">To Date</Label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Showing data from {new Date(dateFrom).toLocaleDateString('en-NZ')} to {new Date(dateTo).toLocaleDateString('en-NZ')}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {zones.map((zone) => {
          const stats = getZoneStats(zone.id);
          
          return (
            <Card key={zone.id} className="border-border hover:border-primary/50 transition-colors">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      {zone.name}
                    </CardTitle>
                    {zone.description && (
                      <p className="text-sm text-muted-foreground">{zone.description}</p>
                    )}
                  </div>
                  {stats.hasActivePatrol ? (
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                      Active Patrol
                    </Badge>
                  ) : stats.scheduledCount > 0 ? (
                    <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                      Scheduled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      No Coverage
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Zone Rules</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-primary" />
                        <span>{zone.self_contained_required ? 'SC Required' : 'SC Optional'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        <span>{zone.nights_per_month} nights/month</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-primary" />
                        <span>Max {zone.max_consecutive_nights} consecutive</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Current Status</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Active Breaches</span>
                        {stats.breachCount > 0 ? (
                          <span className="font-semibold text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {stats.breachCount}
                          </span>
                        ) : (
                          <span className="font-semibold text-green-500 flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" />
                            0
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Scheduled</span>
                        <span className="font-semibold">{stats.scheduledCount}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {stats.lastPatrol && (
                  <div className="bg-muted/20 rounded-md p-3">
                    <p className="text-xs text-muted-foreground mb-1">Last Patrol</p>
                    <p className="text-sm font-medium">
                      {new Date(stats.lastPatrol.completed_at!).toLocaleString('en-NZ', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </p>
                    {stats.lastPatrol.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{stats.lastPatrol.notes}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Calendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}
