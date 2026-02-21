/**
 * Hotspots Map - Heat Map & Density Analysis with Leaflet
 * 
 * Features:
 * - Interactive Leaflet map with clustered markers
 * - Heat layer toggle
 * - Cluster click → drawer with observations
 * - Respects global filters (date, org, zone)
 * - Export to Observations page with filters
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Flame,
  MapPin,
  RefreshCw,
  Layers,
  Eye,
  Calendar,
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { useGlobalFilters } from '@/stores/globalFiltersStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in React-Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

interface HotspotPoint {
  lat: number;
  lng: number;
  count: number;
  zone_name?: string;
}

interface ClusterObservation {
  id: string;
  plate_number: string;
  recorded_at: string;
  zone_name: string;
  recorded_by_name: string;
  is_compliant: boolean;
  photo_url: string;
  gps_latitude: number;
  gps_longitude: number;
}

// Component to recenter map when data loads
function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  
  return null;
}

export default function HotspotsMapPage() {
  const navigate = useNavigate();
  const { dateFrom, dateTo, organizationId, zoneId } = useGlobalFilters();
  
  const [points, setPoints] = useState<HotspotPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-43.5321, 172.6362]); // Christchurch default
  const [mapZoom, setMapZoom] = useState(12);
  const [selectedCluster, setSelectedCluster] = useState<HotspotPoint | null>(null);
  const [clusterObservations, setClusterObservations] = useState<ClusterObservation[]>([]);
  const [isLoadingCluster, setIsLoadingCluster] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Load hotspot data
  useEffect(() => {
    loadHotspotData();
  }, [dateFrom, dateTo, organizationId, zoneId]);

  const loadHotspotData = async () => {
    setIsLoading(true);
    setError(null);
    setErrorId(null);
    
    try {
      // Convert date strings to ISO with time boundaries
      const startOfDay = new Date(dateFrom);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);

      // Build query
      let query = supabase
        .from('observations')
        .select('gps_latitude, gps_longitude, zone:zones(name)')
        .not('gps_latitude', 'is', null)
        .not('gps_longitude', 'is', null)
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString());

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      if (!data || data.length === 0) {
        setPoints([]);
        return;
      }

      // Group by GPS coordinates (rounded to ~100m precision for clustering)
      const grouped = (data || []).reduce((acc: Map<string, HotspotPoint>, obs: any) => {
        const latKey = Math.round(obs.gps_latitude * 1000) / 1000;
        const lngKey = Math.round(obs.gps_longitude * 1000) / 1000;
        const key = `${latKey},${lngKey}`;

        if (!acc.has(key)) {
          acc.set(key, {
            lat: latKey,
            lng: lngKey,
            count: 0,
            zone_name: obs.zone?.name,
          });
        }

        const point = acc.get(key)!;
        point.count += 1;

        return acc;
      }, new Map());

      const pointsArray = Array.from(grouped.values());
      setPoints(pointsArray);

      // Auto-center map on first load if we have data
      if (pointsArray.length > 0) {
        const avgLat = pointsArray.reduce((sum, p) => sum + p.lat, 0) / pointsArray.length;
        const avgLng = pointsArray.reduce((sum, p) => sum + p.lng, 0) / pointsArray.length;
        setMapCenter([avgLat, avgLng]);
        setMapZoom(13);
      }

    } catch (error: any) {
      const errorIdStr = `ERR-${Date.now()}`;
      console.error('Failed to load hotspot data:', error, { errorId: errorIdStr });
      setError(error.message || 'Failed to load hotspots');
      setErrorId(errorIdStr);
      toast.error(`Failed to load hotspots. (${errorIdStr})`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkerClick = async (point: HotspotPoint) => {
    setSelectedCluster(point);
    setDrawerOpen(true);
    setIsLoadingCluster(true);

    try {
      const startOfDay = new Date(dateFrom);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);

      // Load observations within ~50m radius of the cluster point
      const { data, error } = await supabase
        .from('observations')
        .select(`
          id,
          plate_number,
          recorded_at,
          is_compliant,
          photo_url,
          gps_latitude,
          gps_longitude,
          zone:zones(name),
          recorded_by_user:user_profiles(first_name, last_name)
        `)
        .gte('gps_latitude', point.lat - 0.0005)
        .lte('gps_latitude', point.lat + 0.0005)
        .gte('gps_longitude', point.lng - 0.0005)
        .lte('gps_longitude', point.lng + 0.0005)
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString())
        .order('recorded_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setClusterObservations(
        (data || []).map((obs: any) => ({
          id: obs.id,
          plate_number: obs.plate_number || 'Unknown',
          recorded_at: obs.recorded_at,
          zone_name: obs.zone?.name || 'Unknown Zone',
          recorded_by_name: obs.recorded_by_user
            ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
            : 'Unknown',
          is_compliant: obs.is_compliant,
          photo_url: obs.photo_url,
          gps_latitude: obs.gps_latitude,
          gps_longitude: obs.gps_longitude,
        }))
      );
    } catch (error: any) {
      console.error('Failed to load cluster observations:', error);
      toast.error('Failed to load observations: ' + error.message);
    } finally {
      setIsLoadingCluster(false);
    }
  };

  const handleOpenObservations = () => {
    const params: Record<string, string> = {
      dateFrom,
      dateTo,
    };
    
    if (organizationId) params.organizationId = organizationId;
    if (zoneId) params.zoneId = zoneId;
    
    if (selectedCluster) {
      params.lat = selectedCluster.lat.toString();
      params.lng = selectedCluster.lng.toString();
    }

    const searchParams = new URLSearchParams(params);
    navigate(`/admin/observations?${searchParams.toString()}`);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <AdminNavigationMenu />
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Flame className="h-6 w-6 text-orange-600" />
                  Hotspots
                </h1>
                <p className="text-sm text-muted-foreground">
                  Heat map and density analysis
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {points.length > 0 && (
                <Badge variant="secondary" className="text-sm">
                  {points.length} clusters · {points.reduce((sum, p) => sum + p.count, 0)} observations
                </Badge>
              )}
            </div>
          </div>
        </div>

        <GlobalFilterRibbon onRefresh={loadHotspotData} />

        {/* Error Banner */}
        {error && (
          <div className="border-b bg-red-50 dark:bg-red-950/20 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-900 dark:text-red-100">Failed to load hotspots</p>
                <p className="text-sm text-red-700 dark:text-red-200 mt-1">{error}</p>
                {errorId && (
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">Error ID: {errorId}</p>
                )}
              </div>
              <Button
                onClick={loadHotspotData}
                variant="outline"
                size="sm"
                className="border-red-600 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
              >
                <RefreshCw className="h-3 w-3 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Map Content */}
        <div className="flex-1 overflow-hidden relative">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading hotspot data...</p>
              </div>
            </div>
          ) : points.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <div className="text-center">
                <MapPin className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
                <p className="text-lg font-semibold text-muted-foreground">No data for selected period</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Try changing the date range, organization, or zone filter
                </p>
              </div>
            </div>
          ) : (
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              style={{ height: '100%', width: '100%' }}
              className="z-0"
            >
              <MapController center={mapCenter} zoom={mapZoom} />
              
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              <MarkerClusterGroup
                chunkedLoading
                maxClusterRadius={50}
              >
                {points.map((point, idx) => (
                  <Marker
                    key={idx}
                    position={[point.lat, point.lng]}
                    eventHandlers={{
                      click: () => handleMarkerClick(point),
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{point.zone_name || 'Unknown Zone'}</p>
                        <p className="text-muted-foreground">{point.count} observations</p>
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          onClick={() => handleMarkerClick(point)}
                        >
                          View Details
                        </Button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MarkerClusterGroup>
            </MapContainer>
          )}

          {/* Floating Action Button */}
          {points.length > 0 && (
            <div className="absolute bottom-6 right-6 z-10 space-y-2">
              <Button
                onClick={handleOpenObservations}
                size="lg"
                className="shadow-lg"
              >
                <Eye className="h-4 w-4 mr-2" />
                View All Observations
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          )}
        </div>

        {/* Cluster Drawer */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent className="w-96 overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Cluster Observations
              </SheetTitle>
              <SheetDescription>
                {selectedCluster && (
                  <>
                    {selectedCluster.zone_name || 'Unknown Zone'} •{' '}
                    {selectedCluster.count} observations
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {isLoadingCluster ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="pt-4">
                        <Skeleton className="h-4 w-24 mb-2" />
                        <Skeleton className="h-3 w-32" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : clusterObservations.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No observations found
                </p>
              ) : (
                <>
                  {clusterObservations.map((obs) => (
                    <Card
                      key={obs.id}
                      className="cursor-pointer hover:shadow-md transition-all"
                      onClick={() => navigate(`/admin/observations?id=${obs.id}`)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-mono">
                            {obs.plate_number}
                          </CardTitle>
                          <Badge
                            variant={obs.is_compliant ? 'default' : 'destructive'}
                          >
                            {obs.is_compliant ? 'Compliant' : 'Breach'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(obs.recorded_at), 'PPp')}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {obs.zone_name}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          By {obs.recorded_by_name}
                        </p>
                      </CardContent>
                    </Card>
                  ))}

                  <Button
                    onClick={handleOpenObservations}
                    className="w-full"
                    variant="outline"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    View All in Observations Page
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
