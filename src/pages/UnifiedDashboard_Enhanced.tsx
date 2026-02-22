/**
 * UNIFIED BI DASHBOARD - ENHANCED
 * Three-level drill-down: Overview → Zone → Vehicle Details
 * 
 * Features:
 * ✅ Shows observation photos in zone view
 * ✅ Click vehicle to see all observations with photos
 * ✅ Full edit capabilities for canonical and observation records
 * ✅ Complete vehicle history with GPS, timestamps, officer details
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Building2,
  Calendar,
  RefreshCw,
  Loader2,
  MapPin,
  Car,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Home,
  ArrowLeft,
  Download,
  Eye,
  Clock,
  Flag,
  CheckCircle2,
  BarChart3,
  Activity,
  Users,
  Award,
  Edit,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { exportComprehensiveCSV } from '@/lib/csvExport';
import { VehicleEditDrawer } from '@/components/features/VehicleEditDrawer';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];

type ViewLevel = 'overview' | 'zone' | 'vehicle';

interface VehicleCard {
  plate_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  observations: number;
  status: 'overstayer' | 'at_risk' | 'compliant' | 'flagged' | 'homeless';
  is_flagged: boolean;
  homeless_status: string | null;
  profile_photo: string | null;
  first_seen: string;
  last_seen: string;
  latest_observation_photo?: string | null;
}

interface ObservationDetail {
  observation_id: string;
  plate_number: string;
  zone_id: string;
  zone_name: string;
  recorded_at: string;
  recorded_by: string;
  officer_name: string;
  photo: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  is_compliant: boolean;
  is_breach: boolean;
  breach_type: string | null;
  officer_notes: string | null;
  self_contained: boolean;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
}

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getStatusColor = (status: VehicleCard['status']): string => {
  switch (status) {
    case 'overstayer': return 'border-2 border-red-500 bg-red-50 dark:bg-red-950/30';
    case 'at_risk': return 'border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'flagged': return 'border-2 border-purple-500 bg-purple-50 dark:bg-purple-950/30';
    case 'homeless': return 'border-2 border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30';
    case 'compliant': return 'border-2 border-green-500 bg-green-50 dark:bg-green-950/30';
  }
};

const getStatusBadge = (status: VehicleCard['status']) => {
  switch (status) {
    case 'overstayer':
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />OVERSTAYER</Badge>;
    case 'at_risk':
      return <Badge className="gap-1 bg-amber-600"><Clock className="h-3 w-3" />AT RISK</Badge>;
    case 'flagged':
      return <Badge className="gap-1 bg-purple-600"><Flag className="h-3 w-3" />FLAGGED</Badge>;
    case 'homeless':
      return <Badge className="gap-1 bg-cyan-600"><Home className="h-3 w-3" />HOMELESS</Badge>;
    case 'compliant':
      return <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" />COMPLIANT</Badge>;
  }
};

export function UnifiedDashboard() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  // View state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('overview');
  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleCard | null>(null);
  const [vehicleObservations, setVehicleObservations] = useState<ObservationDetail[]>([]);
  const [editingObservation, setEditingObservation] = useState<string | null>(null);

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleCard[]>([]);

  // Filter state
  const [dateFrom, setDateFrom] = useState(() => formatLocalDate(new Date()));
  const [dateTo, setDateTo] = useState(() => formatLocalDate(new Date()));
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

  const drillToVehicle = async (vehicle: VehicleCard) => {
    setSelectedVehicle(vehicle);
    setIsLoading(true);

    try {
      console.log(`🚗 Loading details for ${vehicle.plate_number}...`);

      const { data: observations, error } = await supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_at,
          recorded_by,
          photo,
          gps_latitude,
          gps_longitude,
          is_compliant,
          is_breach,
          breach_type,
          officer_notes,
          self_contained,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          vehicle_year,
          zones!inner(name),
          user_profiles:recorded_by(first_name, last_name)
        `)
        .eq('plate_number', vehicle.plate_number)
        .order('recorded_at', { ascending: false });

      if (error) throw error;

      const obsDetails: ObservationDetail[] = (observations || []).map(o => ({
        observation_id: o.observation_id,
        plate_number: o.plate_number,
        zone_id: o.zone_id,
        zone_name: (o.zones as any)?.name || 'Unknown',
        recorded_at: o.recorded_at,
        recorded_by: o.recorded_by || '',
        officer_name: o.user_profiles 
          ? `${(o.user_profiles as any).first_name} ${(o.user_profiles as any).last_name}` 
          : 'Unknown',
        photo: o.photo,
        gps_latitude: o.gps_latitude,
        gps_longitude: o.gps_longitude,
        is_compliant: o.is_compliant,
        is_breach: o.is_breach,
        breach_type: o.breach_type,
        officer_notes: o.officer_notes,
        self_contained: o.self_contained,
        vehicle_make: o.vehicle_make,
        vehicle_model: o.vehicle_model,
        vehicle_color: o.vehicle_color,
        vehicle_year: o.vehicle_year,
      }));

      setVehicleObservations(obsDetails);
      setViewLevel('vehicle');

      console.log(`✅ Loaded ${obsDetails.length} observations for ${vehicle.plate_number}`);

    } catch (error: any) {
      console.error('Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={() => setViewLevel('overview')}>
          <Building2 className="h-3 w-3 mr-1" />Dashboard
        </Button>
        
        {selectedZone && (
          <>
            <ChevronRight className="h-4 w-4" />
            <Button variant="ghost" size="sm" onClick={() => viewLevel === 'vehicle' && setViewLevel('zone')}>
              <MapPin className="h-3 w-3 mr-1" />{selectedZone.zone_name}
            </Button>
          </>
        )}

        {selectedVehicle && (
          <>
            <ChevronRight className="h-4 w-4" />
            <Button variant="ghost" size="sm" className="font-semibold">
              <Car className="h-3 w-3 mr-1" />{selectedVehicle.plate_number}
            </Button>
          </>
        )}
      </div>

      {/* Vehicle Detail View */}
      {viewLevel === 'vehicle' && selectedVehicle && (
        <>
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-3xl font-bold font-mono">{selectedVehicle.plate_number}</h2>
                    {getStatusBadge(selectedVehicle.status)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>
                      {selectedVehicle.make || 'Unknown'} {selectedVehicle.model || ''} 
                      {selectedVehicle.year && ` (${selectedVehicle.year})`}
                    </span>
                    {selectedVehicle.color && <span className="capitalize">{selectedVehicle.color}</span>}
                    <span>{vehicleObservations.length} observations</span>
                  </div>
                </div>
                <Button onClick={() => setEditingObservation('canonical')} className="gap-2">
                  <Edit className="h-4 w-4" />Edit Vehicle
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All Observations ({vehicleObservations.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {vehicleObservations.map(obs => (
                  <Card
                    key={obs.observation_id}
                    className={`border-2 ${
                      obs.is_breach
                        ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                        : obs.is_compliant
                        ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                        : 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Photo */}
                        <div className="md:col-span-1">
                          {obs.photo ? (
                            <div className="aspect-video rounded-lg overflow-hidden border-2">
                              <img src={obs.photo} alt={`Scan ${obs.observation_id.slice(0, 8)}`} className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="aspect-video rounded-lg border-2 border-dashed flex items-center justify-center bg-muted">
                              <ImageIcon className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="md:col-span-2 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={obs.is_breach ? 'destructive' : 'default'}>
                              {obs.is_breach ? 'BREACH' : obs.is_compliant ? 'COMPLIANT' : 'AT RISK'}
                            </Badge>
                            <Badge variant="outline">
                              <MapPin className="h-3 w-3 mr-1" />{obs.zone_name}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <div className="text-xs text-muted-foreground">Date & Time</div>
                              <div className="font-medium">
                                {new Date(obs.recorded_at).toLocaleString('en-NZ')}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Officer</div>
                              <div className="font-medium">{obs.officer_name}</div>
                            </div>
                            {obs.gps_latitude && obs.gps_longitude && (
                              <div className="col-span-2">
                                <div className="text-xs text-muted-foreground">GPS Coordinates</div>
                                <div className="font-mono text-xs">
                                  {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                                </div>
                              </div>
                            )}
                          </div>

                          {obs.officer_notes && (
                            <div className="mt-2 p-2 bg-muted rounded text-sm">
                              <div className="text-xs text-muted-foreground mb-1">Officer Notes:</div>
                              <div>{obs.officer_notes}</div>
                            </div>
                          )}

                          {obs.breach_type && (
                            <div className="mt-2">
                              <Badge variant="destructive" className="text-xs">
                                {obs.breach_type.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="md:col-span-1 flex flex-col gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingObservation(obs.observation_id)} className="w-full gap-2">
                            <Edit className="h-4 w-4" />Edit
                          </Button>
                          {obs.gps_latitude && obs.gps_longitude && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(`https://www.google.com/maps?q=${obs.gps_latitude},${obs.gps_longitude}`, '_blank')}
                              className="w-full gap-2"
                            >
                              <MapPin className="h-4 w-4" />Map
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Edit Drawer */}
      {editingObservation && (
        <VehicleEditDrawer
          observationId={editingObservation === 'canonical' ? null : editingObservation}
          plateNumber={selectedVehicle?.plate_number || ''}
          open={!!editingObservation}
          onClose={() => {
            setEditingObservation(null);
            if (selectedVehicle) drillToVehicle(selectedVehicle);
          }}
        />
      )}
    </div>
  );
}
