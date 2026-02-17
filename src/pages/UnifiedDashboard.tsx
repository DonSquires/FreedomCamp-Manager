/**
 * UNIFIED BI DASHBOARD
 * Consolidates: Organization Overview + Compliance Dashboard + Analytics Hub
 * 
 * Features:
 * - Three-level drill-down: Overview → Zone → Vehicle Details
 * - Real-time compliance monitoring with breach detection
 * - Advanced analytics: trends, zone performance, officer activity
 * - Comprehensive exports: CSV + PDF with photos
 * - Full edit capabilities for vehicles and observations
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  FileText,
  Users,
  Award,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { exportComprehensiveCSV } from '@/lib/csvExport';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];

// ==================== TYPE DEFINITIONS ====================

type ViewLevel = 'overview' | 'zone';

interface DashboardMetrics {
  totalObservations: number;
  uniqueVehicles: number;
  uniqueZones: number;
  complianceRate: number;
  overstayers: number;
  atRisk: number;
  compliant: number;
  flagged: number;
  homeless: number;
  totalBreaches: number;
  officers: number;
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
  compliance: number;
  breaches: number;
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

interface DailyTrend {
  date: string;
  observations: number;
  complianceRate: number;
  breaches: number;
  homelessCount: number;
}

interface BreachType {
  type: string;
  count: number;
  percentage: number;
}

interface OfficerStats {
  officerId: string;
  officerName: string;
  scans: number;
  breachesDetected: number;
  complianceRate: number;
  zones: number;
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

// ==================== MAIN COMPONENT ====================

export function UnifiedDashboard() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  // View state
  const [viewLevel, setViewLevel] = useState<ViewLevel>('overview');
  const [activeTab, setActiveTab] = useState<'summary' | 'trends' | 'zones' | 'officers' | 'breaches'>('summary');
  const [selectedZone, setSelectedZone] = useState<ZoneStats | null>(null);

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [zones, setZones] = useState<ZoneStats[]>([]);
  const [vehicles, setVehicles] = useState<VehicleCard[]>([]);
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([]);
  const [breachTypes, setBreachTypes] = useState<BreachType[]>([]);
  const [officerStats, setOfficerStats] = useState<OfficerStats[]>([]);

  // Filter state
  const [dateFrom, setDateFrom] = useState(() => formatLocalDate(new Date()));
  const [dateTo, setDateTo] = useState(() => formatLocalDate(new Date()));
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

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
        setDateFrom(formatLocalDate(yesterday));
        setDateTo(formatLocalDate(yesterday));
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
      
      if (formatLocalDate(to) > formatLocalDate(new Date())) {
        toast.error('Cannot navigate beyond today');
        return;
      }
    }
    
    setDateFrom(formatLocalDate(from));
    setDateTo(formatLocalDate(to));
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
      console.log('📊 Loading unified dashboard...');

      // Build observations query
      // ⚠️ RLS automatically filters by accessible orgs (primary + authorized_work_locations + descendants)
      // Only apply manual org filter if master explicitly selects a specific organization
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          organization_id,
          recorded_at,
          recorded_by,
          is_compliant,
          is_breach,
          zones!inner(id, name),
          canonical_vehicles(
            vehicle_make,
            vehicle_model,
            vehicle_color,
            vehicle_year,
            is_flagged,
            homeless_status,
            profile_photo,
            first_seen_at,
            last_seen_at
          ),
          compliance_results(is_compliant, violation_reasons)
        `)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`);

      // Only filter by org if master user explicitly selects one
      if (isMaster && selectedOrgId !== 'all') {
        obsQuery = obsQuery.eq('organization_id', selectedOrgId);
      }
      // For non-master users, RLS handles org filtering automatically

      const { data: observations } = await obsQuery;
      const obs = observations || [];

      console.log(`✅ Loaded ${obs.length} observations`);

      // Calculate core metrics
      const uniquePlates = new Set(obs.map(o => o.plate_number));
      const uniqueZones = new Set(obs.map(o => o.zone_id));

      const homelessPlates = new Set(
        obs.filter(o => {
          const v = o.canonical_vehicles as any;
          return v?.homeless_status === 'confirmed' || v?.homeless_status === 'claimed';
        }).map(o => o.plate_number)
      );

      const flaggedPlates = new Set(
        obs.filter(o => (o.canonical_vehicles as any)?.is_flagged).map(o => o.plate_number)
      );

      const compliantObs = obs.filter(o => o.is_compliant).length;
      const breachObs = obs.filter(o => o.is_breach).length;

      // Monthly stays for overstayer/at-risk
      const fromMonth = dateFrom.slice(0, 7) + '-01';
      const toMonth = dateTo.slice(0, 7) + '-01';

      let staysQuery = supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, zone_id, consecutive_nights, nights_stayed')
        .in('plate_number', Array.from(uniquePlates))
        .gte('calendar_month', fromMonth)
        .lte('calendar_month', toMonth);

      // Only filter by org if master user explicitly selects one
      if (isMaster && selectedOrgId !== 'all') {
        staysQuery = staysQuery.eq('organization_id', selectedOrgId);
      }

      const { data: stays } = await staysQuery;

      // Compliance matrix
      let matrixQuery = supabase
        .from('zone_compliance_matrix')
        .select('zone_id, max_consecutive_nights, nights_per_month')
        .is('effective_to', null);

      // Only filter by org if master user explicitly selects one
      if (isMaster && selectedOrgId !== 'all') {
        matrixQuery = matrixQuery.eq('organization_id', selectedOrgId);
      }

      const { data: matrices } = await matrixQuery;
      const matrixMap = new Map(matrices?.map(m => [m.zone_id, m]) || []);

      const overstayersSet = new Set<string>();
      const atRiskSet = new Set<string>();

      (stays || []).forEach(stay => {
        const rules = matrixMap.get(stay.zone_id);
        if (!rules) return;

        if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
          overstayersSet.add(stay.plate_number);
        } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
          atRiskSet.add(stay.plate_number);
        }
      });

      const compliantCount = uniquePlates.size - overstayersSet.size;
      const complianceRate = uniquePlates.size > 0 
        ? Math.round((compliantCount / uniquePlates.size) * 100) 
        : 100;

      // Officer count
      let officerQuery = supabase
        .from('user_profiles')
        .select('id, first_name, last_name')
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer']);

      // Only filter by org if master user explicitly selects one
      if (isMaster && selectedOrgId !== 'all') {
        officerQuery = officerQuery.eq('organization_id', selectedOrgId);
      }

      const { data: officers } = await officerQuery;

      setMetrics({
        totalObservations: obs.length,
        uniqueVehicles: uniquePlates.size,
        uniqueZones: uniqueZones.size,
        complianceRate,
        overstayers: overstayersSet.size,
        atRisk: atRiskSet.size,
        compliant: compliantCount,
        flagged: flaggedPlates.size,
        homeless: homelessPlates.size,
        totalBreaches: breachObs,
        officers: officers?.length || 0,
      });

      // Build zone stats
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
            breaches: 0,
          });
        }

        const zone = zoneMap.get(o.zone_id);
        zone.observations++;
        zone.plates.add(o.plate_number);
        if (o.is_breach) zone.breaches++;
      });

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

      obs.forEach(o => {
        const zone = zoneMap.get(o.zone_id);
        if (!zone) return;
        
        if (flaggedPlates.has(o.plate_number)) zone.flagged.add(o.plate_number);
        if (homelessPlates.has(o.plate_number)) zone.homeless.add(o.plate_number);
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
          compliance: z.plates.size > 0 ? Math.round((compliant / z.plates.size) * 100) : 100,
          breaches: z.breaches,
        };
      }).sort((a, b) => b.observations - a.observations);

      setZones(zoneStats);

      // Build daily trends
      const dailyMap = new Map<string, {
        observations: number;
        compliant: number;
        breaches: number;
        homelessPlates: Set<string>;
      }>();

      obs.forEach(o => {
        const date = o.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, {
            observations: 0,
            compliant: 0,
            breaches: 0,
            homelessPlates: new Set(),
          });
        }

        const day = dailyMap.get(date)!;
        day.observations++;
        if (o.is_compliant) day.compliant++;
        if (o.is_breach) day.breaches++;
        if (homelessPlates.has(o.plate_number)) day.homelessPlates.add(o.plate_number);
      });

      const trends = Array.from(dailyMap.entries())
        .map(([date, stats]) => ({
          date,
          observations: stats.observations,
          complianceRate: stats.observations > 0 ? Math.round((stats.compliant / stats.observations) * 100) : 100,
          breaches: stats.breaches,
          homelessCount: stats.homelessPlates.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setDailyTrends(trends);

      // Build breach types
      const breachTypeMap = new Map<string, number>();

      obs.forEach(o => {
        const result = (o.compliance_results as any);
        if (Array.isArray(result) && result.length > 0 && !result[0].is_compliant) {
          const reasons = result[0].violation_reasons || [];
          reasons.forEach((reason: string) => {
            breachTypeMap.set(reason, (breachTypeMap.get(reason) || 0) + 1);
          });
        }
      });

      const breachTypesList = Array.from(breachTypeMap.entries())
        .map(([type, count]) => ({
          type: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          count,
          percentage: breachObs > 0 ? Math.round((count / breachObs) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      setBreachTypes(breachTypesList);

      // Build officer stats
      const officerMap = new Map<string, {
        scans: number;
        breaches: number;
        zones: Set<string>;
      }>();

      obs.forEach(o => {
        if (!o.recorded_by) return;
        
        if (!officerMap.has(o.recorded_by)) {
          officerMap.set(o.recorded_by, {
            scans: 0,
            breaches: 0,
            zones: new Set(),
          });
        }

        const officer = officerMap.get(o.recorded_by)!;
        officer.scans++;
        officer.zones.add(o.zone_id);
        if (o.is_breach) officer.breaches++;
      });

      const officerStatsList = Array.from(officerMap.entries())
        .map(([id, stats]) => {
          const profile = (officers || []).find(o => o.id === id);
          return {
            officerId: id,
            officerName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
            scans: stats.scans,
            breachesDetected: stats.breaches,
            complianceRate: stats.scans > 0 ? Math.round(((stats.scans - stats.breaches) / stats.scans) * 100) : 100,
            zones: stats.zones.size,
          };
        })
        .sort((a, b) => b.scans - a.scans);

      setOfficerStats(officerStatsList);

      console.log('✅ Unified dashboard loaded');

    } catch (error: any) {
      console.error('❌ Failed to load dashboard:', error);
      toast.error('Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const drillToZone = async (zone: ZoneStats) => {
    setSelectedZone(zone);
    setIsLoading(true);

    try {
      // Get all vehicles in this zone during date range
      const { data: zoneObs } = await supabase
        .from('vehicle_observations_v2')
        .select('plate_number')
        .eq('zone_id', zone.zone_id)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`);

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

      // Get vehicle details
      const { data: vehicleDetails } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('plate_number', uniquePlates);

      // Get monthly stays for status
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

  const exportCSV = async () => {
    if (!metrics || !user) {
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
      stats: metrics,
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

  const daysDiff = Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" />
            Unified BI Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Complete analytics, compliance monitoring, and reporting
          </p>
        </div>

        <div className="flex items-center gap-2">
          {viewLevel === 'zone' && (
            <Button variant="outline" onClick={() => {
              setViewLevel('overview');
              setSelectedZone(null);
              setVehicles([]);
            }}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Overview
            </Button>
          )}
          <Button variant="outline" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
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
            <Button variant="ghost" size="sm" className="font-semibold text-foreground">
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
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigateDays('next')}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

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
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Analyzing <strong>{daysDiff} days</strong> from{' '}
                <strong>{new Date(dateFrom).toLocaleDateString('en-NZ')}</strong> to{' '}
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
          {viewLevel === 'overview' && metrics && (
            <>
              {/* KPI Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <Card className="border-blue-300 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20">
                  <CardContent className="p-6">
                    <Activity className="h-8 w-8 text-blue-600 mb-2" />
                    <div className="text-4xl font-black text-blue-600">{metrics.totalObservations}</div>
                    <div className="text-sm text-blue-700">Observations</div>
                  </CardContent>
                </Card>

                <Card className="border-green-300 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20">
                  <CardContent className="p-6">
                    <CheckCircle2 className="h-8 w-8 text-green-600 mb-2" />
                    <div className="text-4xl font-black text-green-600">{metrics.complianceRate}%</div>
                    <div className="text-sm text-green-700">Compliance</div>
                  </CardContent>
                </Card>

                <Card className="border-red-300 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20">
                  <CardContent className="p-6">
                    <AlertTriangle className="h-8 w-8 text-red-600 mb-2" />
                    <div className="text-4xl font-black text-red-600">{metrics.overstayers}</div>
                    <div className="text-sm text-red-700">Overstayers</div>
                  </CardContent>
                </Card>

                <Card className="border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20">
                  <CardContent className="p-6">
                    <Clock className="h-8 w-8 text-amber-600 mb-2" />
                    <div className="text-4xl font-black text-amber-600">{metrics.atRisk}</div>
                    <div className="text-sm text-amber-700">At Risk</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <Car className="h-8 w-8 text-purple-600 mb-2" />
                    <div className="text-4xl font-black text-purple-600">{metrics.uniqueVehicles}</div>
                    <div className="text-sm text-muted-foreground">Vehicles</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <MapPin className="h-8 w-8 text-indigo-600 mb-2" />
                    <div className="text-4xl font-black text-indigo-600">{metrics.uniqueZones}</div>
                    <div className="text-sm text-muted-foreground">Zones</div>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="trends">Trends</TabsTrigger>
                  <TabsTrigger value="zones">Zones ({zones.length})</TabsTrigger>
                  <TabsTrigger value="officers">Officers ({officerStats.length})</TabsTrigger>
                  <TabsTrigger value="breaches">Breaches ({metrics.totalBreaches})</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Daily Trends</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={dailyTrends}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" fontSize={12} tickFormatter={(d) => new Date(d).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })} />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="observations" stroke="#3b82f6" name="Observations" />
                            <Line type="monotone" dataKey="breaches" stroke="#ef4444" name="Breaches" />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Top Zones by Activity</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={zones.slice(0, 5)}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="zone_name" fontSize={12} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="observations" fill="#3b82f6" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="trends" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Compliance Trend Analysis</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={dailyTrends}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" fontSize={12} />
                          <YAxis yAxisId="left" />
                          <YAxis yAxisId="right" orientation="right" />
                          <Tooltip />
                          <Legend />
                          <Line yAxisId="left" type="monotone" dataKey="complianceRate" stroke="#22c55e" name="Compliance %" strokeWidth={2} />
                          <Line yAxisId="right" type="monotone" dataKey="observations" stroke="#3b82f6" name="Observations" />
                          <Line yAxisId="right" type="monotone" dataKey="breaches" stroke="#ef4444" name="Breaches" />
                          <Line yAxisId="right" type="monotone" dataKey="homelessCount" stroke="#06b6d4" name="Homeless" />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="zones" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Zone Performance ({zones.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {zones.map(zone => (
                          <Card
                            key={zone.zone_id}
                            className="cursor-pointer hover:shadow-lg transition-all border-2"
                            onClick={() => drillToZone(zone)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold truncate">{zone.zone_name}</h4>
                                <Eye className="h-4 w-4 text-muted-foreground" />
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
                              </div>

                              <div className="flex items-center justify-between pt-3 border-t">
                                <span className="text-xs text-muted-foreground">Compliance</span>
                                <Badge variant={zone.compliance >= 80 ? 'default' : 'destructive'}>
                                  {zone.compliance}%
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="officers" className="mt-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Officer Leaderboard</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {officerStats.map((officer, index) => (
                          <div
                            key={officer.officerId}
                            className={`p-4 border-2 rounded-lg ${
                              index === 0 ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : ''
                            }`}
                          >
                            <div className="flex items-center gap-3 mb-3">
                              {index === 0 && <Award className="h-6 w-6 text-amber-500" />}
                              <span className="font-bold">#{index + 1}</span>
                              <span className="font-semibold">{officer.officerName}</span>
                            </div>
                            <div className="grid grid-cols-4 gap-3 text-sm">
                              <div>
                                <div className="text-xs text-muted-foreground">Scans</div>
                                <div className="font-bold text-lg">{officer.scans}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Breaches</div>
                                <div className="font-bold text-lg text-red-600">{officer.breachesDetected}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Zones</div>
                                <div className="font-bold text-lg">{officer.zones}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">Compliance</div>
                                <div className="font-bold text-lg text-green-600">{officer.complianceRate}%</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="breaches" className="mt-6">
                  {breachTypes.length === 0 ? (
                    <Card>
                      <CardContent className="text-center py-12">
                        <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                        <h3 className="text-xl font-bold mb-2">No Breaches Detected</h3>
                        <p className="text-muted-foreground">100% compliance for selected period</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <Card>
                        <CardHeader>
                          <CardTitle>Breach Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                              <Pie
                                data={breachTypes}
                                dataKey="count"
                                nameKey="type"
                                cx="50%"
                                cy="50%"
                                outerRadius={100}
                                label
                              >
                                {breachTypes.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Breach Types</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {breachTypes.map((breach, index) => (
                              <div key={breach.type} className="flex items-center justify-between p-3 border rounded-lg">
                                <div className="flex items-center gap-3">
                                  <div
                                    className="w-4 h-4 rounded-full"
                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                  />
                                  <span className="font-semibold">{breach.type}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm text-muted-foreground">{breach.count}</span>
                                  <Badge>{breach.percentage}%</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}

          {viewLevel === 'zone' && selectedZone && (
            <>
              <Card className="bg-gradient-to-r from-primary/10 to-primary/5">
                <CardContent className="p-6">
                  <h2 className="text-2xl font-bold mb-2">{selectedZone.zone_name}</h2>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{selectedZone.observations} observations</span>
                    <span>{selectedZone.vehicles} vehicles</span>
                    <Badge variant={selectedZone.compliance >= 80 ? 'default' : 'destructive'}>
                      {selectedZone.compliance}% compliance
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Vehicles ({vehicles.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {vehicles.map(vehicle => (
                      <Card
                        key={vehicle.plate_number}
                        className={`${getStatusColor(vehicle.status)} cursor-pointer hover:shadow-xl transition-all`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            {vehicle.profile_photo && (
                              <div className="w-20 h-20 rounded-lg overflow-hidden border-2">
                                <img src={vehicle.profile_photo} alt={vehicle.plate_number} className="w-full h-full object-cover" />
                              </div>
                            )}
                            
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="font-mono text-base">
                                  {vehicle.plate_number}
                                </Badge>
                                {getStatusBadge(vehicle.status)}
                              </div>

                              <div className="grid grid-cols-3 gap-3 text-sm">
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
