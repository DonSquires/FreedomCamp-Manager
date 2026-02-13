/**
 * Organization Dashboard - REBUILT FROM CORE PRINCIPLES
 * 
 * Core Architecture:
 * - Section 1 (Data Gathering): vehicle_observations_v2 - pure observation data
 * - Section 2 (Reporting): compliance_results - compliance evaluation  
 * - canonical_vehicles - single source of truth for vehicle details
 * 
 * Status Priority (USER CLARIFIED):
 * 1. homeless_status = 'confirmed' → HOMELESS (breach but exempt, FC Act)
 * 2. compliance_results.is_compliant = false → OVERSTAYER (breached)
 * 3. violation_reasons contains 'at risk' → AT RISK
 * 4. is_flagged = true → FLAGGED
 * 5. Otherwise → COMPLIANT
 * 
 * Compliance Rate:
 * - Excludes homeless vehicles (FC Act exempt)
 * - Formula: (compliant non-homeless) / (total non-homeless) * 100
 * 
 * ✅ TIMEZONE FIX: All dates use NZ timezone (Pacific/Auckland) for filtering and display
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { exportComprehensiveCSV } from '@/lib/csvExport';
import { getNZDateString, getNZDateRange, formatNZDateOnly, toNZDate, normalizeDateString } from '@/lib/timezone';

// ==================== TYPES ====================

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
  last_seen: string;
}

// ==================== HELPERS ====================

const getStatusColor = (status: VehicleCard['status']): string => {
  switch (status) {
    case 'homeless': return 'border-2 border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30';
    case 'overstayer': return 'border-2 border-red-500 bg-red-50 dark:bg-red-950/30';
    case 'at_risk': return 'border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30';
    case 'flagged': return 'border-2 border-purple-500 bg-purple-50 dark:bg-purple-950/30';
    case 'compliant': return 'border-2 border-green-500 bg-green-50 dark:bg-green-950/30';
  }
};

const getStatusBadge = (status: VehicleCard['status']) => {
  switch (status) {
    case 'homeless':
      return (
        <Badge className="gap-1 bg-cyan-600">
          <Home className="h-3 w-3" />
          HOMELESS (FC ACT EXEMPT)
        </Badge>
      );
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

  const [viewLevel, setViewLevel] = useState<ViewLevel>('overview');
  const [selectedZone, setSelectedZone] = useState<ZoneStats | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [zones, setZones] = useState<ZoneStats[]>([]);
  const [vehicles, setVehicles] = useState<VehicleCard[]>([]);

  // ✅ CRITICAL FIX: Use NZ timezone for date state
  const [dateFrom, setDateFrom] = useState(() => {
    const today = getNZDateString();
    console.log('📅 Initial dateFrom:', today);
    return today;
  });
  const [dateTo, setDateTo] = useState(() => {
    const today = getNZDateString();
    console.log('📅 Initial dateTo:', today);
    return today;
  });
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

  // ==================== DATE HANDLERS ====================

  // ✅ CRITICAL FIX: Use NZ timezone for date range calculations
  const setDateRange = (range: 'today' | 'yesterday' | 'last7' | 'last30' | 'last90') => {
    const nzNow = toNZDate(new Date());
    const todayStr = getNZDateString(nzNow);

    switch (range) {
      case 'today':
        setDateFrom(todayStr);
        setDateTo(todayStr);
        break;
      case 'yesterday': {
        const yesterday = new Date(nzNow);
        yesterday.setDate(yesterday.getDate() - 1);
        setDateFrom(getNZDateString(yesterday));
        setDateTo(getNZDateString(yesterday));
        break;
      }
      case 'last7': {
        const last7 = new Date(nzNow);
        last7.setDate(last7.getDate() - 7);
        setDateFrom(getNZDateString(last7));
        setDateTo(todayStr);
        break;
      }
      case 'last30': {
        const last30 = new Date(nzNow);
        last30.setDate(last30.getDate() - 30);
        setDateFrom(getNZDateString(last30));
        setDateTo(todayStr);
        break;
      }
      case 'last90': {
        const last90 = new Date(nzNow);
        last90.setDate(last90.getDate() - 90);
        setDateFrom(getNZDateString(last90));
        setDateTo(todayStr);
        break;
      }
    }
  };

  // ✅ CRITICAL FIX: Use NZ timezone for date navigation
  const navigateDays = (direction: 'prev' | 'next') => {
    const from = toNZDate(new Date(dateFrom + 'T00:00:00'));
    const to = toNZDate(new Date(dateTo + 'T00:00:00'));
    
    if (direction === 'prev') {
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
    } else {
      from.setDate(from.getDate() + 1);
      to.setDate(to.getDate() + 1);
      
      const nzToday = getNZDateString();
      if (getNZDateString(to) > nzToday) {
        toast.error('Cannot navigate beyond today');
        return;
      }
    }
    
    setDateFrom(getNZDateString(from));
    setDateTo(getNZDateString(to));
  };

  // ==================== DATA LOADING - REBUILT FROM CORE PRINCIPLES ====================

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
      console.log('🏗️ LOADING DASHBOARD - Core Principles Architecture');
      
      // ✅ CRITICAL: Normalize date formats before using them
      const normalizedFrom = normalizeDateString(dateFrom);
      const normalizedTo = normalizeDateString(dateTo);
      
      console.log('📅 Date validation:', {
        dateFrom, 
        dateTo,
        normalizedFrom,
        normalizedTo,
      });
      
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

      // ✅ STEP 1: Load observations (Section 1 - Data Gathering)
      console.log('📊 Step 1: Load observations (pure data)');
      console.log('🕐 NZ Date Range:', normalizedFrom, 'to', normalizedTo);
      
      // ✅ CRITICAL FIX: Convert NZ date range to UTC for database query
      const startRange = getNZDateRange(normalizedFrom);
      const endRange = getNZDateRange(normalizedTo);
      
      console.log('🌍 UTC Range:', startRange.start, 'to', endRange.end);
      
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select('observation_id, plate_number, zone_id, organization_id, recorded_at, zones(name)')
        .gte('recorded_at', startRange.start)
        .lte('recorded_at', endRange.end);

      if (orgFilter) obsQuery = obsQuery.eq('organization_id', orgFilter);

      const { data: observations, error: obsError } = await obsQuery;
      if (obsError) throw obsError;
      
      const obs = observations || [];
      const uniquePlates = [...new Set(obs.map(o => o.plate_number))];
      const uniqueZones = [...new Set(obs.map(o => o.zone_id))];

      console.log(`✅ Loaded ${obs.length} observations, ${uniquePlates.length} unique plates, ${uniqueZones.length} zones`);

      // ✅ STEP 2: Load canonical vehicles (single source of truth)
      console.log('🚗 Step 2: Load canonical vehicles');
      let vehicleData: any[] = [];
      if (uniquePlates.length > 0) {
        const { data: vehicles } = await supabase
          .from('canonical_vehicles')
          .select('plate_number, vehicle_make, vehicle_model, vehicle_color, vehicle_year, is_flagged, homeless_status, profile_photo, last_seen_at')
          .in('plate_number', uniquePlates);
        vehicleData = vehicles || [];
      }
      const vehicleMap = new Map(vehicleData.map(v => [v.plate_number, v]));

      console.log(`✅ Loaded ${vehicleData.length} canonical vehicles`);

      // ✅ STEP 3: Load compliance results (Section 2 - Reporting)
      console.log('⚖️ Step 3: Load compliance results (reporting)');
      const obsIds = obs.map(o => o.observation_id);
      let complianceData: any[] = [];
      
      if (obsIds.length > 0) {
        const { data: compResults } = await supabase
          .from('compliance_results')
          .select('observation_id, is_compliant, violation_reasons')
          .in('observation_id', obsIds);
        complianceData = compResults || [];
      }
      
      const complianceMap = new Map(complianceData.map(c => [c.observation_id, c]));
      console.log(`✅ Loaded ${complianceData.length} compliance results`);

      // ✅ STEP 4: Calculate vehicle status using CORE PRINCIPLES
      console.log('🎯 Step 4: Calculate vehicle status (priority: homeless → overstayer → at_risk → flagged → compliant)');
      
      const homelessSet = new Set<string>();
      const overstayersSet = new Set<string>();
      const atRiskSet = new Set<string>();
      const flaggedSet = new Set<string>();

      // For each plate, determine status based on ALL their observations
      uniquePlates.forEach(plate => {
        const vehicle = vehicleMap.get(plate);
        if (!vehicle) return;

        // ✅ PRIORITY 1: Homeless (FC Act Exempt)
        if (vehicle.homeless_status === 'confirmed') {
          homelessSet.add(plate);
          return; // Homeless vehicles are ALWAYS exempt, don't check compliance
        }

        // ✅ PRIORITY 2: Check compliance results for overstayer/at-risk
        const plateObs = obs.filter(o => o.plate_number === plate);
        let isOverstayer = false;
        let isAtRisk = false;

        plateObs.forEach(o => {
          const comp = complianceMap.get(o.observation_id);
          if (!comp) return;

          if (!comp.is_compliant) {
            // Check if it's "at risk" or actual breach
            const reasons = comp.violation_reasons || [];
            const hasAtRisk = reasons.some((r: string) => 
              r.toLowerCase().includes('at risk') || 
              r.toLowerCase().includes('one more night')
            );

            if (hasAtRisk) {
              isAtRisk = true;
            } else {
              isOverstayer = true; // Actual breach
            }
          }
        });

        if (isOverstayer) {
          overstayersSet.add(plate);
        } else if (isAtRisk) {
          atRiskSet.add(plate);
        } else if (vehicle.is_flagged) {
          flaggedSet.add(plate);
        }
      });

      console.log('📈 Status counts:', {
        homeless: homelessSet.size,
        overstayers: overstayersSet.size,
        atRisk: atRiskSet.size,
        flagged: flaggedSet.size,
      });

      // ✅ STEP 5: Calculate compliance rate (exclude homeless - FC Act exempt)
      const nonHomelessVehicles = uniquePlates.length - homelessSet.size;
      const nonHomelessOverstayers = [...overstayersSet].filter(p => !homelessSet.has(p)).length;
      const compliantCount = nonHomelessVehicles - nonHomelessOverstayers - atRiskSet.size;
      const complianceRate = nonHomelessVehicles > 0 
        ? Math.round((compliantCount / nonHomelessVehicles) * 100) 
        : 100;

      console.log('✅ Compliance calculation:', {
        total: uniquePlates.length,
        homeless: homelessSet.size,
        nonHomeless: nonHomelessVehicles,
        compliant: compliantCount,
        rate: complianceRate,
      });

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

      // ✅ STEP 6: Build zone breakdown
      console.log('🗺️ Step 6: Build zone breakdown');
      const zoneMap = new Map<string, any>();
      
      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            zone_id: o.zone_id,
            zone_name: (o.zones as any)?.name || 'Unknown',
            observations: 0,
            plates: new Set(),
            homeless: new Set(),
            overstayers: new Set(),
            atRisk: new Set(),
            flagged: new Set(),
          });
        }

        const zone = zoneMap.get(o.zone_id);
        zone.observations++;
        zone.plates.add(o.plate_number);

        // Add vehicle to appropriate set
        if (homelessSet.has(o.plate_number)) zone.homeless.add(o.plate_number);
        else if (overstayersSet.has(o.plate_number)) zone.overstayers.add(o.plate_number);
        else if (atRiskSet.has(o.plate_number)) zone.atRisk.add(o.plate_number);
        else if (flaggedSet.has(o.plate_number)) zone.flagged.add(o.plate_number);
      });

      const zoneStats: ZoneStats[] = Array.from(zoneMap.values()).map(z => {
        const nonHomelessVehicles = z.plates.size - z.homeless.size;
        const nonHomelessOverstayers = z.overstayers.size;
        const compliant = nonHomelessVehicles - nonHomelessOverstayers - z.atRisk.size;
        
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
          compliance_rate: nonHomelessVehicles > 0 ? Math.round((compliant / nonHomelessVehicles) * 100) : 100,
        };
      }).sort((a, b) => b.observations - a.observations);

      setZones(zoneStats);

      console.log('✅ Dashboard loaded successfully');

    } catch (error: any) {
      console.error('❌ Failed to load dashboard:', error);
      toast.error('Failed to load dashboard: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const drillToZone = async (zone: ZoneStats, category: string = 'all') => {
    setIsLoading(true);
    setSelectedZone(zone);
    setSelectedCategory(category);
    
    try {
      console.log(`🔍 Drilling to zone: ${zone.zone_name}, category: ${category}`);

      // ✅ CRITICAL FIX: Get observations for this zone using NZ timezone range
      const startRange = getNZDateRange(dateFrom);
      const endRange = getNZDateRange(dateTo);
      
      console.log(`🔍 Zone drill-down: ${zone.zone_name}`);
      console.log('🕐 NZ Date Range:', dateFrom, 'to', dateTo);
      console.log('🌍 UTC Range:', startRange.start, 'to', endRange.end);
      
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select('observation_id, plate_number, recorded_at')
        .eq('zone_id', zone.zone_id)
        .gte('recorded_at', startRange.start)
        .lte('recorded_at', endRange.end);

      const { data: zoneObs, error: zoneObsError } = await obsQuery;
      if (zoneObsError) throw zoneObsError;
      
      const plateObsCount = new Map<string, number>();
      (zoneObs || []).forEach(o => {
        plateObsCount.set(o.plate_number, (plateObsCount.get(o.plate_number) || 0) + 1);
      });

      const uniquePlates = Array.from(plateObsCount.keys());

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

      // Get compliance results for these observations
      const obsIds = (zoneObs || []).map(o => o.observation_id);
      const { data: compResults } = await supabase
        .from('compliance_results')
        .select('observation_id, is_compliant, violation_reasons')
        .in('observation_id', obsIds);

      const compMap = new Map((compResults || []).map(c => [c.observation_id, c]));

      // Determine status for each vehicle
      let vehicleList: VehicleCard[] = (vehicleDetails || []).map(v => {
        const obsCount = plateObsCount.get(v.plate_number) || 0;
        
        // ✅ CORE PRINCIPLE: Priority hierarchy
        let status: VehicleCard['status'] = 'compliant';
        
        // 1. Homeless (FC Act Exempt)
        if (v.homeless_status === 'confirmed') {
          status = 'homeless';
        } else {
          // 2. Check compliance results
          const vehicleObs = (zoneObs || []).filter(o => o.plate_number === v.plate_number);
          let isOverstayer = false;
          let isAtRisk = false;

          vehicleObs.forEach(o => {
            const comp = compMap.get(o.observation_id);
            if (!comp || comp.is_compliant) return;

            const reasons = comp.violation_reasons || [];
            const hasAtRisk = reasons.some((r: string) => 
              r.toLowerCase().includes('at risk') || 
              r.toLowerCase().includes('one more night')
            );

            if (hasAtRisk) {
              isAtRisk = true;
            } else {
              isOverstayer = true;
            }
          });

          if (isOverstayer) status = 'overstayer';
          else if (isAtRisk) status = 'at_risk';
          else if (v.is_flagged) status = 'flagged';
        }

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
          last_seen: v.last_seen_at,
        };
      });

      // Filter by category
      if (category === 'homeless') vehicleList = vehicleList.filter(v => v.status === 'homeless');
      else if (category === 'overstayers') vehicleList = vehicleList.filter(v => v.status === 'overstayer');
      else if (category === 'at_risk') vehicleList = vehicleList.filter(v => v.status === 'at_risk');
      else if (category === 'flagged') vehicleList = vehicleList.filter(v => v.status === 'flagged');
      else if (category === 'compliant') vehicleList = vehicleList.filter(v => v.status === 'compliant');

      vehicleList.sort((a, b) => b.observations - a.observations);

      setVehicles(vehicleList);
      setViewLevel('zone');

    } catch (error: any) {
      console.error('Failed to drill to zone:', error);
      toast.error('Failed to load zone details: ' + error.message);
    } finally {
      setIsLoading(false);
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-primary" />
            Analytics Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Core principles architecture • NZ Timezone</p>
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
                  Previous Day
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigateDays('next')}>
                  Next Day
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
                <Input 
                  type="date" 
                  value={dateFrom || ''} 
                  onChange={(e) => {
                    const inputValue = e.target.value;
                    if (!inputValue) {
                      console.log('From date cleared');
                      setDateFrom(getNZDateString());
                      return;
                    }
                    console.log('From date changed:', inputValue);
                    setDateFrom(inputValue);
                  }}
                  max={getNZDateString()}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input 
                  type="date" 
                  value={dateTo || ''} 
                  onChange={(e) => {
                    const inputValue = e.target.value;
                    if (!inputValue) {
                      console.log('To date cleared');
                      setDateTo(getNZDateString());
                      return;
                    }
                    console.log('To date changed:', inputValue);
                    setDateTo(inputValue);
                  }}
                  min={dateFrom}
                  max={getNZDateString()}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Showing data from <strong>{dateFrom ? formatNZDateOnly(dateFrom) : 'Invalid Date'}</strong> to{' '}
                <strong>{dateTo ? formatNZDateOnly(dateTo) : 'Invalid Date'}</strong>
                {' '}(NZ Time)
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
          {viewLevel === 'overview' && stats && (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100">
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

                <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-green-100">
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
                      {stats.compliant} compliant (excludes homeless)
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-red-200 bg-gradient-to-br from-red-50 to-red-100">
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

                <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100">
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
                <Card className="border-2 border-cyan-200 bg-gradient-to-br from-cyan-50 to-cyan-100">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <Home className="h-8 w-8 text-cyan-600" />
                      <Badge className="bg-cyan-600">FC ACT EXEMPT</Badge>
                    </div>
                    <div className="text-4xl font-black text-cyan-600 mb-1">
                      {stats.homeless}
                    </div>
                    <div className="text-sm text-cyan-700">Homeless Vehicles</div>
                    <div className="text-xs text-cyan-600 mt-1">Breach but exempt</div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100">
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

                <Card className="border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100">
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
                            <div className="p-2 bg-red-50 rounded">
                              <div className="text-xs text-red-700">Overstayers</div>
                              <div className="font-bold text-red-600">{zone.overstayers}</div>
                            </div>
                            <div className="p-2 bg-amber-50 rounded">
                              <div className="text-xs text-amber-700">At Risk</div>
                              <div className="font-bold text-amber-600">{zone.at_risk}</div>
                            </div>
                            {zone.homeless > 0 && (
                              <div className="p-2 bg-cyan-50 rounded">
                                <div className="text-xs text-cyan-700">Homeless</div>
                                <div className="font-bold text-cyan-600">{zone.homeless}</div>
                              </div>
                            )}
                            {zone.flagged > 0 && (
                              <div className="p-2 bg-purple-50 rounded">
                                <div className="text-xs text-purple-700">Flagged</div>
                                <div className="font-bold text-purple-600">{zone.flagged}</div>
                              </div>
                            )}
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
              <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30">
                <CardContent className="p-6">
                  <h2 className="text-2xl font-bold mb-2">{selectedZone.zone_name}</h2>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                    <span>{selectedZone.observations} observations</span>
                    <span>{selectedZone.vehicles} vehicles</span>
                    <Badge variant={selectedZone.compliance_rate >= 80 ? 'default' : 'destructive'}>
                      {selectedZone.compliance_rate}% compliance
                    </Badge>
                  </div>
                  <div className="mt-3 pt-3 border-t border-primary/20">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span className="font-medium">Filtered by date range:</span>
                      <span className="px-2 py-0.5 bg-primary/10 rounded font-mono">
                        {formatNZDateOnly(dateFrom)}
                      </span>
                      <span>→</span>
                      <span className="px-2 py-0.5 bg-primary/10 rounded font-mono">
                        {formatNZDateOnly(dateTo)}
                      </span>
                      <span className="text-xs">(NZ)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Category Breakdown */}
              <Card className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    Filter by Category
                    <Badge variant="outline" className="ml-auto">
                      {dateFrom === dateTo ? 'Single Day' : `${Math.ceil((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24) + 1)} Days`}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'homeless' ? 'border-2 border-cyan-500 bg-cyan-50' : 'border-cyan-200 bg-cyan-50/50'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'homeless')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-cyan-600 mb-1">{selectedZone.homeless}</div>
                    <div className="text-xs text-cyan-700">Homeless</div>
                  </CardContent>
                </Card>

                <Card
                  className={`cursor-pointer hover:shadow-lg transition-all ${
                    selectedCategory === 'overstayers' ? 'border-2 border-red-500 bg-red-50' : 'border-red-200 bg-red-50/50'
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
                    selectedCategory === 'at_risk' ? 'border-2 border-amber-500 bg-amber-50' : 'border-amber-200 bg-amber-50/50'
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
                    selectedCategory === 'compliant' ? 'border-2 border-green-500 bg-green-50' : 'border-green-200 bg-green-50/50'
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
                    selectedCategory === 'flagged' ? 'border-2 border-purple-500 bg-purple-50' : 'border-purple-200 bg-purple-50/50'
                  }`}
                  onClick={() => drillToZone(selectedZone, 'flagged')}
                >
                  <CardContent className="p-4">
                    <div className="text-3xl font-bold text-purple-600 mb-1">{selectedZone.flagged}</div>
                    <div className="text-xs text-purple-700">Flagged</div>
                  </CardContent>
                </Card>
                  </div>
                </CardContent>
              </Card>

              {/* Vehicle Cards */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Car className="h-5 w-5" />
                    Vehicles ({vehicles.length})
                    {selectedCategory !== 'all' && (
                      <Badge variant="outline" className="ml-2">
                        {selectedCategory.replace('_', ' ')}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Showing vehicles observed in {selectedZone.zone_name} between{' '}
                    <strong>{formatNZDateOnly(dateFrom)}</strong> and{' '}
                    <strong>{formatNZDateOnly(dateTo)}</strong>
                    {' '}(NZ Time)
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {vehicles.map(vehicle => (
                      <Card
                        key={vehicle.plate_number}
                        className={`${getStatusColor(vehicle.status)} cursor-pointer hover:shadow-xl transition-all group`}
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
                                  <div className="text-xs">{formatNZDateOnly(vehicle.last_seen)}</div>
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
