/**
 * Vehicle Enrichment Maintenance
 * Batch process vehicles to auto-populate make, model, year, color from photos and NZ databases
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  XCircle,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface VehicleToEnrich {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  profile_photo: string | null;
  total_observations: number;
  last_seen_at: string;
  selected: boolean;
  status?: 'pending' | 'processing' | 'success' | 'failed' | 'skipped';
  enriched_data?: {
    make?: string;
    model?: string;
    year?: number;
    color?: string;
    source?: string;
  };
  error_message?: string;
}

export function VehicleEnrichmentMaintenance() {
  const [vehicles, setVehicles] = useState<VehicleToEnrich[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [progress, setProgress] = useState({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 });
  const [batchSize, setBatchSize] = useState(10);

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

      setVehicles((data || []).map(v => ({
        ...v,
        selected: false,
        status: 'pending',
      })));

      console.log(`✅ Loaded ${data?.length || 0} vehicles missing details`);
    } catch (error: any) {
      console.error('Failed to load vehicles:', error);
      toast.error('Failed to load vehicles: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Select/deselect all
  const toggleSelectAll = () => {
    const allSelected = vehicles.every(v => v.selected);
    setVehicles(prev => prev.map(v => ({ ...v, selected: !allSelected })));
  };

  // Toggle individual vehicle
  const toggleVehicle = (plateNumber: string) => {
    setVehicles(prev =>
      prev.map(v =>
        v.plate_number === plateNumber ? { ...v, selected: !v.selected } : v
      )
    );
  };

  // Select only vehicles with photos (better enrichment success rate)
  const selectWithPhotos = () => {
    setVehicles(prev =>
      prev.map(v => ({
        ...v,
        selected: v.profile_photo !== null,
      }))
    );
    toast.success('Selected vehicles with photos');
  };

  // Enrich a single vehicle
  const enrichVehicle = async (vehicle: VehicleToEnrich): Promise<VehicleToEnrich> => {
    console.log(`🔍 Enriching vehicle: ${vehicle.plate_number}`);

    let enrichedData: any = {};
    let source = '';
    let sources: string[] = [];

    try {
      // Step 1: Try photo analysis if photo exists
      if (vehicle.profile_photo) {
        console.log(`📸 Trying photo analysis for ${vehicle.plate_number}...`);
        try {
          const { data: photoData, error: photoError } = await supabase.functions.invoke('analyze-vehicle-photo', {
            body: {
              plateNumber: vehicle.plate_number,
              photoUrl: vehicle.profile_photo,
            },
          });

          if (!photoError && photoData && (photoData.make || photoData.model || photoData.color || photoData.year)) {
            if (photoData.make) enrichedData.make = photoData.make;
            if (photoData.model) enrichedData.model = photoData.model;
            if (photoData.color) enrichedData.color = photoData.color;
            if (photoData.year) enrichedData.year = photoData.year;
            sources.push('photo_analysis');
            console.log(`✅ Photo analysis found:`, photoData);
          }
        } catch (err: any) {
          console.log(`⚠️ Photo analysis failed: ${err.message}`);
        }
      }

      // Step 2: Try NZSCV database lookup (includes caching)
      console.log(`🔍 Trying NZSCV lookup for ${vehicle.plate_number}...`);
      try {
        const { data: nzscvData, error: nzscvError } = await supabase.functions.invoke('check-nzscv-status', {
          body: {
            plateNumber: vehicle.plate_number,
          },
        });

        if (nzscvError) {
          console.log(`⚠️ NZSCV lookup error: ${nzscvError.message}`);
        } else if (nzscvData) {
          // Handle cached response
          if (nzscvData.skipped) {
            console.log(`💾 Using cached NZSCV data (checked ${nzscvData.days_ago} days ago)`);
            // Even though skipped, we can use the cached data
            // NZSCV primarily returns self-contained certification, not make/model
          } else if (nzscvData.result) {
            // Fresh NZSCV lookup
            const result = nzscvData.result;
            if (result.vehicle_make && !enrichedData.make) enrichedData.make = result.vehicle_make;
            if (result.vehicle_model && !enrichedData.model) enrichedData.model = result.vehicle_model;
            if (result.vehicle_year && !enrichedData.year) enrichedData.year = result.vehicle_year;
            sources.push('nzscv_database');
            console.log(`✅ NZSCV lookup found:`, result);
          }
        }
      } catch (err: any) {
        console.log(`⚠️ NZSCV lookup failed: ${err.message}`);
      }

      // Step 3: Try Carjam NZ (web scraping for make/model/color)
      if (!enrichedData.make || !enrichedData.model || !enrichedData.color) {
        console.log(`🚗 Trying Carjam NZ for ${vehicle.plate_number}...`);
        try {
          // Carjam provides comprehensive NZ vehicle registration data
          const carjamUrl = `https://www.carjam.co.nz/car/?plate=${encodeURIComponent(vehicle.plate_number)}`;
          
          const response = await fetch(carjamUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          if (response.ok) {
            const html = await response.text();
            
            // Parse HTML for vehicle details (basic regex extraction)
            // Format: "2015 Toyota Corolla White"
            const makeMatch = html.match(/<span[^>]*>Make:<\/span>\s*<[^>]*>([^<]+)</i);
            const modelMatch = html.match(/<span[^>]*>Model:<\/span>\s*<[^>]*>([^<]+)</i);
            const yearMatch = html.match(/<span[^>]*>Year:<\/span>\s*<[^>]*>(\d{4})</i);
            const colorMatch = html.match(/<span[^>]*>Colour:<\/span>\s*<[^>]*>([^<]+)</i);
            
            if (makeMatch && !enrichedData.make) {
              enrichedData.make = makeMatch[1].trim();
              sources.push('carjam_nz');
            }
            if (modelMatch && !enrichedData.model) {
              enrichedData.model = modelMatch[1].trim();
              if (!sources.includes('carjam_nz')) sources.push('carjam_nz');
            }
            if (yearMatch && !enrichedData.year) {
              enrichedData.year = parseInt(yearMatch[1]);
              if (!sources.includes('carjam_nz')) sources.push('carjam_nz');
            }
            if (colorMatch && !enrichedData.color) {
              enrichedData.color = colorMatch[1].trim();
              if (!sources.includes('carjam_nz')) sources.push('carjam_nz');
            }
            
            console.log(`✅ Carjam NZ found:`, { make: enrichedData.make, model: enrichedData.model, year: enrichedData.year, color: enrichedData.color });
          } else {
            console.log(`⚠️ Carjam NZ returned ${response.status}`);
          }
        } catch (err: any) {
          console.log(`⚠️ Carjam NZ failed: ${err.message}`);
        }
      }

      // Combine source names
      source = sources.join(' + ');

      // Check if we found any data
      if (Object.keys(enrichedData).length === 0 || (!enrichedData.make && !enrichedData.model && !enrichedData.color)) {
        return {
          ...vehicle,
          status: 'skipped',
          error_message: 'No additional vehicle details found from any source (photo, NZSCV, Carjam)',
        };
      }

      // Update database
      const { error: updateError } = await supabase
        .from('canonical_vehicles')
        .update({
          vehicle_make: enrichedData.make || vehicle.vehicle_make,
          vehicle_model: enrichedData.model || vehicle.vehicle_model,
          vehicle_color: enrichedData.color || vehicle.vehicle_color,
          vehicle_year: enrichedData.year || vehicle.vehicle_year,
          nzscv_last_checked: new Date().toISOString(),
          nzscv_source: source,
          updated_at: new Date().toISOString(),
        })
        .eq('plate_number', vehicle.plate_number);

      if (updateError) throw updateError;

      return {
        ...vehicle,
        status: 'success',
        enriched_data: {
          make: enrichedData.make,
          model: enrichedData.model,
          year: enrichedData.year,
          color: enrichedData.color,
          source,
        },
      };
    } catch (error: any) {
      console.error(`❌ Failed to enrich ${vehicle.plate_number}:`, error);
      return {
        ...vehicle,
        status: 'failed',
        error_message: error.message,
      };
    }
  };

  // Process selected vehicles in batches
  const processVehicles = async () => {
    const selectedVehicles = vehicles.filter(v => v.selected);
    
    if (selectedVehicles.length === 0) {
      toast.error('No vehicles selected');
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    setProgress({ current: 0, total: selectedVehicles.length, success: 0, failed: 0, skipped: 0 });

    const batches = Math.ceil(selectedVehicles.length / batchSize);
    setTotalBatches(batches);

    console.log(`🚀 Starting enrichment: ${selectedVehicles.length} vehicles in ${batches} batches`);

    for (let i = 0; i < batches; i++) {
      if (isPaused) {
        console.log('⏸️ Processing paused');
        break;
      }

      setCurrentBatch(i + 1);
      const batchStart = i * batchSize;
      const batchEnd = Math.min((i + 1) * batchSize, selectedVehicles.length);
      const batch = selectedVehicles.slice(batchStart, batchEnd);

      console.log(`📦 Processing batch ${i + 1}/${batches}: ${batch.length} vehicles`);

      // Process batch sequentially to avoid overwhelming APIs
      for (const vehicle of batch) {
        if (isPaused) break;

        // Update status to processing
        setVehicles(prev =>
          prev.map(v =>
            v.plate_number === vehicle.plate_number
              ? { ...v, status: 'processing' }
              : v
          )
        );

        // Enrich vehicle
        const result = await enrichVehicle(vehicle);

        // Update vehicle with result
        setVehicles(prev =>
          prev.map(v =>
            v.plate_number === vehicle.plate_number ? result : v
          )
        );

        // Update progress
        setProgress(prev => ({
          ...prev,
          current: prev.current + 1,
          success: prev.success + (result.status === 'success' ? 1 : 0),
          failed: prev.failed + (result.status === 'failed' ? 1 : 0),
          skipped: prev.skipped + (result.status === 'skipped' ? 1 : 0),
        }));

        // Small delay between requests to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Delay between batches
      if (i < batches - 1 && !isPaused) {
        console.log(`⏳ Waiting 2s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setIsProcessing(false);
    
    if (!isPaused) {
      toast.success(
        `✅ Enrichment complete: ${progress.success} succeeded, ${progress.skipped} skipped, ${progress.failed} failed`
      );
    }
  };

  // Pause processing
  const pauseProcessing = () => {
    setIsPaused(true);
    toast.info('Processing paused');
  };

  // Reset all
  const resetAll = () => {
    setVehicles(prev => prev.map(v => ({ ...v, status: 'pending', enriched_data: undefined, error_message: undefined })));
    setProgress({ current: 0, total: 0, success: 0, failed: 0, skipped: 0 });
    setCurrentBatch(0);
    setTotalBatches(0);
    toast.success('Reset complete');
  };

  const selectedCount = vehicles.filter(v => v.selected).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Car className="h-8 w-8 text-primary" />
            Vehicle Enrichment Maintenance
          </h1>
          <p className="text-muted-foreground mt-1">
            Batch process vehicles to auto-populate make, model, year, and color
          </p>
        </div>
        <Button onClick={loadVehicles} disabled={isLoading || isProcessing}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
          Reload
        </Button>
      </div>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-900 dark:text-blue-100">
              <p className="font-semibold mb-2">How Vehicle Enrichment Works:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li><strong>Photo Analysis:</strong> Extracts vehicle details from profile photos using ALPR/OCR</li>
                <li><strong>NZSCV Database:</strong> Queries NZ Self-Contained Vehicle database for official certification data</li>
                <li><strong>Carjam NZ:</strong> Scrapes Carjam.co.nz for comprehensive registration data (make, model, year, color)</li>
                <li><strong>Batch Processing:</strong> Processes vehicles in small groups to avoid overwhelming APIs</li>
              </ol>
              <p className="mt-2 text-xs text-blue-700">
                💡 <strong>Tip:</strong> Carjam NZ provides the most comprehensive NZ vehicle data. NZSCV focuses on self-contained certification.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats and Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{vehicles.length}</div>
                <div className="text-xs text-muted-foreground">Total Vehicles</div>
              </div>
              <div className="text-center p-3 bg-primary/10 rounded-lg">
                <div className="text-2xl font-bold text-primary">{selectedCount}</div>
                <div className="text-xs text-muted-foreground">Selected</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={toggleSelectAll} variant="outline" size="sm">
                {vehicles.every(v => v.selected) ? 'Deselect All' : 'Select All'}
              </Button>
              <Button onClick={selectWithPhotos} variant="outline" size="sm">
                Select With Photos
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Batch Size:</label>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded-md bg-background"
                disabled={isProcessing}
              >
                <option value="5">5 vehicles per batch</option>
                <option value="10">10 vehicles per batch</option>
                <option value="20">20 vehicles per batch</option>
                <option value="50">50 vehicles per batch</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isProcessing && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Processing...</span>
                    <span className="font-mono">{progress.current} / {progress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3">
                    <div
                      className="bg-primary h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  Batch {currentBatch} of {totalBatches}
                </div>
              </>
            )}

            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded">
                <div className="font-bold text-green-600">{progress.success}</div>
                <div className="text-xs text-green-700">Success</div>
              </div>
              <div className="text-center p-2 bg-amber-50 dark:bg-amber-950/20 rounded">
                <div className="font-bold text-amber-600">{progress.skipped}</div>
                <div className="text-xs text-amber-700">Skipped</div>
              </div>
              <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded">
                <div className="font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-700">Failed</div>
              </div>
            </div>

            <div className="flex gap-2">
              {!isProcessing ? (
                <Button
                  onClick={processVehicles}
                  disabled={selectedCount === 0}
                  className="flex-1"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start Processing ({selectedCount})
                </Button>
              ) : (
                <Button
                  onClick={pauseProcessing}
                  variant="outline"
                  className="flex-1"
                >
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
              <Button onClick={resetAll} variant="outline" disabled={isProcessing}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

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
                    <TableHead className="w-12">
                      <Checkbox
                        checked={vehicles.every(v => v.selected)}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Current Details</TableHead>
                    <TableHead>Photo</TableHead>
                    <TableHead>Observations</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>Enriched Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((vehicle) => (
                    <TableRow key={vehicle.plate_number}>
                      <TableCell>
                        <Checkbox
                          checked={vehicle.selected}
                          onCheckedChange={() => toggleVehicle(vehicle.plate_number)}
                          disabled={isProcessing}
                        />
                      </TableCell>
                      <TableCell>
                        {vehicle.status === 'pending' && <Badge variant="outline">Pending</Badge>}
                        {vehicle.status === 'processing' && (
                          <Badge className="bg-blue-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Processing
                          </Badge>
                        )}
                        {vehicle.status === 'success' && (
                          <Badge className="bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        )}
                        {vehicle.status === 'failed' && (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                        {vehicle.status === 'skipped' && (
                          <Badge variant="secondary">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Skipped
                          </Badge>
                        )}
                      </TableCell>
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
                        {vehicle.profile_photo ? (
                          <img src={vehicle.profile_photo} alt={vehicle.plate_number} className="h-12 w-16 object-cover rounded" />
                        ) : (
                          <span className="text-xs text-muted-foreground">No photo</span>
                        )}
                      </TableCell>
                      <TableCell>{vehicle.total_observations}</TableCell>
                      <TableCell className="text-xs">{new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}</TableCell>
                      <TableCell>
                        {vehicle.enriched_data ? (
                          <div className="text-sm">
                            <div className="font-medium text-green-600">
                              {vehicle.enriched_data.make} {vehicle.enriched_data.model}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {vehicle.enriched_data.year} • {vehicle.enriched_data.color}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {vehicle.enriched_data.source?.split(' + ').map((src: string, idx: number) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {src === 'photo_analysis' && '📸 Photo'}
                                  {src === 'nzscv_database' && '🗄️ NZSCV'}
                                  {src === 'carjam_nz' && '🚗 Carjam NZ'}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : vehicle.error_message ? (
                          <div className="text-xs text-amber-600">{vehicle.error_message}</div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
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
