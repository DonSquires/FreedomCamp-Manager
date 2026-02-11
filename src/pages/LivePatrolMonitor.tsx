import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePatrols } from '@/hooks/usePatrols';
import { useVehicles } from '@/hooks/useVehicles';
import { useZones } from '@/hooks/useZones';
import { useAuthStore } from '@/stores/authStore';
import { MapPin, User, Clock, Car, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface LiveOfficer {
  user_id: string;
  first_name: string;
  last_name: string;
  patrol_id: string;
  zone_name: string;
  checked_in_at: string;
  last_activity: string;
  current_location: { lat: number; lng: number } | null;
  vehicles_checked: number;
  breaches_found: number;
  status: 'active' | 'idle' | 'offline';
}

export function LivePatrolMonitor() {
  const { user } = useAuthStore();
  const { data: patrols = [] } = usePatrols(user?.organization_id || 'all');
  const { data: allVehicles = [] } = useVehicles(user?.organization_id || 'all');
  const { data: zones = [] } = useZones();
  
  const [liveOfficers, setLiveOfficers] = useState<LiveOfficer[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  // Get active patrols (checked in today)
  const activePatrols = patrols.filter(p => 
    p.status === 'in_progress' || 
    (p.patrol_date === new Date().toISOString().split('T')[0] && p.checked_in_at)
  );

  // Fetch live officer data
  useEffect(() => {
    const fetchLiveData = async () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Get officers currently on patrol
      const { data: activeOfficerPatrols, error } = await supabase
        .from('patrols')
        .select(`
          id,
          assigned_to,
          zone_id,
          checked_in_at,
          check_in_location_lat,
          check_in_location_lng,
          status,
          assigned_to_user:user_profiles!assigned_to(first_name, last_name),
          zone:zones(name)
        `)
        .eq('patrol_date', today)
        .not('checked_in_at', 'is', null)
        .eq('organization_id', user?.organization_id || '');

      if (error) {
        console.error('Failed to fetch live patrols:', error);
        return;
      }

      // Get vehicle activity for each officer
      const officersWithActivity = await Promise.all(
        (activeOfficerPatrols || []).map(async (patrol) => {
          const { data: vehicleActivity } = await supabase
            .from('vehicle_records')
            .select('id, plate_number, recorded_at, is_compliant, zone_id')
            .eq('recorded_by', patrol.assigned_to)
            .gte('recorded_at', today)
            .order('recorded_at', { ascending: false });

          const vehiclesChecked = vehicleActivity?.length || 0;
          const breachesFound = vehicleActivity?.filter(v => !v.is_compliant).length || 0;
          const lastActivity = vehicleActivity?.[0]?.recorded_at || patrol.checked_in_at;

          // Determine status based on last activity
          const lastActivityTime = new Date(lastActivity).getTime();
          const now = Date.now();
          const minutesSinceActivity = (now - lastActivityTime) / 1000 / 60;
          
          const status = minutesSinceActivity < 15 ? 'active' : minutesSinceActivity < 60 ? 'idle' : 'offline';

          return {
            user_id: patrol.assigned_to,
            first_name: (patrol as any).assigned_to_user?.first_name || 'Unknown',
            last_name: (patrol as any).assigned_to_user?.last_name || 'Officer',
            patrol_id: patrol.id,
            zone_name: (patrol as any).zone?.name || 'Unknown Zone',
            checked_in_at: patrol.checked_in_at,
            last_activity: lastActivity,
            current_location: patrol.check_in_location_lat && patrol.check_in_location_lng 
              ? { lat: Number(patrol.check_in_location_lat), lng: Number(patrol.check_in_location_lng) }
              : null,
            vehicles_checked: vehiclesChecked,
            breaches_found: breachesFound,
            status,
          } as LiveOfficer;
        })
      );

      setLiveOfficers(officersWithActivity);
    };

    fetchLiveData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchLiveData, 30000);
    
    return () => clearInterval(interval);
  }, [user, patrols]);

  // Get recent vehicle checks (last 20)
  useEffect(() => {
    const fetchRecentActivity = async () => {
      const { data, error } = await supabase
        .from('vehicle_records')
        .select(`
          id,
          plate_number,
          recorded_at,
          is_compliant,
          zone:zones(name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(20);

      if (!error && data) {
        setRecentActivity(data);
      }
    };

    fetchRecentActivity();

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('vehicle_records_changes')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'vehicle_records' },
        (payload) => {
          console.log('New vehicle record:', payload.new);
          fetchRecentActivity(); // Refresh on new record
          toast.success(`New check: ${(payload.new as any).plate_number}`);
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const formatTimeSince = (timestamp: string) => {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const minutesAgo = Math.floor((now - time) / 1000 / 60);
    
    if (minutesAgo < 1) return 'Just now';
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    const hoursAgo = Math.floor(minutesAgo / 60);
    if (hoursAgo < 24) return `${hoursAgo}h ago`;
    return `${Math.floor(hoursAgo / 24)}d ago`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Live Patrol Monitor</h2>
        <p className="text-muted-foreground">Real-time officer activity and vehicle checks</p>
      </div>

      {/* Active Officers Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Officers</p>
                <p className="text-3xl font-bold mt-1">
                  {liveOfficers.filter(o => o.status === 'active').length}
                </p>
              </div>
              <User className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Vehicles Checked (Today)</p>
                <p className="text-3xl font-bold mt-1">
                  {liveOfficers.reduce((sum, o) => sum + o.vehicles_checked, 0)}
                </p>
              </div>
              <Car className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Breaches Found</p>
                <p className="text-3xl font-bold mt-1">
                  {liveOfficers.reduce((sum, o) => sum + o.breaches_found, 0)}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Zones Covered</p>
                <p className="text-3xl font-bold mt-1">
                  {new Set(liveOfficers.map(o => o.zone_name)).size}
                </p>
              </div>
              <MapPin className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Live Officer Cards */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Officers in Field
            <Badge variant="outline" className="ml-auto">
              Live Updates
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {liveOfficers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No Active Officers</p>
              <p className="text-sm">No officers are currently checked in for patrol</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {liveOfficers.map((officer) => (
                <Card key={officer.user_id} className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold">
                            {officer.first_name} {officer.last_name}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {officer.zone_name}
                          </p>
                        </div>
                      </div>
                      <Badge 
                        variant={
                          officer.status === 'active' ? 'default' : 
                          officer.status === 'idle' ? 'secondary' : 
                          'outline'
                        }
                        className={
                          officer.status === 'active' ? 'bg-green-500' : 
                          officer.status === 'idle' ? 'bg-amber-500' : 
                          'bg-gray-500'
                        }
                      >
                        {officer.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-xs text-muted-foreground">Checked</div>
                        <div className="text-lg font-bold">{officer.vehicles_checked}</div>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-xs text-muted-foreground">Breaches</div>
                        <div className="text-lg font-bold text-amber-500">
                          {officer.breaches_found}
                        </div>
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <div className="text-xs text-muted-foreground">Last</div>
                        <div className="text-sm font-semibold">
                          {formatTimeSince(officer.last_activity)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Checked in: {new Date(officer.checked_in_at).toLocaleTimeString('en-NZ', { 
                        timeZone: 'Pacific/Auckland',
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity Feed */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Vehicle Checks
            <Badge variant="outline" className="ml-auto">Last 20</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentActivity.map((record) => (
              <div 
                key={record.id}
                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full ${record.is_compliant ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="font-semibold">{record.plate_number}</p>
                    <p className="text-sm text-muted-foreground">
                      {(record as any).zone?.name || 'Unknown Zone'} • {(record as any).recorded_by_user?.first_name} {(record as any).recorded_by_user?.last_name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {record.is_compliant ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Compliant
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-500/10 text-red-600">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Breach
                    </Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {formatTimeSince(record.recorded_at)}
                  </span>
                </div>
              </div>
            ))}
            {recentActivity.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No Recent Activity</p>
                <p className="text-sm">Vehicle checks will appear here in real-time</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
