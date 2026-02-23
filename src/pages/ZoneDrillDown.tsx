/**
 * ZoneDrillDown - Detailed zone view with observation list
 * Shows zone-specific metrics and observation table with drill-down to records
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { VehicleCard } from '@/components/features/VehicleCard';
import {
  ArrowLeft,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Flag,
  MapPin,
  Calendar,
  Loader2,
  Eye,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';

interface Observation {
  observation_id: string;
  recorded_at: string;
  plate_number: string;
  recorded_by: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  officer_notes: string | null;
  user_profiles?: {
    first_name: string;
    last_name: string;
  } | null;
  canonical_vehicles?: {
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    vehicle_color: string | null;
    total_breaches: number;
    is_flagged: boolean;
    homeless_status: string | null;
  } | null;
  compliance_results?: {
    is_compliant: boolean;
  }[] | null;
}

interface ZoneDrillDownProps {
  zoneId: string;
  zoneName: string;
  onBack: () => void;
  onObservationSelect?: (observationId: string) => void;
  dateFrom?: string;
  dateTo?: string;
}

export function ZoneDrillDown({
  zoneId,
  zoneName,
  onBack,
  onObservationSelect,
  dateFrom,
  dateTo,
}: ZoneDrillDownProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [filteredObs, setFilteredObs] = useState<Observation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompliance, setFilterCompliance] = useState<'all' | 'compliant' | 'non-compliant'>('all');
  const [filterFlagged, setFilterFlagged] = useState(false);

  // Stats
  const totalObs = observations.length;
  const uniqueVehicles = new Set(observations.map(o => o.plate_number)).size;
  const compliantCount = observations.filter(o => {
    const complianceResults = o.compliance_results;
    if (!complianceResults || complianceResults.length === 0) return false;
    return complianceResults[0].is_compliant === true;
  }).length;
  const complianceRate = totalObs > 0 ? Math.round((compliantCount / totalObs) * 100) : 0;
  const flaggedCount = new Set(
    observations
      .filter(o => o.canonical_vehicles?.is_flagged === true)
      .map(o => o.plate_number)
  ).size;

  useEffect(() => {
    loadObservations();
  }, [zoneId, dateFrom, dateTo]);

  useEffect(() => {
    applyFilters();
  }, [observations, searchQuery, filterCompliance, filterFlagged]);

  const loadObservations = async () => {
    setIsLoading(true);
    try {
      console.log('🔍 Loading observations for zone:', zoneId);
      
      let query = supabase
        .from('observations')
        .select(`
          id as observation_id,
          recorded_at,
          plate_number,
          recorded_by,
          gps_latitude,
          gps_longitude,
          officer_notes,
          user_profiles(
            first_name,
            last_name
          ),
          canonical_vehicles(
            vehicle_make,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            total_breaches,
            is_flagged,
            homeless_status
          ),
          compliance_results!compliance_results_observation_id_fkey(
            is_compliant
          )
        `)
        .eq('zone_id', zoneId);

      // Apply date filters if provided
      if (dateFrom) {
        query = query.gte('recorded_at', `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        query = query.lte('recorded_at', `${dateTo}T23:59:59`);
      }

      const { data, error } = await query
        .order('recorded_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      
      console.log(`✅ Loaded ${data?.length || 0} observations for zone ${zoneId}`);
      setObservations(data || []);
    } catch (error: any) {
      console.error('❌ Failed to load observations:', error);
      toast.error('Failed to load observations');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...observations];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        o =>
          o.plate_number?.toLowerCase().includes(query) ||
          o.canonical_vehicles?.vehicle_make?.toLowerCase().includes(query) ||
          o.canonical_vehicles?.vehicle_model?.toLowerCase().includes(query)
      );
    }

    // Compliance filter
    if (filterCompliance === 'compliant') {
      filtered = filtered.filter(o => {
        const complianceResults = o.compliance_results;
        return complianceResults && complianceResults.length > 0 && complianceResults[0].is_compliant === true;
      });
    } else if (filterCompliance === 'non-compliant') {
      filtered = filtered.filter(o => {
        const complianceResults = o.compliance_results;
        return complianceResults && complianceResults.length > 0 && complianceResults[0].is_compliant === false;
      });
    }

    // Flagged filter
    if (filterFlagged) {
      filtered = filtered.filter(o => o.canonical_vehicles?.is_flagged === true);
    }

    setFilteredObs(filtered);
  };

  return (
    <ResponsiveContainer maxWidth="7xl" padding="md">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-2">
            <Button variant="outline" onClick={onBack} size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <MapPin className="h-6 w-6 md:h-8 md:w-8 text-primary" />
                {zoneName}
              </h1>
              <p className="text-sm md:text-base text-muted-foreground">Zone records and observations</p>
              {dateFrom && dateTo && (
                <Badge variant="outline" className="mt-1 text-xs">
                  <Calendar className="h-3 w-3 mr-1" />
                  {format(new Date(dateFrom), 'dd MMM')} - {format(new Date(dateTo), 'dd MMM yyyy')}
                </Badge>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadObservations} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Refresh
          </Button>
        </div>

        {/* Zone Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Total Observations</div>
              <div className="text-2xl md:text-3xl font-black">{totalObs.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Unique Vehicles</div>
              <div className="text-2xl md:text-3xl font-black">{uniqueVehicles.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Compliance Rate</div>
              <div className="text-2xl md:text-3xl font-black text-green-600">{complianceRate}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 md:p-6">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Flagged Vehicles</div>
              <div className="text-2xl md:text-3xl font-black text-red-600">{flaggedCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-3 md:p-4">
            <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search plate, make, model..."
                    className="pl-9 text-sm"
                  />
                </div>
              </div>

              {/* Compliance Filter */}
              <div className="flex gap-1.5 md:gap-2 flex-wrap">
                <Button
                  variant={filterCompliance === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterCompliance('all')}
                  className="flex-1 sm:flex-none text-xs md:text-sm"
                >
                  <Filter className="h-3 w-3 mr-1" />
                  All
                </Button>
                <Button
                  variant={filterCompliance === 'compliant' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterCompliance('compliant')}
                  className="flex-1 sm:flex-none text-xs md:text-sm"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  <span className="hidden sm:inline">Compliant</span>
                  <span className="sm:hidden">✓</span>
                </Button>
                <Button
                  variant={filterCompliance === 'non-compliant' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterCompliance('non-compliant')}
                  className="flex-1 sm:flex-none text-xs md:text-sm"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  <span className="hidden sm:inline">Non-Compliant</span>
                  <span className="sm:hidden">✗</span>
                </Button>
                <Button
                  variant={filterFlagged ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setFilterFlagged(!filterFlagged)}
                  className="flex-1 sm:flex-none text-xs md:text-sm"
                >
                  <Flag className="h-3 w-3 mr-1" />
                  <span className="hidden sm:inline">Flagged</span>
                  <span className="sm:hidden">⚑</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Observations List */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="text-base md:text-lg">
              Observations ({filteredObs.length.toLocaleString()})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredObs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm md:text-base">No observations found</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {filteredObs.map(obs => {
                  const isCompliant = obs.compliance_results && obs.compliance_results.length > 0 
                    ? obs.compliance_results[0].is_compliant 
                    : null;
                  const isBreach = isCompliant === false;
                  const isFlagged = obs.canonical_vehicles?.is_flagged === true;
                  const isHomeless = obs.canonical_vehicles?.homeless_status === 'confirmed' || 
                    obs.canonical_vehicles?.homeless_status === 'claimed';

                  return (
                    <div
                      key={obs.observation_id}
                      className="p-3 md:p-4 border rounded-lg hover:border-primary hover:shadow-md transition-all"
                    >
                      {/* Vehicle Card with Photo */}
                      <div className="mb-3">
                        <VehicleCard
                          plateNumber={obs.plate_number || 'Unknown'}
                          vehicleMake={obs.canonical_vehicles?.vehicle_make}
                          vehicleModel={obs.canonical_vehicles?.vehicle_model}
                          vehicleYear={obs.canonical_vehicles?.vehicle_year}
                          vehicleColor={obs.canonical_vehicles?.vehicle_color}
                          isFlagged={isFlagged}
                          isHomeless={isHomeless}
                          isBreach={isBreach}
                          size="md"
                          showPhoto={true}
                          showDetails={true}
                        />
                      </div>

                      {/* Compliance Badge */}
                      <div className="flex items-center gap-2 mb-2">
                        {isCompliant !== null ? (
                          <Badge variant={isCompliant ? 'default' : 'destructive'} className="text-xs">
                            {isCompliant ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Compliant
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Non-Compliant
                              </>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">No Data</Badge>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground mb-2">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {format(new Date(obs.recorded_at), 'dd MMM yyyy HH:mm')}
                          </span>
                        </div>
                        {obs.user_profiles && (
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {obs.user_profiles.first_name} {obs.user_profiles.last_name}
                            </span>
                          </div>
                        )}
                        {obs.gps_latitude && obs.gps_longitude && (
                          <div className="flex items-center gap-1.5 col-span-full sm:col-span-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate font-mono text-[10px]">
                              {obs.gps_latitude.toFixed(5)}, {obs.gps_longitude.toFixed(5)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Officer Notes */}
                      {obs.officer_notes && (
                        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                          {obs.officer_notes}
                        </p>
                      )}

                      {/* Actions */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onObservationSelect?.(obs.observation_id)}
                        className="w-full sm:w-auto text-xs"
                      >
                        <Eye className="h-3 w-3 mr-1.5" />
                        View Details
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
