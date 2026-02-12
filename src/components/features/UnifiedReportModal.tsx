/**
 * UnifiedReportModal - Single interface for all report types
 * 
 * Features:
 * - Step-based wizard (Type → Attach To → Details → Submit)
 * - Supports: Incident, H&S, Maintenance
 * - Attachable to: Vehicle, Zone, Person, Standalone
 * - Inline person creation
 * - GPS auto-capture
 * - Photo upload
 */

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Heart,
  Loader2,
  MapPin,
  Settings,
  Trash2,
  Upload,
  User,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type ReportType = 'incident' | 'hs' | 'maintenance';
type AttachmentType = 'vehicle' | 'zone' | 'person' | 'standalone';

interface UnifiedReportModalProps {
  open: boolean;
  onClose: () => void;
  
  // Pre-fill options (from context)
  defaultType?: ReportType;
  defaultVehicle?: { plateNumber: string; vehicleId?: string };
  defaultZone?: { zoneId: string; zoneName: string };
  defaultPerson?: { personId: string; personName: string };
  
  onSuccess: (reportId: string) => void;
}

interface PersonRecord {
  id: string;
  full_name: string;
  zone_id: string;
  tent_location_description?: string;
  homeless_claimed: boolean;
  risk_level?: string;
}

interface VehicleOption {
  plate_number: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
}

export function UnifiedReportModal({
  open,
  onClose,
  defaultType,
  defaultVehicle,
  defaultZone,
  defaultPerson,
  onSuccess,
}: UnifiedReportModalProps) {
  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [reportType, setReportType] = useState<ReportType>(defaultType || 'incident');
  const [attachmentType, setAttachmentType] = useState<AttachmentType>('standalone');
  
  // Attachment selections
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleOption | null>(
    defaultVehicle ? { plate_number: defaultVehicle.plateNumber } : null
  );
  const [selectedZone, setSelectedZone] = useState(defaultZone || null);
  const [selectedPerson, setSelectedPerson] = useState(defaultPerson || null);
  
  // Report details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [photos, setPhotos] = useState<string[]>([]);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  
  // Person creation
  const [showPersonCreation, setShowPersonCreation] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonTentLocation, setNewPersonTentLocation] = useState('');
  const [newPersonHomelessClaimed, setNewPersonHomelessClaimed] = useState(false);
  
  // Loading states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingPersons, setIsLoadingPersons] = useState(false);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(false);
  
  // Data lists
  const [personOptions, setPersonOptions] = useState<PersonRecord[]>([]);
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-capture GPS on mount
  useEffect(() => {
    if (open && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          console.error('GPS error:', error);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
  }, [open]);

  // Load person options when zone selected
  useEffect(() => {
    if (attachmentType === 'person' && selectedZone) {
      loadPersonOptions();
    }
  }, [attachmentType, selectedZone?.zoneId]);

  // Load vehicle options when needed
  useEffect(() => {
    if (attachmentType === 'vehicle') {
      loadVehicleOptions();
    }
  }, [attachmentType]);

  const loadPersonOptions = async () => {
    if (!selectedZone) return;
    
    setIsLoadingPersons(true);
    try {
      const { data, error } = await supabase
        .from('person_records')
        .select('id, full_name, zone_id, tent_location_description, homeless_claimed, risk_level')
        .eq('zone_id', selectedZone.zoneId)
        .order('full_name');

      if (error) throw error;
      setPersonOptions(data || []);
    } catch (error: any) {
      console.error('Failed to load persons:', error);
      toast.error('Failed to load person records');
    } finally {
      setIsLoadingPersons(false);
    }
  };

  const loadVehicleOptions = async () => {
    setIsLoadingVehicles(true);
    try {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, vehicle_color')
        .order('last_seen_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setVehicleOptions(data || []);
    } catch (error: any) {
      console.error('Failed to load vehicles:', error);
      toast.error('Failed to load vehicle records');
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const uploadedUrls: string[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const fileName = `reports/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      } catch (error: any) {
        console.error('Photo upload failed:', error);
        toast.error(`Failed to upload photo ${i + 1}`);
      }
    }

    setPhotos([...photos, ...uploadedUrls]);
    toast.success(`${uploadedUrls.length} photo(s) uploaded`);
  };

  const handleCreatePerson = async () => {
    if (!newPersonName.trim() || !selectedZone) {
      toast.error('Person name and zone are required');
      return;
    }

    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const { data: newPerson, error } = await supabase
        .from('person_records')
        .insert({
          organization_id: profile.organization_id,
          zone_id: selectedZone.zoneId,
          user_id: user.user.id,
          full_name: newPersonName.trim(),
          tent_location_description: newPersonTentLocation.trim() || null,
          homeless_claimed: newPersonHomelessClaimed,
          date_of_birth: null,
          id_verified: false,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Person record created: ${newPersonName}`);
      setSelectedPerson({
        personId: newPerson.id,
        personName: newPerson.full_name,
      });
      setShowPersonCreation(false);
      setNewPersonName('');
      setNewPersonTentLocation('');
      setNewPersonHomelessClaimed(false);
      
      // Reload person options
      loadPersonOptions();
    } catch (error: any) {
      console.error('Failed to create person:', error);
      toast.error('Failed to create person record: ' + error.message);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      let reportId: string | null = null;

      // Create appropriate report based on type
      if (reportType === 'incident') {
        const { data: incident, error } = await supabase
          .from('incidents')
          .insert({
            organization_id: profile.organization_id,
            user_id: user.user.id,
            zone_id: selectedZone?.zoneId || null,
            incident_type: 'other',
            description: description.trim(),
            severity: severity,
            status: 'pending',
            location_lat: gpsLocation?.lat,
            location_lng: gpsLocation?.lng,
            attachments: photos.length > 0 ? { photos } : null,
            plate_number: selectedVehicle?.plate_number || null,
          })
          .select()
          .single();

        if (error) throw error;
        reportId = incident.id;

        // Create person interaction if person selected
        if (selectedPerson) {
          await supabase.from('person_interactions').insert({
            organization_id: profile.organization_id,
            person_id: selectedPerson.personId,
            interaction_type: 'incident_report',
            zone_id: selectedZone?.zoneId || null,
            gps_latitude: gpsLocation?.lat,
            gps_longitude: gpsLocation?.lng,
            officer_id: user.user.id,
            officer_notes: description.trim(),
            vehicle_id: selectedVehicle?.plate_number || null,
            incident_id: incident.id,
            photos: photos,
            outcome: 'Incident report filed',
          });
        }

        toast.success('Incident report created successfully');
      } else if (reportType === 'hs') {
        const { data: hsReport, error } = await supabase
          .from('health_safety_reports')
          .insert({
            organization_id: profile.organization_id,
            zone_id: selectedZone?.zoneId,
            reported_by: user.user.id,
            details: description.trim(),
            severity: severity,
            status: 'pending',
            location_lat: gpsLocation?.lat,
            location_lng: gpsLocation?.lng,
            attachments: photos.length > 0 ? { photos } : null,
          })
          .select()
          .single();

        if (error) throw error;
        reportId = hsReport.id;

        // Create person interaction if person selected
        if (selectedPerson) {
          await supabase.from('person_interactions').insert({
            organization_id: profile.organization_id,
            person_id: selectedPerson.personId,
            interaction_type: 'hs_report',
            zone_id: selectedZone?.zoneId || null,
            gps_latitude: gpsLocation?.lat,
            gps_longitude: gpsLocation?.lng,
            officer_id: user.user.id,
            officer_notes: description.trim(),
            vehicle_id: selectedVehicle?.plate_number || null,
            hs_report_id: hsReport.id,
            photos: photos,
            outcome: 'H&S report filed',
          });
        }

        toast.success('H&S report created successfully');
      } else if (reportType === 'maintenance') {
        // Maintenance reports don't have a dedicated table yet
        // For now, store as incident with maintenance type
        const { data: maintenanceReport, error } = await supabase
          .from('incidents')
          .insert({
            organization_id: profile.organization_id,
            user_id: user.user.id,
            zone_id: selectedZone?.zoneId || null,
            incident_type: 'maintenance',
            description: `[MAINTENANCE] ${description.trim()}`,
            severity: severity,
            status: 'pending',
            location_lat: gpsLocation?.lat,
            location_lng: gpsLocation?.lng,
            attachments: photos.length > 0 ? { photos } : null,
          })
          .select()
          .single();

        if (error) throw error;
        reportId = maintenanceReport.id;

        // Create person interaction if person selected
        if (selectedPerson) {
          await supabase.from('person_interactions').insert({
            organization_id: profile.organization_id,
            person_id: selectedPerson.personId,
            interaction_type: 'maintenance_report',
            zone_id: selectedZone?.zoneId || null,
            gps_latitude: gpsLocation?.lat,
            gps_longitude: gpsLocation?.lng,
            officer_id: user.user.id,
            officer_notes: description.trim(),
            vehicle_id: selectedVehicle?.plate_number || null,
            photos: photos,
            outcome: 'Maintenance report filed',
          });
        }

        toast.success('Maintenance report created successfully');
      }

      if (reportId) {
        onSuccess(reportId);
        handleClose();
      }
    } catch (error: any) {
      console.error('Failed to create report:', error);
      toast.error('Failed to create report: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setCurrentStep(1);
    setReportType(defaultType || 'incident');
    setAttachmentType('standalone');
    setSelectedVehicle(null);
    setSelectedZone(null);
    setSelectedPerson(null);
    setTitle('');
    setDescription('');
    setSeverity('medium');
    setPhotos([]);
    setGpsLocation(null);
    onClose();
  };

  const goToNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goToPreviousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToNextStep = () => {
    switch (currentStep) {
      case 1:
        return reportType !== null;
      case 2:
        if (attachmentType === 'vehicle') return selectedVehicle !== null;
        if (attachmentType === 'zone') return selectedZone !== null;
        if (attachmentType === 'person') return selectedPerson !== null;
        return true; // Standalone always valid
      case 3:
        return title.trim() !== '' && description.trim() !== '';
      default:
        return true;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reportType === 'incident' && <AlertTriangle className="h-5 w-5 text-orange-600" />}
            {reportType === 'hs' && <Heart className="h-5 w-5 text-red-600" />}
            {reportType === 'maintenance' && <Wrench className="h-5 w-5 text-blue-600" />}
            Create {reportType === 'incident' ? 'Incident' : reportType === 'hs' ? 'H&S' : 'Maintenance'} Report
          </DialogTitle>
          
          {/* Step Indicator */}
          <div className="flex items-center gap-2 mt-4">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={cn(
                  'flex-1 h-2 rounded-full transition-colors',
                  step <= currentStep ? 'bg-primary' : 'bg-muted'
                )}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Step {currentStep} of 4: {
              currentStep === 1 ? 'Select Report Type' :
              currentStep === 2 ? 'Attach To' :
              currentStep === 3 ? 'Details' :
              'Review & Submit'
            }
          </p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* STEP 1: Report Type */}
          {currentStep === 1 && (
            <div className="space-y-3">
              <Label>What type of report are you creating?</Label>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  variant={reportType === 'incident' ? 'default' : 'outline'}
                  onClick={() => setReportType('incident')}
                  className="h-24 flex-col gap-2"
                >
                  <AlertTriangle className="h-6 w-6" />
                  <span>Incident</span>
                </Button>
                <Button
                  variant={reportType === 'hs' ? 'default' : 'outline'}
                  onClick={() => setReportType('hs')}
                  className="h-24 flex-col gap-2"
                >
                  <Heart className="h-6 w-6" />
                  <span>H&S</span>
                </Button>
                <Button
                  variant={reportType === 'maintenance' ? 'default' : 'outline'}
                  onClick={() => setReportType('maintenance')}
                  className="h-24 flex-col gap-2"
                >
                  <Wrench className="h-6 w-6" />
                  <span>Maintenance</span>
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: Attachment Type */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <Label>Attach this report to:</Label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={attachmentType === 'vehicle' ? 'default' : 'outline'}
                  onClick={() => setAttachmentType('vehicle')}
                  className="h-20 flex-col gap-2"
                >
                  <FileText className="h-5 w-5" />
                  <span>Vehicle</span>
                </Button>
                <Button
                  variant={attachmentType === 'zone' ? 'default' : 'outline'}
                  onClick={() => setAttachmentType('zone')}
                  className="h-20 flex-col gap-2"
                >
                  <MapPin className="h-5 w-5" />
                  <span>Zone</span>
                </Button>
                <Button
                  variant={attachmentType === 'person' ? 'default' : 'outline'}
                  onClick={() => setAttachmentType('person')}
                  className="h-20 flex-col gap-2"
                >
                  <User className="h-5 w-5" />
                  <span>Person</span>
                </Button>
                <Button
                  variant={attachmentType === 'standalone' ? 'default' : 'outline'}
                  onClick={() => setAttachmentType('standalone')}
                  className="h-20 flex-col gap-2"
                >
                  <Settings className="h-5 w-5" />
                  <span>Standalone</span>
                </Button>
              </div>

              {/* Vehicle Selector */}
              {attachmentType === 'vehicle' && (
                <div className="space-y-2 mt-4">
                  <Label>Select Vehicle</Label>
                  {isLoadingVehicles ? (
                    <div className="text-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-2">
                      {vehicleOptions.map((vehicle) => (
                        <button
                          key={vehicle.plate_number}
                          onClick={() => setSelectedVehicle(vehicle)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                            selectedVehicle?.plate_number === vehicle.plate_number
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-muted border-transparent'
                          )}
                        >
                          <div className="font-mono font-bold">{vehicle.plate_number}</div>
                          {(vehicle.vehicle_make || vehicle.vehicle_model) && (
                            <div className="text-sm opacity-80">
                              {vehicle.vehicle_make} {vehicle.vehicle_model} {vehicle.vehicle_color}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Zone Selector */}
              {attachmentType === 'zone' && !defaultZone && (
                <div className="space-y-2 mt-4">
                  <Alert>
                    <MapPin className="h-4 w-4" />
                    <AlertDescription>
                      Zone selection requires zone context. Please specify zone when opening this modal.
                    </AlertDescription>
                  </Alert>
                </div>
              )}

              {/* Person Selector with Inline Creation */}
              {attachmentType === 'person' && (
                <div className="space-y-2 mt-4">
                  <div className="flex items-center justify-between">
                    <Label>Select Person</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPersonCreation(!showPersonCreation)}
                    >
                      <Users className="h-4 w-4 mr-2" />
                      New Person
                    </Button>
                  </div>

                  {showPersonCreation && (
                    <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                      <div>
                        <Label htmlFor="new-person-name">Full Name *</Label>
                        <Input
                          id="new-person-name"
                          value={newPersonName}
                          onChange={(e) => setNewPersonName(e.target.value)}
                          placeholder="John Doe"
                        />
                      </div>
                      <div>
                        <Label htmlFor="tent-location">Tent/Structure Location</Label>
                        <Input
                          id="tent-location"
                          value={newPersonTentLocation}
                          onChange={(e) => setNewPersonTentLocation(e.target.value)}
                          placeholder="Near south carpark, blue tent"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="homeless-claimed"
                          checked={newPersonHomelessClaimed}
                          onChange={(e) => setNewPersonHomelessClaimed(e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor="homeless-claimed" className="cursor-pointer">
                          Person claims homeless status
                        </Label>
                      </div>
                      <Button
                        onClick={handleCreatePerson}
                        disabled={!newPersonName.trim() || !selectedZone}
                        className="w-full"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Create Person Record
                      </Button>
                    </div>
                  )}

                  {isLoadingPersons ? (
                    <div className="text-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </div>
                  ) : personOptions.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-2">
                      {personOptions.map((person) => (
                        <button
                          key={person.id}
                          onClick={() => setSelectedPerson({ personId: person.id, personName: person.full_name })}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                            selectedPerson?.personId === person.id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-muted border-transparent'
                          )}
                        >
                          <div className="font-bold">{person.full_name}</div>
                          {person.tent_location_description && (
                            <div className="text-sm opacity-80">{person.tent_location_description}</div>
                          )}
                          {person.homeless_claimed && (
                            <Badge variant="secondary" className="mt-1">Homeless</Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Alert>
                      <User className="h-4 w-4" />
                      <AlertDescription>
                        No person records found in this zone. Create a new record above.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Details */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief title of the report"
                />
              </div>

              <div>
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed description of the incident, issue, or maintenance need..."
                  rows={5}
                />
              </div>

              <div>
                <Label>Severity</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Button
                    variant={severity === 'low' ? 'default' : 'outline'}
                    onClick={() => setSeverity('low')}
                  >
                    Low
                  </Button>
                  <Button
                    variant={severity === 'medium' ? 'default' : 'outline'}
                    onClick={() => setSeverity('medium')}
                  >
                    Medium
                  </Button>
                  <Button
                    variant={severity === 'high' ? 'default' : 'outline'}
                    onClick={() => setSeverity('high')}
                  >
                    High
                  </Button>
                </div>
              </div>

              <div>
                <Label>Photos</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full mt-2"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Upload Photos ({photos.length})
                </Button>
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {photos.map((photo, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border">
                        <img src={photo} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setPhotos(photos.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 bg-red-600 text-white p-1 rounded-full hover:bg-red-700"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {gpsLocation && (
                <Alert>
                  <MapPin className="h-4 w-4" />
                  <AlertDescription>
                    GPS Location Captured ({gpsLocation.accuracy.toFixed(0)}m accuracy)
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* STEP 4: Review & Submit */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Review your report details before submitting
                </AlertDescription>
              </Alert>

              <div className="border rounded-lg p-4 space-y-3">
                <div>
                  <Label className="text-muted-foreground">Report Type</Label>
                  <p className="font-semibold capitalize">{reportType}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Attached To</Label>
                  <p className="font-semibold capitalize">
                    {attachmentType === 'vehicle' && selectedVehicle ? selectedVehicle.plate_number :
                     attachmentType === 'zone' && selectedZone ? selectedZone.zoneName :
                     attachmentType === 'person' && selectedPerson ? selectedPerson.personName :
                     'Standalone'}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Title</Label>
                  <p className="font-semibold">{title}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="text-sm">{description}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Severity</Label>
                  <Badge variant={severity === 'high' ? 'destructive' : severity === 'medium' ? 'default' : 'secondary'}>
                    {severity}
                  </Badge>
                </div>
                {photos.length > 0 && (
                  <div>
                    <Label className="text-muted-foreground">Photos</Label>
                    <p className="text-sm">{photos.length} photo(s) attached</p>
                  </div>
                )}
                {gpsLocation && (
                  <div>
                    <Label className="text-muted-foreground">GPS</Label>
                    <p className="text-sm">Captured ({gpsLocation.accuracy.toFixed(0)}m accuracy)</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center gap-2">
          {currentStep > 1 && (
            <Button variant="outline" onClick={goToPreviousStep}>
              <ChevronLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          )}
          
          {currentStep < 4 ? (
            <Button onClick={goToNextStep} disabled={!canProceedToNextStep()}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Submit Report
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
