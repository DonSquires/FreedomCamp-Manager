/**
 * ZoneDrillDown - Detailed zone view with observation list
 * Shows zone-specific metrics and observation table with drill-down to records
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

// ✅ CLEAN ARCHITECTURE: Use compatibility view for joined data
interface Observation {
  observation_id: string;
  recorded_at: string;
  plate_number: string;
  vehicle_make: string | null; // From canonical_vehicles via view
  vehicle_model: string | null; // From canonical_vehicles via view
  vehicle_color: string | null; // From canonical_vehicles via view
  is_compliant: boolean; // From compliance_results via view
  recorded_by: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  officer_notes: string | null;
  user_profiles?: {
    first_name: string;
    last_name: string;
  };
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
  const compliantCount = observations.filter(o => o.is_compliant).length;
  const complianceRate = totalObs > 0 ? Math.round((compliantCount / totalObs) * 100) : 0;
  const flaggedCount = 0; // Flagged status is in canonical_vehicles, not available here

  useEffect(() => {
    loadObservations();
  }, [zoneId, dateFrom, dateTo]);

  useEffect(() => {
    applyFilters();
  }, [observations, searchQuery, filterCompliance, filterFlagged]);

  const loadObservations = async () => {
    setIsLoading(true);
    try {
      // ✅ CLEAN ARCHITECTURE: Use compatibility view for complete data
      let query = supabase
        .from('vehicle_observations_with_details')
        .select(`
          observation_id,
          recorded_at,
          plate_number,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          is_compliant,
          recorded_by,
          gps_latitude,
          gps_longitude,
          officer_notes
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
      
      // ✅ Note: User info not in view, would need separate join if required
      setObservations(data || []);
    } catch (error: any) {
      console.error('Failed to load observations:', error);
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
          o.vehicle_make?.toLowerCase().includes(query) ||
          o.vehicle_model?.toLowerCase().includes(query)
      );
    }

    // Compliance filter
    if (filterCompliance === 'compliant') {
      filtered = filtered.filter(o => o.is_compliant);
    } else if (filterCompliance === 'non-compliant') {
      filtered = filtered.filter(o => !o.is_compliant);
    }

    // Flagged filter - Note: Flagged status is not available in observations_v2
    // Would need to join with canonical_vehicles to support this filter
    // if (filterFlagged) {
    //   filtered = filtered.filter(o => o.is_flagged);
    // }

    setFilteredObs(filtered);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <MapPin className="h-8 w-8 text-primary" />
              {zoneName}
            </h1>
            <p className="text-muted-foreground">Zone records and observations</p>
            {dateFrom && dateTo && (
              <Badge variant="outline" className="mt-1">
                <Calendar className="h-3 w-3 mr-1" />
                {new Date(dateFrom).toLocaleDateString('en-NZ')} - {new Date(dateTo).toLocaleDateString('en-NZ')}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={loadObservations} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {/* Zone Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-1">Total Observations</div>
            <div className="text-3xl font-black">{totalObs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-1">Unique Vehicles</div>
            <div className="text-3xl font-black">{uniqueVehicles}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-1">Compliance Rate</div>
            <div className="text-3xl font-black">{complianceRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-1">Flagged Vehicles</div>
            <div className="text-3xl font-black text-red-600">{flaggedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search plate number, make, model..."
                  className="pl-9"
                />
              </div>
            </div>

            {/* Compliance Filter */}
            <div className="flex gap-2">
              <Button
                variant={filterCompliance === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterCompliance('all')}
              >
                <Filter className="h-3 w-3 mr-1" />
                All
              </Button>
              <Button
                variant={filterCompliance === 'compliant' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterCompliance('compliant')}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Compliant
              </Button>
              <Button
                variant={filterCompliance === 'non-compliant' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterCompliance('non-compliant')}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Non-Compliant
              </Button>
            </div>

            {/* Flagged Filter */}
            <Button
              variant={filterFlagged ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setFilterFlagged(!filterFlagged)}
            >
              <Flag className="h-3 w-3 mr-1" />
              Flagged Only
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Observations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Observations ({filteredObs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredObs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No observations found</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredObs.map(obs => (
                <div
                  key={obs.observation_id}
                  className="p-4 border rounded-lg hover:border-primary transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-mono font-bold">
                          {obs.plate_number || 'Unknown'}
                        </span>
                      </div>
                      {(obs.vehicle_make || obs.vehicle_model) && (
                        <p className="text-xs text-muted-foreground">
                          {obs.vehicle_color && `${obs.vehicle_color} `}
                          {obs.vehicle_make} {obs.vehicle_model}
                        </p>
                      )}
                    </div>
                    <Badge variant={obs.is_compliant ? 'default' : 'destructive'}>
                      {obs.is_compliant ? (
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
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(obs.recorded_at).toLocaleString('en-NZ', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Pacific/Auckland',
                      })}
                    </div>
                    {obs.user_profiles && (
                      <div>
                        By: {obs.user_profiles.first_name} {obs.user_profiles.last_name}
                      </div>
                    )}
                    {obs.gps_latitude && obs.gps_longitude && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        GPS: {obs.gps_latitude.toFixed(5)}, {obs.gps_longitude.toFixed(5)}
                      </div>
                    )}
                  </div>

                  {obs.officer_notes && (
                    <p className="text-xs text-muted-foreground mb-2">{obs.officer_notes}</p>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onObservationSelect?.(obs.observation_id)}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    View Details
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
