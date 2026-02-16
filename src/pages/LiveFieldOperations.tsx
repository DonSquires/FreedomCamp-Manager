/**
 * Live Field Operations - Admin Portal
 * 
 * Real-time monitoring of all field officers:
 * - Live GPS location on map
 * - Current activity (scanning, investigating, patrolling, etc.)
 * - Recent scans and observations
 * - Auto patrol check-ins/check-outs
 * - Zone transitions
 * - GPS accuracy and signal strength
 * 
 * CRITICAL FOR OPERATIONAL OVERSIGHT AND LEGAL COMPLIANCE
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Activity,
  Clock,
  Camera,
  FileText,
  Shield,
  Navigation,
  Wifi,
  WifiOff,
  RefreshCw,
  Filter,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OfficerActivity {
  user_id: string;
  officer_name: string;
  activity_type: string;
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number;
  zone_name?: string;
  plate_number?: string;
  activity_details?: string;
  recorded_at: string;
  time_ago: string;
}

export function LiveFieldOperations() {
  const [activities, setActivities] = useState<OfficerActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterActivity, setFilterActivity] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Load recent activities
  const loadActivities = async () => {
    try {
      // Get last 100 activities from all officers in last 4 hours
      const fourHoursAgo = new Date();
      fourHoursAgo.setHours(fourHoursAgo.getHours() - 4);

      const { data, error } = await supabase
        .from('officer_activity_log')
        .select(`
          user_id,
          activity_type,
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          metadata,
          recorded_at,
          user_profiles!inner(first_name, last_name)
        `)
        .gte('recorded_at', fourHoursAgo.toISOString())
        .order('recorded_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const formatted: OfficerActivity[] = (data || []).map((activity: any) => {
        const metadata = activity.metadata || {};
        const profile = activity.user_profiles;
        const timeAgo = getTimeAgo(new Date(activity.recorded_at));

        return {
          user_id: activity.user_id,
          officer_name: `${profile.first_name} ${profile.last_name}`,
          activity_type: activity.activity_type,
          gps_latitude: activity.gps_latitude,
          gps_longitude: activity.gps_longitude,
          gps_accuracy: activity.gps_accuracy,
          zone_name: metadata.zone_name,
          plate_number: metadata.plate_number,
          activity_details: metadata.activity_details,
          recorded_at: activity.recorded_at,
          time_ago: timeAgo,
        };
      });

      setActivities(formatted);
    } catch (error: any) {
      console.error('Failed to load activities:', error);
      toast.error('Failed to load field operations');
    } finally {
      setLoading(false);
    }
  };

  // Calculate time ago
  const getTimeAgo = (timestamp: Date): string => {
    const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  // Get activity icon and color
  const getActivityStyle = (type: string) => {
    switch (type) {
      case 'scanning':
        return { icon: Camera, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/20' };
      case 'investigating':
        return { icon: FileText, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/20' };
      case 'patrolling':
        return { icon: Shield, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/20' };
      case 'driving':
        return { icon: Navigation, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/20' };
      case 'reporting':
        return { icon: FileText, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/20' };
      default:
        return { icon: Activity, color: 'text-gray-600', bg: 'bg-gray-50 dark:bg-gray-950/20' };
    }
  };

  // Get GPS accuracy color
  const getAccuracyColor = (accuracy: number) => {
    if (accuracy <= 10) return 'text-green-600';
    if (accuracy <= 30) return 'text-yellow-600';
    if (accuracy <= 50) return 'text-orange-600';
    return 'text-red-600';
  };

  // Initial load
  useEffect(() => {
    loadActivities();
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadActivities();
    }, 10000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Subscribe to real-time updates
  useEffect(() => {
    const channel = supabase
      .channel('officer-activity-updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'officer_activity_log',
        },
        (payload) => {
          console.log('🔔 New activity:', payload);
          loadActivities(); // Reload all activities
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter activities
  const filteredActivities = filterActivity === 'all'
    ? activities
    : activities.filter(a => a.activity_type === filterActivity);

  // Group by officer
  const officerGroups = filteredActivities.reduce((groups, activity) => {
    const key = activity.user_id;
    if (!groups[key]) {
      groups[key] = {
        officer_name: activity.officer_name,
        activities: [],
      };
    }
    groups[key].activities.push(activity);
    return groups;
  }, {} as Record<string, { officer_name: string; activities: OfficerActivity[] }>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Live Field Operations</h1>
        <p className="text-muted-foreground">
          Real-time monitoring of all field officers and their activities
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <select
                value={filterActivity}
                onChange={(e) => setFilterActivity(e.target.value)}
                className="px-3 py-2 border rounded-lg bg-background"
              >
                <option value="all">All Activities</option>
                <option value="scanning">Scanning</option>
                <option value="investigating">Investigating</option>
                <option value="patrolling">Patrolling</option>
                <option value="driving">Driving</option>
                <option value="reporting">Reporting</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <RefreshCw className={cn('h-4 w-4 mr-2', autoRefresh && 'animate-spin')} />
                {autoRefresh ? 'Auto-Refresh On' : 'Auto-Refresh Off'}
              </Button>

              <Button variant="outline" size="sm" onClick={loadActivities} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Feed - Grouped by Officer */}
      <div className="grid gap-6">
        {Object.entries(officerGroups).map(([userId, group]) => {
          const latestActivity = group.activities[0];
          const ActivityIcon = getActivityStyle(latestActivity.activity_type).icon;
          const activityColor = getActivityStyle(latestActivity.activity_type).color;
          const activityBg = getActivityStyle(latestActivity.activity_type).bg;

          return (
            <Card key={userId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2 rounded-lg', activityBg)}>
                      <ActivityIcon className={cn('h-5 w-5', activityColor)} />
                    </div>
                    <div>
                      <p className="text-lg font-bold">{group.officer_name}</p>
                      <p className="text-sm text-muted-foreground font-normal">
                        {latestActivity.zone_name || 'Unknown Zone'} • {latestActivity.time_ago}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={getAccuracyColor(latestActivity.gps_accuracy)}>
                      GPS: ±{latestActivity.gps_accuracy.toFixed(0)}m
                    </Badge>
                    <Badge variant="secondary">
                      {latestActivity.activity_type}
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent>
                {/* Latest Activity Details */}
                <div className="space-y-4">
                  {/* GPS Location */}
                  <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                    <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">Current Location</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {latestActivity.gps_latitude.toFixed(6)}, {latestActivity.gps_longitude.toFixed(6)}
                      </p>
                      <a
                        href={`https://www.google.com/maps?q=${latestActivity.gps_latitude},${latestActivity.gps_longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        View on Google Maps →
                      </a>
                    </div>
                  </div>

                  {/* Activity Details */}
                  {latestActivity.plate_number && (
                    <div className="flex items-center gap-2 text-sm">
                      <Camera className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">Last Scan:</span>
                      <span className="font-mono">{latestActivity.plate_number}</span>
                    </div>
                  )}

                  {/* Recent Activities Timeline */}
                  {group.activities.length > 1 && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-sm font-semibold mb-3">Recent Activity ({group.activities.length})</p>
                      <div className="space-y-2">
                        {group.activities.slice(0, 5).map((activity, idx) => {
                          const Icon = getActivityStyle(activity.activity_type).icon;
                          const color = getActivityStyle(activity.activity_type).color;

                          return (
                            <div key={idx} className="flex items-start gap-3 text-sm">
                              <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', color)} />
                              <div className="flex-1">
                                <span className="font-medium capitalize">{activity.activity_type}</span>
                                {activity.zone_name && (
                                  <span className="text-muted-foreground"> in {activity.zone_name}</span>
                                )}
                                {activity.plate_number && (
                                  <span className="text-muted-foreground"> • {activity.plate_number}</span>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {activity.time_ago}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredActivities.length === 0 && !loading && (
          <Card>
            <CardContent className="p-12 text-center">
              <Activity className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-lg font-semibold text-muted-foreground">No Field Activity</p>
              <p className="text-sm text-muted-foreground mt-1">
                No officers are currently active in the field
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
