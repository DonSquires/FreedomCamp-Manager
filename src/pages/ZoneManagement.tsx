/**
 * Zone Management - Create, edit, and configure zones with geofencing
 * Includes interactive map for drawing polygon and circle geofences
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MapPin,
  Circle,
  Pentagon,
  Trash,
  Map as MapIcon,
  Satellite,
  Undo2,
  Edit,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface Zone {
  id: string;
  name: string;
  description: string | null;
  organization_id: string;
  self_contained_required: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  day_visit_only: boolean;
  allowed_days: string[];
  is_active: boolean;
  geometry: any;
  location_lat: number | null;
  location_lng: number | null;
  organizations?: { name: string };
}

export function ZoneManagement() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [zones, setZones] = useState<Zone[]>([]);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    organization_id: '',
    self_contained_required: true,
    nights_per_month: 28,
    max_consecutive_nights: 3,
    day_visit_only: false,
    allowed_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  });

  // Geofence state
  const [showGeofenceMap, setShowGeofenceMap] = useState(false);
  const [geofenceType, setGeofenceType] = useState<'polygon' | 'circle'>('polygon');
  const [geofenceData, setGeofenceData] = useState<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mapCenter] = useState<[number, number]>([-41.2706, 173.2840]);
  const [mapType, setMapType] = useState<'satellite' | 'street'>('satellite');
  const [drawingPoints, setDrawingPoints] = useState<any[]>([]);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const drawnLayerRef = useRef<any>(null);
  const streetLayerRef = useRef<any>(null);
  const satelliteLayerRef = useRef<any>(null);
  const labelsLayerRef = useRef<any>(null);
  const tempDrawLayerRef = useRef<any>(null);

  useEffect(() => {
    loadZones();
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  const loadZones = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('zones')
        .select('*, organizations(name)')
        .order('name');

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setZones(data || []);
    } catch (error: any) {
      console.error('Failed to load zones:', error);
      toast.error('Failed to load zones');
    } finally {
      setIsLoading(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    }
  };

  const handleCreateNew = async () => {
    // If master user, verify organization first
    if (isMaster && organizations.length === 0) {
      toast.error('No organizations available');
      return;
    }

    if (isMaster && organizations.length > 1) {
      // Multiple orgs - user must select in dialog
      setEditingZone(null);
      setFormData({
        name: '',
        description: '',
        organization_id: '',
        self_contained_required: true,
        nights_per_month: 28,
        max_consecutive_nights: 3,
        day_visit_only: false,
        allowed_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      });
      setGeofenceData(null);
      setShowGeofenceMap(false);
      setShowDialog(true);
    } else if (isMaster && organizations.length === 1) {
      // Only one org - auto-select
      setEditingZone(null);
      setFormData({
        name: '',
        description: '',
        organization_id: organizations[0].id,
        self_contained_required: true,
        nights_per_month: 28,
        max_consecutive_nights: 3,
        day_visit_only: false,
        allowed_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      });
      setGeofenceData(null);
      setShowGeofenceMap(false);
      setShowDialog(true);
    } else {
      // Regular user - use their org
      if (!user?.organization_id) {
        toast.error('No organization assigned to your account');
        return;
      }

      setEditingZone(null);
      setFormData({
        name: '',
        description: '',
        organization_id: user.organization_id,
        self_contained_required: true,
        nights_per_month: 28,
        max_consecutive_nights: 3,
        day_visit_only: false,
        allowed_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      });
      setGeofenceData(null);
      setShowGeofenceMap(false);
      setShowDialog(true);
    }
  };

  const handleEdit = (zone: Zone) => {
    setEditingZone(zone);
    setFormData({
      name: zone.name,
      description: zone.description || '',
      organization_id: zone.organization_id,
      self_contained_required: zone.self_contained_required,
      nights_per_month: zone.nights_per_month,
      max_consecutive_nights: zone.max_consecutive_nights,
      day_visit_only: zone.day_visit_only,
      allowed_days: zone.allowed_days || [],
    });
    setGeofenceData(zone.geometry);
    setShowGeofenceMap(false);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Zone name is required');
      return;
    }

    if (!formData.organization_id) {
      toast.error('Organization is required');
      return;
    }

    setIsSaving(true);

    try {
      const zoneData: any = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        organization_id: formData.organization_id,
        self_contained_required: formData.self_contained_required,
        nights_per_month: formData.nights_per_month,
        max_consecutive_nights: formData.max_consecutive_nights,
        day_visit_only: formData.day_visit_only,
        allowed_days: formData.allowed_days,
        geometry: geofenceData || null,
        is_active: true,
      };

      // Set location from geofence center if available
      if (geofenceData) {
        if (geofenceData.type === 'Point') {
          zoneData.location_lat = geofenceData.coordinates[1];
          zoneData.location_lng = geofenceData.coordinates[0];
        } else if (geofenceData.type === 'Polygon') {
          // Calculate polygon centroid
          const coords = geofenceData.coordinates[0];
          const latSum = coords.reduce((sum: number, c: number[]) => sum + c[1], 0);
          const lngSum = coords.reduce((sum: number, c: number[]) => sum + c[0], 0);
          zoneData.location_lat = latSum / coords.length;
          zoneData.location_lng = lngSum / coords.length;
        }
      }

      if (editingZone) {
        const { error } = await supabase
          .from('zones')
          .update(zoneData)
          .eq('id', editingZone.id);

        if (error) throw error;
        toast.success('Zone updated successfully');
      } else {
        const { error } = await supabase
          .from('zones')
          .insert(zoneData);

        if (error) throw error;
        toast.success('Zone created successfully');
      }

      setShowDialog(false);
      loadZones();
    } catch (error: any) {
      console.error('Failed to save zone:', error);
      toast.error('Failed to save zone: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async (zone: Zone) => {
    if (!confirm(`Are you sure you want to deactivate "${zone.name}"?`)) return;

    try {
      const { error } = await supabase
        .from('zones')
        .update({ is_active: false })
        .eq('id', zone.id);

      if (error) throw error;
      toast.success('Zone deactivated');
      loadZones();
    } catch (error: any) {
      console.error('Failed to deactivate zone:', error);
      toast.error('Failed to deactivate zone');
    }
  };

  // Load Leaflet map
  useEffect(() => {
    if (!showGeofenceMap || !mapContainerRef.current) return;

    const loadLeaflet = async () => {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (!(window as any).L) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      const L = (window as any).L;

      if (!mapRef.current && mapContainerRef.current) {
        const map = L.map(mapContainerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView(mapCenter, 15);

        streetLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19,
        });

        satelliteLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Esri, Maxar', maxZoom: 19 }
        );

        labelsLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          { attribution: 'Esri', maxZoom: 19 }
        );

        if (mapType === 'satellite') {
          satelliteLayerRef.current.addTo(map);
          labelsLayerRef.current.addTo(map);
        } else {
          streetLayerRef.current.addTo(map);
        }

        mapRef.current = map;

        // Load existing geofence if editing
        if (geofenceData) {
          if (geofenceData.type === 'Point') {
            const center = L.latLng(geofenceData.coordinates[1], geofenceData.coordinates[0]);
            drawnLayerRef.current = L.circle(center, {
              radius: geofenceData.radius,
              color: '#22c55e',
              fillColor: '#22c55e',
              fillOpacity: 0.3,
              weight: 3,
            }).addTo(map);
            map.setView(center, 15);
          } else if (geofenceData.type === 'Polygon') {
            const coords = geofenceData.coordinates[0].map((c: number[]) => [c[1], c[0]]);
            drawnLayerRef.current = L.polygon(coords, {
              color: '#22c55e',
              fillColor: '#22c55e',
              fillOpacity: 0.3,
              weight: 3,
            }).addTo(map);
            map.fitBounds(drawnLayerRef.current.getBounds());
          }
        } else {
          // Get user location
          if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                map.setView([position.coords.latitude, position.coords.longitude], 15);
              },
              () => {},
              { enableHighAccuracy: true, timeout: 5000 }
            );
          }
        }
      }
    };

    loadLeaflet().catch(() => toast.error('Failed to load map'));

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [showGeofenceMap, geofenceData, mapCenter, mapType]);

  const switchMapType = () => {
    if (!mapRef.current) return;

    const newType = mapType === 'street' ? 'satellite' : 'street';

    if (streetLayerRef.current) mapRef.current.removeLayer(streetLayerRef.current);
    if (satelliteLayerRef.current) mapRef.current.removeLayer(satelliteLayerRef.current);
    if (labelsLayerRef.current) mapRef.current.removeLayer(labelsLayerRef.current);

    if (newType === 'satellite') {
      satelliteLayerRef.current.addTo(mapRef.current);
      labelsLayerRef.current.addTo(mapRef.current);
    } else {
      streetLayerRef.current.addTo(mapRef.current);
    }

    setMapType(newType);
  };

  const startDrawing = () => {
    if (!mapRef.current) return;

    const L = (window as any).L;
    const map = mapRef.current;

    setIsDrawing(true);
    setDrawingPoints([]);

    if (drawnLayerRef.current) {
      map.removeLayer(drawnLayerRef.current);
      drawnLayerRef.current = null;
    }
    if (tempDrawLayerRef.current) {
      map.removeLayer(tempDrawLayerRef.current);
      tempDrawLayerRef.current = null;
    }

    if (geofenceType === 'circle') {
      let center: any = null;
      let tempCircle: any = null;
      let radiusLine: any = null;

      const mouseMoveHandler = (e: any) => {
        if (center && tempCircle) {
          const radius = center.distanceTo(e.latlng);
          map.removeLayer(tempCircle);
          if (radiusLine) map.removeLayer(radiusLine);

          tempCircle = L.circle(center, {
            radius,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.2,
            weight: 3,
          }).addTo(map);

          radiusLine = L.polyline([center, e.latlng], {
            color: '#3b82f6',
            dashArray: '5, 5',
            weight: 2,
          }).addTo(map);
        }
      };

      const clickHandler = (e: any) => {
        if (!center) {
          center = e.latlng;
          tempCircle = L.circle(center, {
            radius: 100,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.2,
          }).addTo(map);

          map.on('mousemove', mouseMoveHandler);
          toast.info('Move mouse to adjust radius, click to confirm');
        } else {
          const radius = center.distanceTo(e.latlng);
          if (tempCircle) map.removeLayer(tempCircle);
          if (radiusLine) map.removeLayer(radiusLine);

          drawnLayerRef.current = L.circle(center, {
            radius,
            color: '#22c55e',
            fillColor: '#22c55e',
            fillOpacity: 0.3,
            weight: 3,
          }).addTo(map);

          const geometry = {
            type: 'Point',
            coordinates: [center.lng, center.lat],
            radius: Math.round(radius),
          };

          setGeofenceData(geometry);
          map.off('click', clickHandler);
          map.off('mousemove', mouseMoveHandler);
          setIsDrawing(false);
          toast.success(`Circle geofence created (${Math.round(radius)}m radius)`);
        }
      };

      map.on('click', clickHandler);
      toast.info('🎯 Click center point for circle geofence', { duration: 3000 });
    } else {
      const points: any[] = [];

      const mouseMoveHandler = (e: any) => {
        if (points.length > 0) {
          if (tempDrawLayerRef.current) {
            map.removeLayer(tempDrawLayerRef.current);
          }

          const previewPoints = [...points, e.latlng];
          tempDrawLayerRef.current = L.polyline(previewPoints, {
            color: '#3b82f6',
            dashArray: '5, 5',
            weight: 4,
          }).addTo(map);
        }
      };

      const clickHandler = (e: any) => {
        points.push(e.latlng);
        setDrawingPoints([...points]);

        // Add marker with white background for visibility
        L.circleMarker(e.latlng, {
          radius: 8,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 3,
          fillOpacity: 1,
        }).addTo(map);

        if (tempDrawLayerRef.current) {
          map.removeLayer(tempDrawLayerRef.current);
        }

        if (points.length > 1) {
          tempDrawLayerRef.current = L.polyline(points, {
            color: '#3b82f6',
            weight: 3,
          }).addTo(map);
        }

        if (points.length === 1) {
          toast.info('📍 Click to add more points', { duration: 3000 });
          map.on('mousemove', mouseMoveHandler);
        } else if (points.length >= 3) {
          toast.info(`✓ ${points.length} points - double-click to finish`, { duration: 3000 });
        }
      };

      const finishPolygon = () => {
        if (points.length < 3) {
          toast.error('Need at least 3 points for polygon');
          return;
        }

        if (tempDrawLayerRef.current) {
          map.removeLayer(tempDrawLayerRef.current);
        }

        drawnLayerRef.current = L.polygon(points, {
          color: '#22c55e',
          fillColor: '#22c55e',
          fillOpacity: 0.3,
          weight: 3,
        }).addTo(map);

        const coordinates = points.map(p => [p.lng, p.lat]);
        coordinates.push(coordinates[0]);

        setGeofenceData({
          type: 'Polygon',
          coordinates: [coordinates],
        });

        map.off('click', clickHandler);
        map.off('dblclick', dblClickHandler);
        map.off('mousemove', mouseMoveHandler);
        setIsDrawing(false);
        setDrawingPoints([]);
        toast.success('Polygon geofence created');
      };

      const dblClickHandler = (e: any) => {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
        finishPolygon();
      };

      map.on('click', clickHandler);
      map.on('dblclick', dblClickHandler);
      toast.info('🎯 Click points to draw polygon, double-click to finish', { duration: 3000 });
    }
  };

  const autoDetectBoundary = async () => {
    if (!formData.name.trim() || !formData.organization_id) {
      toast.error('Enter zone name and select organization first');
      return;
    }

    setIsAutoDetecting(true);
    try {
      // Call suggest-new-zone edge function for intelligent boundary detection
      const { data, error } = await supabase.functions.invoke('suggest-new-zone', {
        body: {
          observation_id: null, // No observation - manual zone creation
          gps_latitude: mapCenter[0],
          gps_longitude: mapCenter[1],
          organization_id: formData.organization_id,
          user_id: user?.id,
        },
      });

      if (error) throw error;

      if (data.success && data.suggestion) {
        const suggestion = data.suggestion;
        
        // Pre-fill zone name and description from AI suggestion
        setFormData(prev => ({
          ...prev,
          name: suggestion.suggested_name || prev.name,
          description: suggestion.suggested_description || prev.description,
        }));

        // Load suggested polygon geometry
        if (suggestion.suggested_geometry) {
          setGeofenceData(suggestion.suggested_geometry);
          setShowGeofenceMap(true);
          
          // Wait for map to load and display polygon
          setTimeout(() => {
            if (mapRef.current && suggestion.suggested_geometry) {
              const L = (window as any).L;
              const coords = suggestion.suggested_geometry.coordinates[0].map((c: number[]) => [c[1], c[0]]);
              
              if (drawnLayerRef.current) {
                mapRef.current.removeLayer(drawnLayerRef.current);
              }
              
              drawnLayerRef.current = L.polygon(coords, {
                color: '#22c55e',
                fillColor: '#22c55e',
                fillOpacity: 0.3,
                weight: 3,
              }).addTo(mapRef.current);
              
              mapRef.current.fitBounds(drawnLayerRef.current.getBounds());
            }
          }, 500);
          
          toast.success(`✨ Auto-detected: ${suggestion.suggested_name} (${suggestion.location_type})`);
        } else {
          toast.warning('Could not detect boundary - please draw manually');
        }
      } else {
        toast.warning('No boundary detected - please draw manually');
      }
    } catch (error: any) {
      console.error('Auto-detect failed:', error);
      toast.error('Failed to auto-detect boundary');
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const clearGeofence = () => {
    if (drawnLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(drawnLayerRef.current);
      drawnLayerRef.current = null;
    }
    if (tempDrawLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(tempDrawLayerRef.current);
      tempDrawLayerRef.current = null;
    }
    setGeofenceData(null);
    setDrawingPoints([]);
    toast.success('Geofence cleared');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
              <MapPin className="h-8 w-8 text-blue-600" />
              Zone Management
            </h1>
            <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
              Configure zones with geofencing and compliance rules
            </p>
          </div>
        </div>
        <Button onClick={handleCreateNew} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          Create Zone
        </Button>
      </div>

      {/* Zones List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : zones.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <MapPin className="h-16 w-16 mx-auto mb-4 text-gray-400 opacity-20" />
            <p className="text-gray-700 dark:text-gray-200 font-semibold text-lg">No zones found. Create your first zone to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {zones.map(zone => (
            <Card key={zone.id} className="border-2 hover:border-blue-500 transition-colors">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                        {zone.name}
                      </h3>
                      {zone.is_active ? (
                        <Badge className="bg-green-500">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                      {zone.geometry && (
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950">
                          <MapPin className="h-3 w-3 mr-1" />
                          Geofenced
                        </Badge>
                      )}
                    </div>
                    {zone.description && (
                      <p className="text-sm text-gray-700 dark:text-gray-200 mb-3 font-semibold">
                        {zone.description}
                      </p>
                    )}
                    {isMaster && (
                      <p className="text-xs text-gray-700 dark:text-gray-200 mb-3 font-bold">
                        Organisation: {(zone.organizations as any)?.name}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">
                        <Settings className="h-3 w-3 mr-1" />
                        {zone.self_contained_required ? 'Self-Contained Required' : 'No Self-Contained Requirement'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {zone.nights_per_month} nights/month
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Max {zone.max_consecutive_nights} consecutive nights
                      </Badge>
                      {zone.day_visit_only && (
                        <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950">
                          Day Visit Only
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(zone)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    {zone.is_active && zone.name !== 'Other Location' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeactivate(zone)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingZone ? 'Edit Zone' : 'Create New Zone'}
            </DialogTitle>
            <DialogDescription>
              Configure zone details, geofencing, and compliance rules
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">
                  Zone Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Saxton Car Park"
                  className="mt-1"
                />
              </div>

              {isMaster && (
                <div>
                  <Label htmlFor="organization">
                    Organisation <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={formData.organization_id}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, organization_id: v }))}
                  >
                    <SelectTrigger id="organization" className="mt-1">
                      <SelectValue placeholder="Select organisation" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description of this zone"
                className="mt-1"
                rows={2}
              />
            </div>

            {/* Geofencing */}
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-2 border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Geofence Boundary</Label>
                <div className="flex gap-2 flex-wrap">
                  {!showGeofenceMap ? (
                    <>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => setShowGeofenceMap(true)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <MapIcon className="h-4 w-4 mr-2" />
                        Open Map
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={autoDetectBoundary}
                        disabled={!formData.name || !formData.organization_id}
                      >
                        <MapPin className="h-4 w-4 mr-2" />
                        Auto-Detect Boundary
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant={mapType === 'satellite' ? 'default' : 'outline'}
                        size="sm"
                        onClick={switchMapType}
                      >
                        {mapType === 'satellite' ? (
                          <>
                            <Satellite className="h-4 w-4 mr-2" />
                            Satellite
                          </>
                        ) : (
                          <>
                            <MapIcon className="h-4 w-4 mr-2" />
                            Street
                          </>
                        )}
                      </Button>
                      <Select
                        value={geofenceType}
                        onValueChange={(v: any) => setGeofenceType(v)}
                        disabled={isDrawing}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="polygon">
                            <div className="flex items-center gap-2">
                              <Pentagon className="h-4 w-4" />
                              Polygon
                            </div>
                          </SelectItem>
                          <SelectItem value="circle">
                            <div className="flex items-center gap-2">
                              <Circle className="h-4 w-4" />
                              Circle
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={startDrawing}
                        disabled={isDrawing}
                      >
                        {isDrawing ? 'Drawing...' : 'Start Drawing'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearGeofence}
                        disabled={isDrawing}
                      >
                        <Trash className="h-4 w-4 mr-2" />
                        Clear
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {showGeofenceMap && (
                <div
                  ref={mapContainerRef}
                  className="w-full h-[400px] border-2 rounded-lg shadow-lg bg-white dark:bg-gray-900"
                />
              )}

              {geofenceData && !isDrawing && (
                <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border-2 border-green-300 dark:border-green-700">
                  <p className="text-base font-bold text-green-800 dark:text-green-200">
                    ✓ Geofence configured:{' '}
                    {geofenceData.type === 'Polygon'
                      ? `Polygon with ${geofenceData.coordinates[0].length - 1} points`
                      : `Circle with ${geofenceData.radius}m radius`}
                  </p>
                </div>
              )}
            </div>

            {/* Compliance Rules */}
            <div className="space-y-4">
              <h3 className="font-semibold text-base">Compliance Rules</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="nights">Nights per Month</Label>
                  <Input
                    id="nights"
                    type="number"
                    min="1"
                    max="31"
                    value={formData.nights_per_month}
                    onChange={(e) => setFormData(prev => ({ ...prev, nights_per_month: parseInt(e.target.value) }))}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="consecutive">Max Consecutive Nights</Label>
                  <Input
                    id="consecutive"
                    type="number"
                    min="1"
                    max="14"
                    value={formData.max_consecutive_nights}
                    onChange={(e) => setFormData(prev => ({ ...prev, max_consecutive_nights: parseInt(e.target.value) }))}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="self-contained">Self-Contained</Label>
                  <Select
                    value={formData.self_contained_required.toString()}
                    onValueChange={(v) => setFormData(prev => ({ ...prev, self_contained_required: v === 'true' }))}
                  >
                    <SelectTrigger id="self-contained" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Required</SelectItem>
                      <SelectItem value="false">Not Required</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="day-visit">Day Visit Only</Label>
                <Select
                  value={formData.day_visit_only.toString()}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, day_visit_only: v === 'true' }))}
                >
                  <SelectTrigger id="day-visit" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Overnight Allowed</SelectItem>
                    <SelectItem value="true">Day Visit Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDialog(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !formData.name || !formData.organization_id}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Save Zone
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
