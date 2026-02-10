import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  MapPin,
  Plus,
  Trash2,
  Flag,
  FileText,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Camera,
  Home,
  Bell,
  MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { useVehicleCompliance } from '@/hooks/useVehicleCompliance';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group';

interface VerificationData {
  plateNumber: string;
  zoneId: string;
  zoneName: string;
  organizationId: string;
  complianceResult: {
    is_compliant: boolean;
    is_homeless: boolean;
  };
  claimsHomeless: boolean;
  isSelfContained: boolean;
  hasGreenSticker: boolean;
  hasBlueSticker: boolean;
  scvRegistrationStatus: string;
  plateInputMethod: 'ocr' | 'manual' | 'auto_populated';
  scannedPhoto: string | null;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  vehicleColor?: string;
  vehicleRecordId?: string;
}

interface EvidenceCollectionProps {
  verificationData: VerificationData;
  onBack: () => void;
  onComplete: () => void;
}

interface PreviousRecord {
  id: string;
  plate_number: string;
  zone_name: string;
  organization_name: string;
  recorded_at: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  homeless_claimed: boolean;
  homeless_confirmed: boolean | null;
  behavioral_flags: string[];
  is_compliant: boolean;
  notes?: string;
}

interface FlaggedVehicle {
  id: string;
  plate_number: string;
  notes: string;
  priority: string;
  is_active: boolean;
  last_known_site: string;
}

interface BreachInfo {
  current_status: 'compliant' | 'breach' | 'warning';
  days_stayed: number;
  max_consecutive: number;
  message: string;
  severity: 'info' | 'warning' | 'danger';
}

interface TimeComplianceWarning {
  type: 'evening_warning' | 'overnight_confirmed' | 'day_visit_breach' | 'last_night_warning';
  message: string;
  requiresOfficerAction: boolean;
  severity: 'warning' | 'danger' | 'info';
  suggestedActions: string[];
}

interface CriticalWarning {
  type: 'flagged' | 'homeless' | 'hs_issues' | 'breach' | 'at_limit';
  title: string;
  message: string;
  severity: 'danger' | 'warning' | 'info';
}

export function EvidenceCollection({ verificationData, onBack, onComplete }: EvidenceCollectionProps) {
  const { user } = useAuthStore();
  const [vehicleMake, setVehicleMake] = useState(verificationData.vehicleMake || '');
  const [vehicleModel, setVehicleModel] = useState(verificationData.vehicleModel || '');
  const [vehicleYear, setVehicleYear] = useState(verificationData.vehicleYear || '');
  const [vehicleColor, setVehicleColor] = useState(verificationData.vehicleColor || '');
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>(() => {
    return verificationData.scannedPhoto ? [verificationData.scannedPhoto] : [];
  });
  const [notes, setNotes] = useState('');
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [behavioralFlags, setBehavioralFlags] = useState<string[]>([]);
  const [requiresFollowup, setRequiresFollowup] = useState(false);
  const [followupReason, setFollowupReason] = useState('');
  const [followupPriority, setFollowupPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [weatherConditions, setWeatherConditions] = useState('');
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [previousRecords, setPreviousRecords] = useState<PreviousRecord[]>([]);
  const [flaggedVehicle, setFlaggedVehicle] = useState<FlaggedVehicle | null>(null);
  
  // Use centralized compliance hook - SINGLE SOURCE OF TRUTH
  const { data: complianceData, isLoading: isLoadingCompliance } = useVehicleCompliance(
    verificationData.plateNumber,
    verificationData.zoneId
  );
  const [showMismatchDialog, setShowMismatchDialog] = useState(false);
  const [mismatchData, setMismatchData] = useState<{
    aiMake?: string;
    aiModel?: string;
    aiColor?: string;
    aiYear?: string;
    prevMake?: string;
    prevModel?: string;
    prevColor?: string;
    prevYear?: string;
  } | null>(null);
  const [isUpdatingRecords, setIsUpdatingRecords] = useState(false);
  const [timeComplianceWarning, setTimeComplianceWarning] = useState<TimeComplianceWarning | null>(null);
  const [showTimeComplianceDialog, setShowTimeComplianceDialog] = useState(false);
  const [selectedEnforcementAction, setSelectedEnforcementAction] = useState<string>('');
  const [enforcementNotes, setEnforcementNotes] = useState('');
  const [isRecordingEnforcement, setIsRecordingEnforcement] = useState(false);
  const [vehicleRecordId, setVehicleRecordId] = useState<string | null>(verificationData.vehicleRecordId || null);
  
  // NEW: Critical warnings dialog state
  const [criticalWarnings, setCriticalWarnings] = useState<CriticalWarning[]>([]);
  const [showCriticalWarningDialog, setShowCriticalWarningDialog] = useState(false);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState(false);
  
  // GPS accuracy tracking
  const [isAcquiringGPS, setIsAcquiringGPS] = useState(true);
  const [gpsAccuracyStatus, setGpsAccuracyStatus] = useState<'acquiring' | 'good' | 'fair' | 'poor'>('acquiring');
  const gpsWatchIdRef = useRef<number | null>(null);
  const bestAccuracyRef = useRef<number>(9999);
  
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Check time-based compliance on mount
  useEffect(() => {
    checkTimeBasedCompliance();
  }, []);

  // Check time-based compliance logic
  const checkTimeBasedCompliance = async () => {
    try {
      const currentTime = new Date();
      const nzTime = new Date(currentTime.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
      const currentHour = nzTime.getHours();

      const { data: zone, error: zoneError } = await supabase
        .from('zones')
        .select('*')
        .eq('id', verificationData.zoneId)
        .single();

      if (zoneError || !zone) {
        console.error('Failed to load zone:', zoneError);
        return;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      monthStart.setHours(0, 0, 0, 0);

      const { data: recentRecords, error: recordsError } = await supabase
        .from('vehicle_records')
        .select('recorded_at')
        .eq('plate_number', verificationData.plateNumber.toUpperCase())
        .eq('zone_id', verificationData.zoneId)
        .gte('recorded_at', monthStart.toISOString())
        .order('recorded_at', { ascending: false });

      if (recordsError) throw recordsError;

      const dates = recentRecords?.map(r => new Date(r.recorded_at).toDateString()) || [];
      const uniqueDates = [...new Set(dates)];
      const totalNightsInMonth = uniqueDates.length;
      
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const currentMonthName = now.toLocaleString('en-NZ', { month: 'long' });
      
      let consecutiveDays = 0;

      const today = new Date().toDateString();
      let currentDate = new Date();

      for (let i = 0; i < daysInMonth; i++) {
        const dateStr = currentDate.toDateString();
        if (uniqueDates.includes(dateStr)) {
          consecutiveDays++;
        } else if (i > 0) {
          break;
        }
        currentDate.setDate(currentDate.getDate() - 1);
      }

      let warning: TimeComplianceWarning | null = null;

      if (currentHour >= 20 || currentHour < 5) {
        
        if (zone.day_visit_only) {
          warning = {
            type: 'day_visit_breach',
            message: `🚨 BREACH DETECTED: Recording after 20:00 in a DAY-VISIT-ONLY zone. Vehicle is staying overnight in violation of zone rules.`,
            requiresOfficerAction: true,
            severity: 'danger',
            suggestedActions: [
              'Issued warning notice - must leave immediately',
              'Issued tow notice - vehicle must be moved by morning',
              'Spoke with owner - agreed to leave tonight',
              'Owner not present - notice left on windscreen'
            ]
          };
        } else if (totalNightsInMonth >= zone.nights_per_month) {
          warning = {
            type: 'overnight_confirmed',
            message: `🚨 MONTHLY LIMIT BREACH: Vehicle has stayed ${totalNightsInMonth} nights in ${currentMonthName} (max: ${zone.nights_per_month}). $400 fine applicable.`,
            requiresOfficerAction: true,
            severity: 'danger',
            suggestedActions: [
              'Issued breach notice - monthly limit exceeded, $400 fine',
              'Informed owner - must leave zone until next month',
              'Tow notice issued - vehicle must be removed',
              'Owner not present - enforcement notice on windscreen'
            ]
          };
        } else if (consecutiveDays >= zone.max_consecutive_nights) {
          warning = {
            type: 'overnight_confirmed',
            message: `🚨 CONSECUTIVE NIGHTS BREACH: This is night ${consecutiveDays + 1} (max: ${zone.max_consecutive_nights} consecutive). Vehicle has exceeded zone limits.`,
            requiresOfficerAction: true,
            severity: 'danger',
            suggestedActions: [
              'Issued breach notice - consecutive limit exceeded, $400 fine',
              'Informed owner - must leave tomorrow morning',
              'Tow notice issued - vehicle must be removed',
              'Owner not present - enforcement notice on windscreen'
            ]
          };
        } else if (consecutiveDays === zone.max_consecutive_nights - 1) {
          warning = {
            type: 'last_night_warning',
            message: `⚠️ FINAL CONSECUTIVE NIGHT: This is night ${consecutiveDays + 1} of ${zone.max_consecutive_nights} allowed. Vehicle MUST leave tomorrow or face $400 fine.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Informed owner - this is final consecutive night, must leave tomorrow',
              'Left notice - vehicle must be moved by 8am tomorrow',
              'Spoke with owner - understood and will leave',
              'Owner not present - final warning notice on windscreen'
            ]
          };
        } else if (totalNightsInMonth >= zone.nights_per_month - 2) {
          const nightsRemaining = zone.nights_per_month - totalNightsInMonth;
          warning = {
            type: 'last_night_warning',
            message: `⚠️ MONTHLY LIMIT WARNING: Vehicle has ${nightsRemaining} night${nightsRemaining === 1 ? '' : 's'} remaining in ${currentMonthName} (${totalNightsInMonth}/${zone.nights_per_month} nights used).`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Informed owner - approaching monthly limit, plan accordingly',
              'Left notice - monthly parking limit information',
              'Spoke with owner - understood monthly restrictions',
              'Owner not present - advisory notice on windscreen'
            ]
          };
        } else {
          setNotes(prev => `${prev}\n\n🌙 OVERNIGHT STAY CONFIRMED (recorded after 20:00 NZ time)\nConsecutive: ${consecutiveDays + 1}/${zone.max_consecutive_nights} | ${currentMonthName}: ${totalNightsInMonth + 1}/${zone.nights_per_month}`.trim());
        }
      } else if (currentHour >= 15 && currentHour < 20) {
        
        if (zone.day_visit_only) {
          warning = {
            type: 'evening_warning',
            message: `⚠️ DAY-VISIT-ONLY ZONE: Recording in evening hours. Advise vehicle owner they cannot stay overnight and must leave before 20:00.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Advised owner - must leave before 20:00 (day-visit-only)',
              'Left notice - no overnight parking allowed',
              'Spoke with owner - will leave shortly',
              'Owner not present - advisory notice left'
            ]
          };
        } else if (totalNightsInMonth >= zone.nights_per_month) {
          warning = {
            type: 'evening_warning',
            message: `🚨 MONTHLY LIMIT REACHED: Vehicle has stayed ${totalNightsInMonth} nights in ${currentMonthName} (max: ${zone.nights_per_month}). Advise owner they CANNOT stay tonight.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Advised owner - monthly limit reached for ' + currentMonthName + ', cannot stay',
              'Left notice - must leave before 20:00 or face $400 fine',
              'Spoke with owner - understood and will leave',
              'Owner not present - warning notice on windscreen'
            ]
          };
        } else if (consecutiveDays >= zone.max_consecutive_nights) {
          warning = {
            type: 'evening_warning',
            message: `🚨 CONSECUTIVE LIMIT REACHED: Vehicle has stayed ${consecutiveDays} consecutive nights (max: ${zone.max_consecutive_nights}). Advise owner they CANNOT stay tonight.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Advised owner - consecutive limit reached, cannot stay',
              'Left notice - must leave before 20:00 or face $400 fine',
              'Spoke with owner - understood and will leave',
              'Owner not present - warning notice on windscreen'
            ]
          };
        } else if (consecutiveDays === zone.max_consecutive_nights - 1) {
          warning = {
            type: 'evening_warning',
            message: `⚠️ FINAL CONSECUTIVE NIGHT: If vehicle stays tonight, this will be night ${consecutiveDays + 1} of ${zone.max_consecutive_nights} allowed. Advise owner they MUST leave tomorrow.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Informed owner - this is final consecutive night, must leave tomorrow',
              'Left notice - parking limit information provided',
              'Spoke with owner - understood restrictions',
              'Owner not present - warning notice on windscreen'
            ]
          };
        } else if (totalNightsInMonth >= zone.nights_per_month - 2) {
          const nightsRemaining = zone.nights_per_month - totalNightsInMonth;
          warning = {
            type: 'evening_warning',
            message: `⚠️ MONTHLY LIMIT WARNING: Vehicle has ${nightsRemaining} night${nightsRemaining === 1 ? '' : 's'} remaining in ${currentMonthName} (${daysInMonth} days). Advise owner to plan accordingly.`,
            requiresOfficerAction: true,
            severity: 'warning',
            suggestedActions: [
              'Informed owner - approaching monthly limit for ' + currentMonthName + ', plan stays carefully',
              'Left notice - monthly parking limit information',
              'Spoke with owner - understood and will monitor usage',
              'Owner not present - advisory notice on windscreen'
            ]
          };
        }
      }

      if (warning) {
        setTimeComplianceWarning(warning);
        setShowTimeComplianceDialog(true);
      }
    } catch (error) {
      console.error('Time compliance check failed:', error);
    }
  };

  // Record enforcement action
  const recordEnforcementAction = async () => {
    if (!selectedEnforcementAction || !user) {
      toast.error('Please select an action taken');
      return;
    }

    setIsRecordingEnforcement(true);
    try {
      // Map enforcement action to correct action_type
      let actionType = 'warning';
      if (selectedEnforcementAction.includes('No Action - Homeless Confirmed')) {
        actionType = 'no_action_homeless';
      } else if (selectedEnforcementAction.includes('No action taken')) {
        actionType = 'no_action';
      } else if (timeComplianceWarning?.type === 'day_visit_breach' || timeComplianceWarning?.type === 'overnight_confirmed') {
        actionType = 'breach_notice';
      } else if (selectedEnforcementAction.includes('Issued tow notice')) {
        actionType = 'tow_request';
      } else if (selectedEnforcementAction.includes('Issued warning notice') || selectedEnforcementAction.includes('Issued breach notice')) {
        actionType = 'notice';
      }

      const { error } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: verificationData.organizationId,
          user_id: user.id,
          zone_id: verificationData.zoneId,
          action_type: actionType,
          delivery_method: 'in_person',
          recipient_name: null,
          notes: `Time-based compliance action:\n${selectedEnforcementAction}${enforcementNotes ? '\n\nAdditional notes: ' + enforcementNotes : ''}\n\nContext: ${timeComplianceWarning?.message}`,
          location_lat: gpsLocation?.lat || null,
          location_lng: gpsLocation?.lng || null,
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          recorded_at: new Date().toISOString(),
        });

      if (error) throw error;

      const actionNote = `\n\n📋 ENFORCEMENT ACTION:\n${selectedEnforcementAction}${enforcementNotes ? '\n' + enforcementNotes : ''}`;
      setNotes(prev => (prev + actionNote).trim());

      toast.success('✅ Enforcement action recorded');
      setShowTimeComplianceDialog(false);
    } catch (error: any) {
      console.error('Failed to record enforcement:', error);
      toast.error('Failed to record action: ' + error.message);
    } finally {
      setIsRecordingEnforcement(false);
    }
  };

  // Enhanced GPS tracking for high accuracy
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      toast.error('GPS not available on this device');
      setIsAcquiringGPS(false);
      return;
    }

    let positionCount = 0;
    const maxPositions = 10; // Stop after 10 good readings
    const targetAccuracy = 5; // Target 5 meters
    const acceptableAccuracy = 10; // Accept up to 10 meters
    const timeout = 30000; // 30 second timeout
    
    const startTime = Date.now();

    // Use watchPosition for continuous updates
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = position.coords.accuracy;
        const elapsed = Date.now() - startTime;

        // Update GPS status based on accuracy
        if (accuracy <= targetAccuracy) {
          setGpsAccuracyStatus('good');
        } else if (accuracy <= acceptableAccuracy) {
          setGpsAccuracyStatus('fair');
        } else {
          setGpsAccuracyStatus('poor');
        }

        // Only update if this position is more accurate than previous best
        if (accuracy < bestAccuracyRef.current) {
          bestAccuracyRef.current = accuracy;
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: accuracy,
          });

          // Fetch weather only once when we get a good position
          if (accuracy <= acceptableAccuracy && positionCount === 0) {
            fetchWeather(position.coords.latitude, position.coords.longitude);
          }
        }

        positionCount++;

        // Stop acquiring after getting enough good readings or timeout
        if (accuracy <= targetAccuracy || positionCount >= maxPositions || elapsed >= timeout) {
          setIsAcquiringGPS(false);
        }
      },
      (error) => {
        console.error('GPS error:', error);
        setIsAcquiringGPS(false);
        setGpsAccuracyStatus('poor');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    gpsWatchIdRef.current = watchId;

    // Cleanup function
    return () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, []);

  // Fetch global vehicle history, flags, and weather on mount
  useEffect(() => {
    const initializeData = async () => {
      if (!verificationData.vehicleRecordId) {
        await createInitialVehicleRecord();
      }

      await loadVehicleHistory();
    };

    initializeData();
  }, [verificationData.plateNumber]);

  const createInitialVehicleRecord = async () => {
    if (!user) {
      return;
    }

    try {
      const recordTimeNZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
      const recordHour = recordTimeNZ.getHours();
      const isOvernightStay = recordHour >= 21 || recordHour < 5;
      
      const hasVehicleDetails = vehicleMake || vehicleModel || vehicleColor || vehicleYear;
      const needsAdminReview = !hasVehicleDetails;
      
      const initialNotes = `Recorded Time (NZ): ${recordTimeNZ.toLocaleString('en-NZ', {
        timeZone: 'Pacific/Auckland',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })}${isOvernightStay ? '\n🌙 OVERNIGHT STAY CONFIRMED (Recorded 9pm-5am NZ time)' : ''}${needsAdminReview ? '\n⚠️ VEHICLE DETAILS UNKNOWN - Requires admin verification with CarJam' : ''}`;

      const recordData = {
        organization_id: verificationData.organizationId,
        zone_id: verificationData.zoneId,
        plate_number: verificationData.plateNumber.toUpperCase(),
        recorded_by: user.id,
        is_self_contained: verificationData.isSelfContained ?? false,
        is_compliant: true,
        notes: initialNotes,
        vehicle_make: vehicleMake || 'Unknown',
        vehicle_model: vehicleModel || 'Unknown',
        vehicle_color: vehicleColor || 'Unknown',
        evidence_photos: verificationData.scannedPhoto ? [verificationData.scannedPhoto] : [],
        evidence_timestamp: new Date().toISOString(),
        gps_latitude: gpsLocation?.lat || null,
        gps_longitude: gpsLocation?.lng || null,
        gps_accuracy: gpsLocation?.accuracy || null,
        location_lat: gpsLocation?.lat || null,
        location_lng: gpsLocation?.lng || null,
        behavioral_flags: [],
        requires_followup: needsAdminReview,
        followup_reason: needsAdminReview ? 'Vehicle details unavailable from ALPR/AI - requires verification with CarJam' : null,
        followup_priority: needsAdminReview ? 'medium' : null,
        weather_conditions: null,
        plate_input_method: verificationData.plateInputMethod,
        homeless_claimed: verificationData.claimsHomeless,
        homeless_confirmed: null,
        homeless_confirmed_by: null,
        homeless_confirmed_at: null,
      };

      const { data: createdRecord, error: insertError } = await supabase
        .from('vehicle_records')
        .insert(recordData)
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      setVehicleRecordId(createdRecord.id);
      
      if (needsAdminReview) {
        toast.success('✅ Record created - flagged for admin to verify vehicle details', { duration: 4000 });
      } else {
        toast.success('✅ Record created - add evidence and notes below', { duration: 4000 });
      }
    } catch (error: any) {
      console.error('❌ Failed to create initial record:', error);
      toast.error('Failed to create record: ' + (error.message || 'Unknown error'));
    }
  };

  // Separate function for loading vehicle history in background
  const loadVehicleHistory = async () => {
    try {
      const plateNumber = verificationData.plateNumber.toUpperCase().trim();

      const warnings: CriticalWarning[] = [];

      const { data: records, error: recordsError } = await supabase
        .from('vehicle_records')
        .select(`
          id,
          plate_number,
          recorded_at,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          homeless_claimed,
          homeless_confirmed,
          behavioral_flags,
          is_compliant,
          notes,
          zone:zones(name),
          organization:organizations(name)
        `)
        .eq('plate_number', plateNumber)
        .order('recorded_at', { ascending: false })
        .limit(10);

      if (recordsError) throw recordsError;

      if (records && records.length > 0) {
        setPreviousRecords(
          records.map((r: any) => ({
            id: r.id,
            plate_number: r.plate_number,
            zone_name: r.zone?.name || 'Unknown Zone',
            organization_name: r.organization?.name || 'Unknown Org',
            recorded_at: r.recorded_at,
            vehicle_make: r.vehicle_make,
            vehicle_model: r.vehicle_model,
            vehicle_color: r.vehicle_color,
            homeless_claimed: r.homeless_claimed || false,
            homeless_confirmed: r.homeless_confirmed,
            behavioral_flags: r.behavioral_flags || [],
            is_compliant: r.is_compliant,
            notes: r.notes,
          }))
        );

        // NEW: Check for homeless status warnings
        const hasHomelessConfirmed = records.some(r => r.homeless_confirmed === true);
        const hasHomelessPending = records.some(r => r.homeless_claimed && r.homeless_confirmed === null);
        
        if (hasHomelessConfirmed) {
          warnings.push({
            type: 'homeless',
            title: '🏠 Confirmed Homeless Status',
            message: `This vehicle has confirmed homeless status in previous records. Officer should be aware of individual's situation and available support services.`,
            severity: 'info',
          });
        } else if (hasHomelessPending) {
          warnings.push({
            type: 'homeless',
            title: '⏳ Homeless Claim Pending',
            message: `This vehicle has a homeless claim pending admin review. Status not yet confirmed.`,
            severity: 'info',
          });
        }

        // NEW: Check for H&S/behavioral issues
        const hasBehavioralFlags = records.some(r => r.behavioral_flags && r.behavioral_flags.length > 0);
        if (hasBehavioralFlags) {
          const allFlags = [...new Set(records.flatMap(r => r.behavioral_flags || []))];
          warnings.push({
            type: 'hs_issues',
            title: '⚠️ Officer Safety Alert',
            message: `Previous behavioral issues recorded: ${allFlags.join(', ')}. Exercise appropriate caution when approaching this vehicle.`,
            severity: 'warning',
          });
        }

        // Check for mismatches between AI and previous records
        const latest = records[0];
        const hasPreviousData = latest.vehicle_make || latest.vehicle_model || latest.vehicle_color;
        const hasAIData = verificationData.vehicleMake || verificationData.vehicleModel || verificationData.vehicleColor;

        if (hasPreviousData && hasAIData) {
          const makeMismatch = latest.vehicle_make && verificationData.vehicleMake && 
            latest.vehicle_make.toLowerCase().trim() !== verificationData.vehicleMake.toLowerCase().trim();
          const modelMismatch = latest.vehicle_model && verificationData.vehicleModel && 
            latest.vehicle_model.toLowerCase().trim() !== verificationData.vehicleModel.toLowerCase().trim();
          const colorMismatch = latest.vehicle_color && verificationData.vehicleColor && 
            latest.vehicle_color.toLowerCase().trim() !== verificationData.vehicleColor.toLowerCase().trim();

          if (makeMismatch || colorMismatch) {
            console.warn('⚠️ MISMATCH DETECTED between AI and previous records');
            setMismatchData({
              aiMake: verificationData.vehicleMake,
              aiModel: verificationData.vehicleModel,
              aiColor: verificationData.vehicleColor,
              aiYear: verificationData.vehicleYear,
              prevMake: latest.vehicle_make,
              prevModel: latest.vehicle_model,
              prevColor: latest.vehicle_color,
              prevYear: latest.vehicle_year,
            });
            
            if (latest.vehicle_make) setVehicleMake(latest.vehicle_make);
            if (latest.vehicle_model) setVehicleModel(latest.vehicle_model);
            if (latest.vehicle_color) setVehicleColor(latest.vehicle_color);
            if (latest.vehicle_year) setVehicleYear(latest.vehicle_year);
            
            setTimeout(() => setShowMismatchDialog(true), 1000);
          } else {
            if (latest.vehicle_make) setVehicleMake(latest.vehicle_make);
            if (latest.vehicle_model) setVehicleModel(latest.vehicle_model);
            if (latest.vehicle_color) setVehicleColor(latest.vehicle_color);
            if (latest.vehicle_year) setVehicleYear(latest.vehicle_year);
          }
        } else if (hasPreviousData) {
          if (latest.vehicle_make) setVehicleMake(latest.vehicle_make);
          if (latest.vehicle_model) setVehicleModel(latest.vehicle_model);
          if (latest.vehicle_color) setVehicleColor(latest.vehicle_color);
          if (latest.vehicle_year) setVehicleYear(latest.vehicle_year);
        }

        toast.info(`ℹ️ Found ${records.length} previous record${records.length === 1 ? '' : 's'} for this plate`);
      }

      // Check for flagged vehicles
      const { data: flagged, error: flagError } = await supabase
        .from('flagged_vehicles')
        .select('*')
        .ilike('plate_number', plateNumber)
        .eq('is_active', true)
        .single();

      if (flagError) {
        // No flagged vehicle found
      }

      if (!flagError && flagged) {
        setFlaggedVehicle(flagged);
        
        // NEW: Add flagged vehicle warning
        warnings.push({
          type: 'flagged',
          title: '🚨 FLAGGED VEHICLE - OFFICER SAFETY',
          message: `${flagged.priority.toUpperCase()} PRIORITY: ${flagged.notes}\n\nLast seen: ${flagged.last_known_site}\n\n⚠️ Exercise extreme caution when approaching this vehicle.`,
          severity: 'danger',
        });
        
        toast.error(`⚠️ SAFETY ALERT: This vehicle is flagged - ${flagged.priority.toUpperCase()} priority`);
      }

      // Note: Compliance warnings will be added from the hook data below
    } catch (error) {
      console.error('Failed to fetch vehicle history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Add compliance warnings when compliance data is loaded
  useEffect(() => {
    if (complianceData && !isLoadingCompliance) {
      const warnings = [...criticalWarnings];
      
      // Add breach warnings based on centralized compliance calculation
      if (!complianceData.is_compliant || complianceData.violation_severity === 'critical') {
        warnings.push({
          type: 'breach',
          title: '🚨 BREACH DETECTED',
          message: complianceData.violation_message + '\n\n📋 ' + (complianceData.recommended_action || 'Enforcement action recommended'),
          severity: 'danger',
        });
      } else if (complianceData.violation_severity === 'warning') {
        warnings.push({
          type: 'at_limit',
          title: '⚠️ AT MAXIMUM STAY LIMIT',
          message: complianceData.violation_message + '\n\n💡 ' + (complianceData.recommended_action || 'Advise owner of limits'),
          severity: 'warning',
        });
      }

      if (warnings.length > 0 && !acknowledgedWarnings) {
        setCriticalWarnings(warnings);
        setShowCriticalWarningDialog(true);
      }
    }
  }, [complianceData, isLoadingCompliance]);

  // Update all previous records with corrected vehicle details
  const updateAllRecords = async (correctedMake: string, correctedModel: string, correctedColor: string, correctedYear: string) => {
    if (!user) return;
    
    setIsUpdatingRecords(true);
    try {
      const { error } = await supabase
        .from('vehicle_records')
        .update({
          vehicle_make: correctedMake || null,
          vehicle_model: correctedModel || null,
          vehicle_color: correctedColor || null,
          vehicle_year: correctedYear || null,
        })
        .eq('plate_number', verificationData.plateNumber.toUpperCase());

      if (error) throw error;

      setVehicleMake(correctedMake);
      setVehicleModel(correctedModel);
      setVehicleColor(correctedColor);
      setVehicleYear(correctedYear);

      toast.success(`✅ Updated ${previousRecords.length} previous record${previousRecords.length === 1 ? '' : 's'} with correct details`);
      setShowMismatchDialog(false);
    } catch (error: any) {
      console.error('Failed to update records:', error);
      toast.error('Failed to update records: ' + error.message);
    } finally {
      setIsUpdatingRecords(false);
    }
  };

  // Calculate distance between two GPS coordinates in meters
  const calculateGPSDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
  };

  // Check for location-based violations
  const checkLocationViolations = async (currentLat: number, currentLng: number, plateNumber: string, zoneId: string) => {
    try {
      // Get zone rules
      const { data: zone, error: zoneError } = await supabase
        .from('zones')
        .select('day_visit_only, max_consecutive_nights, nights_per_month, name')
        .eq('id', zoneId)
        .single();

      if (zoneError || !zone) {
        console.error('Failed to load zone for violation check:', zoneError);
        return null;
      }

      // Get all previous records for this plate in this zone with GPS coordinates
      const { data: previousRecords, error: recordsError } = await supabase
        .from('vehicle_records')
        .select('id, plate_number, gps_latitude, gps_longitude, recorded_at')
        .eq('plate_number', plateNumber.toUpperCase())
        .eq('zone_id', zoneId)
        .not('gps_latitude', 'is', null)
        .not('gps_longitude', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(50); // Check last 50 records

      if (recordsError) {
        console.error('Failed to fetch previous records:', recordsError);
        return null;
      }

      if (!previousRecords || previousRecords.length === 0) {
        return null; // No previous records to compare
      }

      const SAME_LOCATION_THRESHOLD = 50; // 50 meters
      const HOURS_24 = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

      let violationDetected = false;
      let violationMessage = '';
      let nightsInSameLocation = 0;
      const currentTime = new Date();

      // Check each previous record
      for (const record of previousRecords) {
        if (!record.gps_latitude || !record.gps_longitude) continue;

        const distance = calculateGPSDistance(
          currentLat,
          currentLng,
          parseFloat(record.gps_latitude),
          parseFloat(record.gps_longitude)
        );

        // If within 50 meters (same location)
        if (distance <= SAME_LOCATION_THRESHOLD) {
          const recordTime = new Date(record.recorded_at);
          const timeDiff = currentTime.getTime() - recordTime.getTime();

          // If more than 24 hours apart in same location
          if (timeDiff > HOURS_24) {
            nightsInSameLocation++;

            // Check against zone rules
            if (zone.day_visit_only) {
              violationDetected = true;
              violationMessage = `🚨 LOCATION VIOLATION: Vehicle has remained in same location for ${Math.floor(timeDiff / HOURS_24)}+ days in a DAY-VISIT-ONLY zone (${zone.name}). Overnight parking prohibited.`;
              break;
            } else if (nightsInSameLocation >= zone.max_consecutive_nights) {
              const daysRemaining = zone.max_consecutive_nights - nightsInSameLocation;
              if (daysRemaining <= 0) {
                violationDetected = true;
                violationMessage = `🚨 LOCATION VIOLATION: Vehicle has remained in same location for ${nightsInSameLocation}+ consecutive nights (max: ${zone.max_consecutive_nights} in ${zone.name}). $400 fine applicable.`;
              } else if (daysRemaining === 1) {
                violationMessage = `⚠️ LOCATION WARNING: Vehicle in same location for ${nightsInSameLocation} nights. ${daysRemaining} night remaining before violation (${zone.name}).`;
              }
              break;
            }
          }
        }
      }

      return {
        violationDetected,
        violationMessage,
        nightsInSameLocation,
        sameLocationThreshold: SAME_LOCATION_THRESHOLD,
      };
    } catch (error) {
      console.error('Location violation check failed:', error);
      return null;
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      console.error('❌ Submit failed: No user');
      toast.error('User not authenticated');
      return;
    }

    if (!verificationData.organizationId) {
      console.error('❌ Submit failed: No organization_id');
      toast.error('No organization selected');
      return;
    }

    if (!gpsLocation) {
      toast.error('⚠️ GPS location required. Please enable location access and wait for GPS lock.');
      return;
    }

    setIsSubmitting(true);
    try {
      const recordTimeNZ = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
      const recordHour = recordTimeNZ.getHours();
      const isOvernightStay = recordHour >= 21 || recordHour < 5;
      
      // Check for location-based violations
      const locationViolation = await checkLocationViolations(
        gpsLocation.lat,
        gpsLocation.lng,
        verificationData.plateNumber,
        verificationData.zoneId
      );

      let additionalNotes = '';
      if (locationViolation && locationViolation.violationMessage) {
        additionalNotes = `\n\n--- GPS Location Check ---\n${locationViolation.violationMessage}\nGPS Accuracy: ${gpsLocation.accuracy.toFixed(1)}m\nNights in Same Location: ${locationViolation.nightsInSameLocation}\nLocation Threshold: ${locationViolation.sameLocationThreshold}m`;
      }

      // Use centralized compliance data for final compliance status
      let finalComplianceStatus = true;
      if (complianceData) {
        finalComplianceStatus = complianceData.is_compliant && 
          complianceData.violation_severity !== 'critical' && 
          complianceData.violation_severity !== 'moderate';
      }
      
      // Override if location violation detected
      if (locationViolation && locationViolation.violationDetected) {
        finalComplianceStatus = false;
      }
      
      const notesWithVerification = `${notes}${additionalNotes}\n\n--- Verification ---\nSelf-Contained: ${verificationData.isSelfContained ? 'YES' : 'NO'}${
        verificationData.isSelfContained
          ? `\nGreen: ${verificationData.hasGreenSticker ? 'YES' : 'NO'}\nBlue: ${verificationData.hasBlueSticker ? 'YES' : 'NO'}\nReg: ${verificationData.scvRegistrationStatus.replace(/_/g, ' ').toUpperCase()}`
          : ''
      }\nHomeless: ${verificationData.claimsHomeless ? 'YES' : 'NO'}\nRecorded Time (NZ): ${recordTimeNZ.toLocaleString('en-NZ', {
        timeZone: 'Pacific/Auckland',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })}${isOvernightStay ? '\n🌙 OVERNIGHT STAY CONFIRMED (Recorded 9pm-5am NZ time)' : ''}`;

      if (vehicleRecordId) {
        const updateData: Record<string, any> = {
          vehicle_make: vehicleMake === 'Unknown' ? null : (vehicleMake || null),
          vehicle_model: vehicleModel === 'Unknown' ? null : (vehicleModel || null),
          vehicle_color: vehicleColor === 'Unknown' ? null : (vehicleColor || null),
          evidence_photos: evidencePhotos,
          notes: notesWithVerification,
          behavioral_flags: behavioralFlags,
          requires_followup: requiresFollowup || (locationViolation?.violationDetected || false),
          followup_reason: requiresFollowup ? followupReason : (locationViolation?.violationDetected ? locationViolation.violationMessage : null),
          followup_priority: requiresFollowup ? followupPriority : (locationViolation?.violationDetected ? 'high' : null),
          weather_conditions: weatherConditions || null,
          gps_latitude: gpsLocation?.lat || null,
          gps_longitude: gpsLocation?.lng || null,
          gps_accuracy: gpsLocation?.accuracy || null,
          location_lat: gpsLocation?.lat || null,
          location_lng: gpsLocation?.lng || null,
          is_compliant: finalComplianceStatus,
        };

        const { error: updateError } = await supabase
          .from('vehicle_records')
          .update(updateData)
          .eq('id', vehicleRecordId);

        if (updateError) {
          throw updateError;
        }

        if (locationViolation?.violationDetected) {
          toast.error('🚨 Location violation detected and recorded', { duration: 5000 });
        } else {
          toast.success('✅ Evidence and details saved to record');
        }
      } else {
        const recordData: Record<string, any> = {
          organization_id: verificationData.organizationId,
          zone_id: verificationData.zoneId,
          plate_number: verificationData.plateNumber.toUpperCase(),
          recorded_by: user.id,
          is_self_contained: verificationData.isSelfContained,
          is_compliant: finalComplianceStatus,
          notes: notesWithVerification,
          vehicle_make: vehicleMake === 'Unknown' ? null : (vehicleMake || null),
          vehicle_model: vehicleModel === 'Unknown' ? null : (vehicleModel || null),
          vehicle_color: vehicleColor === 'Unknown' ? null : (vehicleColor || null),
          evidence_photos: evidencePhotos,
          evidence_timestamp: new Date().toISOString(),
          gps_latitude: gpsLocation?.lat || null,
          gps_longitude: gpsLocation?.lng || null,
          gps_accuracy: gpsLocation?.accuracy || null,
          location_lat: gpsLocation?.lat || null,
          location_lng: gpsLocation?.lng || null,
          behavioral_flags: behavioralFlags,
          requires_followup: requiresFollowup || (locationViolation?.violationDetected || false),
          followup_reason: requiresFollowup ? followupReason : (locationViolation?.violationDetected ? locationViolation.violationMessage : null),
          followup_priority: requiresFollowup ? followupPriority : (locationViolation?.violationDetected ? 'high' : null),
          weather_conditions: weatherConditions || null,
          plate_input_method: verificationData.plateInputMethod,
          homeless_claimed: verificationData.claimsHomeless,
          homeless_confirmed: null,
          homeless_confirmed_by: null,
          homeless_confirmed_at: null,
        };

        const { data, error } = await supabase.from('vehicle_records').insert(recordData);

        if (error) {
          throw error;
        }

        if (locationViolation?.violationDetected) {
          toast.error('🚨 Location violation detected and recorded', { duration: 5000 });
        } else {
          toast.success('✅ Vehicle recorded successfully');
        }
      }
      
      onComplete();
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      toast.error(`Failed to save record: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fetch weather using AI
  const fetchWeather = async (lat: number, lng: number) => {
    try {
      const { data, error } = await supabase.functions.invoke('get-weather', {
        body: { latitude: lat, longitude: lng },
      });

      if (error) throw error;

      if (data && data.weather) {
        setWeatherConditions(data.weather);
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
      setWeatherConditions('Weather unavailable');
    }
  };

  const handleEvidenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingPhotos(true);
    try {
      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${user?.id}/${Date.now()}_${i}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      setEvidencePhotos([...evidencePhotos, ...uploadedUrls]);
      toast.success(`✅ ${uploadedUrls.length} photo(s) uploaded`);
    } catch (error) {
      toast.error('Failed to upload photos');
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const handleCameraCapture = () => {
    cameraInputRef.current?.click();
  };

  const removeEvidencePhoto = (index: number) => {
    setEvidencePhotos(evidencePhotos.filter((_, i) => i !== index));
  };

  const toggleBehavioralFlag = (flag: string) => {
    if (behavioralFlags.includes(flag)) {
      setBehavioralFlags(behavioralFlags.filter(f => f !== flag));
    } else {
      setBehavioralFlags([...behavioralFlags, flag]);
    }
  };

  const hasSafetyConcerns = flaggedVehicle || 
    previousRecords.some(r => r.behavioral_flags.length > 0 || r.homeless_claimed);

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center gap-3 px-1">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-xl font-bold">Evidence Collection</h2>
          <p className="text-xs text-muted-foreground">
            {verificationData.plateNumber} • {verificationData.zoneName}
          </p>
        </div>
      </div>

      {/* CRITICAL WARNINGS DIALOG - MUST ACKNOWLEDGE */}
      <Dialog open={showCriticalWarningDialog} onOpenChange={() => {
        if (acknowledgedWarnings) {
          setShowCriticalWarningDialog(false);
        }
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-6 w-6 text-red-500 animate-pulse" />
              <span className="text-red-600">OFFICER ALERT - Acknowledgment Required</span>
            </DialogTitle>
            <DialogDescription className="text-base font-medium">
              Critical information about this vehicle detected. Please review all warnings before proceeding.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Vehicle Info */}
            <div className="p-4 bg-gradient-to-r from-red-500/10 to-amber-500/10 border-2 border-red-500/30 rounded-lg">
              <div className="text-center">
                <p className="text-3xl font-black mb-2">{verificationData.plateNumber}</p>
                <p className="text-sm text-muted-foreground">
                  {verificationData.zoneName} • {new Date().toLocaleString('en-NZ', {
                    timeZone: 'Pacific/Auckland',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })} NZ
                </p>
              </div>
            </div>

            {/* Critical Warnings List */}
            <div className="space-y-3">
              {criticalWarnings.map((warning, idx) => (
                <Alert
                  key={idx}
                  variant={warning.severity === 'danger' ? 'destructive' : undefined}
                  className={
                    warning.severity === 'danger' 
                      ? 'border-2 border-red-500 bg-red-500/10' 
                      : warning.severity === 'warning'
                      ? 'border-2 border-amber-500 bg-amber-500/10'
                      : 'border-2 border-blue-500 bg-blue-500/10'
                  }
                >
                  {warning.severity === 'danger' ? (
                    <ShieldAlert className="h-5 w-5" />
                  ) : warning.severity === 'warning' ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <Bell className="h-5 w-5" />
                  )}
                  <AlertTitle className="text-base font-bold">{warning.title}</AlertTitle>
                  <AlertDescription className="text-sm whitespace-pre-line mt-2">
                    {warning.message}
                  </AlertDescription>
                </Alert>
              ))}
            </div>

            {/* Acknowledgment Checkbox */}
            <div className="p-4 bg-muted/50 border-2 border-primary rounded-lg">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="acknowledge-warnings"
                  checked={acknowledgedWarnings}
                  onChange={(e) => setAcknowledgedWarnings(e.target.checked)}
                  className="h-5 w-5 mt-0.5 cursor-pointer"
                />
                <Label htmlFor="acknowledge-warnings" className="text-sm font-semibold cursor-pointer flex-1">
                  ✅ I acknowledge I have read and understood all warnings above. I will proceed with appropriate caution and take necessary safety precautions.
                </Label>
              </div>
            </div>

            {!acknowledgedWarnings && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
                <p className="text-sm font-semibold text-red-600">
                  ⚠️ You must acknowledge these warnings before continuing
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              onClick={() => {
                setShowCriticalWarningDialog(false);
              }}
              disabled={!acknowledgedWarnings}
              className="w-full"
              size="lg"
            >
              {acknowledgedWarnings ? (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Acknowledged - Continue with Evidence Collection
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Acknowledge Required
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GPS Accuracy Status Banner */}
      {isAcquiringGPS && (
        <Card className="border-blue-500 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <MapPin className="h-5 w-5 text-blue-500 animate-pulse" />
                <div className="absolute inset-0 animate-ping">
                  <MapPin className="h-5 w-5 text-blue-500 opacity-30" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-700">Acquiring GPS Location...</p>
                <p className="text-xs text-muted-foreground">
                  {gpsLocation 
                    ? `Current accuracy: ${gpsLocation.accuracy.toFixed(1)}m - improving...`
                    : 'Please wait while we get your precise location'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* GPS Status Card */}
      {gpsLocation && !isAcquiringGPS && (
        <Card className={
          gpsAccuracyStatus === 'good' 
            ? 'border-green-500 bg-green-500/5'
            : gpsAccuracyStatus === 'fair'
            ? 'border-amber-500 bg-amber-500/5'
            : 'border-red-500 bg-red-500/5'
        }>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MapPin className={
                  gpsAccuracyStatus === 'good'
                    ? 'h-5 w-5 text-green-500'
                    : gpsAccuracyStatus === 'fair'
                    ? 'h-5 w-5 text-amber-500'
                    : 'h-5 w-5 text-red-500'
                } />
                <div>
                  <p className="text-sm font-semibold">
                    GPS Accuracy: {gpsLocation.accuracy.toFixed(1)}m
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {gpsAccuracyStatus === 'good' && '✅ Excellent - High precision'}
                    {gpsAccuracyStatus === 'fair' && '⚠️ Good - Acceptable for evidence'}
                    {gpsAccuracyStatus === 'poor' && '❌ Poor - Move to open area'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Flagged Vehicle Warning */}
      {flaggedVehicle && (
        <Alert variant="destructive" className="border-2 border-red-500">
          <ShieldAlert className="h-5 w-5" />
          <AlertTitle className="text-base font-bold">⚠️ OFFICER SAFETY - FLAGGED VEHICLE</AlertTitle>
          <AlertDescription className="text-sm">
            <p className="font-semibold mt-1">{flaggedVehicle.priority.toUpperCase()} PRIORITY</p>
            <p className="mt-2">{flaggedVehicle.notes}</p>
            <p className="text-xs mt-2 opacity-80">Last seen: {flaggedVehicle.last_known_site || 'Unknown'}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Breach Status - Using Centralized Compliance Data */}
      {complianceData && !complianceData.is_compliant && (
        <Alert
          variant={complianceData.violation_severity === 'critical' ? 'destructive' : undefined}
          className={
            complianceData.violation_severity === 'critical'
              ? 'border-2 border-red-500'
              : 'border-2 border-amber-500 bg-amber-500/10'
          }
        >
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="text-base font-bold">
            {complianceData.violation_severity === 'critical' ? '🚨 BREACH DETECTED' : '⚠️ WARNING'}
          </AlertTitle>
          <AlertDescription className="text-sm">
            {complianceData.violation_message}
            {complianceData.fine_amount > 0 && (
              <p className="mt-2 font-semibold">
                💰 Fine Amount: ${complianceData.fine_amount}
              </p>
            )}
            {complianceData.recommended_action && (
              <p className="mt-2 text-xs">
                📋 {complianceData.recommended_action}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Previous Records Summary */}
      {previousRecords.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Previous Records ({previousRecords.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {previousRecords.slice(0, 3).map((record) => (
              <div
                key={record.id}
                className="p-3 bg-background/50 rounded-lg border border-border/50 text-xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold">{record.zone_name}</span>
                  <span className="text-muted-foreground">
                    {new Date(record.recorded_at).toLocaleDateString('en-NZ', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {(record.vehicle_make || record.vehicle_model || record.vehicle_color) && (
                  <p className="text-muted-foreground">
                    {record.vehicle_color} {record.vehicle_make} {record.vehicle_model}
                  </p>
                )}
                {record.behavioral_flags.length > 0 && (
                  <p className="text-red-600 font-semibold mt-1">
                    ⚠️ Flags: {record.behavioral_flags.join(', ')}
                  </p>
                )}
              </div>
            ))}
            {previousRecords.length > 3 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                + {previousRecords.length - 3} more record{previousRecords.length - 3 !== 1 ? 's' : ''}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Vehicle Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vehicle Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="make" className="text-xs">Make</Label>
              <Input
                id="make"
                value={vehicleMake}
                onChange={(e) => setVehicleMake(e.target.value)}
                placeholder="Toyota"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="model" className="text-xs">Model</Label>
              <Input
                id="model"
                value={vehicleModel}
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="Camry"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="year" className="text-xs">Year</Label>
              <Input
                id="year"
                value={vehicleYear}
                onChange={(e) => setVehicleYear(e.target.value)}
                placeholder="2020"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="color" className="text-xs">Color</Label>
              <Input
                id="color"
                value={vehicleColor}
                onChange={(e) => setVehicleColor(e.target.value)}
                placeholder="Silver"
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Photo */}
      <VehicleProfilePhoto
        plateNumber={verificationData.plateNumber}
        existingPhotos={evidencePhotos}
        onPhotoAdded={(url) => setEvidencePhotos([...evidencePhotos, url])}
      />

      {/* Evidence Photos */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Evidence Photos</CardTitle>
            <div className="flex gap-2">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleEvidenceUpload}
                className="hidden"
                multiple
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCameraCapture}
                disabled={isUploadingPhotos}
              >
                <Camera className="h-4 w-4 mr-2" />
                Camera
              </Button>
              <input
                ref={evidenceInputRef}
                type="file"
                accept="image/*"
                onChange={handleEvidenceUpload}
                className="hidden"
                multiple
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => evidenceInputRef.current?.click()}
                disabled={isUploadingPhotos}
              >
                {isUploadingPhotos ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Upload
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {evidencePhotos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No evidence photos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {evidencePhotos.map((photo, index) => (
                <div key={index} className="relative group">
                  <img
                    src={photo}
                    alt={`Evidence ${index + 1}`}
                    className="w-full aspect-square object-cover rounded-lg border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeEvidencePhoto(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Behavioral Flags */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Behavioral Flags (Officer Safety)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            'aggressive',
            'threatening',
            'intoxicated',
            'weapons',
            'dogs',
            'mental_health',
            'vulnerable',
          ].map((flag) => (
            <div key={flag} className="flex items-center space-x-2">
              <Checkbox
                id={flag}
                checked={behavioralFlags.includes(flag)}
                onCheckedChange={() => toggleBehavioralFlag(flag)}
              />
              <Label htmlFor={flag} className="text-sm capitalize cursor-pointer">
                {flag.replace('_', ' ')}
              </Label>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Follow-up Required */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Follow-up Required</CardTitle>
            <Switch checked={requiresFollowup} onCheckedChange={setRequiresFollowup} />
          </div>
        </CardHeader>
        {requiresFollowup && (
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="followup-reason" className="text-xs">Reason</Label>
              <Textarea
                id="followup-reason"
                value={followupReason}
                onChange={(e) => setFollowupReason(e.target.value)}
                placeholder="Describe why this requires follow-up..."
                className="mt-1"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="priority" className="text-xs">Priority</Label>
              <Select value={followupPriority} onValueChange={(value: any) => setFollowupPriority(value)}>
                <SelectTrigger id="priority" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional observations, context, or officer notes..."
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Weather */}
      {weatherConditions && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              <strong>Weather:</strong> {weatherConditions}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="sticky bottom-4 pt-4">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !gpsLocation}
          className="w-full h-14 text-base font-bold shadow-lg"
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Saving Record...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Save Evidence & Complete
            </>
          )}
        </Button>
        {!gpsLocation && (
          <p className="text-xs text-center text-red-500 mt-2 font-semibold">
            ⚠️ Waiting for GPS location - required to save
          </p>
        )}
      </div>

      {/* Vehicle Details Mismatch Dialog */}
      <Dialog open={showMismatchDialog} onOpenChange={setShowMismatchDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Vehicle Details Mismatch
            </DialogTitle>
            <DialogDescription>
              AI detected different details than previous records. Which is correct?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {mismatchData && (
              <>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded border">
                  <p className="text-xs font-semibold text-blue-700 mb-2">🤖 AI Detection (Current)</p>
                  <p className="text-sm">
                    {mismatchData.aiColor} {mismatchData.aiMake} {mismatchData.aiModel}
                    {mismatchData.aiYear && ` (${mismatchData.aiYear})`}
                  </p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded border">
                  <p className="text-xs font-semibold text-green-700 mb-2">📋 Database Records (Previous)</p>
                  <p className="text-sm">
                    {mismatchData.prevColor} {mismatchData.prevMake} {mismatchData.prevModel}
                    {mismatchData.prevYear && ` (${mismatchData.prevYear})`}
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="flex-col gap-2">
            <Button
              onClick={() => {
                if (mismatchData) {
                  updateAllRecords(
                    mismatchData.aiMake || '',
                    mismatchData.aiModel || '',
                    mismatchData.aiColor || '',
                    mismatchData.aiYear || ''
                  );
                }
              }}
              disabled={isUpdatingRecords}
              className="w-full"
            >
              {isUpdatingRecords ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                '🤖 Use AI Detection (Update All Records)'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowMismatchDialog(false)}
              className="w-full"
            >
              📋 Keep Database Records (Previous)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Compliance Warning Dialog */}
      <Dialog open={showTimeComplianceDialog} onOpenChange={setShowTimeComplianceDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              Officer Action Required
            </DialogTitle>
            <DialogDescription>
              Time-based compliance check - please record action taken
            </DialogDescription>
          </DialogHeader>
          
          {timeComplianceWarning && (
            <div className="space-y-4 py-4">
              <Alert
                variant={timeComplianceWarning.severity === 'danger' ? 'destructive' : undefined}
                className={timeComplianceWarning.severity === 'warning' ? 'border-amber-500 bg-amber-500/10' : ''}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm whitespace-pre-line">
                  {timeComplianceWarning.message}
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Action Taken</Label>
                <RadioGroup value={selectedEnforcementAction} onValueChange={setSelectedEnforcementAction}>
                  {timeComplianceWarning.suggestedActions.map((action, idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <RadioGroupItem value={action} id={`action-${idx}`} />
                      <Label htmlFor={`action-${idx}`} className="text-sm cursor-pointer">
                        {action}
                      </Label>
                    </div>
                  ))}
                  
                  {/* Homeless Exemption Option */}
                  {(complianceData?.is_homeless || verificationData.complianceResult?.is_homeless || verificationData.claimsHomeless) && (
                    <div className="flex items-center space-x-2 mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                      <RadioGroupItem value="No Action - Homeless Confirmed (Exempt)" id="homeless-exempt" />
                      <Label htmlFor="homeless-exempt" className="text-sm cursor-pointer flex items-center gap-2">
                        <Home className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-700 dark:text-blue-400">
                          No Action - Homeless Confirmed (Exempt)
                        </span>
                      </Label>
                    </div>
                  )}
                  
                  {/* General No Action Option */}
                  <div className="flex items-center space-x-2 mt-2">
                    <RadioGroupItem value="No action taken" id="no-action" />
                    <Label htmlFor="no-action" className="text-sm cursor-pointer">
                      No action taken
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div>
                <Label htmlFor="enforcement-notes" className="text-xs">Additional Notes</Label>
                <Textarea
                  id="enforcement-notes"
                  value={enforcementNotes}
                  onChange={(e) => setEnforcementNotes(e.target.value)}
                  placeholder="Any additional context or observations..."
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={recordEnforcementAction}
              disabled={!selectedEnforcementAction || isRecordingEnforcement}
              className="w-full"
            >
              {isRecordingEnforcement ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Record Action & Continue
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
