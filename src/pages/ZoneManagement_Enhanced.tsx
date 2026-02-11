// Enhanced geofence mapping with satellite view - work in progress
// This file contains the improved geofence feature
// TO BE INTEGRATED: Replace ZoneManagement.tsx once tested

import { useState, useEffect, useRef } from 'react';
import { MapPin, Circle, Pentagon, Trash, Map as MapIcon, Satellite, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export function EnhancedGeofenceDrawer() {
  const [showGeofenceMap, setShowGeofenceMap] = useState(false);
  const [geofenceType, setGeofenceType] = useState<'polygon' | 'circle'>('polygon');
  const [geofenceData, setGeofenceData] = useState<any>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mapCenter] = useState<[number, number]>([-41.2706, 173.2840]);
  const [mapType, setMapType] = useState<'satellite' | 'street'>('satellite');
  const [drawingPoints, setDrawingPoints] = useState<any[]>([]);
  
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const drawnLayerRef = useRef<any>(null);
  const streetLayerRef = useRef<any>(null);
  const satelliteLayerRef = useRef<any>(null);
  const labelsLayerRef = useRef<any>(null);
  const tempDrawLayerRef = useRef<any>(null);

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

        // Street layer
        streetLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19,
        });

        // Satellite layer (Esri)
        satelliteLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Esri, Maxar, Earthstar Geographics',
            maxZoom: 19,
          }
        );

        // Labels for satellite view
        labelsLayerRef.current = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          {
            attribution: 'Esri',
            maxZoom: 19,
          }
        );

        // Add initial layer
        if (mapType === 'satellite') {
          satelliteLayerRef.current.addTo(map);
          labelsLayerRef.current.addTo(map);
        } else {
          streetLayerRef.current.addTo(map);
        }

        mapRef.current = map;

        // Get user location
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              map.setView([position.coords.latitude, position.coords.longitude], 15);
            },
            () => toast.info('Using default location: Nelson, NZ'),
            { enableHighAccuracy: true, timeout: 5000 }
          );
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
  }, [showGeofenceMap, mapCenter, mapType]);

  const switchMapType = () => {
    if (!mapRef.current) return;

    const newType = mapType === 'street' ? 'satellite' : 'street';

    // Remove current layers
    if (streetLayerRef.current) mapRef.current.removeLayer(streetLayerRef.current);
    if (satelliteLayerRef.current) mapRef.current.removeLayer(satelliteLayerRef.current);
    if (labelsLayerRef.current) mapRef.current.removeLayer(labelsLayerRef.current);

    // Add new layer
    if (newType === 'satellite') {
      satelliteLayerRef.current.addTo(mapRef.current);
      labelsLayerRef.current.addTo(mapRef.current);
    } else {
      streetLayerRef.current.addTo(mapRef.current);
    }

    setMapType(newType);
    toast.success(`Switched to ${newType} view`);
  };

  const startDrawing = () => {
    if (!mapRef.current) return;

    const L = (window as any).L;
    const map = mapRef.current;

    setIsDrawing(true);
    setDrawingPoints([]);

    // Clear existing drawings
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

          // Show radius label
          const midPoint = L.latLng(
            (center.lat + e.latlng.lat) / 2,
            (center.lng + e.latlng.lng) / 2
          );

          if ((window as any).radiusLabel) {
            map.removeLayer((window as any).radiusLabel);
          }

          (window as any).radiusLabel = L.marker(midPoint, {
            icon: L.divIcon({
              className: 'radius-label',
              html: `<div style="background: white; padding: 4px 8px; border-radius: 4px; font-size: 13px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 2px solid #3b82f6;">${Math.round(radius)}m</div>`,
            }),
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

          L.marker(center, {
            icon: L.divIcon({
              className: 'center-marker',
              html: '<div style="width: 14px; height: 14px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.4);"></div>',
            }),
          }).addTo(map);

          map.on('mousemove', mouseMoveHandler);
          toast.info('Move mouse to adjust radius, click to confirm');
        } else {
          const radius = center.distanceTo(e.latlng);
          if (tempCircle) map.removeLayer(tempCircle);
          if (radiusLine) map.removeLayer(radiusLine);
          if ((window as any).radiusLabel) map.removeLayer((window as any).radiusLabel);

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
      toast.info('🎯 Click center point');
    } else {
      // Polygon drawing
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
            weight: 3,
          }).addTo(map);
        }
      };

      const clickHandler = (e: any) => {
        points.push(e.latlng);
        setDrawingPoints([...points]);

        L.circleMarker(e.latlng, {
          radius: 6,
          fillColor: '#3b82f6',
          color: 'white',
          weight: 2,
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
          toast.info('📍 Click to add more points');
          map.on('mousemove', mouseMoveHandler);
        } else if (points.length >= 3) {
          toast.info(`✓ ${points.length} points - double-click to finish`);
        }
      };

      const dblClickHandler = () => {
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

      map.on('click', clickHandler);
      map.on('dblclick', dblClickHandler);
      toast.info('🎯 Click to start drawing');
    }
  };

  const undoLastPoint = () => {
    if (drawingPoints.length === 0) {
      toast.error('No points to undo');
      return;
    }

    const newPoints = [...drawingPoints];
    newPoints.pop();
    setDrawingPoints(newPoints);

    if (tempDrawLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(tempDrawLayerRef.current);
      tempDrawLayerRef.current = null;
    }

    if (newPoints.length > 0) {
      const L = (window as any).L;
      tempDrawLayerRef.current = L.polyline(newPoints, {
        color: '#3b82f6',
        weight: 3,
      }).addTo(mapRef.current);
    }

    toast.success('Last point removed');
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

  const autoDetectGeofence = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const L = (window as any).L;
          const map = mapRef.current;

          if (!map) return;

          if (drawnLayerRef.current) {
            map.removeLayer(drawnLayerRef.current);
          }

          const radius = 500;
          drawnLayerRef.current = L.circle([latitude, longitude], {
            radius,
            color: '#22c55e',
            fillColor: '#22c55e',
            fillOpacity: 0.3,
            weight: 3,
          }).addTo(map);
          
          map.setView([latitude, longitude], 15);

          setGeofenceData({
            type: 'Point',
            coordinates: [longitude, latitude],
            radius,
          });

          toast.success('GPS location detected - 500m geofence created');
        },
        () => toast.error('Could not detect GPS location'),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      toast.error('Geolocation not supported');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Geofence Boundary</Label>
        <div className="flex gap-2 flex-wrap">
          {!showGeofenceMap ? (
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
          ) : (
            <>
              <Button
                type="button"
                variant={mapType === 'satellite' ? 'default' : 'outline'}
                size="sm"
                onClick={switchMapType}
                className={mapType === 'satellite' ? 'bg-blue-600 hover:bg-blue-700' : ''}
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
                onValueChange={(v: any) => {
                  setGeofenceType(v);
                  if (isDrawing) {
                    setIsDrawing(false);
                    if (mapRef.current) {
                      mapRef.current.off('click');
                      mapRef.current.off('dblclick');
                      mapRef.current.off('mousemove');
                    }
                  }
                }}
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
                onClick={autoDetectGeofence}
                disabled={isDrawing}
              >
                <MapPin className="h-4 w-4 mr-2" />
                My Location
              </Button>
              <Button
                type="button"
                variant={isDrawing ? 'default' : 'outline'}
                size="sm"
                onClick={startDrawing}
                disabled={isDrawing}
                className={isDrawing ? 'bg-green-600 hover:bg-green-700' : ''}
              >
                {geofenceType === 'circle' ? (
                  <Circle className="h-4 w-4 mr-2" />
                ) : (
                  <Pentagon className="h-4 w-4 mr-2" />
                )}
                {isDrawing ? 'Drawing...' : 'Start Drawing'}
              </Button>
              {isDrawing && geofenceType === 'polygon' && drawingPoints.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={undoLastPoint}
                >
                  <Undo2 className="h-4 w-4 mr-2" />
                  Undo
                </Button>
              )}
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
        <>
          <div
            ref={mapContainerRef}
            className="w-full h-[500px] border-2 rounded-lg shadow-lg"
            style={{ zIndex: 1 }}
          />
          {isDrawing && (
            <div className="p-4 bg-blue-500/10 border-2 border-blue-500/20 rounded-lg">
              <p className="text-sm font-semibold text-blue-700">
                {geofenceType === 'circle'
                  ? drawingPoints.length === 0
                    ? '🎯 Click on the map to set the center point'
                    : '📏 Move your mouse and click to set the radius'
                  : drawingPoints.length === 0
                  ? '🎯 Click on the map to start drawing your boundary'
                  : drawingPoints.length < 3
                  ? `📍 ${drawingPoints.length} point(s) added - need at least 3 points`
                  : `✓ ${drawingPoints.length} points added - double-click to finish or keep adding points`}
              </p>
            </div>
          )}
        </>
      )}

      {geofenceData && !isDrawing && (
        <div className="p-4 bg-green-500/10 border-2 border-green-500/20 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-700">
                ✓ Geofence boundary configured
              </p>
              <p className="text-xs text-green-600 mt-1">
                {geofenceData.type === 'Polygon'
                  ? `Polygon with ${geofenceData.coordinates[0].length - 1} points`
                  : `Circle with ${geofenceData.radius}m radius`}
              </p>
            </div>
            <Badge variant="outline" className="bg-green-500/20 text-green-700 border-green-500/30">
              Ready to save
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}
