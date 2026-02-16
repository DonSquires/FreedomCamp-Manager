/**
 * Observations Report
 * Comprehensive report of all vehicle observations with enriched data
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
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
import { Loader2, Download, Calendar, MapPin, Camera, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useZones } from '@/hooks/useZones';

interface ObservationRecord {
  observation_id: string;
  plate_number: string;
  // Photo
  photo: string | null;
  // Date/Time
  recorded_at: string;
  // Zone
  zone_id: string;
  zone_name: string;
  // GPS
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  // Weather
  weather_conditions?: string;
  // Compliance
  is_compliant: boolean;
  breach_type: string | null;
  breach_details: any;
  // Notes
  officer_notes: string | null;
  // Officer
  officer_name: string;
  // Enriched from canonical_vehicles
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  homeless_status: string;
  // Organization
  organization_id: string;
  organization_name: string;
}

export default function ObservationsReport() {
  const { user } = useAuthStore();
  const { organizations } = useOrganizations();
  
  // Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(
    format(new Date(new Date().setDate(new Date().getDate() - 7)), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  const { zones } = useZones(selectedOrgId || undefined);

  // Query observations
  const { data: observations, isLoading } = useQuery({
    queryKey: ['observations-report', selectedOrgId, selectedZoneId, startDate, endDate],
    queryFn: async () => {
      let query = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          photo,
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
          zone:zones(name),
          officer:user_profiles!vehicle_observations_v2_recorded_by_fkey(first_name, last_name),
          organization:organizations(name),
          canonical:canonical_vehicles!vehicle_observations_v2_plate_number_fkey(
            vehicle_make,
            vehicle_model,
            vehicle_year,
            vehicle_color,
            self_contained,
            self_contained_expiry,
            homeless_status
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

      // Transform data
      return (data || []).map((obs: any) => ({
        observation_id: obs.observation_id,
        plate_number: obs.plate_number,
        photo: obs.photo,
        recorded_at: obs.recorded_at,
        zone_id: obs.zone_id,
        zone_name: obs.zone?.name || 'Unknown',
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
        gps_accuracy: obs.gps_accuracy,
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
      })) as ObservationRecord[];
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
    link.download = `observations-report-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
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
                  <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Organizations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Organizations</SelectItem>
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
                <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Zones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Zones</SelectItem>
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
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {observations.map((obs) => (
              <Card key={obs.observation_id} className="overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  {/* Photo */}
                  {obs.photo && (
                    <div className="md:w-48 h-48 md:h-auto bg-muted flex-shrink-0">
                      <img
                        src={obs.photo}
                        alt={obs.plate_number}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

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

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
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
                      <div className="bg-muted rounded-md p-3">
                        <div className="text-xs text-muted-foreground mb-1">OFFICER NOTES</div>
                        <div className="text-sm">{obs.officer_notes}</div>
                      </div>
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
