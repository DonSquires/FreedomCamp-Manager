/**
 * Observations Page - Comprehensive Vehicle Observation Table
 * 
 * Features:
 * - Virtualized table with paging, sorting, search
 * - Global filter integration (date, org, zone)
 * - CSV export respecting current filters
 * - Drilldown detail drawer
 * - Map preview for selected row
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Eye,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Calendar,
  User,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { useGlobalFilters } from '@/stores/globalFiltersStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Observation {
  id: string;
  created_at: string;
  recorded_at: string;
  plate_number: string;
  officer_name: string;
  zone_name: string;
  is_compliant: boolean;
  breach_type: string | null;
  photo_url: string | null;
  gps_latitude: number;
  gps_longitude: number;
}

export default function ObservationsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { dateFrom, dateTo, organizationId, zoneId } = useGlobalFilters();

  const [observations, setObservations] = useState<Observation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('recorded_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [selectedObservation, setSelectedObservation] = useState<Observation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Check for drilldown params (focusDate, bbox, id)
  const focusDate = searchParams.get('focusDate');
  const observationId = searchParams.get('id');

  useEffect(() => {
    loadObservations();
  }, [dateFrom, dateTo, organizationId, zoneId, page, pageSize, search, sortField, sortDir]);

  // Auto-open drawer if ID param is present
  useEffect(() => {
    if (observationId && observations.length > 0) {
      const obs = observations.find(o => o.id === observationId);
      if (obs) {
        setSelectedObservation(obs);
        setDrawerOpen(true);
      }
    }
  }, [observationId, observations]);

  const loadObservations = async () => {
    setIsLoading(true);
    setError(null);
    setErrorId(null);

    try {
      const startOfDay = new Date(dateFrom);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);

      // Build query
      let query = supabase
        .from('observations')
        .select(`
          id,
          created_at,
          recorded_at,
          plate_number,
          is_compliant,
          breach_type,
          photo_url,
          gps_latitude,
          gps_longitude,
          zone:zones(name),
          recorded_by_user:user_profiles(first_name, last_name)
        `, { count: 'exact' })
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString())
        .order(sortField, { ascending: sortDir === 'asc' })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId);
      }

      if (search.trim()) {
        query = query.or(`plate_number.ilike.%${search.trim()}%`);
      }

      const { data, error: fetchError, count } = await query;

      if (fetchError) throw fetchError;

      setTotal(count || 0);
      setObservations(
        (data || []).map((obs: any) => ({
          id: obs.id,
          created_at: obs.created_at,
          recorded_at: obs.recorded_at,
          plate_number: obs.plate_number || 'Unknown',
          officer_name: obs.recorded_by_user
            ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
            : 'Unknown',
          zone_name: obs.zone?.name || 'Unknown Zone',
          is_compliant: obs.is_compliant,
          breach_type: obs.breach_type,
          photo_url: obs.photo_url,
          gps_latitude: obs.gps_latitude,
          gps_longitude: obs.gps_longitude,
        }))
      );
    } catch (error: any) {
      const errorIdStr = `ERR-${Date.now()}`;
      console.error('Failed to load observations:', error, { errorId: errorIdStr });
      setError(error.message || 'Failed to load observations');
      setErrorId(errorIdStr);
      toast.error(`Failed to load observations. (${errorIdStr})`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      toast.info('Generating CSV export...');

      // Get bbox from search params if present (from hotspots drilldown)
      const lat = searchParams.get('lat');
      const lng = searchParams.get('lng');
      const bbox = lat && lng ? {
        north: parseFloat(lat) + 0.01,
        south: parseFloat(lat) - 0.01,
        east: parseFloat(lng) + 0.01,
        west: parseFloat(lng) - 0.01,
      } : undefined;

      // Call Edge Function for server-generated CSV
      const { data, error } = await supabase.functions.invoke('observations-export', {
        body: {
          date_from: dateFrom,
          date_to: dateTo,
          organization_id: organizationId || null,
          zone_id: zoneId || null,
          search: search.trim() || undefined,
          bbox,
        },
      });

      if (error) {
        // Check for FunctionsHttpError to get detailed error
        if (error instanceof Error && 'context' in error) {
          const context = (error as any).context;
          const errorText = await context?.text?.() || error.message;
          const errorId = `ERR-${Date.now()}`;
          console.error('Export failed:', errorText, { errorId });
          toast.error(`Export failed. (${errorId})`);
          return;
        }
        throw error;
      }

      // The Edge Function returns CSV directly, but invoke() parses it as text
      // We need to use raw fetch for binary/CSV responses
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/observations-export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          date_from: dateFrom,
          date_to: dateTo,
          organization_id: organizationId || null,
          zone_id: zoneId || null,
          search: search.trim() || undefined,
          bbox,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorId = errorData.errorId || `ERR-${Date.now()}`;
        console.error('Export failed:', errorData, { errorId });
        toast.error(`Export failed. (${errorId})`);
        return;
      }

      // Download the CSV file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `observations_${dateFrom}_to_${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('CSV export downloaded successfully');
    } catch (error: any) {
      const errorId = `ERR-${Date.now()}`;
      console.error('Export error:', error, { errorId });
      toast.error(`Failed to export: ${error.message} (${errorId})`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRowClick = (obs: Observation) => {
    setSelectedObservation(obs);
    setDrawerOpen(true);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <AdminNavigationMenu />
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Eye className="h-6 w-6 text-blue-600" />
                  Observations
                </h1>
                <p className="text-sm text-muted-foreground">
                  All vehicle observations and evidence
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {total > 0 && (
                <Badge variant="secondary" className="text-sm">
                  {total.toLocaleString()} total observations
                </Badge>
              )}
            </div>
          </div>
        </div>

        <GlobalFilterRibbon onRefresh={loadObservations} />

        {/* Error Banner */}
        {error && (
          <div className="border-b bg-red-50 dark:bg-red-950/20 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-red-900 dark:text-red-100">Failed to load observations</p>
                <p className="text-sm text-red-700 dark:text-red-200 mt-1">{error}</p>
                {errorId && (
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">Error ID: {errorId}</p>
                )}
              </div>
              <Button
                onClick={loadObservations}
                variant="outline"
                size="sm"
                className="border-red-600 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Filters & Actions */}
        <div className="border-b bg-muted/30 p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by plate number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <Select value={pageSize.toString()} onValueChange={(val) => setPageSize(Number(val))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
                <SelectItem value="100">100 / page</SelectItem>
              </SelectContent>
            </Select>

            <Button 
              onClick={handleExportCSV} 
              variant="outline"
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading observations...</p>
              </div>
            </div>
          ) : observations.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Eye className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
                <p className="text-lg font-semibold text-muted-foreground">No observations found</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Try changing your filters or date range
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Plate Number</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {observations.map((obs) => (
                  <TableRow
                    key={obs.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(obs)}
                  >
                    <TableCell className="font-medium">
                      {format(new Date(obs.recorded_at), 'PPp')}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {obs.plate_number}
                    </TableCell>
                    <TableCell>{obs.zone_name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {obs.officer_name}
                    </TableCell>
                    <TableCell>
                      {obs.is_compliant ? (
                        <Badge variant="default">Compliant</Badge>
                      ) : (
                        <Badge variant="destructive">
                          {obs.breach_type || 'Breach'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {obs.photo_url ? (
                        <ImageIcon className="h-4 w-4 text-blue-600" />
                      ) : (
                        <span className="text-xs text-muted-foreground">No photo</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {obs.gps_latitude.toFixed(4)}, {obs.gps_longitude.toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {!isLoading && observations.length > 0 && (
          <div className="border-t bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} of {total.toLocaleString()}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Detail Drawer */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent className="w-96 overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Observation Detail
              </SheetTitle>
              <SheetDescription>
                {selectedObservation && (
                  <>
                    {selectedObservation.plate_number} •{' '}
                    {format(new Date(selectedObservation.recorded_at), 'PPp')}
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            {selectedObservation && (
              <div className="mt-6 space-y-4">
                {/* Evidence Photo */}
                {selectedObservation.photo_url && (
                  <Card>
                    <CardContent className="pt-4">
                      <img
                        src={selectedObservation.photo_url}
                        alt="Evidence"
                        className="w-full rounded-lg"
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Details */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Observation Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Status:</span>{' '}
                      {selectedObservation.is_compliant ? (
                        <Badge variant="default">Compliant</Badge>
                      ) : (
                        <Badge variant="destructive">
                          {selectedObservation.breach_type || 'Breach'}
                        </Badge>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Zone:</span>{' '}
                      <span className="font-medium">{selectedObservation.zone_name}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Officer:</span>{' '}
                      <span className="font-medium">{selectedObservation.officer_name}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location:</span>{' '}
                      <span className="font-mono text-xs">
                        {selectedObservation.gps_latitude.toFixed(6)}, {selectedObservation.gps_longitude.toFixed(6)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => navigate(`/admin/hotspots?lat=${selectedObservation.gps_latitude}&lng=${selectedObservation.gps_longitude}`)}
                  >
                    <MapPin className="h-4 w-4 mr-2" />
                    Open on Hotspots Map
                  </Button>
                </div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
