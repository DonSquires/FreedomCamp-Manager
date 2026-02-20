
/**
 * Observations Report
 * Comprehensive report of all vehicle observations with enriched data
 * Supports KPI drill-down filters from BI Dashboard
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query'; // Fixed: Corrected the import path for useQuery
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Download, Calendar, MapPin, FileText, X, Archive } from 'lucide-react';
import historicalPlaceholder from '@/assets/historical-record-placeholder.jpg';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useZones } from '@/hooks/useZones';
import { ZoneRequirementsChecklist } from '@/components/features/ZoneRequirementsChecklist';
import { ComplianceMetricsSummary } from '@/components/features/ComplianceMetricsSummary';

interface ComplianceSummary {
  status: 'compliant' | 'at_risk' | 'breach' | 'breach_homeless_exempt';
  explanation: string;
  metrics: {
    nights_per_month_allowed: number;
    nights_stayed_this_month: number;
    max_consecutive_nights_allowed: number;
    consecutive_nights_stayed: number;
    self_contained_required: boolean;
    is_self_contained: boolean;
    self_contained_expiry: string | null;
    self_contained_expired: boolean;
  };
  flags: {
    exceeds_monthly_limit: boolean;
    exceeds_consecutive_limit: boolean;
    sc_required_but_missing: boolean;
    sc_expired: boolean;
    is_homeless_exempt: boolean;
    homeless_status: string;
  };
  calculated_at: string;
  zone_name: string;
}

interface ObservationRecord {
  observation_id: string;
  plate_number: string;
  photo_url: string | null;
  is_historical: boolean;
  recorded_at: string;
  zone_id: string;
  zone_name: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  weather_conditions?: string;
  is_compliant: boolean;
  breach_type: string | null;
  breach_details: any;
  officer_notes: string | null;
  officer_name: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  homeless_status: string;
  organization_id: string;
  organization_name: string;
  compliance_summary: ComplianceSummary | null;
}

export default function ObservationsReport() {
  const { user } = useAuthStore();
  const { organizations } = useOrganizations();
  
  // Check URL parameters for BI dashboard drill-down
  const urlParams = new URLSearchParams(window.location.search);
  const urlDateFrom = urlParams.get('dateFrom');
  const urlDateTo = urlParams.get('dateTo');
  const urlOrgId = urlParams.get('orgId');
  const urlFilterType = urlParams.get('filterType');
  
  // Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>(urlOrgId || '');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(
    urlDateFrom || format(new Date(new Date().setDate(new Date().getDate() - 7)), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState<string>(urlDateTo || format(new Date(), 'yyyy-MM-dd'));
  const [kpiFilter, setKpiFilter] = useState<string | null>(urlFilterType || null);
  const [overstayerPlates, setOverstayerPlates] = useState<Set<string>>(new Set());
  const [atRiskPlates, setAtRiskPlates] = useState<Set<string>>(new Set());
  const [homelessExemptObs, setHomelessExemptObs] = useState<Set<string>>(new Set());

  const { zones } = useZones(selectedOrgId || undefined);

  // Clear URL params after applying them (but keep tab param)
  useEffect(() => {
    if (urlDateFrom || urlDateTo || urlOrgId || urlFilterType) {
      window.history.replaceState({}, '', window.location.pathname + '?tab=observations-report');
    }
  }, []);

  // Load overstayer/at-risk plates when KPI filter is active
  useEffect(() => {
    if (kpiFilter === 'overstayers' || kpiFilter === 'at-risk') {
      loadOverstayerData();
    }
  }, [kpiFilter, startDate, endDate, selectedOrgId]);

  // Load homeless exempt observations when KPI filter is active
  useEffect(() => {
    if (kpiFilter === 'homeless_exempt') {
      loadHomelessExemptData();
    }
  }, [kpiFilter, startDate, endDate, selectedOrgId]);

  const loadHomelessExemptData = async () => {
    try {
      const { data, error } = await supabase.rpc('observations_homeless_exempt', {
        p_from: `${startDate}T00:00:00`,
        p_to: `${endDate}T23:59:59`,
        p_org_id: selectedOrgId || null,
        p_zone_id: selectedZoneId || null,
      });

      if (error) throw error;

      const obsIds = new Set((data || []).map((d: any) => d.observation_id));
      setHomelessExemptObs(obsIds);
    } catch (error: any) {
      console.error('Failed to load homeless exempt data:', error);
    }
  };

  const loadOverstayerData = async () => {
    try {
      // Query monthly stays to identify overstayers/at-risk
      const fromMonth = startDate.slice(0, 7) + '-01';
      const toMonth = endDate.slice(0, 7) + '-01';

      let staysQuery = supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, zone_id, consecutive_nights, nights_stayed')
        .gte('calendar_month', fromMonth)
        .lte('calendar_month', toMonth);

      if (selectedOrgId) {
        staysQuery = staysQuery.eq('organization_id', selectedOrgId);
      }

      const { data: stays } = await staysQuery;

      // Get compliance matrix rules
      let matrixQuery = supabase
        .from('zone_compliance_matrix')
        .select('zone_id, max_consecutive_nights, nights_per_month')
        .is('effective_to', null);

      if (selectedOrgId) {
        matrixQuery = matrixQuery.eq('organization_id', selectedOrgId);
      }

      const { data: matrices } = await matrixQuery;
      const matrixMap = new Map(matrices?.map(m => [m.zone_id, m]) || []);

      const overstayers = new Set<string>();
      const atRisk = new Set<string>();

      (stays || []).forEach(stay => {
        const rules = matrixMap.get(stay.zone_id);
        if (!rules) return;

        if (stay.consecutive_nights > rules.max_consecutive_nights || stay.nights_stayed > rules.nights_per_month) {
          overstayers.add(stay.plate_number);
        } else if (stay.consecutive_nights === rules.max_consecutive_nights || stay.nights_stayed === rules.nights_per_month) {
          atRisk.add(stay.plate_number);
        }
      });

      setOverstayerPlates(overstayers);
      setAtRiskPlates(atRisk);

    } catch (error: any) {
      console.error('Failed to load overstayer data:', error);
    }
  };

  // Query observations
  const { data: observations, isLoading } = useQuery({
    queryKey: ['observations-report', selectedOrgId, selectedZoneId, startDate, endDate, kpiFilter, overstayerPlates.size, atRiskPlates.size],
    queryFn: async () => {
      let query = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          photo_hash,
          recorded_at,
          zone_id,
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          is_compliant,
          breach_type,
          breach_details,
          officer_notes,
          organization_id,
          compliance_summary,
          zone:zones(name, location_lat, location_lng),
          officer:user_profiles!vehicle_observations_v2_recorded_by_fkey(first_name, last_name),
          organization:organizations(name),
          weather_conditions,
          canonical:canonical_vehicles!vehicle_observations_v2_plate_number_fkey(
            vehicle_make,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            self_contained,
            self_contained_expiry,
            homeless_status
          ),
          photo_metadata:photo_metadata!photo_metadata_observation_id_fkey(
            photo_url
          )
        `)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (selectedOrgId) {
        query = query.eq('organization_id', selectedOrgId);
      }

      if (selectedZoneId) {
        query = query.eq('zone_id', selectedZoneId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform data with fallbacks for legacy records
      let results = (data || []).map((obs: any) => ({
        observation_id: obs.observation_id,
        plate_number: obs.plate_number,
        photo_url: obs.photo_metadata?.[0]?.photo_url || null,
        is_historical: !obs.photo_metadata?.[0]?.photo_url,
        recorded_at: obs.recorded_at,
        zone_id: obs.zone_id,
        zone_name: obs.zone?.name || 'Unknown',
        // Use observation GPS if available, otherwise fallback to zone GPS
        gps_latitude: obs.gps_latitude || obs.zone?.location_lat || null,
        gps_longitude: obs.gps_longitude || obs.zone?.location_lng || null,
        gps_accuracy: obs.gps_accuracy,
        weather_conditions: obs.weather_conditions,
        is_compliant: obs.is_compliant,
        breach_type: obs.breach_type,
        breach_details: obs.breach_details,
        officer_notes: obs.officer_notes,
        officer_name: obs.officer ? `${obs.officer.first_name} ${obs.officer.last_name}` : 'Unknown',
        vehicle_make: obs.canonical?.vehicle_make || null,
        vehicle_model: obs.canonical?.vehicle_model || null,
        vehicle_year: obs.canonical?.vehicle_year || null,
        vehicle_color: obs.canonical?.vehicle_color || null,
        self_contained: obs.canonical?.self_contained || false,
        self_contained_expiry: obs.canonical?.self_contained_expiry || null,
        homeless_status: obs.canonical?.homeless_status || 'none',
        organization_id: obs.organization_id,
        organization_name: obs.organization?.name || 'Unknown',
        compliance_summary: obs.compliance_summary,
      }));

      // Apply KPI filter if active
      if (kpiFilter === 'overstayers') {
        results = results.filter(obs => overstayerPlates.has(obs.plate_number));
      } else if (kpiFilter === 'at-risk') {
        results = results.filter(obs => atRiskPlates.has(obs.plate_number));
      } else if (kpiFilter === 'breaches') {
        results = results.filter(obs => !obs.is_compliant && obs.breach_type);
      } else if (kpiFilter === 'compliant') {
        results = results.filter(obs => obs.is_compliant);
      } else if (kpiFilter === 'homeless_exempt') {
        results = results.filter(obs => homelessExemptObs.has(obs.observation_id));
      }

      return results as ObservationRecord[];
    },
  });

  const exportToCSV = () => {
    if (!observations || observations.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = [
      'Observation ID',
      'Plate Number',
      'Date',
      'Time (24hr)',
      'Zone',
      'Officer',
      'Make',
      'Model',
      'Year',
      'Color',
      'GPS Latitude',
      'GPS Longitude',
      'GPS Accuracy (m)',
      'Self-Contained',
      'SC Expiry',
      'Homeless Status',
      'Breach Status',
      'Breach Type',
      'Breach Reason',
      'Officer Notes',
      'Organization',
    ];

    const rows = observations.map(obs => [
      obs.observation_id,
      obs.plate_number,
      format(new Date(obs.recorded_at), 'dd/MM/yyyy'),
      format(new Date(obs.recorded_at), 'HH:mm'),
      obs.zone_name,
      obs.officer_name,
      obs.vehicle_make || '',
      obs.vehicle_model || '',
      obs.vehicle_year || '',
      obs.vehicle_color || '',
      obs.gps_latitude?.toFixed(6) || '',
      obs.gps_longitude?.toFixed(6) || '',
      obs.gps_accuracy?.toFixed(1) || '',
      obs.self_contained ? 'Yes' : 'No',
      obs.self_contained_expiry ? format(new Date(obs.self_contained_expiry), 'dd/MM/yyyy') : '',
      obs.homeless_status === 'confirmed' ? 'Confirmed' : obs.homeless_status === 'claimed' ? 'Claimed' : 'None',
      obs.is_compliant ? 'Compliant' : 'Breach',
      obs.breach_type || '',
      obs.breach_details?.violation_summary || '',
      obs.officer_notes || '',
      obs.organization_name,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `observations-report-${kpiFilter ? `${kpiFilter}-` : ''}${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    link.click();

    toast.success('Report exported to CSV');
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Observations Report</h1>
            <p className="text-muted-foreground mt-1">
              Detailed observation records with enriched vehicle data
              {kpiFilter && ` • Filtered: ${kpiFilter}`}
            </p>
          </div>
          <Button onClick={exportToCSV} disabled={!observations || observations.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Organization */}
              {user?.role === 'master' && (
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Select value={selectedOrgId || 'all'} onValueChange={(val) => setSelectedOrgId(val === 'all' ? '' : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Organizations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {organizations?.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Zone */}
              <div className="space-y-2">
                <Label>Zone</Label>
                <Select value={selectedZoneId || 'all'} onValueChange={(val) => setSelectedZoneId(val === 'all' ? '' : val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Zones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Zones</SelectItem>
                    {zones?.map(zone => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Start Date */}
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              {/* End Date */}
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            
            {/* KPI Filter Chip */}
            {kpiFilter && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-500 dark:border-blue-700 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-blue-900 dark:text-blue-100">
                    📊 KPI Filter:
                  </span>
                  <Badge variant="default" className="bg-blue-600">
                    {kpiFilter === 'overstayers' ? `Overstayers (${observations?.length || 0})` : 
                     kpiFilter === 'at-risk' ? `At-Risk (${observations?.length || 0})` :
                     kpiFilter === 'breaches' ? `Breaches (${observations?.length || 0})` :
                     kpiFilter === 'compliant' ? `Compliant (${observations?.length || 0})` :
                     kpiFilter === 'homeless_exempt' ? `Homeless Exempt (${observations?.length || 0})` :
                     'Active'}
                  </Badge>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setKpiFilter(null)}
                  className="text-blue-700 hover:text-blue-900 dark:text-blue-200 dark:hover:text-blue-100"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear Filter
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Summary */}
        {observations && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-lg font-semibold">
                    {observations.length} Observation{observations.length !== 1 ? 's' : ''}
                    {kpiFilter && ` (${kpiFilter})`}
                  </span>
                </div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Compliant: </span>
                    <span className="font-semibold text-green-600">
                      {observations.filter(o => o.is_compliant).length}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Breaches: </span>
                    <span className="font-semibold text-red-600">
                      {observations.filter(o => !o.is_compliant).length}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Observations List */}
        {isLoading ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Loading observations...</p>
              </div>
            </CardContent>
          </Card>
        ) : !observations || observations.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No observations found for selected filters</p>
                {kpiFilter && (
                  <p className="text-sm mt-2">
                    Try clearing the KPI filter to see all observations
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {observations.map((obs) => (
              <Card key={obs.observation_id} className="overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  {/* Photo with Watermark Overlay or Historical Placeholder */}
                  <div className="md:w-48 h-48 md:h-auto bg-muted flex-shrink-0 relative">
                    {obs.is_historical ? (
                      <>
                        <img
                          src={historicalPlaceholder}
                          alt="Historical Record - No Photo"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <div className="text-center text-white p-4">
                            <Archive className="h-8 w-8 mx-auto mb-2" />
                            <div className="text-xs font-semibold">HISTORICAL RECORD</div>
                            <div className="text-[10px]">Photo Not Available</div>
                          </div>
                        </div>
                      </>
                    ) : obs.photo_url ? (
                      <img
                        src={obs.photo_url}
                        alt={obs.plate_number}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-800">
                        <div className="text-center text-gray-500">
                          <Archive className="h-8 w-8 mx-auto mb-2" />
                          <div className="text-xs">No Photo</div>
                        </div>
                      </div>
                    )}
                    {/* Watermark Overlay (only for non-historical photos) */}
                    {!obs.is_historical && obs.photo_url && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] leading-tight p-2 font-mono">
                        <div className="font-bold">
                          GPS: {obs.gps_latitude?.toFixed(6)}, {obs.gps_longitude?.toFixed(6)} (±{obs.gps_accuracy?.toFixed(0)}m)
                          {obs.weather_conditions && ` | ${obs.weather_conditions}`}
                        </div>
                        <div>
                          {format(new Date(obs.recorded_at), 'dd MMM yyyy, HH:mm:ss')} NZDT
                        </div>
                        <div>
                          Officer: {obs.officer_name} | {obs.zone_name}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[8px]">{obs.organization_name}</span>
                          <div 
                            className="w-2 h-2 rounded-full" 
                            style={{
                              backgroundColor: obs.gps_accuracy && obs.gps_accuracy <= 10 ? '#00FF00' : 
                                             obs.gps_accuracy && obs.gps_accuracy <= 30 ? '#FFFF00' : 
                                             obs.gps_accuracy && obs.gps_accuracy <= 50 ? '#FFA500' : '#FF0000'
                            }}
                            title={`GPS Accuracy: ${obs.gps_accuracy?.toFixed(0)}m`}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-xl font-mono font-bold">{obs.plate_number}</h3>
                          {!obs.is_compliant && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200">BREACH</span>
                          )}
                          {obs.homeless_status === 'confirmed' && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">HOMELESS</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {obs.vehicle_make} {obs.vehicle_model} {obs.vehicle_year} • {obs.vehicle_color}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {format(new Date(obs.recorded_at), 'dd/MM/yyyy')}
                        </div>
                        <div className="text-muted-foreground">
                          {format(new Date(obs.recorded_at), 'HH:mm')}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
                      {/* Location */}
                      <div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                          <MapPin className="h-3 w-3" />
                          <span>LOCATION</span>
                        </div>
                        <div className="font-semibold">{obs.zone_name}</div>
                        {obs.gps_latitude && obs.gps_longitude && (
                          <div className="text-xs text-muted-foreground">
                            {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                            {obs.gps_accuracy && ` (±${obs.gps_accuracy.toFixed(0)}m)`}
                            {obs.is_historical && !obs.gps_accuracy && (
                              <span className="ml-1 text-amber-600">(Zone Center)</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Officer */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">OFFICER</div>
                        <div className="font-semibold">{obs.officer_name}</div>
                        <div className="text-xs text-muted-foreground">{obs.organization_name}</div>
                      </div>

                      {/* Self-Contained */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">SELF-CONTAINED</div>
                        <div className="font-semibold">
                          {obs.self_contained ? 'Yes' : 'No'}
                        </div>
                        {obs.self_contained_expiry && (
                          <div className="text-xs text-muted-foreground">
                            Expiry: {format(new Date(obs.self_contained_expiry), 'dd/MM/yyyy')}
                          </div>
                        )}
                      </div>

                      {/* Weather Conditions */}
                      {obs.weather_conditions && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">WEATHER</div>
                          <div className="font-semibold text-sm">{obs.weather_conditions}</div>
                        </div>
                      )}
                    </div>

                    {/* Breach Details */}
                    {!obs.is_compliant && obs.breach_details && (
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md p-3 mb-3">
                        <div className="text-xs font-semibold text-red-900 dark:text-red-100 mb-1">
                          BREACH: {obs.breach_type}
                        </div>
                        <div className="text-sm text-red-800 dark:text-red-200">
                          {obs.breach_details.violation_summary || 'No details provided'}
                        </div>
                      </div>
                    )}

                    {/* Officer Notes */}
                    {obs.officer_notes && (
                      <div className="bg-muted rounded-md p-3 mb-3">
                        <div className="text-xs text-muted-foreground mb-1">OFFICER NOTES</div>
                        <div className="text-sm">{obs.officer_notes}</div>
                      </div>
                    )}

                    {/* Pre-Calculated Compliance Summary */}
                    {obs.compliance_summary && (
                      <div className="mt-4 space-y-3">
                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                          <Badge className={{
                            compliant: 'bg-emerald-600 text-white',
                            at_risk: 'bg-amber-500 text-white',
                            breach: 'bg-red-600 text-white',
                            breach_homeless_exempt: 'bg-violet-600 text-white',
                          }[obs.compliance_summary.status]}>
                            {{
                              compliant: '✓ COMPLIANT',
                              at_risk: '⚠ AT RISK',
                              breach: '✗ BREACH',
                              breach_homeless_exempt: '⚠ BREACH (HOMELESS EXEMPT)',
                            }[obs.compliance_summary.status]}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Calculated: {format(new Date(obs.compliance_summary.calculated_at), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>

                        {/* Compliance Explanation */}
                        <div className={`p-3 rounded-lg border-l-4 ${
                          obs.compliance_summary.status === 'compliant' ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500' :
                          obs.compliance_summary.status === 'at_risk' ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-500' :
                          obs.compliance_summary.status === 'breach_homeless_exempt' ? 'bg-violet-50 dark:bg-violet-950/20 border-violet-500' :
                          'bg-red-50 dark:bg-red-950/20 border-red-500'
                        }`}>
                          <div className="text-sm font-semibold mb-1">Compliance Assessment</div>
                          <div className="text-sm leading-relaxed">
                            {obs.compliance_summary.explanation}
                          </div>
                        </div>

                        {/* Compliance Metrics Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div className="p-2 bg-muted rounded">
                            <div className="text-muted-foreground mb-1">Monthly</div>
                            <div className={`font-bold ${
                              obs.compliance_summary.flags.exceeds_monthly_limit ? 'text-red-600' :
                              obs.compliance_summary.metrics.nights_stayed_this_month === obs.compliance_summary.metrics.nights_per_month_allowed ? 'text-amber-500' :
                              'text-emerald-600'
                            }`}>
                              {obs.compliance_summary.metrics.nights_stayed_this_month} / {obs.compliance_summary.metrics.nights_per_month_allowed} nights
                            </div>
                          </div>
                          <div className="p-2 bg-muted rounded">
                            <div className="text-muted-foreground mb-1">Consecutive</div>
                            <div className={`font-bold ${
                              obs.compliance_summary.flags.exceeds_consecutive_limit ? 'text-red-600' :
                              obs.compliance_summary.metrics.consecutive_nights_stayed === obs.compliance_summary.metrics.max_consecutive_nights_allowed ? 'text-amber-500' :
                              'text-emerald-600'
                            }`}>
                              {obs.compliance_summary.metrics.consecutive_nights_stayed} / {obs.compliance_summary.metrics.max_consecutive_nights_allowed} nights
                            </div>
                          </div>
                          <div className="p-2 bg-muted rounded">
                            <div className="text-muted-foreground mb-1">Self-Contained</div>
                            <div className={`font-bold ${
                              obs.compliance_summary.flags.sc_required_but_missing || obs.compliance_summary.flags.sc_expired ? 'text-red-600' :
                              obs.compliance_summary.metrics.is_self_contained ? 'text-emerald-600' :
                              'text-gray-500'
                            }`}>
                              {obs.compliance_summary.metrics.self_contained_required ? (
                                obs.compliance_summary.metrics.is_self_contained ? (
                                  obs.compliance_summary.flags.sc_expired ? '✗ EXPIRED' : '✓ Valid'
                                ) : '✗ Missing'
                              ) : 'Not Required'}
                            </div>
                          </div>
                          <div className="p-2 bg-muted rounded">
                            <div className="text-muted-foreground mb-1">Homeless</div>
                            <div className={`font-bold ${
                              obs.compliance_summary.flags.is_homeless_exempt ? 'text-violet-600' : 'text-gray-500'
                            }`}>
                              {obs.compliance_summary.flags.is_homeless_exempt ? '✓ Exempt' : 'None'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Fallback to Zone Requirements Checklist if no compliance summary */}
                    {!obs.compliance_summary && (
                      <ZoneRequirementsChecklist observationId={obs.observation_id} compact />
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
