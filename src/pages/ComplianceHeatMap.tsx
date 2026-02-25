/**
 * Compliance Heat Map - Geographic visualization of compliance, activity, and enforcement
 * 
 * Features:
 * - Interactive map with GPS-based heat overlays
 * - Toggle between compliance, activity, and enforcement heat maps
 * - Zone-based clustering and analysis
 * - Real-time data filtering by date range
 * - Click-through to vehicle and observation details
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MapPin,
  RefreshCw,
  Loader2,
  Download,
  Filter,
  AlertTriangle,
  Activity,
  Shield,
  TrendingUp,
  Eye,
  Layers,
  Target,
  Home,
  Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface HeatMapPoint {
  lat: number;
  lng: number;
  intensity: number;
  plate_number?: string;
  zone_name?: string;
  is_breach?: boolean;
  is_flagged?: boolean;
  homeless_status?: string;
  observation_id?: string;
  recorded_at?: string;
}

interface ZoneCluster {
  zone_id: string;
  zone_name: string;
  center_lat: number;
  center_lng: number;
  observation_count: number;
  breach_count: number;
  compliance_rate: number;
  flagged_count: number;
  homeless_count: number;
  enforcement_count: number;
  unique_vehicles: number;
}

type HeatMapMode = 'compliance' | 'activity' | 'enforcement' | 'breaches' | 'flagged' | 'homeless';

export function ComplianceHeatMap() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [heatMapMode, setHeatMapMode] = useState<HeatMapMode>('compliance');
  const [heatPoints, setHeatPoints] = useState<HeatMapPoint[]>([]);
  const [zoneClusters, setZoneClusters] = useState<ZoneCluster[]>([]);

  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>('all');
  const [availableOrganizations, setAvailableOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [selectedZone, setSelectedZone] = useState<ZoneCluster | null>(null);
  const [showClusters, setShowClusters] = useState(true);
  const [showHeatMap, setShowHeatMap] = useState(true);

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  useEffect(() => {
    loadHeatMapData();
  }, [startDate, endDate, selectedOrganizationId, heatMapMode]);

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableOrganizations(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    }
  };

  const loadHeatMapData = async () => {
    setIsLoading(true);

    try {
      console.log('🗺️ Loading heat map data...');

      // Get user's organization if not master
      let filterOrgId: string | null = null;
      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();
        filterOrgId = profile?.organization_id || null;
      } else if (selectedOrganizationId !== 'all') {
        filterOrgId = selectedOrganizationId;
      }

      // Load observations with GPS coordinates
      let obsQuery = supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          gps_latitude,
          gps_longitude,
          is_compliant,
          is_breach,
          recorded_at,
          zone_id,
          zones (name, location_lat, location_lng),
          canonical_vehicles (is_flagged, homeless_status)
        `)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`)
        .not('gps_latitude', 'is', null)
        .not('gps_longitude', 'is', null);

      if (filterOrgId) {
        obsQuery = obsQuery.eq('organization_id', filterOrgId);
      }

      const { data: observations, error: obsError } = await obsQuery;

      if (obsError) throw obsError;

      console.log('✅ Loaded', observations?.length || 0, 'observations with GPS');

      // Load enforcement actions with GPS
      let enfQuery = supabase
        .from('enforcement_actions')
        .select(`
          id,
          plate_number,
          location_lat,
          location_lng,
          zone_id,
          action_type,
          zones (name)
        `)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`)
        .not('location_lat', 'is', null)
        .not('location_lng', 'is', null);

      if (filterOrgId) {
        enfQuery = enfQuery.eq('organization_id', filterOrgId);
      }

      const { data: enforcement, error: enfError } = await enfQuery;

      if (enfError) throw enfError;

      console.log('✅ Loaded', enforcement?.length || 0, 'enforcement actions with GPS');

      // Process heat map points based on mode
      let points: HeatMapPoint[] = [];

      switch (heatMapMode) {
        case 'activity':
          // All observations - intensity based on frequency
          points = (observations || []).map(obs => ({
            lat: obs.gps_latitude!,
            lng: obs.gps_longitude!,
            intensity: 1,
            plate_number: obs.plate_number,
            zone_name: (obs.zones as any)?.name,
            is_breach: obs.is_breach,
            is_flagged: (obs.canonical_vehicles as any)?.is_flagged,
            observation_id: obs.observation_id,
            recorded_at: obs.recorded_at,
          }));
          break;

        case 'compliance':
          // Non-compliant observations - higher intensity = worse compliance
          points = (observations || [])
            .filter(obs => !obs.is_compliant)
            .map(obs => ({
              lat: obs.gps_latitude!,
              lng: obs.gps_longitude!,
              intensity: obs.is_breach ? 2 : 1,
              plate_number: obs.plate_number,
              zone_name: (obs.zones as any)?.name,
              is_breach: obs.is_breach,
              observation_id: obs.observation_id,
              recorded_at: obs.recorded_at,
            }));
          break;

        case 'breaches':
          // Only breach observations
          points = (observations || [])
            .filter(obs => obs.is_breach)
            .map(obs => ({
              lat: obs.gps_latitude!,
              lng: obs.gps_longitude!,
              intensity: 2,
              plate_number: obs.plate_number,
              zone_name: (obs.zones as any)?.name,
              is_breach: true,
              observation_id: obs.observation_id,
              recorded_at: obs.recorded_at,
            }));
          break;

        case 'enforcement':
          // Enforcement action locations
          points = (enforcement || []).map(enf => ({
            lat: enf.location_lat!,
            lng: enf.location_lng!,
            intensity: 1.5,
            plate_number: enf.plate_number,
            zone_name: (enf.zones as any)?.name,
          }));
          break;

        case 'flagged':
          // Flagged vehicle sightings
          points = (observations || [])
            .filter(obs => (obs.canonical_vehicles as any)?.is_flagged)
            .map(obs => ({
              lat: obs.gps_latitude!,
              lng: obs.gps_longitude!,
              intensity: 2,
              plate_number: obs.plate_number,
              zone_name: (obs.zones as any)?.name,
              is_flagged: true,
              observation_id: obs.observation_id,
              recorded_at: obs.recorded_at,
            }));
          break;

        case 'homeless':
          // Homeless vehicle sightings (both confirmed and claimed)
          points = (observations || [])
            .filter(obs => {
              const status = (obs.canonical_vehicles as any)?.homeless_status;
              return status === 'confirmed' || status === 'claimed';
            })
            .map(obs => ({
              lat: obs.gps_latitude!,
              lng: obs.gps_longitude!,
              intensity: (obs.canonical_vehicles as any)?.homeless_status === 'confirmed' ? 2 : 1.5,
              plate_number: obs.plate_number,
              zone_name: (obs.zones as any)?.name,
              homeless_status: (obs.canonical_vehicles as any)?.homeless_status,
              observation_id: obs.observation_id,
              recorded_at: obs.recorded_at,
            }));
          break;
      }

      setHeatPoints(points);

      // Calculate zone clusters
      const zoneMap = new Map<string, {
        zone_id: string;
        zone_name: string;
        observations: any[];
        enforcement: any[];
        gps_points: Array<{ lat: number; lng: number }>;
      }>();

      (observations || []).forEach(obs => {
        if (!zoneMap.has(obs.zone_id)) {
          zoneMap.set(obs.zone_id, {
            zone_id: obs.zone_id,
            zone_name: (obs.zones as any)?.name || 'Unknown',
            observations: [],
            enforcement: [],
            gps_points: [],
          });
        }

        const zone = zoneMap.get(obs.zone_id)!;
        zone.observations.push(obs);
        if (obs.gps_latitude && obs.gps_longitude) {
          zone.gps_points.push({ lat: obs.gps_latitude, lng: obs.gps_longitude });
        }
      });

      (enforcement || []).forEach(enf => {
        if (zoneMap.has(enf.zone_id)) {
          zoneMap.get(enf.zone_id)!.enforcement.push(enf);
        }
      });

      const clusters: ZoneCluster[] = Array.from(zoneMap.values()).map(zone => {
        // Calculate center point from GPS observations or use zone center
        let centerLat = 0;
        let centerLng = 0;

        if (zone.gps_points.length > 0) {
          centerLat = zone.gps_points.reduce((sum, p) => sum + p.lat, 0) / zone.gps_points.length;
          centerLng = zone.gps_points.reduce((sum, p) => sum + p.lng, 0) / zone.gps_points.length;
        } else {
          // Fallback to first observation's zone location
          const firstObs = zone.observations[0];
          centerLat = (firstObs?.zones as any)?.location_lat || 0;
          centerLng = (firstObs?.zones as any)?.location_lng || 0;
        }

        const breachCount = zone.observations.filter(o => o.is_breach).length;
        const totalObs = zone.observations.length;
        const complianceRate = totalObs > 0 ? Math.round(((totalObs - breachCount) / totalObs) * 100) : 100;

        const uniquePlates = new Set(zone.observations.map(o => o.plate_number));
        const flaggedCount = zone.observations.filter(o => (o.canonical_vehicles as any)?.is_flagged).length;
        
        // Count homeless - unique vehicles per zone
        const homelessPlates = new Set(
          zone.observations
            .filter(o => {
              const status = (o.canonical_vehicles as any)?.homeless_status;
              return status === 'confirmed' || status === 'claimed';
            })
            .map(o => o.plate_number)
        );
        const homelessCount = homelessPlates.size;

        return {
          zone_id: zone.zone_id,
          zone_name: zone.zone_name,
          center_lat: centerLat,
          center_lng: centerLng,
          observation_count: totalObs,
          breach_count: breachCount,
          compliance_rate: complianceRate,
          flagged_count: flaggedCount,
          homeless_count: homelessCount,
          enforcement_count: zone.enforcement.length,
          unique_vehicles: uniquePlates.size,
        };
      }).filter(c => c.observation_count > 0);

      setZoneClusters(clusters);
      console.log('✅ Generated', clusters.length, 'zone clusters');

    } catch (error: any) {
      console.error('Failed to load heat map data:', error);
      toast.error('Failed to load heat map data');
    } finally {
      setIsLoading(false);
    }
  };

  const exportData = () => {
    const csvData = [
      ['Compliance Heat Map Export'],
      ['Generated:', new Date().toLocaleString('en-NZ')],
      ['Period:', `${startDate} to ${endDate}`],
      ['Mode:', heatMapMode],
      [''],
      ['Zone Clusters'],
      ['Zone Name', 'Observations', 'Unique Vehicles', 'Breaches', 'Compliance %', 'Flagged', 'Homeless', 'Enforcement'],
      ...zoneClusters.map(z => [
        z.zone_name,
        z.observation_count,
        z.unique_vehicles,
        z.breach_count,
        z.compliance_rate,
        z.flagged_count,
        z.homeless_count,
        z.enforcement_count,
      ]),
      [''],
      ['Heat Points'],
      ['Latitude', 'Longitude', 'Plate', 'Zone', 'Intensity', 'Breach', 'Flagged'],
      ...heatPoints.slice(0, 1000).map(p => [
        p.lat.toFixed(6),
        p.lng.toFixed(6),
        p.plate_number || '',
        p.zone_name || '',
        p.intensity,
        p.is_breach ? 'Yes' : 'No',
        p.is_flagged ? 'Yes' : 'No',
      ]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `heat-map-${heatMapMode}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Heat map data exported');
  };

  const getModeColor = (mode: HeatMapMode) => {
    switch (mode) {
      case 'activity': return 'blue';
      case 'compliance': return 'red';
      case 'breaches': return 'orange';
      case 'enforcement': return 'purple';
      case 'flagged': return 'pink';
      case 'homeless': return 'cyan';
      default: return 'gray';
    }
  };

  const getModeIcon = (mode: HeatMapMode) => {
    switch (mode) {
      case 'activity': return Activity;
      case 'compliance': return TrendingUp;
      case 'breaches': return AlertTriangle;
      case 'enforcement': return Shield;
      case 'flagged': return Flag;
      case 'homeless': return Home;
      default: return MapPin;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <MapPin className="h-8 w-8 text-primary" />
            Compliance Heat Map
          </h1>
          <p className="text-muted-foreground mt-1">
            Geographic visualization of compliance, activity, and enforcement patterns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadHeatMapData} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button variant="outline" onClick={exportData}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Heat Map Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Heat Map Mode Selector */}
            <div>
              <Label className="mb-2 block">Heat Map Mode</Label>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                {(['activity', 'compliance', 'breaches', 'enforcement', 'flagged', 'homeless'] as HeatMapMode[]).map(mode => {
                  const Icon = getModeIcon(mode);
                  const color = getModeColor(mode);
                  return (
                    <Button
                      key={mode}
                      variant={heatMapMode === mode ? 'default' : 'outline'}
                      onClick={() => setHeatMapMode(mode)}
                      className="h-auto py-3 flex flex-col items-center gap-1"
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs capitalize">{mode}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Date Range & Organization */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {isMaster && availableOrganizations.length > 0 && (
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {availableOrganizations.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            {/* Display Options */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showClusters}
                  onChange={(e) => setShowClusters(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">Show Zone Clusters</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHeatMap}
                  onChange={(e) => setShowHeatMap(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">Show Heat Overlay</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Heat Points</div>
            <div className="text-3xl font-bold">{heatPoints.length}</div>
            <div className="text-xs text-muted-foreground mt-1">GPS locations</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Zone Clusters</div>
            <div className="text-3xl font-bold">{zoneClusters.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Active zones</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Observations</div>
            <div className="text-3xl font-bold">
              {zoneClusters.reduce((sum, z) => sum + z.observation_count, 0)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">In selected period</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Avg Compliance</div>
            <div className="text-3xl font-bold">
              {zoneClusters.length > 0
                ? Math.round(zoneClusters.reduce((sum, z) => sum + z.compliance_rate, 0) / zoneClusters.length)
                : 0}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">Across all zones</div>
          </CardContent>
        </Card>
      </div>

      {/* Map Placeholder with Instructions */}
      <Card className="border-2 border-dashed border-primary/50">
        <CardContent className="p-12 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4">
              <Target className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Interactive Map Integration</h3>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              This heat map visualizes {heatPoints.length} GPS locations across {zoneClusters.length} zones.
              To enable the interactive map, integrate a mapping library like Google Maps, Mapbox, or Leaflet.
            </p>
          </div>

          <div className="flex items-center justify-center gap-4">
            <Badge variant="outline" className="gap-1 py-2 px-4">
              <Layers className="h-4 w-4" />
              {heatMapMode === 'activity' && 'Activity Density'}
              {heatMapMode === 'compliance' && 'Non-Compliance Hotspots'}
              {heatMapMode === 'breaches' && 'Breach Locations'}
              {heatMapMode === 'enforcement' && 'Enforcement Actions'}
              {heatMapMode === 'flagged' && 'Flagged Vehicle Sightings'}
              {heatMapMode === 'homeless' && 'Homeless Vehicle Locations'}
            </Badge>
            <Badge variant="outline" className="py-2 px-4">
              Period: {startDate} to {endDate}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Zone Clusters Table */}
      {showClusters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Zone Clusters ({zoneClusters.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : zoneClusters.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No zone data found for selected period</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {zoneClusters
                  .sort((a, b) => b.observation_count - a.observation_count)
                  .map((zone) => (
                    <div
                      key={zone.zone_id}
                      className="p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setSelectedZone(zone === selectedZone ? null : zone)}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-lg">{zone.zone_name}</h4>
                            <Badge variant={zone.compliance_rate >= 80 ? 'default' : 'destructive'}>
                              {zone.compliance_rate}% Compliant
                            </Badge>
                            {zone.flagged_count > 0 && (
                              <Badge variant="outline" className="gap-1 bg-red-50 text-red-700">
                                <Flag className="h-3 w-3" />
                                {zone.flagged_count} Flagged
                              </Badge>
                            )}
                            {zone.homeless_count > 0 && (
                              <Badge variant="outline" className="gap-1 bg-cyan-50 text-cyan-700">
                                <Home className="h-3 w-3" />
                                {zone.homeless_count} Homeless
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Center: {zone.center_lat.toFixed(6)}, {zone.center_lng.toFixed(6)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`https://maps.google.com/?q=${zone.center_lat},${zone.center_lng}&z=15`, '_blank');
                          }}
                        >
                          <Eye className="h-4 w-4" />
                          View on Map
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                        <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded">
                          <div className="text-xs text-muted-foreground mb-1">Observations</div>
                          <div className="text-2xl font-bold text-blue-600">{zone.observation_count}</div>
                        </div>

                        <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded">
                          <div className="text-xs text-muted-foreground mb-1">Unique Vehicles</div>
                          <div className="text-2xl font-bold text-green-600">{zone.unique_vehicles}</div>
                        </div>

                        <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded">
                          <div className="text-xs text-muted-foreground mb-1">Breaches</div>
                          <div className="text-2xl font-bold text-red-600">{zone.breach_count}</div>
                        </div>

                        <div className="p-3 bg-purple-50 dark:bg-purple-950/20 rounded">
                          <div className="text-xs text-muted-foreground mb-1">Enforcement</div>
                          <div className="text-2xl font-bold text-purple-600">{zone.enforcement_count}</div>
                        </div>

                        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded">
                          <div className="text-xs text-muted-foreground mb-1">Density</div>
                          <div className="text-2xl font-bold text-amber-600">
                            {(zone.observation_count / Math.max(1, zoneClusters.length)).toFixed(1)}
                          </div>
                        </div>
                      </div>

                      {selectedZone?.zone_id === zone.zone_id && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="text-xs font-semibold text-muted-foreground mb-2">Heat Map Analysis:</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 bg-muted rounded">
                              <strong>Activity Level:</strong> {zone.observation_count > 50 ? 'Very High' : zone.observation_count > 20 ? 'High' : zone.observation_count > 10 ? 'Medium' : 'Low'}
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <strong>Compliance Risk:</strong> {zone.compliance_rate < 70 ? 'High Risk' : zone.compliance_rate < 85 ? 'Medium Risk' : 'Low Risk'}
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <strong>Breach Rate:</strong> {zone.observation_count > 0 ? ((zone.breach_count / zone.observation_count) * 100).toFixed(1) : 0}%
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <strong>Enforcement Rate:</strong> {zone.observation_count > 0 ? ((zone.enforcement_count / zone.observation_count) * 100).toFixed(1) : 0}%
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
