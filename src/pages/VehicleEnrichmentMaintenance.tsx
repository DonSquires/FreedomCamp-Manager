/**
 * Vehicle Data Review
 * View vehicles missing make, model, year, or color details
 * Manual updates can be done through Vehicle Management
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Car,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Info,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

interface VehicleWithMissingData {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  profile_photo: string | null;
  total_observations: number;
  last_seen_at: string;
  missing_fields: string[];
}

export function VehicleEnrichmentMaintenance() {
  const [vehicles, setVehicles] = useState<VehicleWithMissingData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // Load vehicles missing details
  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      // Get vehicles where make OR model is missing
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .or('vehicle_make.is.null,vehicle_model.is.null')
        .order('total_observations', { ascending: false })
        .limit(200); // Limit to 200 most active vehicles

      if (error) throw error;

      setVehicles((data || []).map(v => {
        const missing_fields: string[] = [];
        if (!v.vehicle_make) missing_fields.push('Make');
        if (!v.vehicle_model) missing_fields.push('Model');
        if (!v.vehicle_year) missing_fields.push('Year');
        if (!v.vehicle_color) missing_fields.push('Color');
        
        return {
          ...v,
          missing_fields,
        };
      }));

      console.log(`✅ Loaded ${data?.length || 0} vehicles missing details`);
    } catch (error: any) {
      console.error('Failed to load vehicles:', error);
      toast.error('Failed to load vehicles: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openVehicleManagement = () => {
    navigate('/admin/vehicle-registry');
  };



  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Car className="h-8 w-8 text-primary" />
            Vehicle Data Review
          </h1>
          <p className="text-muted-foreground mt-1">
            View vehicles missing make, model, year, or color details
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openVehicleManagement} variant="outline">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Vehicle Management
          </Button>
          <Button onClick={loadVehicles} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
            Reload
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <p className="font-semibold mb-2">Manual Data Entry Required</p>
              <p>Automatic vehicle enrichment has been disabled (external services not working).</p>
              <p className="mt-2">
                To update vehicle details, please use <strong>Vehicle Management</strong> to manually edit individual vehicles.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-muted rounded-lg">
              <div className="text-3xl font-bold">{vehicles.length}</div>
              <div className="text-sm text-muted-foreground mt-1">Total Vehicles</div>
              <div className="text-xs text-muted-foreground">Missing Details</div>
            </div>
            <div className="text-center p-4 bg-red-50 dark:bg-red-950/20 rounded-lg">
              <div className="text-3xl font-bold text-red-600">
                {vehicles.filter(v => !v.vehicle_make).length}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Missing Make</div>
            </div>
            <div className="text-center p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
              <div className="text-3xl font-bold text-orange-600">
                {vehicles.filter(v => !v.vehicle_model).length}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Missing Model</div>
            </div>
            <div className="text-center p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
              <div className="text-3xl font-bold text-amber-600">
                {vehicles.filter(v => !v.vehicle_color || !v.vehicle_year).length}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Missing Year/Color</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle List */}
      <Card>
        <CardHeader>
          <CardTitle>Vehicles Missing Details ({vehicles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
              <p className="text-lg">All vehicles have complete details!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate</TableHead>
                    <TableHead>Current Details</TableHead>
                    <TableHead>Missing Fields</TableHead>
                    <TableHead>Photo</TableHead>
                    <TableHead>Observations</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((vehicle) => (
                    <TableRow key={vehicle.plate_number}>
                      <TableCell className="font-mono font-bold">{vehicle.plate_number}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {vehicle.vehicle_make || vehicle.vehicle_model ? (
                            <>
                              <div>{vehicle.vehicle_make || '—'} {vehicle.vehicle_model || '—'}</div>
                              <div className="text-xs text-muted-foreground">
                                {vehicle.vehicle_year || '—'} • {vehicle.vehicle_color || '—'}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">No details</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {vehicle.missing_fields.map((field) => (
                            <Badge key={field} variant="destructive" className="text-xs">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {vehicle.profile_photo ? (
                          <img src={vehicle.profile_photo} alt={vehicle.plate_number} className="h-12 w-16 object-cover rounded" />
                        ) : (
                          <span className="text-xs text-muted-foreground">No photo</span>
                        )}
                      </TableCell>
                      <TableCell>{vehicle.total_observations}</TableCell>
                      <TableCell className="text-xs">{new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
