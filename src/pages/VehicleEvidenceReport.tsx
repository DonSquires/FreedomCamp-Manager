
/**
 * VEHICLE EVIDENCE REPORT
 * Generates exportable PDF reports for specific vehicles with selected observations
 * Used for evidential proof to support infringement notices
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Car,
  Search,
  FileText,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Calendar,
  User,
  Camera,
  Flag,
  Home,
  Shield,
  Eye,
  Printer,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { formatInTimeZone } from 'date-fns-tz';
import { CollapsibleInstructions } from '@/components/features/CollapsibleInstructions';

const NZ_TIMEZONE = 'Pacific/Auckland';

interface CanonicalVehicle {
  plate_number: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  vehicle_color: string;
  self_contained: boolean;
  self_contained_expiry: string;
  homeless_status: string;
  homeless_notes: string;
  is_flagged: boolean;
  flagged_priority: string;
  flagged_reason: string;
  flagged_notes: string;
  profile_photo: string;
  profile_photo_metadata: any;
  total_observations: number;
  total_breaches: number;
  first_seen_at: string;
  last_seen_at: string;
  enforcement_count: number;
  last_enforcement_at: string;
}

interface Observation {
  observation_id: string;
  plate_number: string;
  recorded_at: string;
  zone_id: string;
  zone_name: string;
  officer_name: string;
  is_breach: boolean;
  is_compliant: boolean;
  breach_type: string;
  officer_notes: string;
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number;
  photo: string;
  photo_hash: string;
  self_contained: boolean;
  self_contained_expiry: string;
  has_incident: boolean;
  has_hs_incident: boolean;
}

export function VehicleEvidenceReport() {
  const { user } = useAuthStore();
  const [searchPlate, setSearchPlate] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [vehicleData, setVehicleData] = useState<CanonicalVehicle | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [selectedObservations, setSelectedObservations] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [maxObservations, setMaxObservations] = useState<number>(10);

  const handleSearch = async () => {
    if (!searchPlate.trim()) {
      toast.error('Please enter a plate number');
      return;
    }

    setIsSearching(true);
    try {
      const plateUpper = searchPlate.trim().toUpperCase();

      // Get canonical vehicle data
      const { data: canonical, error: canonicalError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', plateUpper)
        .single();

      if (canonicalError) {
        if (canonicalError.code === 'PGRST116') {
          toast.error('Vehicle not found in system');
        } else {
          throw canonicalError;
        }
        return;
      }

      setVehicleData(canonical);

      // Get observations
      const { data: obsData, error: obsError } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          recorded_at,
          zone_id,
          zones (name),
          user_profiles!vehicle_observations_v2_recorded_by_fkey (first_name, last_name),
          is_breach,
          is_compliant,
          breach_type,
          officer_notes,
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          photo,
          photo_hash,
          self_contained,
          self_contained_expiry,
          has_incident,
          has_hs_incident
        `)
        .eq('plate_number', plateUpper)
        .order('recorded_at', { ascending: false })
        .limit(100);

      if (obsError) throw obsError;

      const formattedObs: Observation[] = (obsData || []).map((obs: any) => ({
        observation_id: obs.observation_id,
        plate_number: obs.plate_number,
        recorded_at: obs.recorded_at,
        zone_id: obs.zone_id,
        zone_name: obs.zones?.name || 'Unknown Zone',
        officer_name: obs.user_profiles ? `${obs.user_profiles.first_name} ${obs.user_profiles.last_name}` : 'Unknown',
        is_breach: obs.is_breach,
        is_compliant: obs.is_compliant,
        breach_type: obs.breach_type,
        officer_notes: obs.officer_notes,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
        gps_accuracy: obs.gps_accuracy,
        photo: obs.photo,
        photo_hash: obs.photo_hash,
        self_contained: obs.self_contained,
        self_contained_expiry: obs.self_contained_expiry,
        has_incident: obs.has_incident,
        has_hs_incident: obs.has_hs_incident,
      }));

      setObservations(formattedObs);
      
      // Auto-select breach observations (up to maxObservations)
      const breachObs = formattedObs.filter(o => o.is_breach).slice(0, maxObservations);
      setSelectedObservations(new Set(breachObs.map(o => o.observation_id)));

      toast.success(`Found ${formattedObs.length} observations for ${plateUpper}`);
    } catch (error: any) {
      console.error('Search failed:', error);
      toast.error('Failed to search vehicle: ' + error.message);
    } finally {
      setIsSearching(false);
    }
  };

  const toggleObservation = (obsId: string) => {
    const newSet = new Set(selectedObservations);
    if (newSet.has(obsId)) {
      newSet.delete(obsId);
    } else {
      newSet.add(obsId);
    }
    setSelectedObservations(newSet);
  };

  const selectAll = () => {
    setSelectedObservations(new Set(observations.slice(0, maxObservations).map(o => o.observation_id)));
  };

  const selectNone = () => {
    setSelectedObservations(new Set());
  };

  const selectBreaches = () => {
    const breaches = observations.filter(o => o.is_breach).slice(0, maxObservations);
    setSelectedObservations(new Set(breaches.map(o => o.observation_id)));
  };

  const handleGeneratePDF = async () => {
    if (selectedObservations.size === 0) {
      toast.error('Please select at least one observation');
      return;
    }

    if (!vehicleData) {
      toast.error('No vehicle data loaded');
      return;
    }

    setIsGenerating(true);
    try {
      const selectedObs = observations.filter(o => selectedObservations.has(o.observation_id));

      // Get organization details
      const { data: org } = await supabase
        .from('organizations')
        .select('name, contact_email, contact_phone')
        .eq('id', user?.organization_id)
        .single();

      const reportData = {
        vehicle: vehicleData,
        observations: selectedObs,
        organization: org,
        generated_by: `${user?.first_name} ${user?.last_name}`,
        generated_at: new Date().toISOString(),
      };

      // Call Edge Function to generate PDF
      const { data, error } = await supabase.functions.invoke('generate-vehicle-report', {
        body: reportData,
      });

      if (error) throw error;

      if (data?.html) {
        // Open HTML in new window for printing as PDF
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(data.html);
          printWindow.document.close();
          
          // Wait for images to load, then trigger print dialog
          printWindow.onload = () => {
            setTimeout(() => {
              printWindow.focus();
              printWindow.print();
            }, 500);
          };

          toast.success('Report generated! Use browser Print → Save as PDF', {
            duration: 5000,
          });
        } else {
          toast.error('Please allow popups to generate PDF reports');
        }
      } else if (data?.pdf_url) {
        // Direct PDF download (if implemented in future)
        const link = document.createElement('a');
        link.href = data.pdf_url;
        link.download = `vehicle-report-${vehicleData.plate_number}-${Date.now()}.pdf`;
        link.click();

        toast.success('Report downloaded successfully!');
      } else {
        throw new Error('No report data returned');
      }
    } catch (error: any) {
      console.error('PDF generation failed:', error);
      toast.error('Failed to generate report: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <ResponsiveContainer maxWidth="full" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileText className="h-8 w-8 text-blue-600" />
            Vehicle Evidence Report
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate court-ready PDF reports for infringement evidence
          </p>
        </div>

        {/* Instructions Card */}
        <CollapsibleInstructions
          title="How to Generate Evidence Reports"
          icon={<FileText className="h-5 w-5 text-blue-600" />}
          defaultOpen={false}
        >
          <div className="space-y-4">
            {/* Step Instructions */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  1
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Search for Vehicle</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Enter the plate number in the search box below to load the vehicles complete history
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  2
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Select Observations</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Choose which observations to include in the report Breach observations are auto-selected by default
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  3
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Generate PDF Report</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Click Generate PDF Report to create a court-ready document with all selected evidence
                  </p>
                </div>
              </div>
            </div>

            {/* Photo Explanation */}
            <div className="mt-6 p-4 bg-white/60 dark:bg-gray-900/40 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-600" />
                Understanding Profile Photo vs Evidence Photos
              </h4>
              <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <div className="flex items-start gap-2">
                  <div className="h-6 w-6 rounded bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <span className="font-semibold text-blue-800 dark:text-blue-200">Profile Photo:</span>
                    <p className="mt-1">
                      The best representative photo of the vehicle automatically selected from all observations 
                      This provides a clear visual reference of the vehicles general appearance and is shown in the report header
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2">
                  <div className="h-6 w-6 rounded bg-green-100 dark:bg-green-900/50 flex items-center justify-center shrink-0 mt-0.5">
                    <Camera className="h-4 w-4 text-green-600" />
                  </div>
                  <div>
                    <span className="font-semibold text-green-800 dark:text-green-200">Evidence Photos:</span>
                    <p className="mt-1">
                      Specific photos captured during each observation showing the vehicle at that exact time location and date 
                      These are timestamped GPS-tagged and include photo hashes for integrity verification - essential for court evidence
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Important:</strong> The report includes BOTH the profile photo for vehicle identification and 
                    individual evidence photos for proving specific violations at specific times and locations Each observations 
                    photo includes GPS coordinates timestamps and cryptographic hashes for legal verification
                  </span>
                </p>
              </div>
            </div>

            {/* Legal Notice */}
            <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-700">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                <strong>Court-Ready Reports Include:</strong> Vehicle details profile photo selected observations with timestamps 
                GPS coordinates officer identification photo hashes for integrity verification compliance status and breach classifications
              </p>
            </div>
          </div>
        </CollapsibleInstructions>

        {/* Search Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5" />
              Search Vehicle
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="plate-search">Plate Number</Label>
                <Input
                  id="plate-search"
                  value={searchPlate}
                  onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                  placeholder="Enter plate number (e.g., ABC123)"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="font-mono text-lg"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={handleSearch} disabled={isSearching} className="h-10">
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Search
                </Button>
              </div>
            </div>
          </CardContent> {/* Closing CardContent for Search Section */}
        </Card>

        {/* Vehicle Information */}
        {vehicleData && (
          <>
            <Card className="border-2 border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Car className="h-6 w-6 text-primary" />
                  Vehicle Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-6">
                  {/* Profile Photo */}
                  {vehicleData.profile_photo && (
                    <div className="shrink-0">
                      <img
                        src={vehicleData.profile_photo}
                        alt={vehicleData.plate_number}
                        className="w-48 h-32 object-cover rounded-lg border-2 border-primary/20"
                      />
                    </div>
                  )}

                  {/* Details Grid */}
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Plate Number</div>
                      <div className="font-mono font-bold text-xl">{vehicleData.plate_number}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Make/Model</div>
                      <div className="font-semibold">
                        {vehicleData.vehicle_make} {vehicleData.vehicle_model}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Year</div>
                      <div className="font-semibold">{vehicleData.vehicle_year || 'Unknown'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Color</div>
                      <div className="font-semibold">{vehicleData.vehicle_color || 'Unknown'}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Total Observations</div>
                      <div className="font-semibold">{vehicleData.total_observations}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Total Breaches</div>
                      <div className="font-semibold text-red-600">{vehicleData.total_breaches}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">First Seen</div>
                      <div className="font-semibold text-sm">
                        {formatInTimeZone(new Date(vehicleData.first_seen_at), NZ_TIMEZONE, 'dd/MM/yyyy')}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Last Seen</div>
                      <div className="font-semibold text-sm">
                        {formatInTimeZone(new Date(vehicleData.last_seen_at), NZ_TIMEZONE, 'dd/MM/yyyy')}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Enforcement Actions</div>
                      <div className="font-semibold">{vehicleData.enforcement_count || 0}</div>
                    </div>
                  </div>
                </div>

                {/* Status Badges */}
                <div className="flex flex-wrap gap-2 pt-4 border-t">
                  <Badge variant={vehicleData.self_contained ? 'default' : 'secondary'}>
                    {vehicleData.self_contained ? '✓ Self-Contained' : '✗ Not Self-Contained'}
                  </Badge>
                  {vehicleData.is_flagged && (
                    <Badge variant="destructive" className="gap-1">
                      <Flag className="h-3 w-3" />
                      Flagged: {vehicleData.flagged_reason}
                    </Badge>
                  )}
                  {vehicleData.homeless_status === 'confirmed' && (
                    <Badge variant="outline" className="gap-1 bg-cyan-100 text-cyan-800">
                      <Home className="h-3 w-3" />
                      Homeless (Confirmed)
                    </Badge>
                  )}
                  {vehicleData.enforcement_count > 0 && (
                    <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-800">
                      <Shield className="h-3 w-3" />
                      {vehicleData.enforcement_count} Prior Enforcement{vehicleData.enforcement_count !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Observations Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Select Observations ({selectedObservations.size} selected)
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={selectBreaches}>
                      Breaches Only
                    </Button>
                    <Button variant="outline" size="sm" onClick={selectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={selectNone}>
                      Clear
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Max Observations Selector */}
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <Label className="text-sm font-semibold min-w-[200px]">
                    Maximum observations to include:
                  </Label>
                  <Select
                    value={maxObservations.toString()}
                    onValueChange={(v) => setMaxObservations(parseInt(v))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="15">15</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Observations List */}
                {observations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No observations found for this vehicle
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {observations.slice(0, maxObservations).map((obs) => (
                      <Card
                        key={obs.observation_id}
                        className={`cursor-pointer transition-all ${
                          selectedObservations.has(obs.observation_id)
                            ? 'border-2 border-primary bg-primary/5'
                            : 'hover:border-primary/50'
                        }`}
                        onClick={() => toggleObservation(obs.observation_id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <Checkbox
                              checked={selectedObservations.has(obs.observation_id)}
                              onCheckedChange={() => toggleObservation(obs.observation_id)}
                              className="mt-1"
                            />

                            {/* Photo */}
                            {obs.photo && (
                              <div className="shrink-0">
                                <img
                                  src={obs.photo}
                                  alt="Observation"
                                  className="w-24 h-16 object-cover rounded border"
                                />
                              </div>
                            )}

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant={obs.is_breach ? 'destructive' : obs.is_compliant ? 'outline' : 'secondary'}>
                                  {obs.is_breach ? 'BREACH' : obs.is_compliant ? 'Compliant' : 'Non-Compliant'}
                                </Badge>
                                {obs.breach_type && (
                                  <Badge variant="outline" className="text-xs">
                                    {obs.breach_type}
                                  </Badge>
                                )}
                                <span className="text-sm font-semibold ml-auto">
                                  {formatInTimeZone(new Date(obs.recorded_at), NZ_TIMEZONE, 'dd/MM/yyyy HH:mm')}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-muted-foreground">Zone:</span>
                                  <span className="font-medium">{obs.zone_name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-muted-foreground">Officer:</span>
                                  <span className="font-medium">{obs.officer_name}</span>
                                </div>
                                {obs.gps_latitude && obs.gps_longitude && (
                                  <div className="col-span-2 text-xs text-muted-foreground">
                                    GPS: {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                                  </div>
                                )}
                              </div>

                              {obs.officer_notes && (
                                <div className="mt-2 text-xs p-2 bg-muted/50 rounded">
                                  {obs.officer_notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generate Report Button */}
            {observations.length > 0 && (
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setPreviewOpen(true)}
                  disabled={selectedObservations.size === 0}
                >
                  <Eye className="h-5 w-5 mr-2" />
                  Preview Report
                </Button>
                <Button
                  size="lg"
                  onClick={handleGeneratePDF}
                  disabled={isGenerating || selectedObservations.size === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isGenerating ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-5 w-5 mr-2" />
                  )}
                  Generate PDF Report ({selectedObservations.size} observations)
                </Button>
              </div>
            )}
          </>
        )}

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="h-6 w-6" />
                Report Preview
              </DialogTitle>
              <DialogDescription>
                Preview of the evidence report for {vehicleData?.plate_number}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-6 bg-white text-black border rounded-lg">
                <h2 className="text-2xl font-bold mb-4">VEHICLE EVIDENCE REPORT</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <div className="text-sm text-gray-600">Plate Number:</div>
                    <div className="font-mono font-bold text-xl">{vehicleData?.plate_number}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Vehicle:</div>
                    <div className="font-semibold">
                      {vehicleData?.vehicle_make} {vehicleData?.vehicle_model} ({vehicleData?.vehicle_color})
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Total Breaches:</div>
                    <div className="font-bold text-red-600">{vehicleData?.total_breaches}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Observations Included:</div>
                    <div className="font-bold">{selectedObservations.size}</div>
                  </div>
                </div>
                <div className="border-t pt-4">
                  <h3 className="font-bold mb-2">Selected Observations:</h3>
                  {observations
                    .filter(o => selectedObservations.has(o.observation_id))
                    .map((obs, idx) => (
                      <div key={obs.observation_id} className="mb-3 pb-3 border-b last:border-b-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold">#{idx + 1}</span>
                          <span className="text-sm">
                            {formatInTimeZone(new Date(obs.recorded_at), NZ_TIMEZONE, 'dd/MM/yyyy HH:mm')}
                          </span>
                          {obs.is_breach && (
                            <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                              BREACH
                            </span>
                          )}
                        </div>
                        <div className="text-sm">Zone: {obs.zone_name} | Officer: {obs.officer_name}</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
