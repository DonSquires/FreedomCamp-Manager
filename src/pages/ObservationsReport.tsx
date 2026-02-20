/**
 * Observations Report - Clean Rebuild
 * Simple, focused evidence report for field observations
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Loader2, Download, Calendar, MapPin, FileText, Camera, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useZones } from '@/hooks/useZones';

interface Observation {
  id: string;
  plate_number: string;
  photo_url: string;
  photo_hash: string;
  recorded_at: string;
  zone_id: string;
  zone_name: string;
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number | null;
  officer_name: string;
  officer_notes: string | null;
  weather_conditions: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  is_compliant: boolean;
  breach_type: string | null;
  breach_reason: string | null;
  nights_stayed_this_month: number;
  consecutive_nights: number;
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
  const [complianceFilter, setComplianceFilter] = useState<string>('all');

  const { zones } = useZones(selectedOrgId || undefined);

  // Query observations
  const { data: observations, isLoading } = useQuery({
    queryKey: ['observations', selectedOrgId, selectedZoneId, startDate, endDate, complianceFilter],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles!observations_recorded_by_fkey(first_name, last_name),
          organization:organizations(name)
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

      if (complianceFilter === 'compliant') {
        query = query.eq('is_compliant', true);
      } else if (complianceFilter === 'breach') {
        query = query.eq('is_compliant', false);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((obs: any) => ({
        id: obs.id,
        plate_number: obs.plate_number,
        photo_url: obs.photo_url,
        photo_hash: obs.photo_hash,
        recorded_at: obs.recorded_at,
        zone_id: obs.zone_id,
        zone_name: obs.zone?.name || 'Unknown Zone',
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
        gps_accuracy: obs.gps_accuracy,
        officer_name: obs.officer ? `${obs.officer.first_name} ${obs.officer.last_name}` : 'Unknown',
        officer_notes: obs.officer_notes,
        weather_conditions: obs.weather_conditions,
        vehicle_make: obs.vehicle_make,
        vehicle_model: obs.vehicle_model,
        vehicle_year: obs.vehicle_year,
        vehicle_color: obs.vehicle_color,
        self_contained: obs.self_contained,
        self_contained_expiry: obs.self_contained_expiry,
        is_compliant: obs.is_compliant,
        breach_type: obs.breach_type,
        breach_reason: obs.breach_reason,
        nights_stayed_this_month: obs.nights_stayed_this_month,
        consecutive_nights: obs.consecutive_nights,
        organization_name: obs.organization?.name || 'Unknown',
      })) as Observation[];
    },
  });

  const exportToCSV = () => {
    if (!observations || observations.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = [
      'Date',
      'Time',
      'Plate',
      'Zone',
      'Officer',
      'GPS Lat',
      'GPS Lng',
      'Accuracy (m)',
      'Vehicle',
      'Color',
      'Self-Contained',
      'Compliance',
      'Breach Type',
      'Breach Reason',
      'Nights This Month',
      'Consecutive Nights',
      'Notes',
      'Weather',
      'Organization',
    ];

    const rows = observations.map(obs => [
      format(new Date(obs.recorded_at), 'dd/MM/yyyy'),
      format(new Date(obs.recorded_at), 'HH:mm'),
      obs.plate_number,
      obs.zone_name,
      obs.officer_name,
      obs.gps_latitude.toFixed(6),
      obs.gps_longitude.toFixed(6),
      obs.gps_accuracy?.toFixed(1) || '',
      `${obs.vehicle_make || ''} ${obs.vehicle_model || ''} ${obs.vehicle_year || ''}`.trim(),
      obs.vehicle_color || '',
      obs.self_contained ? 'Yes' : 'No',
      obs.is_compliant ? 'Compliant' : 'Breach',
      obs.breach_type || '',
      obs.breach_reason || '',
      obs.nights_stayed_this_month,
      obs.consecutive_nights,
      obs.officer_notes || '',
      obs.weather_conditions || '',
      obs.organization_name,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `observations-${format(new Date(), 'yyyy-MM-dd-HHmm')}.csv`;
    link.click();

    toast.success('Report exported to CSV');
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Field Observations</h1>
            <p className="text-muted-foreground mt-1">
              Evidence-based vehicle observation records
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

            {/* Compliance Filter */}
            <div className="space-y-2">
              <Label>Compliance Status</Label>
              <Select value={complianceFilter} onValueChange={setComplianceFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Observations</SelectItem>
                  <SelectItem value="compliant">✓ Compliant Only</SelectItem>
                  <SelectItem value="breach">✗ Breaches Only</SelectItem>
                </SelectContent>
              </Select>
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
              <Card key={obs.id} className="overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  {/* Evidence Photo */}
                  <div className="md:w-64 h-48 md:h-auto bg-muted flex-shrink-0 relative">
                    <img
                      src={obs.photo_url}
                      alt={obs.plate_number}
                      className="w-full h-full object-cover"
                    />
                    {/* GPS Watermark */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] leading-tight p-2 font-mono">
                      <div className="font-bold">
                        GPS: {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                        {obs.gps_accuracy && ` (±${obs.gps_accuracy.toFixed(0)}m)`}
                      </div>
                      <div>
                        {format(new Date(obs.recorded_at), 'dd MMM yyyy, HH:mm:ss')} NZDT
                      </div>
                      <div>
                        Officer: {obs.officer_name} | {obs.zone_name}
                      </div>
                    </div>
                    {/* Evidence Badge */}
                    <div className="absolute top-2 right-2">
                      <Badge className="bg-blue-600 text-white text-xs">
                        <Camera className="h-3 w-3 mr-1" />
                        Evidence
                      </Badge>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-xl font-mono font-bold">{obs.plate_number}</h3>
                          {!obs.is_compliant && (
                            <Badge variant="destructive">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              BREACH
                            </Badge>
                          )}
                          {obs.is_compliant && (
                            <Badge className="bg-green-600 text-white">
                              ✓ COMPLIANT
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[obs.vehicle_color, obs.vehicle_year, obs.vehicle_make, obs.vehicle_model]
                            .filter(Boolean)
                            .join(' ')}
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
                        <div className="text-xs text-muted-foreground">
                          {obs.officer_name}
                        </div>
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

                      {/* Stay Metrics */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">STAY METRICS</div>
                        <div className="text-sm">
                          {obs.nights_stayed_this_month} nights this month
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {obs.consecutive_nights} consecutive
                        </div>
                      </div>
                    </div>

                    {/* Breach Details */}
                    {!obs.is_compliant && obs.breach_reason && (
                      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md p-3 mb-3">
                        <div className="text-xs font-semibold text-red-900 dark:text-red-100 mb-1">
                          BREACH: {obs.breach_type || 'Compliance Violation'}
                        </div>
                        <div className="text-sm text-red-800 dark:text-red-200">
                          {obs.breach_reason}
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

                    {/* Weather */}
                    {obs.weather_conditions && (
                      <div className="text-xs text-muted-foreground">
                        Weather: {obs.weather_conditions}
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
