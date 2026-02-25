/**
 * Organization Dashboard - BI-Style Analytics with Drill-Down
 * 
 * Architecture:
 * - Three-level drill: Overview → Zone → Vehicle Details Modal
 * - All data filtered by date range (local timezone, not UTC)
 * - Statistics must match across all levels (no aggregation mismatches)
 * - Color-coded status: Red=Overstayers, Amber=At-Risk, Green=Compliant, Purple=Flagged, Cyan=Homeless
 * - Overstayers counted as non-compliant in compliance rate
 * - Monthly stays filtered by both plates AND zones with observations in date range
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2,
  Calendar,
  RefreshCw,
  Loader2,
  MapPin,
  Car,
  AlertTriangle,
  TrendingUp,
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
  Info,
  Edit,
  Save,
  X,
  Camera,
  Upload,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { exportComprehensiveCSV } from '@/lib/csvExport';

// ==================== TYPE DEFINITIONS ====================

type ViewLevel = 'overview' | 'zone';

interface DashboardStats {
  total_observations: number;
  total_vehicles: number;
  total_zones: number;
  overstayers: number;
  at_risk: number;
  compliant: number;
  flagged: number;
  homeless: number;
  compliance_rate: number;
}

interface ZoneStats {
  zone_id: string;
  zone_name: string;
  observations: number;
  vehicles: number;
  overstayers: number;
  at_risk: number;
  compliant: number;
  flagged: number;
  homeless: number;
  compliance_rate: number;
}

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
}

interface ObservationRecord {
  observation_id: string;
  plate_number: string;
  zone_name: string;
  recorded_at: string;
  recorded_by: string;
  is_compliant: boolean;
  is_breach: boolean;
  breach_type: string | null;
  photo: string | null;
  officer_notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
}

interface BreachReason {
  severity: 'breach' | 'warning';
  message: string;
  details: string;
}

// ==================== HELPER FUNCTIONS ====================

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
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          OVERSTAYER
        </Badge>
      );
    case 'at_risk':
      return (
        <Badge className="gap-1 bg-amber-600">
          <Clock className="h-3 w-3" />
          AT RISK
        </Badge>
      );
    case 'flagged':
      return (
        <Badge className="gap-1 bg-purple-600">
          <Flag className="h-3 w-3" />
          FLAGGED
        </Badge>
      );
    case 'homeless':
      return (
        <Badge className="gap-1 bg-cyan-600">
          <Home className="h-3 w-3" />
          HOMELESS
        </Badge>
      );
    case 'compliant':
      return (
        <Badge className="gap-1 bg-green-600">
          <CheckCircle2 className="h-3 w-3" />
          COMPLIANT
        </Badge>
      );
  }
};

// ==================== MAIN COMPONENT ====================

export function OrganizationDashboard() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  // View state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('overview');
  const [selectedZone, setSelectedZone] = useState<ZoneStats | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [zones, setZones] = useState<ZoneStats[]>([]);
  const [vehicles, setVehicles] = useState<VehicleCard[]>([]);

  // Filter state (LOCAL timezone)
  const [dateFrom, setDateFrom] = useState(() => formatLocalDate(new Date()));
  const [dateTo, setDateTo] = useState(() => formatLocalDate(new Date()));
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

  // Vehicle detail modal state
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [modalVehicle, setModalVehicle] = useState<any>(null);
  const [modalObservations, setModalObservations] = useState<ObservationRecord[]>([]);
  const [breachReasons, setBreachReasons] = useState<BreachReason[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // ==================== DATE HANDLERS ====================

  const setDateRange = (range: 'today' | 'yesterday' | 'last7' | 'last30' | 'last90') => {
    const today = new Date();
    const todayStr = formatLocalDate(today);

    switch (range) {
      case 'today':
        setDateFrom(todayStr);
        setDateTo(todayStr);
        break;
      case 'yesterday': {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = formatLocalDate(yesterday);
        setDateFrom(yesterdayStr);
        setDateTo(yesterdayStr);
        break;
      }
      case 'last7': {
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 7);
        setDateFrom(formatLocalDate(last7));
        setDateTo(todayStr);
        break;
      }
      case 'last30': {
        const last30 = new Date(today);
        last30.setDate(last30.getDate() - 30);
        setDateFrom(formatLocalDate(last30));
        setDateTo(todayStr);
        break;
      }
      case 'last90': {
        const last90 = new Date(today);
        last90.setDate(last90.getDate() - 90);
        setDateFrom(formatLocalDate(last90));
        setDateTo(todayStr);
        break;
      }
    }
  };

  const navigateDays = (direction: 'prev' | 'next') => {
    const from = new Date(dateFrom + 'T00:00:00');
    const to = new Date(dateTo + 'T00:00:00');
    
    if (direction === 'prev') {
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
    } else {
      from.setDate(from.getDate() + 1);
      to.setDate(to.getDate() + 1);
      
      const todayStr = formatLocalDate(new Date());
      const toStr = formatLocalDate(to);
      
      if (toStr > todayStr) {
        toast.error('Cannot navigate beyond today');
        return;
      }
    }
    
    setDateFrom(formatLocalDate(from));
    setDateTo(formatLocalDate(to));
  };

  const handleDateFromChange = (newDate: string) => {
    setDateFrom(newDate);
    if (newDate > dateTo) {
      setDateTo(newDate);
    }
  };

  const handleDateToChange = (newDate: string) => {
    if (newDate >= dateFrom) {
      setDateTo(newDate);
    } else {
      toast.error('End date cannot be before start date');
    }
  };

  // ==================== DATA LOADING ====================

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
    }
  };

  const loadDashboard = async () => {
    setIsLoading(true);
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user?.id)
        .single();

      let orgFilter: string | null = null;
      if (isMaster && selectedOrgId !== 'all') {
        orgFilter = selectedOrgId;
      } else if (!isMaster) {
        orgFilter = profile?.organization_id || null;
      }

      // Load observations within date range WITH compliance_results join
      let obsQuery = supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          organization_id,
          recorded_at,
          zones(name),
          compliance_results(is_compliant, violation_reasons)
        `)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`);

      if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter);

      const { data: observations } = await obsQuery;
      const obs = observations || [];

      const uniquePlates = [...new Set(obs.map(o => o.plate_number))];
      const uniqueZones = [...new Set(obs.map(o => o.zone_id))];

      // Load vehicle details
      let vehicleData: any[] = [];
      if (uniquePlates.length > 0) {
        const { data: vehicles } = await supabase
          .from('canonical_vehicles')
          .select('plate_number, vehicle_make, vehicle_model, vehicle_color, vehicle_year, is_flagged, homeless_status, profile_photo')
          .in('plate_number', uniquePlates);
        vehicleData = vehicles || [];
      }
      const vehicleMap = new Map(vehicleData.map(v => [v.plate_number, v]));

      // Load monthly stays - CRITICAL: Filter by both plates AND zones with observations
      const fromMonth = dateFrom.slice(0, 7) + '-01';
      const toMonth = dateTo.slice(0, 7) + '-01';

      let staysQuery = supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, zone_id, consecutive_nights, nights_stayed')
        .in('plate_number', uniquePlates)
        .in('zone_id', uniqueZones)
        .gte('calendar_month', fromMonth)
        .lte('calendar_month', toMonth);

      if (orgFilter) staysQuery = staysQuery.eq('organization_id', orgFilter);

      const { data: stays } = await staysQuery;

      // Load compliance matrix
      let matrixQuery = supabase
        .from('zone_compliance_matrix')
        .select('zone_id, max_consecutive_nights, nights_per_month')
        .is('effective_to', null);

      if (orgFilter) matrixQuery = matrixQuery.eq('organization_id', orgFilter);

      const { data: matrices } = await matrixQuery;
      const matrixMap = new Map(matrices?.map(m => [m.zone_id, m]) || []);

      // Build plate-zone map to track which vehicles were observed in which zones
      const plateZoneMap = new Map<string, Set<string>>();
      obs.forEach(o => {
        if (!plateZoneMap.has(o.plate_number)) {
          plateZoneMap.set(o.plate_number, new Set());
        }
        plateZoneMap.get(o.plate_number)!.add(o.zone_id);
      });

      // Calculate overstayers and at-risk from monthly stays
      // ✅ CRITICAL FIX: Only count if vehicle was observed in this zone during date range
      const overstayersSet = new Set<string>();
      const atRiskSet = new Set<string>();

      (stays || []).forEach(stay => {
        const rules = matrixMap.get(stay.zone_id);
        if (!rules) return;

        // ✅ Only count if the vehicle was actually observed in this zone
        const plateZones = plateZoneMap.get(stay.plate_number);
        if (!plateZones || !plateZones.has(stay.zone_id)) return;

        if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
          overstayersSet.add(stay.plate_number);
        } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
          atRiskSet.add(stay.plate_number);
        }
      });

      // Count flagged and homeless
      const flaggedSet = new Set(vehicleData.filter(v => v.is_flagged).map(v => v.plate_number));
      const homelessSet = new Set(vehicleData.filter(v => v.homeless_status === 'confirmed').map(v => v.plate_number));

      // Calculate stats
      const compliantCount = uniquePlates.length - overstayersSet.size;
      const complianceRate = uniquePlates.length > 0 
        ? Math.round((compliantCount / uniquePlates.length) * 100) 
        : 100;

      setStats({
        total_observations: obs.length,
        total_vehicles: uniquePlates.length,
        total_zones: uniqueZones.length,
        overstayers: overstayersSet.size,
        at_risk: atRiskSet.size,
        compliant: compliantCount,
        flagged: flaggedSet.size,
        homeless: homelessSet.size,
        compliance_rate: complianceRate,
      });

      // Build zone breakdown
      const zoneMap = new Map<string, any>();
      
      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            zone_id: o.zone_id,
            zone_name: (o.zones as any)?.name || 'Unknown',
            observations: 0,
            plates: new Set(),
            overstayers: new Set(),
            atRisk: new Set(),
            flagged: new Set(),
            homeless: new Set(),
          });
        }

        const zone = zoneMap.get(o.zone_id);
        zone.observations++;
        zone.plates.add(o.plate_number);
      });

      // Add overstay/at-risk info to zones
      (stays || []).forEach(stay => {
        const rules = matrixMap.get(stay.zone_id);
        if (!rules || !zoneMap.has(stay.zone_id)) return;

        const zone = zoneMap.get(stay.zone_id);
        if (!zone.plates.has(stay.plate_number)) return;

        if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
          zone.overstayers.add(stay.plate_number);
        } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
          zone.atRisk.add(stay.plate_number);
        }
      });

      // Add flagged/homeless to zones
      obs.forEach(o => {
        const zone = zoneMap.get(o.zone_id);
        if (!zone) return;
        
        if (flaggedSet.has(o.plate_number)) zone.flagged.add(o.plate_number);
        if (homelessSet.has(o.plate_number)) zone.homeless.add(o.plate_number);
      });

      const zoneStats: ZoneStats[] = Array.from(zoneMap.values()).map(z => {
        const compliant = z.plates.size - z.overstayers.size;
        return {
          zone_id: z.zone_id,
          zone_name: z.zone_name,
          observations: z.observations,
          vehicles: z.plates.size,
          overstayers: z.overstayers.size,
          at_risk: z.atRisk.size,
          compliant,
          flagged: z.flagged.size,
          homeless: z.homeless.size,
          compliance_rate: z.plates.size > 0 ? Math.round((compliant / z.plates.size) * 100) : 100,
        };
      }).sort((a, b) => b.observations - a.observations);

      setZones(zoneStats);

    } catch (error: any) {
      console.error('Failed to load dashboard:', error);
      toast.error('Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const drillToZone = async (zone: ZoneStats, category: string = 'all') => {
    setIsLoading(true);
    setSelectedZone(zone);
    setSelectedCategory(category);
    
    try {
      // Get observations for this zone in date range WITH compliance_results
      let obsQuery = supabase
        .from('observations')
        .select(`
          plate_number,
          compliance_results(is_compliant)
        `)
        .eq('zone_id', zone.zone_id)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`);

      const { data: zoneObs } = await obsQuery;
      
      const plateMap = new Map<string, number>();
      (zoneObs || []).forEach(o => {
        plateMap.set(o.plate_number, (plateMap.get(o.plate_number) || 0) + 1);
      });

      const uniquePlates = Array.from(plateMap.keys());

      if (uniquePlates.length === 0) {
        setVehicles([]);
        setViewLevel('zone');
        setIsLoading(false);
        return;
      }

      // Get monthly stays for this zone
      const fromMonth = dateFrom.slice(0, 7) + '-01';
      const toMonth = dateTo.slice(0, 7) + '-01';

      const { data: zoneStays } = await supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, consecutive_nights, nights_stayed')
        .in('plate_number', uniquePlates)
        .eq('zone_id', zone.zone_id)
        .gte('calendar_month', fromMonth)
        .lte('calendar_month', toMonth);

      const { data: zoneMatrix } = await supabase
        .from('zone_compliance_matrix')
        .select('max_consecutive_nights, nights_per_month')
        .eq('zone_id', zone.zone_id)
        .is('effective_to', null)
        .single();

      const overstayersSet = new Set<string>();
      const atRiskSet = new Set<string>();

      (zoneStays || []).forEach(stay => {
        if (!zoneMatrix) return;
        if (stay.consecutive_nights > zoneMatrix.max_consecutive_nights || stay.nights_stayed > zoneMatrix.nights_per_month) {
          overstayersSet.add(stay.plate_number);
        } else if (stay.consecutive_nights === zoneMatrix.max_consecutive_nights || stay.nights_stayed === zoneMatrix.nights_per_month) {
          atRiskSet.add(stay.plate_number);
        }
      });

      // Get vehicle details
      const { data: vehicleDetails } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('plate_number', uniquePlates);

      let vehicleList: VehicleCard[] = (vehicleDetails || []).map(v => {
        const obsCount = plateMap.get(v.plate_number) || 0;
        
        let status: VehicleCard['status'] = 'compliant';
        if (overstayersSet.has(v.plate_number)) status = 'overstayer';
        else if (atRiskSet.has(v.plate_number)) status = 'at_risk';
        else if (v.is_flagged) status = 'flagged';
        else if (v.homeless_status === 'confirmed') status = 'homeless';

        return {
          plate_number: v.plate_number,
          make: v.vehicle_make,
          model: v.vehicle_model,
          color: v.vehicle_color,
          year: v.vehicle_year,
          observations: obsCount,
          status,
          is_flagged: v.is_flagged,
          homeless_status: v.homeless_status,
          profile_photo: v.profile_photo,
          first_seen: v.first_seen_at,
          last_seen: v.last_seen_at,
        };
      });

      // Filter by category
      if (category === 'overstayers') {
        vehicleList = vehicleList.filter(v => v.status === 'overstayer');
      } else if (category === 'at_risk') {
        vehicleList = vehicleList.filter(v => v.status === 'at_risk');
      } else if (category === 'compliant') {
        vehicleList = vehicleList.filter(v => v.status === 'compliant');
      } else if (category === 'flagged') {
        vehicleList = vehicleList.filter(v => v.status === 'flagged');
      } else if (category === 'homeless') {
        vehicleList = vehicleList.filter(v => v.status === 'homeless');
      }

      vehicleList.sort((a, b) => b.observations - a.observations);

      setVehicles(vehicleList);
      setViewLevel('zone');

    } catch (error: any) {
      console.error('Failed to drill to zone:', error);
      toast.error('Failed to load zone details');
    } finally {
      setIsLoading(false);
    }
  };

  const openVehicleModal = async (vehicle: VehicleCard) => {
    try {
      setIsEditMode(false);
      setPhotoPreview(null);

      // Load canonical vehicle
      const { data: canonical, error: canonicalError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', vehicle.plate_number)
        .single();

      if (canonicalError) throw canonicalError;

      setModalVehicle(canonical);
      setEditForm({
        homeless_status: canonical.homeless_status || 'none',
        homeless_notes: canonical.homeless_notes || '',
        self_contained: canonical.self_contained || false,
        self_contained_expiry: canonical.self_contained_expiry || '',
        vehicle_make: canonical.vehicle_make || '',
        vehicle_model: canonical.vehicle_model || '',
        vehicle_year: canonical.vehicle_year || '',
        vehicle_color: canonical.vehicle_color || '',
      });

      // Load observations in date range
      const { data: obsData, error: obsError } = await supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          is_compliant,
          is_breach,
          breach_type,
          photo,
          officer_notes,
          gps_latitude,
          gps_longitude,
          recorded_at,
          zones(name),
          user_profiles!observations_user_id_fkey(first_name, last_name)
        `)
        .eq('plate_number', vehicle.plate_number)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (obsError) throw obsError;

      const obsList: ObservationRecord[] = (obsData || []).map(o => ({
        observation_id: o.observation_id,
        plate_number: o.plate_number,
        zone_name: (o.zones as any)?.name || 'Unknown',
        recorded_at: o.recorded_at,
        recorded_by: o.user_profiles 
          ? `${(o.user_profiles as any).first_name} ${(o.user_profiles as any).last_name}`
          : 'Unknown',
        is_compliant: o.is_compliant,
        is_breach: o.is_breach,
        breach_type: o.breach_type,
        photo: o.photo,
        officer_notes: o.officer_notes,
        gps_latitude: o.gps_latitude,
        gps_longitude: o.gps_longitude,
      }));

      setModalObservations(obsList);

      // Calculate breach reasons
      const reasons: BreachReason[] = [];
      
      const fromMonth = dateFrom.slice(0, 7) + '-01';
      const toMonth = dateTo.slice(0, 7) + '-01';

      const { data: staysData } = await supabase
        .from('vehicle_monthly_stays')
        .select('*, zones(name)')
        .eq('plate_number', vehicle.plate_number)
        .gte('calendar_month', fromMonth)
        .lte('calendar_month', toMonth);

      if (staysData && staysData.length > 0) {
        const { data: matrixData } = await supabase
          .from('zone_compliance_matrix')
          .select('zone_id, max_consecutive_nights, nights_per_month')
          .in('zone_id', staysData.map(s => s.zone_id))
          .is('effective_to', null);

        const matrixMap = new Map(matrixData?.map(m => [m.zone_id, m]) || []);

        staysData.forEach(stay => {
          const rules = matrixMap.get(stay.zone_id);
          if (!rules) return;

          const zoneName = (stay.zones as any)?.name || 'Unknown zone';

          if (stay.consecutive_nights > rules.max_consecutive_nights) {
            reasons.push({
              severity: 'breach',
              message: `OVERSTAY BREACH in ${zoneName}`,
              details: `Vehicle has stayed ${stay.consecutive_nights} consecutive nights, exceeding the ${rules.max_consecutive_nights} night limit`,
            });
          } else if (stay.consecutive_nights === rules.max_consecutive_nights) {
            reasons.push({
              severity: 'warning',
              message: `AT RISK in ${zoneName}`,
              details: `Vehicle has reached the maximum ${rules.max_consecutive_nights} consecutive nights. One more night will trigger a breach`,
            });
          }

          if (stay.nights_stayed > rules.nights_per_month) {
            reasons.push({
              severity: 'breach',
              message: `MONTHLY LIMIT BREACH in ${zoneName}`,
              details: `Vehicle has stayed ${stay.nights_stayed} nights this month, exceeding the ${rules.nights_per_month} night monthly limit`,
            });
          } else if (stay.nights_stayed === rules.nights_per_month) {
            reasons.push({
              severity: 'warning',
              message: `MONTHLY LIMIT AT RISK in ${zoneName}`,
              details: `Vehicle has reached the ${rules.nights_per_month} night monthly limit. One more night will trigger a breach`,
            });
          }
        });
      }

      if (canonical.is_flagged) {
        reasons.push({
          severity: 'breach',
          message: 'FLAGGED VEHICLE',
          details: canonical.flagged_reason || 'Vehicle is flagged for special attention',
        });
      }

      setBreachReasons(reasons);
      setShowVehicleModal(true);

    } catch (error: any) {
      console.error('Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
    }
  };

  const handlePhotoUpload = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const fileName = `${modalVehicle.plate_number}-${Date.now()}.jpg`;
      const filePath = `${user?.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('evidence')
        .getPublicUrl(filePath);

      setPhotoPreview(publicUrl);
      toast.success('Photo uploaded');

      // Auto-analyze
      toast.info('Analyzing photo...');
      
      try {
        const { data: analysisData } = await supabase.functions.invoke('analyze-vehicle-photo', {
          body: {
            plateNumber: modalVehicle.plate_number,
            photoUrl: publicUrl,
          },
        });

        if (analysisData && (analysisData.make || analysisData.model || analysisData.color || analysisData.year)) {
          setEditForm(prev => ({
            ...prev,
            vehicle_make: analysisData.make || prev.vehicle_make,
            vehicle_model: analysisData.model || prev.vehicle_model,
            vehicle_color: analysisData.color || prev.vehicle_color,
            vehicle_year: analysisData.year || prev.vehicle_year,
          }));
          toast.success('Vehicle details auto-populated!');
        }
      } catch (err) {
        console.warn('Photo analysis failed:', err);
      }
    } catch (error: any) {
      console.error('Photo upload failed:', error);
      toast.error('Photo upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const saveVehicleEdits = async () => {
    if (!modalVehicle) return;

    setIsSaving(true);
    try {
      const updates: any = {
        homeless_status: editForm.homeless_status,
        homeless_notes: editForm.homeless_notes,
        self_contained: editForm.self_contained,
        self_contained_expiry: editForm.self_contained_expiry || null,
        vehicle_make: editForm.vehicle_make || null,
        vehicle_model: editForm.vehicle_model || null,
        vehicle_year: editForm.vehicle_year ? parseInt(editForm.vehicle_year) : null,
        vehicle_color: editForm.vehicle_color || null,
        updated_at: new Date().toISOString(),
      };

      if (photoPreview) {
        updates.profile_photo = photoPreview;
      }

      const { error } = await supabase
        .from('canonical_vehicles')
        .update(updates)
        .eq('plate_number', modalVehicle.plate_number);

      if (error) throw error;

      setModalVehicle({ ...modalVehicle, ...updates });
      setIsEditMode(false);
      setPhotoPreview(null);
      toast.success('Vehicle updated');
      
      await loadDashboard();
    } catch (error: any) {
      console.error('Save failed:', error);
      toast.error('Save failed: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const generatePDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user?.id)
        .single();

      let orgId: string | undefined = undefined;
      if (!isMaster) {
        orgId = profile?.organization_id || undefined;
      } else if (selectedOrgId !== 'all') {
        orgId = selectedOrgId;
      }

      const requestBody: any = {
        date_from: dateFrom,
        date_to: dateTo,
      };

      if (orgId) requestBody.organization_id = orgId;
      if (viewLevel === 'zone' && selectedZone) {
        requestBody.zone_id = selectedZone.zone_id;
      }

      const { data, error } = await supabase.functions.invoke('generate-dashboard-report', {
        body: requestBody,
      });

      if (error) throw error;

      const reportWindow = window.open('', '_blank');
      if (reportWindow) {
        reportWindow.document.write(data.html);
        reportWindow.document.close();
        toast.success('PDF report generated!');
      } else {
        toast.error('Please allow popups to view the PDF report');
      }
    } catch (error: any) {
      console.error('PDF generation failed:', error);
      toast.error('PDF generation failed');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const exportCSV = async () => {
    if (!stats || !user) {
      toast.error('No data to export');
      return;
    }

    await exportComprehensiveCSV({
      dateFrom,
      dateTo,
      viewLevel,
      selectedOrgId,
      selectedZone,
      isMaster,
      userId: user.id,
      stats,
      zones,
      vehicles,
    });
  };

  // ==================== EFFECTS ====================

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  useEffect(() => {
    loadDashboard();
  }, [dateFrom, dateTo, selectedOrgId]);

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Vehicle Detail Modal */}
      <Dialog open={showVehicleModal} onOpenChange={setShowVehicleModal}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Car className="h-6 w-6" />
                Vehicle: {modalVehicle?.plate_number}
              </div>
              {!isEditMode ? (
                <Button size="sm" onClick={() => setIsEditMode(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    setIsEditMode(false);
                    setPhotoPreview(null);
                  }}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveVehicleEdits} disabled={isSaving}>
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Breach/Warning Alerts */}
            {breachReasons.length > 0 && (
              <div className="space-y-2">
                {breachReasons.map((reason, idx) => (
                  <Card 
                    key={idx}
                    className={`border-2 ${
                      reason.severity === 'breach' 
                        ? 'border-red-500 bg-red-50 dark:bg-red-950/30' 
                        : 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className={`h-6 w-6 flex-shrink-0 ${
                          reason.severity === 'breach' ? 'text-red-600' : 'text-amber-600'
                        }`} />
                        <div className="flex-1">
                          <div className={`font-bold text-lg ${
                            reason.severity === 'breach' ? 'text-red-700' : 'text-amber-700'
                          }`}>
                            {reason.message}
                          </div>
                          <div className={`text-sm ${
                            reason.severity === 'breach' ? 'text-red-600' : 'text-amber-600'
                          }`}>
                            {reason.details}
                          </div>
                        </div>
                        <Badge variant={reason.severity === 'breach' ? 'destructive' : 'default'}>
                          {reason.severity === 'breach' ? 'BREACH' : 'WARNING'}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Vehicle Info */}
            <Card>
              <CardHeader>
                <CardTitle>Vehicle Information</CardTitle>
              </CardHeader>
              <CardContent>
                {isEditMode ? (
                  <div className="space-y-4">
                    {/* Photo Upload */}
                    <div className="border-2 border-dashed rounded-lg p-4">
                      <Label className="text-sm font-semibold mb-2 block">Photo</Label>
                      <div className="flex items-center gap-4">
                        <div className="w-32 h-32 rounded-lg border-2 overflow-hidden bg-muted flex items-center justify-center">
                          {photoPreview ? (
                            <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                          ) : modalVehicle?.profile_photo ? (
                            <img src={modalVehicle.profile_photo} alt={modalVehicle.plate_number} className="w-full h-full object-cover" />
                          ) : (
                            <Car className="h-12 w-12 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 space-y-2">
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.capture = 'environment';
                              input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (file) handlePhotoUpload(file);
                              };
                              input.click();
                            }}
                            disabled={uploadingPhoto}
                            className="w-full"
                          >
                            {uploadingPhoto ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Camera className="h-4 w-4 mr-2" />
                            )}
                            Take Photo
                          </Button>
                          <Button 
                            type="button" 
                            variant="outline" 
                            size="sm" 
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (file) handlePhotoUpload(file);
                              };
                              input.click();
                            }}
                            disabled={uploadingPhoto}
                            className="w-full"
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            Choose File
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Make</Label>
                        <Input 
                          value={editForm.vehicle_make}
                          onChange={(e) => setEditForm({ ...editForm, vehicle_make: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Model</Label>
                        <Input 
                          value={editForm.vehicle_model}
                          onChange={(e) => setEditForm({ ...editForm, vehicle_model: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Year</Label>
                        <Input 
                          type="number"
                          value={editForm.vehicle_year}
                          onChange={(e) => setEditForm({ ...editForm, vehicle_year: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Color</Label>
                        <Input 
                          value={editForm.vehicle_color}
                          onChange={(e) => setEditForm({ ...editForm, vehicle_color: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Self-Contained</Label>
                        <select
                          value={editForm.self_contained ? 'true' : 'false'}
                          onChange={(e) => setEditForm({ ...editForm, self_contained: e.target.value === 'true' })}
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        >
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      </div>
                      {editForm.self_contained && (
                        <div className="space-y-2">
                          <Label>Expiry</Label>
                          <Input 
                            type="date"
                            value={editForm.self_contained_expiry}
                            onChange={(e) => setEditForm({ ...editForm, self_contained_expiry: e.target.value })}
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Homeless Status</Label>
                        <select
                          value={editForm.homeless_status}
                          onChange={(e) => setEditForm({ ...editForm, homeless_status: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        >
                          <option value="none">None</option>
                          <option value="claimed">Claimed</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                      </div>
                    </div>
                    {editForm.homeless_status !== 'none' && (
                      <div className="space-y-2">
                        <Label>Homeless Notes</Label>
                        <Textarea 
                          value={editForm.homeless_notes}
                          onChange={(e) => setEditForm({ ...editForm, homeless_notes: e.target.value })}
                          rows={3}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {modalVehicle?.profile_photo && (
                      <div className="col-span-2 md:col-span-1">
                        <img 
                          src={modalVehicle.profile_photo} 
                          alt={modalVehicle.plate_number}
                          className="w-full h-32 object-cover rounded-lg border-2"
                        />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs text-muted-foreground">Plate</Label>
                      <div className="font-mono font-bold text-lg">{modalVehicle?.plate_number}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Make / Model</Label>
                      <div className="font-semibold">
                        {modalVehicle?.vehicle_make || 'Unknown'} {modalVehicle?.vehicle_model || ''}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Year / Color</Label>
                      <div className="font-semibold">
                        {modalVehicle?.vehicle_year || '?'} / {modalVehicle?.vehicle_color || '?'}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Self-Contained</Label>
                      <Badge variant={modalVehicle?.self_contained ? 'default' : 'destructive'}>
                        {modalVehicle?.self_contained ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Observations</Label>
                      <div className="font-bold text-lg">{modalVehicle?.total_observations || 0}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Breaches</Label>
                      <div className="font-bold text-lg text-red-600">{modalVehicle?.total_breaches || 0}</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Observation History */}
            <Card>
              <CardHeader>
                <CardTitle>Observation History ({modalObservations.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {modalObservations.map(obs => (
                    <Card key={obs.observation_id} className="hover:bg-muted/50">
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          {obs.photo && (
                            <div className="w-24 h-20 rounded border overflow-hidden flex-shrink-0">
                              <img src={obs.photo} alt="Obs" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant={obs.is_compliant ? 'outline' : 'destructive'}>
                                {obs.is_breach ? 'BREACH' : obs.is_compliant ? 'Compliant' : 'Non-Compliant'}
                              </Badge>
                              <div className="text-xs text-muted-foreground ml-auto">
                                {new Date(obs.recorded_at).toLocaleString('en-NZ')}
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <div className="text-xs text-muted-foreground">Zone</div>
                                <div className="font-medium">{obs.zone_name}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Officer</div>
                                <div className="font-medium">{obs.recorded_by}</div>
                              </div>
                            </div>
                            {obs.officer_notes && (
                              <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                                <strong>Notes:</strong> {obs.officer_notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" />
            Analytics Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">BI-style drill-down analytics</p>
        </div>

        <div className="flex items-center gap-2">
          {viewLevel === 'zone' && (
            <Button variant="outline" onClick={() => {
              setViewLevel('overview');
              setSelectedZone(null);
              setVehicles([]);
            }}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button 
            variant="default" 
            onClick={generatePDF} 
            disabled={isGeneratingPDF || isLoading}
            className="bg-gradient-to-r from-purple-600 to-purple-700"
          >
            {isGeneratingPDF ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                PDF Report
              </>
            )}
          </Button>
          <Button onClick={loadDashboard} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setViewLevel('overview');
            setSelectedZone(null);
            setVehicles([]);
          }}
          className={viewLevel === 'overview' ? 'font-semibold text-foreground' : ''}
        >
          <Building2 className="h-3 w-3 mr-1" />
          Dashboard
        </Button>
        
        {selectedZone && (
          <>
            <ChevronRight className="h-4 w-4" />
            <Button
              variant="ghost"
              size="sm"
              className="font-semibold text-foreground"
            >
              <MapPin className="h-3 w-3 mr-1" />
              {selectedZone.zone_name}
            </Button>
          </>
        )}
      </div>

      {/* Date Filters */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Quick Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm font-medium mr-2">Quick Select:</Label>
              <Button variant="outline" size="sm" onClick={() => setDateRange('today')}>Today</Button>
              <Button variant="outline" size="sm" onClick={() => setDateRange('yesterday')}>Yesterday</Button>
              <Button variant="outline" size="sm" onClick={() => setDateRange('last7')}>Last 7 Days</Button>
              <Button variant="outline" size="sm" onClick={() => setDateRange('last30')}>Last 30 Days</Button>
              <Button variant="outline" size="sm" onClick={() => setDateRange('last90')}>Last 90 Days</Button>
              
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigateDays('prev')}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous Day
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigateDays('next')}>
                  Next Day
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Date Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {isMaster && organizations.length > 0 && (
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <select
                    value={selectedOrgId}
                    onChange={(e) => setSelectedOrgId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    <option value="all">All Organizations</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <Label>From Date</Label>
                <Input 
                  type="date" 
                  value={dateFrom} 
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  max={formatLocalDate(new Date())}
                />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input 
                  type="date" 
                  value={dateTo} 
                  onChange={(e) => handleDateToChange(e.target.value)}
                  min={dateFrom}
                  max={formatLocalDate(new Date())}
                />
              </div>
            </div>

            {/* Date Display */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Showing data from <strong>{new Date(dateFrom).toLocaleDateString('en-NZ')}</strong> to{' '}
                <strong>{new Date(dateTo).toLocaleDateString('en-NZ')}</strong>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* OVERVIEW LEVEL */}
          {viewLevel === 'overview' && stats && (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Activity className="h-8 w-8 text-blue-600" />
                      <Badge className="bg-blue-600">{stats.total_zones} zones</Badge>
                    </div>
                    <div className="text-4xl font-black text-blue-600 mb-1">
                      {stats.total_observations.toLocaleString()}
                    </div>
                    <div className="text-sm text-blue-700">Total Observations</div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                      <TrendingUp className="h-6 w-6 text-green-600" />
                    </div>
                    <div className="text-4xl font-black text-green-600 mb-1">
                      {stats.compliance_rate}%
                    </div>
                    <div className="text-sm text-green-700">Compliance Rate</div>
                    <div className="text-xs text-green-600 mt-1">
                      {stats.compliant} of {stats.total_vehicles} vehicles
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-red-200 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <AlertTriangle className="h-8 w-8 text-red-600" />
                      <Badge variant="destructive">BREACH</Badge>
                    </div>
                    <div className="text-4xl font-black text-red-600 mb-1">
                      {stats.overstayers}
                    </div>
                    <div className="text-sm text-red-700">Overstayers</div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Clock className="h-8 w-8 text-amber-600" />
                      <Badge className="bg-amber-600">At Risk</Badge>
                    </div>
                    <div className="text-4xl font-black text-amber-600 mb-1">
                      {stats.at_risk}
                    </div>
                    <div className="text-sm text-amber-700">At Risk Vehicles</div>
                  </CardContent>
                </Card>
              </div>

              {/* Second Row KPIs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Flag className="h-8 w-8 text-purple-600" />
                      <Badge className="bg-purple-600">High Priority</Badge>
                    </div>
                    <div className="text-4xl font-black text-purple-600 mb-1">
                      {stats.flagged}
                    </div>
                    <div className="text-sm text-purple-700">Flagged Vehicles</div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/30 dark:to-cyan-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Home className="h-8 w-8 text-cyan-600" />
                      <Badge className="bg-cyan-600">Confirmed</Badge>
                    </div>
                    <div className="text-4xl font-black text-cyan-600 mb-1">
                      {stats.homeless}
                    </div>
                    <div className="text-sm text-cyan-700">Homeless Vehicles</div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950/30 dark:to-slate-900/20">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Car className="h-8 w-8 text-slate-600" />
                      <Badge className="bg-slate-600">{stats.total_zones} zones</Badge>
                    </div>
                    <div className="text-4xl font-black text-slate-600 mb-1">
                      {stats.total_vehicles}
                    </div>
                    <div className="text-sm text-slate-700">Total Vehicles</div>
                  </CardContent>
                </Card>
              </div>

              {/* Zone Grid */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Zone Performance ({zones.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {zones.map(zone => (
                      <Card
                        key={zone.zone_id}
                        className="cursor-pointer hover:shadow-lg hover:border-primary transition-all group"
                        onClick={() => drillToZone(zone)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-semibold truncate">{zone.zone_name}</h4>
                            <Eye className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                            <div className="p-2 bg-muted rounded">
                              <div className="text-xs text-muted-foreground">Observations</div>
                              <div className="font-bold">{zone.observations}</div>
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <div className="text-xs text-muted-foreground">Vehicles</div>
                              <div className="font-bold">{zone.vehicles}</div>
                            </div>
                            <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded">
                              <div className="text-xs text-red-700">Overstayers</div>
                              <div className="font-bold text-red-600">{zone.overstayers}</div>
                            </div>
                            <div className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded">
                              <div className="text-xs text-amber-700">At Risk</div>
                              <div className="font-bold text-amber-600">{zone.at_risk}</div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t">
                            <span className="text-xs text-muted-foreground">Compliance</span>
                            <Badge variant={zone.compliance_rate >= 80 ? 'default' : 'destructive'}>
                              {zone.compliance_rate}%
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ZONE LEVEL */}
          {viewLevel === 'zone' && selectedZone && (
            <>
              {/* Zone Summary */}
              <Card className="bg-gradient-to-r from-primary/10 to-primary/5">
                <CardContent className="p-6">
                  <h2 className="text-2xl font-bold mb-2">{selectedZone.zone_name}</h2>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <span>{selectedZone.observations} observations</span>
                    <span>{selectedZone.vehicles} vehicles</span>
                    <Badge variant={selectedZone.compliance_rate >= 80 ? 'default' : 'destructive'}>
                      {selectedZone.compliance_rate}% compliance
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Category Breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'overstayers' ? 'border-2 border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-red-200 bg-red-50/50 dark:bg-red-950/20'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'overstayers')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-red-600 mb-1">{selectedZone.overstayers}</div>
                    <div className="text-xs text-red-700">Overstayers</div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'at_risk' ? 'border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-amber-200 bg-amber-50/50 dark:bg-amber-950/20'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'at_risk')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-amber-600 mb-1">{selectedZone.at_risk}</div>
                    <div className="text-xs text-amber-700">At Risk</div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'compliant' ? 'border-2 border-green-500 bg-green-50 dark:bg-green-950/30' : 'border-green-200 bg-green-50/50 dark:bg-green-950/20'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'compliant')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-green-600 mb-1">{selectedZone.compliant}</div>
                    <div className="text-xs text-green-700">Compliant</div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'flagged' ? 'border-2 border-purple-500 bg-purple-50 dark:bg-purple-950/30' : 'border-purple-200 bg-purple-50/50 dark:bg-purple-950/20'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'flagged')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-purple-600 mb-1">{selectedZone.flagged}</div>
                    <div className="text-xs text-purple-700">Flagged</div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'homeless' ? 'border-2 border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30' : 'border-cyan-200 bg-cyan-50/50 dark:bg-cyan-950/20'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'homeless')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-cyan-600 mb-1">{selectedZone.homeless}</div>
                    <div className="text-xs text-cyan-700">Homeless</div>
                  </CardContent>
                </Card>
              </div>

              {/* Vehicle Cards */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Vehicles ({vehicles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {vehicles.map(vehicle => (
                      <Card
                        key={vehicle.plate_number}
                        className={`${getStatusColor(vehicle.status)} cursor-pointer hover:shadow-xl transition-all group`}
                        onClick={() => openVehicleModal(vehicle)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            {vehicle.profile_photo && (
                              <div className="w-20 h-20 rounded-lg overflow-hidden border-2 flex-shrink-0">
                                <img src={vehicle.profile_photo} alt={vehicle.plate_number} className="w-full h-full object-cover" />
                              </div>
                            )}
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <Badge variant="outline" className="font-mono text-base px-3 py-1">
                                  {vehicle.plate_number}
                                </Badge>
                                {getStatusBadge(vehicle.status)}
                                <Eye className="h-4 w-4 ml-auto text-muted-foreground group-hover:text-primary" />
                              </div>

                              <div className="grid grid-cols-4 gap-3 text-sm">
                                <div>
                                  <div className="text-xs text-muted-foreground">Vehicle</div>
                                  <div className="font-medium">
                                    {vehicle.make || 'Unknown'} {vehicle.model || ''}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground">Observations</div>
                                  <div className="font-bold text-lg">{vehicle.observations}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground">Last Seen</div>
                                  <div className="text-xs">{new Date(vehicle.last_seen).toLocaleDateString('en-NZ')}</div>
                                </div>
                              </div>
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
        </>
      )}
    </div>
  );
}
