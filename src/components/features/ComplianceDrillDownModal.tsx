/**
 * COMPLIANCE DRILL-DOWN MODAL
 * Shows detailed vehicle list when clicking on compliance metrics
 * Provides enforcement actions and vehicle management
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle,
  Clock,
  Flag,
  Home,
  Search,
  Eye,
  FileText,
  MapPin,
  Calendar,
  Car,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatInTimeZone } from 'date-fns-tz';

const NZ_TIMEZONE = 'Pacific/Auckland';

export type DrillDownType = 
  | 'overstayers'
  | 'about_to_overstay'
  | 'flagged'
  | 'homeless'
  | 'enforceable';

interface ComplianceDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: DrillDownType | null;
  organizationId: string;
  fromDate: string;
  toDate: string;
  onViewVehicle?: (plateNumber: string) => void;
  onCreateEnforcement?: (plateNumber: string) => void;
}

interface VehicleDetail {
  plate_number: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  zone_name?: string;
  zone_id?: string;
  last_seen_at?: string;
  total_observations: number;
  consecutive_nights?: number;
  nights_stayed?: number;
  is_flagged: boolean;
  is_homeless: boolean;
  breach_status?: string;
  breach_type?: string;
  self_contained: boolean;
  profile_photo?: string;
}

export function ComplianceDrillDownModal({
  isOpen,
  onClose,
  type,
  organizationId,
  fromDate,
  toDate,
  onViewVehicle,
  onCreateEnforcement,
}: ComplianceDrillDownModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch vehicle details based on drill-down type
  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['compliance-drilldown', type, organizationId, fromDate, toDate],
    queryFn: async () => {
      if (!type || !organizationId) return [];

      console.log('🔍 Fetching drill-down data:', { type, organizationId, fromDate, toDate });

      // Get all observations in date range
      const { data: observations, error: obsError } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_at,
          is_breach,
          zones!inner(name)
        `)
        .eq('organization_id', organizationId)
        .gte('recorded_at', `${fromDate}T00:00:00`)
        .lte('recorded_at', `${toDate}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (obsError) throw obsError;

      // Group by plate_number to get unique vehicles
      const vehicleMap = new Map<string, any>();
      observations?.forEach(obs => {
        if (!vehicleMap.has(obs.plate_number)) {
          vehicleMap.set(obs.plate_number, {
            plate_number: obs.plate_number,
            zone_name: obs.zones?.name,
            zone_id: obs.zone_id,
            last_seen_at: obs.recorded_at,
            total_observations: 1,
            is_breach: obs.is_breach,
          });
        } else {
          const existing = vehicleMap.get(obs.plate_number);
          existing.total_observations++;
        }
      });

      const uniquePlates = Array.from(vehicleMap.keys());

      if (uniquePlates.length === 0) return [];

      // Get canonical vehicle data
      const { data: canonicalVehicles } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('plate_number', uniquePlates);

      // Get monthly stays data
      const { data: monthlyStays } = await supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, consecutive_nights, nights_stayed, last_observation_date')
        .eq('organization_id', organizationId)
        .in('plate_number', uniquePlates);

      // Get breach alerts
      const { data: breaches } = await supabase
        .from('breach_alerts')
        .select('plate_number, status, breach_type')
        .eq('organization_id', organizationId)
        .in('plate_number', uniquePlates)
        .in('status', ['active', 'pending']);

      // Combine all data
      const results: VehicleDetail[] = uniquePlates.map(plate => {
        const obsData = vehicleMap.get(plate);
        const canonical = canonicalVehicles?.find(v => v.plate_number === plate);
        const stays = monthlyStays?.find(s => s.plate_number === plate);
        const breach = breaches?.find(b => b.plate_number === plate);

        return {
          plate_number: plate,
          vehicle_make: canonical?.vehicle_make,
          vehicle_model: canonical?.vehicle_model,
          vehicle_color: canonical?.vehicle_color,
          zone_name: obsData.zone_name,
          zone_id: obsData.zone_id,
          last_seen_at: obsData.last_seen_at,
          total_observations: obsData.total_observations,
          consecutive_nights: stays?.consecutive_nights || 0,
          nights_stayed: stays?.nights_stayed || 0,
          is_flagged: canonical?.is_flagged || false,
          is_homeless: canonical?.homeless_status === 'confirmed',
          breach_status: breach?.status,
          breach_type: breach?.breach_type,
          self_contained: canonical?.self_contained || false,
          profile_photo: canonical?.profile_photo,
        };
      });

      // Filter based on type
      let filtered = results;

      if (type === 'overstayers') {
        filtered = results.filter(v => v.breach_status === 'active');
      } else if (type === 'about_to_overstay') {
        filtered = results.filter(v => 
          v.consecutive_nights >= 2 && !v.breach_status
        );
      } else if (type === 'flagged') {
        filtered = results.filter(v => v.is_flagged);
      } else if (type === 'homeless') {
        filtered = results.filter(v => v.is_homeless);
      } else if (type === 'enforceable') {
        filtered = results.filter(v => 
          v.breach_status && ['active', 'pending'].includes(v.breach_status)
        );
      }

      console.log(`✅ Found ${filtered.length} vehicles for type: ${type}`);
      return filtered;
    },
    enabled: isOpen && !!type && !!organizationId,
  });

  // Filter vehicles based on search query
  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return vehicles;

    const query = searchQuery.toLowerCase();
    return vehicles.filter(v =>
      v.plate_number.toLowerCase().includes(query) ||
      v.vehicle_make?.toLowerCase().includes(query) ||
      v.vehicle_model?.toLowerCase().includes(query) ||
      v.zone_name?.toLowerCase().includes(query)
    );
  }, [vehicles, searchQuery]);

  // Get title and icon based on type
  const getModalConfig = () => {
    switch (type) {
      case 'overstayers':
        return {
          title: 'Overstaying Vehicles',
          description: 'Vehicles currently exceeding stay limits',
          icon: AlertTriangle,
          color: 'text-red-600',
          bgColor: 'bg-red-50 dark:bg-red-950/20',
        };
      case 'about_to_overstay':
        return {
          title: 'About to Overstay',
          description: 'Vehicles approaching stay limits',
          icon: Clock,
          color: 'text-yellow-600',
          bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
        };
      case 'flagged':
        return {
          title: 'Flagged Vehicles',
          description: 'Vehicles marked for special attention',
          icon: Flag,
          color: 'text-red-600',
          bgColor: 'bg-red-50 dark:bg-red-950/20',
        };
      case 'homeless':
        return {
          title: 'Homeless Vehicles',
          description: 'Vehicles with confirmed homeless status',
          icon: Home,
          color: 'text-cyan-600',
          bgColor: 'bg-cyan-50 dark:bg-cyan-950/20',
        };
      case 'enforceable':
        return {
          title: 'Enforceable Breaches',
          description: 'Vehicles subject to enforcement action',
          icon: FileText,
          color: 'text-red-600',
          bgColor: 'bg-red-50 dark:bg-red-950/20',
        };
      default:
        return {
          title: 'Vehicles',
          description: 'Vehicle list',
          icon: Car,
          color: 'text-primary',
          bgColor: 'bg-primary/10',
        };
    }
  };

  const config = getModalConfig();
  const Icon = config.icon;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`h-12 w-12 rounded-full ${config.bgColor} flex items-center justify-center`}>
              <Icon className={`h-6 w-6 ${config.color}`} />
            </div>
            <div>
              <DialogTitle className="text-2xl">{config.title}</DialogTitle>
              <DialogDescription>{config.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by plate, make, model, or zone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Vehicle Count */}
        <div className="flex items-center justify-between py-2 border-b">
          <span className="text-sm text-muted-foreground">
            Showing {filteredVehicles.length} of {vehicles.length} vehicles
          </span>
          <Badge variant="outline">
            {formatInTimeZone(new Date(fromDate), NZ_TIMEZONE, 'dd MMM')} - {formatInTimeZone(new Date(toDate), NZ_TIMEZONE, 'dd MMM yyyy')}
          </Badge>
        </div>

        {/* Vehicle List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="text-center py-12">
            <Car className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-20" />
            <p className="text-muted-foreground">
              {searchQuery ? 'No vehicles match your search' : 'No vehicles found'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {filteredVehicles.map((vehicle) => (
              <Card key={vehicle.plate_number} className="border-2 hover:border-primary/50 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3">
                      {/* Vehicle Photo or Placeholder */}
                      <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                        {vehicle.profile_photo ? (
                          <img
                            src={vehicle.profile_photo}
                            alt={vehicle.plate_number}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Car className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>

                      {/* Vehicle Details */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-lg">{vehicle.plate_number}</h4>
                          {vehicle.is_flagged && (
                            <Badge variant="destructive" className="h-5 text-xs">
                              <Flag className="h-3 w-3 mr-1" />
                              Flagged
                            </Badge>
                          )}
                          {vehicle.is_homeless && (
                            <Badge variant="secondary" className="h-5 text-xs bg-cyan-100 text-cyan-700">
                              <Home className="h-3 w-3 mr-1" />
                              Homeless
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {vehicle.vehicle_make && vehicle.vehicle_model
                            ? `${vehicle.vehicle_make} ${vehicle.vehicle_model}`
                            : 'Vehicle details unknown'}
                          {vehicle.vehicle_color && ` • ${vehicle.vehicle_color}`}
                        </p>
                      </div>
                    </div>

                    {/* Breach Status */}
                    {vehicle.breach_status && (
                      <Badge variant="destructive">
                        {vehicle.breach_type || 'Breach'}
                      </Badge>
                    )}
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Zone
                      </div>
                      <div className="text-sm font-semibold truncate">
                        {vehicle.zone_name || 'Unknown'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Last Seen
                      </div>
                      <div className="text-sm font-semibold">
                        {vehicle.last_seen_at
                          ? formatInTimeZone(new Date(vehicle.last_seen_at), NZ_TIMEZONE, 'dd MMM')
                          : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Consecutive
                      </div>
                      <div className="text-sm font-semibold">
                        {vehicle.consecutive_nights || 0} nights
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">
                        Observations
                      </div>
                      <div className="text-sm font-semibold">
                        {vehicle.total_observations}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-3 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => onViewVehicle?.(vehicle.plate_number)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Details
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={() => onCreateEnforcement?.(vehicle.plate_number)}
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      Enforce
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
