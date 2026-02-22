/**
 * Vehicle Registry with BI Date Filtering
 * 
 * Features:
 * - Shows canonical_vehicles filtered by date range from BI
 * - Click vehicle to view full details modal
 * - Photo viewer with save/download
 * - View all observations for selected vehicle
 */

import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Car,
  Search,
  ArrowLeft,
  Loader2,
  Calendar,
  Image as ImageIcon,
  Download,
  Eye,
  X,
  Home,
  Flag,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface VehicleRecord {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  is_flagged: boolean;
  flagged_reason: string | null;
  homeless_status: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  profile_photo: string | null;
  total_observations: number;
  total_breaches: number;
  first_seen_at: string;
  last_seen_at: string;
}

interface Observation {
  observation_id: string;
  recorded_at: string;
  zone_name: string;
  officer_name: string;
  photo: string | null;
  is_compliant: boolean;
  is_breach: boolean;
  officer_notes: string | null;
}

export function VehicleRegistryFiltered() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const dateFrom = searchParams.get('dateFrom') || new Date().toISOString().split('T')[0];
  const dateTo = searchParams.get('dateTo') || new Date().toISOString().split('T')[0];
  const orgId = searchParams.get('orgId');

  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Vehicle detail modal
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRecord | null>(null);
  const [vehicleObservations, setVehicleObservations] = useState<Observation[]>([]);
  const [loadingObservations, setLoadingObservations] = useState(false);

  // Photo viewer
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [photoZoom, setPhotoZoom] = useState(1);

  useEffect(() => {
    loadVehicles();
  }, [dateFrom, dateTo, orgId]);

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredVehicles(vehicles);
    } else {
      const term = searchTerm.toLowerCase();
      setFilteredVehicles(
        vehicles.filter(v => 
          v.plate_number.toLowerCase().includes(term) ||
          v.vehicle_make?.toLowerCase().includes(term) ||
          v.vehicle_model?.toLowerCase().includes(term) ||
          v.vehicle_color?.toLowerCase().includes(term)
        )
      );
    }
  }, [searchTerm, vehicles]);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      console.log('📊 Loading vehicles for date range:', dateFrom, 'to', dateTo);

      // Get all vehicles that were seen during the date range
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select('plate_number')
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`);

      if (orgId && orgId !== 'all') {
        obsQuery = obsQuery.eq('organization_id', orgId);
      }

      const { data: observations } = await obsQuery;
      const uniquePlates = Array.from(new Set(observations?.map(o => o.plate_number) || []));

      if (uniquePlates.length === 0) {
        setVehicles([]);
        setFilteredVehicles([]);
        setIsLoading(false);
        return;
      }

      // Get canonical vehicle records for those plates
      const { data: vehicleData, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('plate_number', uniquePlates)
        .order('last_seen_at', { ascending: false });

      if (error) throw error;

      setVehicles(vehicleData || []);
      setFilteredVehicles(vehicleData || []);
      console.log(`✅ Loaded ${vehicleData?.length || 0} vehicles`);

    } catch (error: any) {
      console.error('Failed to load vehicles:', error);
      toast.error('Failed to load vehicles');
    } finally {
      setIsLoading(false);
    }
  };

  const loadVehicleObservations = async (plateNumber: string) => {
    setLoadingObservations(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          recorded_at,
          photo,
          is_compliant,
          is_breach,
          officer_notes,
          zones(name),
          user_profiles!recorded_by(first_name, last_name)
        `)
        .eq('plate_number', plateNumber)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (error) throw error;

      const observations: Observation[] = (data || []).map(o => ({
        observation_id: o.observation_id,
        recorded_at: o.recorded_at,
        zone_name: (o.zones as any)?.name || 'Unknown',
        officer_name: `${(o.user_profiles as any)?.first_name || ''} ${(o.user_profiles as any)?.last_name || ''}`.trim() || 'Unknown',
        photo: o.photo,
        is_compliant: o.is_compliant,
        is_breach: o.is_breach,
        officer_notes: o.officer_notes,
      }));

      setVehicleObservations(observations);
      console.log(`✅ Loaded ${observations.length} observations for ${plateNumber}`);

    } catch (error: any) {
      console.error('Failed to load observations:', error);
      toast.error('Failed to load observations');
    } finally {
      setLoadingObservations(false);
    }
  };

  const openPhotoViewer = (photos: string[], startIndex: number = 0) => {
    const validPhotos = photos.filter(p => p);
    if (validPhotos.length === 0) {
      toast.error('No photos available');
      return;
    }
    setViewerPhotos(validPhotos);
    setCurrentPhotoIndex(startIndex);
    setPhotoZoom(1);
    setPhotoViewerOpen(true);
  };

  const downloadCurrentPhoto = async () => {
    const photoUrl = viewerPhotos[currentPhotoIndex];
    if (!photoUrl) return;

    try {
      const response = await fetch(photoUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-photo-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Photo downloaded');
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Failed to download photo');
    }
  };

  const handleVehicleClick = async (vehicle: VehicleRecord) => {
    setSelectedVehicle(vehicle);
    await loadVehicleObservations(vehicle.plate_number);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Car className="h-8 w-8 text-purple-600" />
              Vehicle Registry
            </h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {new Date(dateFrom).toLocaleDateString('en-NZ')} - {new Date(dateTo).toLocaleDateString('en-NZ')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {filteredVehicles.length} vehicles
          </Badge>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by plate, make, model, color..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
        </div>
      ) : filteredVehicles.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Car className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
            <h3 className="text-xl font-bold mb-2">No vehicles found</h3>
            <p className="text-muted-foreground">
              {searchTerm ? 'Try adjusting your search' : 'No vehicles observed in selected date range'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredVehicles.map(vehicle => (
            <Card
              key={vehicle.plate_number}
              className={cn(
                "cursor-pointer hover:shadow-lg transition-all border-2",
                vehicle.is_flagged && "border-red-500 bg-red-50 dark:bg-red-950/20",
                vehicle.homeless_status === 'confirmed' && "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/20"
              )}
              onClick={() => handleVehicleClick(vehicle)}
            >
              <CardContent className="p-4">
                {/* Photo */}
                {vehicle.profile_photo && (
                  <div className="mb-3 aspect-video rounded-lg overflow-hidden bg-muted">
                    <img
                      src={vehicle.profile_photo}
                      alt={vehicle.plate_number}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Plate Number */}
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-mono text-xl font-black">{vehicle.plate_number}</h3>
                  {vehicle.is_flagged && <Flag className="h-5 w-5 text-red-600" />}
                  {vehicle.homeless_status === 'confirmed' && <Home className="h-5 w-5 text-cyan-600" />}
                </div>

                {/* Vehicle Details */}
                {(vehicle.vehicle_make || vehicle.vehicle_model) && (
                  <p className="text-sm text-muted-foreground mb-3">
                    {vehicle.vehicle_color && `${vehicle.vehicle_color} `}
                    {vehicle.vehicle_make} {vehicle.vehicle_model}
                    {vehicle.vehicle_year && ` (${vehicle.vehicle_year})`}
                  </p>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="p-2 bg-muted rounded">
                    <div className="text-muted-foreground">Observations</div>
                    <div className="font-bold text-lg">{vehicle.total_observations}</div>
                  </div>
                  <div className="p-2 bg-muted rounded">
                    <div className="text-muted-foreground">Breaches</div>
                    <div className="font-bold text-lg text-red-600">{vehicle.total_breaches}</div>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1">
                  {vehicle.is_flagged && (
                    <Badge variant="destructive" className="text-xs">
                      🚩 {vehicle.flagged_reason || 'Flagged'}
                    </Badge>
                  )}
                  {vehicle.homeless_status === 'confirmed' && (
                    <Badge className="bg-cyan-500 text-xs">🏕️ Homeless</Badge>
                  )}
                  {vehicle.self_contained && (
                    <Badge variant="outline" className="text-xs">✓ Self-Contained</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Vehicle Detail Modal */}
      <Dialog open={!!selectedVehicle} onOpenChange={() => setSelectedVehicle(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              <Car className="h-7 w-7 text-purple-600" />
              {selectedVehicle?.plate_number}
              {selectedVehicle?.is_flagged && <Flag className="h-6 w-6 text-red-600" />}
              {selectedVehicle?.homeless_status === 'confirmed' && <Home className="h-6 w-6 text-cyan-600" />}
            </DialogTitle>
          </DialogHeader>

          {selectedVehicle && (
            <div className="space-y-6">
              {/* Vehicle Info */}
              <Card className={cn(
                "border-2",
                selectedVehicle.is_flagged && "border-red-500 bg-red-50 dark:bg-red-950/20",
                selectedVehicle.homeless_status === 'confirmed' && "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/20"
              )}>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: Photo */}
                    {selectedVehicle.profile_photo && (
                      <div>
                        <h4 className="font-semibold mb-3">Profile Photo</h4>
                        <div 
                          className="aspect-video rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => openPhotoViewer([selectedVehicle.profile_photo!], 0)}
                        >
                          <img
                            src={selectedVehicle.profile_photo}
                            alt={selectedVehicle.plate_number}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-2"
                          onClick={() => openPhotoViewer([selectedVehicle.profile_photo!], 0)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Photo
                        </Button>
                      </div>
                    )}

                    {/* Right Column: Details */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-3">Vehicle Details</h4>
                        <div className="space-y-2 text-sm">
                          {selectedVehicle.vehicle_make && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Make:</span>
                              <span className="font-semibold">{selectedVehicle.vehicle_make}</span>
                            </div>
                          )}
                          {selectedVehicle.vehicle_model && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Model:</span>
                              <span className="font-semibold">{selectedVehicle.vehicle_model}</span>
                            </div>
                          )}
                          {selectedVehicle.vehicle_color && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Color:</span>
                              <span className="font-semibold">{selectedVehicle.vehicle_color}</span>
                            </div>
                          )}
                          {selectedVehicle.vehicle_year && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Year:</span>
                              <span className="font-semibold">{selectedVehicle.vehicle_year}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Self-Contained:</span>
                            <span className="font-semibold">
                              {selectedVehicle.self_contained ? '✓ Yes' : '✗ No'}
                            </span>
                          </div>
                          {selectedVehicle.self_contained_expiry && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">SC Expiry:</span>
                              <span className="font-semibold">
                                {new Date(selectedVehicle.self_contained_expiry).toLocaleDateString('en-NZ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-3">Statistics</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 bg-muted rounded">
                            <div className="text-xs text-muted-foreground">Observations</div>
                            <div className="font-bold text-2xl">{selectedVehicle.total_observations}</div>
                          </div>
                          <div className="p-3 bg-muted rounded">
                            <div className="text-xs text-muted-foreground">Breaches</div>
                            <div className="font-bold text-2xl text-red-600">{selectedVehicle.total_breaches}</div>
                          </div>
                        </div>
                      </div>

                      {selectedVehicle.is_flagged && (
                        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded border border-red-300 dark:border-red-700">
                          <div className="flex items-center gap-2 text-red-900 dark:text-red-100 font-semibold mb-1">
                            <Flag className="h-4 w-4" />
                            Flagged Vehicle
                          </div>
                          <p className="text-sm text-red-700 dark:text-red-300">
                            {selectedVehicle.flagged_reason || 'No reason provided'}
                          </p>
                        </div>
                      )}

                      {selectedVehicle.homeless_status === 'confirmed' && (
                        <div className="p-3 bg-cyan-50 dark:bg-cyan-950/30 rounded border border-cyan-300 dark:border-cyan-700">
                          <div className="flex items-center gap-2 text-cyan-900 dark:text-cyan-100 font-semibold mb-1">
                            <Home className="h-4 w-4" />
                            Homeless Status (FC Act Exempt)
                          </div>
                          <p className="text-sm text-cyan-700 dark:text-cyan-300">
                            No enforcement permitted under Freedom Camping Act
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Observations */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Observations ({vehicleObservations.length})</span>
                    {loadingObservations && <Loader2 className="h-5 w-5 animate-spin" />}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingObservations ? (
                    <div className="text-center py-12">
                      <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
                    </div>
                  ) : vehicleObservations.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p>No observations in selected date range</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vehicleObservations.map((obs, index) => (
                        <div
                          key={obs.observation_id}
                          className={cn(
                            "p-4 border-2 rounded-lg",
                            obs.is_breach && "border-red-500 bg-red-50 dark:bg-red-950/20",
                            !obs.is_breach && obs.is_compliant && "border-green-500 bg-green-50 dark:bg-green-950/20"
                          )}
                        >
                          <div className="flex items-start gap-4">
                            {/* Photo Thumbnail */}
                            {obs.photo && (
                              <div
                                className="w-24 h-24 rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                                onClick={() => {
                                  const allPhotos = vehicleObservations
                                    .map(o => o.photo)
                                    .filter(p => p) as string[];
                                  const photoIndex = allPhotos.indexOf(obs.photo!);
                                  openPhotoViewer(allPhotos, photoIndex);
                                }}
                              >
                                <img
                                  src={obs.photo}
                                  alt="Observation"
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                  <h4 className="font-semibold">
                                    {new Date(obs.recorded_at).toLocaleDateString('en-NZ', {
                                      weekday: 'short',
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </h4>
                                  <p className="text-sm text-muted-foreground">
                                    {obs.zone_name} • {obs.officer_name}
                                  </p>
                                </div>
                                <Badge variant={obs.is_breach ? 'destructive' : 'default'} className="shrink-0">
                                  {obs.is_breach ? '🔴 Breach' : '🟢 Compliant'}
                                </Badge>
                              </div>

                              {obs.officer_notes && (
                                <p className="text-sm text-muted-foreground bg-muted p-2 rounded">
                                  {obs.officer_notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Photo Viewer Modal */}
      <Dialog open={photoViewerOpen} onOpenChange={setPhotoViewerOpen}>
        <DialogContent className="max-w-7xl max-h-[95vh] p-0 overflow-hidden bg-black">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-black/80 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPhotoViewerOpen(false)}
                className="text-white hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </Button>
              <span className="text-white text-sm font-semibold">
                {currentPhotoIndex + 1} / {viewerPhotos.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPhotoZoom(Math.max(0.5, photoZoom - 0.25))}
                className="text-white hover:bg-white/20"
                disabled={photoZoom <= 0.5}
              >
                <ZoomOut className="h-5 w-5" />
              </Button>
              <span className="text-white text-sm font-mono w-16 text-center">
                {Math.round(photoZoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPhotoZoom(Math.min(3, photoZoom + 0.25))}
                className="text-white hover:bg-white/20"
                disabled={photoZoom >= 3}
              >
                <ZoomIn className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={downloadCurrentPhoto}
                className="text-white hover:bg-white/20"
              >
                <Download className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Main Photo */}
          <div className="relative h-[90vh] flex items-center justify-center overflow-hidden">
            <img
              src={viewerPhotos[currentPhotoIndex]}
              alt="Vehicle photo"
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{ transform: `scale(${photoZoom})` }}
            />
          </div>

          {/* Navigation */}
          {viewerPhotos.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPhotoIndex(Math.max(0, currentPhotoIndex - 1))}
                disabled={currentPhotoIndex === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12"
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPhotoIndex(Math.min(viewerPhotos.length - 1, currentPhotoIndex + 1))}
                disabled={currentPhotoIndex === viewerPhotos.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12"
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            </>
          )}

          {/* Thumbnails */}
          {viewerPhotos.length > 1 && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/80 backdrop-blur-sm">
              <div className="flex gap-2 overflow-x-auto">
                {viewerPhotos.map((photo, index) => (
                  <div
                    key={index}
                    className={cn(
                      "w-20 h-20 rounded-lg overflow-hidden cursor-pointer border-2 shrink-0 transition-all",
                      index === currentPhotoIndex ? "border-white" : "border-transparent opacity-50 hover:opacity-100"
                    )}
                    onClick={() => {
                      setCurrentPhotoIndex(index);
                      setPhotoZoom(1);
                    }}
                  >
                    <img src={photo} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
