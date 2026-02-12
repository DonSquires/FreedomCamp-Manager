/**
 * Vehicle Details Popup - Editable vehicle details screen for driving patrol
 * Shows after plate detection with option to edit details, update, and add evidence
 * Background color changes based on compliance status
 * Auto-populates from canonical vehicle records and uses AI for self-contained detection
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Car,
  CheckCircle2,
  Camera,
  Search,
  AlertTriangle,
  Home,
  Edit3,
  Save,
  XCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import greenStickerImage from '@/assets/green-self-contained-sticker.png';
import blueStickerImage from '@/assets/blue-self-contained-sticker.jpg';
import { cn } from '@/lib/utils';

interface VehicleDetailsPopupProps {
  open: boolean;
  plateNumber: string;
  zoneName?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleYear?: string;
  isSelfContained: boolean;
  hasGreenSticker?: boolean;
  hasBlueSticker?: boolean;
  isCompliant: boolean;
  isHomeless?: boolean;
  isFlagged?: boolean;
  isBreaching?: boolean;
  photoUrl?: string;
  homelessStatus?: 'none' | 'claimed' | 'confirmed'; // ✅ Phase 2: Homeless status from canonical_vehicles
  homelessNotes?: string; // ✅ Phase 2: Admin notes about homeless status
  onClose: () => void;
  onRetake?: () => void; // New: Allows user to retake the photo
  onUpdateDetails: (details: {
    plateNumber: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    vehicleYear?: string;
    isSelfContained: boolean;
    hasGreenSticker?: boolean;
    hasBlueSticker?: boolean;
  }) => Promise<void>;
  onCheck: (selfContainedStatus: { isSelfContained: boolean; hasGreenSticker?: boolean; hasBlueSticker?: boolean }) => void;
}

export function VehicleDetailsPopup({
  open,
  plateNumber: initialPlate,
  zoneName,
  vehicleMake: initialMake,
  vehicleModel: initialModel,
  vehicleColor: initialColor,
  vehicleYear: initialYear,
  isSelfContained: initialSelfContained,
  hasGreenSticker,
  hasBlueSticker,
  isCompliant,
  isHomeless,
  isFlagged,
  isBreaching,
  photoUrl,
  homelessStatus = 'none', // ✅ Phase 2: Default to 'none'
  homelessNotes,
  onClose,
  onRetake,
  onUpdateDetails,
  onCheck,
}: VehicleDetailsPopupProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isAIAnalyzing, setIsAIAnalyzing] = useState(false);
  const [priorObservationsCount, setPriorObservationsCount] = useState(0);

  // Editable state
  const [plateNumber, setPlateNumber] = useState(initialPlate);
  const [vehicleMake, setVehicleMake] = useState(initialMake || '');
  const [vehicleModel, setVehicleModel] = useState(initialModel || '');
  const [vehicleColor, setVehicleColor] = useState(initialColor || '');
  const [vehicleYear, setVehicleYear] = useState(initialYear || '');
  const [selfContained, setSelfContained] = useState<'green' | 'blue' | 'none'>(
    hasGreenSticker ? 'green' : hasBlueSticker ? 'blue' : 'none'
  );

  // Load vehicle details from database and AI when popup opens
  useEffect(() => {
    if (open && initialPlate) {
      loadVehicleDetails();
    }
  }, [open, initialPlate]);

  // Set initial values when props change
  useEffect(() => {
    if (open) {
      setPlateNumber(initialPlate);
      setVehicleMake(initialMake || '');
      setVehicleModel(initialModel || '');
      setVehicleColor(initialColor || '');
      setVehicleYear(initialYear || '');
      setSelfContained(hasGreenSticker ? 'green' : hasBlueSticker ? 'blue' : 'none');
    }
  }, [open, initialPlate, initialMake, initialModel, initialColor, initialYear, hasGreenSticker, hasBlueSticker]);

  const loadVehicleDetails = async () => {
    setIsLoadingDetails(true);
    try {
      console.log('📊 Loading vehicle details for:', initialPlate);

      // Get canonical vehicle with prior observation history
      const { data: vehicle, error: vehicleError } = await supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, total_observations')
        .eq('plate_number', initialPlate.toUpperCase().trim())
        .single();

      if (vehicleError && vehicleError.code !== 'PGRST116') {
        console.error('Failed to fetch vehicle:', vehicleError);
      }

      if (vehicle) {
        console.log('✅ Found canonical vehicle:', vehicle);
        setPriorObservationsCount(vehicle.total_observations || 0);

        // Use canonical vehicle details if available (prioritize database over initial props)
        if (vehicle.vehicle_make) setVehicleMake(vehicle.vehicle_make);
        if (vehicle.vehicle_model) setVehicleModel(vehicle.vehicle_model);
        if (vehicle.vehicle_color) setVehicleColor(vehicle.vehicle_color);

        // Get most recent observation to check self-contained status
        const { data: recentObs } = await supabase
          .from('vehicle_observations')
          .select('is_self_contained, notes')
          .eq('vehicle_id', vehicle.vehicle_id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .single();

        if (recentObs && recentObs.is_self_contained) {
          console.log('✅ Found prior self-contained status:', recentObs.is_self_contained);
          // Parse notes to check for green or blue sticker
          const hasGreen = recentObs.notes?.toLowerCase().includes('green sticker');
          const hasBlue = recentObs.notes?.toLowerCase().includes('blue sticker') || recentObs.notes?.toLowerCase().includes('nzs 5465');
          setSelfContained(hasGreen ? 'green' : hasBlue ? 'blue' : 'none');
        } else if (photoUrl && !initialMake && !initialModel) {
          // No prior details found - use AI to analyze photo
          console.log('🤖 No prior details - triggering AI analysis...');
          await analyzePhotoWithAI(vehicle.vehicle_id);
        }
      } else {
        // New vehicle - initial values already set in useEffect
        console.log('🆕 New vehicle detected');
        setPriorObservationsCount(0);

        if (photoUrl && !initialMake && !initialModel) {
          console.log('🤖 New vehicle - triggering AI analysis...');
          // AI analysis will be triggered in process-field-scan
        }
      }

      setIsEditing(false);
    } catch (error) {
      console.error('Error loading vehicle details:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const analyzePhotoWithAI = async (vehicleId?: string) => {
    if (!photoUrl) {
      toast.error('No photo available for AI analysis');
      return;
    }

    setIsAIAnalyzing(true);
    try {
      console.log('🤖 Analyzing vehicle photo with AI...');
      toast.info('🤖 AI is analyzing the vehicle photo...');
      
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber: initialPlate.toUpperCase().trim(),
          photoUrl,
          vehicleId,
        },
      });

      if (error) {
        console.error('AI analysis error:', error);
        toast.error('AI analysis failed: ' + (error.message || 'Unknown error'));
        return;
      }

      if (data?.analysis) {
        console.log('✅ AI analysis complete:', data.analysis);
        
        // Populate fields with AI results
        if (data.analysis.make) setVehicleMake(data.analysis.make);
        if (data.analysis.model) setVehicleModel(data.analysis.model);
        if (data.analysis.color) setVehicleColor(data.analysis.color);
        if (data.analysis.year) setVehicleYear(data.analysis.year);
        
        // Detect self-contained from AI analysis
        if (data.analysis.has_green_sticker) {
          setSelfContained('green');
          toast.success(`✅ AI detected: ${data.analysis.make} ${data.analysis.model} with GREEN sticker`);
        } else if (data.analysis.has_blue_sticker) {
          setSelfContained('blue');
          toast.success(`✅ AI detected: ${data.analysis.make} ${data.analysis.model} with BLUE sticker (NZS 5465)`);
        } else if (data.analysis.is_self_contained) {
          // AI thinks it's self-contained but no sticker detected
          toast.info(`🔍 AI detected: ${data.analysis.make} ${data.analysis.model} (likely self-contained, but no sticker visible)`);
        } else {
          setSelfContained('none');
          toast.success(`✅ AI detected: ${data.analysis.make} ${data.analysis.model} (NOT self-contained)`);
        }
      } else if (data?.skipped) {
        toast.info('Vehicle details already exist - skipped AI analysis');
      }
    } catch (error: any) {
      console.error('AI analysis failed:', error);
      toast.error('AI analysis error: ' + error.message);
    } finally {
      setIsAIAnalyzing(false);
    }
  };

  const handleUpdateDetails = async () => {
    setIsSaving(true);
    try {
      await onUpdateDetails({
        plateNumber: plateNumber.toUpperCase(),
        vehicleMake: vehicleMake || undefined,
        vehicleModel: vehicleModel || undefined,
        vehicleColor: vehicleColor || undefined,
        vehicleYear: vehicleYear || undefined,
        isSelfContained: selfContained !== 'none',
        hasGreenSticker: selfContained === 'green',
        hasBlueSticker: selfContained === 'blue',
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  // Determine background color based on status
  const getBackgroundClass = () => {
    if (isFlagged) return 'bg-gradient-to-br from-red-100 to-red-200 dark:from-red-950/40 dark:to-red-900/40';
    if (isHomeless) return 'bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-950/40 dark:to-purple-900/40';
    if (isBreaching) return 'bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-950/40 dark:to-orange-900/40';
    if (!isCompliant) return 'bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-950/40 dark:to-amber-900/40';
    return 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/20 dark:to-blue-900/20';
  };

  const getStatusBadge = () => {
    if (isFlagged) return <Badge className="bg-red-600 text-white animate-pulse">🚨 FLAGGED VEHICLE</Badge>;
    if (isHomeless) return <Badge className="bg-purple-600 text-white">🏠 Homeless Status</Badge>;
    if (isBreaching) return <Badge className="bg-orange-600 text-white">⚠️ BREACH DETECTED</Badge>;
    if (!isCompliant) return <Badge className="bg-amber-600 text-white">⚠️ Non-Compliant</Badge>;
    return <Badge className="bg-green-600 text-white">✓ Compliant</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent 
        className={cn(
          "max-w-[95vw] w-full sm:max-w-md p-0 rounded-3xl shadow-2xl border-4 max-h-[90vh] overflow-y-auto",
          getBackgroundClass(),
          isFlagged && "border-red-500",
          isHomeless && "border-purple-500",
          isBreaching && "border-orange-500",
          !isCompliant && !isFlagged && !isHomeless && !isBreaching && "border-amber-500",
          isCompliant && !isFlagged && !isHomeless && !isBreaching && "border-blue-500"
        )}
      >
        <DialogHeader className="p-6 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center shadow-lg">
                <Car className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <DialogTitle className="text-xl text-gray-900 dark:text-white">
                  {isEditing ? 'EDIT VEHICLE' : 'SCANNED'}
                </DialogTitle>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                  {new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-xl cursor-pointer hover:scale-110 transition-transform"
              onClick={() => analyzePhotoWithAI()}
              title="Click to analyze vehicle with AI"
            >
              {isAIAnalyzing ? (
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-white border-t-transparent"></div>
              ) : (
                <div className="text-center">
                  <p className="text-[10px] font-bold text-white/90">✨</p>
                  <p className="text-xs font-black text-white">AI</p>
                </div>
              )}
            </div>
          </div>

          {/* Status Badge */}
          <div className="mb-4">
            {getStatusBadge()}
          </div>

          {/* Prior Observations Badge */}
          {priorObservationsCount > 0 && (
            <div className="mb-4">
              <Badge variant="outline" className="text-sm font-bold border-2 border-green-500 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300">
                ✅ 📊 {priorObservationsCount} prior observation{priorObservationsCount !== 1 ? 's' : ''} in system
              </Badge>
            </div>
          )}

          {/* ✅ PHASE 2: Homeless Status Badges */}
          {homelessStatus === 'confirmed' && (
            <div className="mb-4 p-4 bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-500 rounded-xl">
              <div className="flex items-center gap-3">
                <Home className="h-6 w-6 text-purple-600" />
                <div>
                  <p className="font-bold text-purple-900 dark:text-purple-100">
                    🏠 Homeless Status: CONFIRMED
                  </p>
                  <p className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                    FC Act 2011 exemption applies • Admin verified
                  </p>
                  {homelessNotes && (
                    <p className="text-xs text-purple-600 dark:text-purple-400 mt-2 italic">
                      "{homelessNotes}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {homelessStatus === 'claimed' && (
            <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-500 rounded-xl">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
                <div>
                  <p className="font-bold text-amber-900 dark:text-amber-100">
                    🏠 Homeless Status: PENDING REVIEW
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    Officer reported homeless claim • Awaiting admin verification
                  </p>
                  {homelessNotes && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 italic">
                      "{homelessNotes}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Zone Badge - Auto-populated from scan */}
          {zoneName && (
            <div className="mb-4">
              <Badge variant="outline" className="text-sm font-bold border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
                📍 Zone: {zoneName}
              </Badge>
            </div>
          )}
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {/* License Plate - Large Display */}
          <div className="relative">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 text-center">
              LICENSE PLATE
            </p>
            <div 
              className={cn(
                "bg-white dark:bg-gray-900 rounded-2xl border-4 border-blue-500 shadow-xl p-6 relative",
                !isEditing && "cursor-pointer hover:border-blue-600 hover:shadow-2xl transition-all active:scale-[0.98]"
              )}
              onClick={() => {
                if (!isEditing) {
                  setIsEditing(true);
                }
              }}
              title={!isEditing ? "Tap to edit plate number" : undefined}
            >
              {isEditing ? (
                <Input
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  className="text-5xl font-black text-center tracking-widest text-blue-600 dark:text-blue-400 border-2 border-blue-300 h-20"
                  maxLength={8}
                  autoFocus
                />
              ) : (
                <p className="text-5xl font-black text-center tracking-widest text-blue-600 dark:text-blue-400">
                  {plateNumber}
                </p>
              )}
            </div>
            {!isEditing && (
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-2 italic">
                💡 Tap plate number to edit
              </p>
            )}
          </div>

          {/* Vehicle Details Grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Make */}
            <div className="bg-blue-500 dark:bg-blue-600 rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-bold text-white/90 mb-2">MAKE</p>
              {isEditing ? (
                <Input
                  value={vehicleMake}
                  onChange={(e) => setVehicleMake(e.target.value)}
                  className="text-xl font-bold bg-white/20 border-white/40 text-white placeholder:text-white/60 h-12"
                  placeholder="Unknown"
                />
              ) : (
                <p className="text-xl font-bold text-white truncate">
                  {vehicleMake || 'Unknown'}
                </p>
              )}
            </div>

            {/* Model */}
            <div className="bg-blue-500 dark:bg-blue-600 rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-bold text-white/90 mb-2">MODEL</p>
              {isEditing ? (
                <Input
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="text-xl font-bold bg-white/20 border-white/40 text-white placeholder:text-white/60 h-12"
                  placeholder="Unknown"
                />
              ) : (
                <p className="text-xl font-bold text-white truncate">
                  {vehicleModel || 'Unknown'}
                </p>
              )}
            </div>

            {/* Year */}
            <div className="bg-purple-500 dark:bg-purple-600 rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-bold text-white/90 mb-2">YEAR</p>
              {isEditing ? (
                <Input
                  value={vehicleYear}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  className="text-xl font-bold bg-white/20 border-white/40 text-white placeholder:text-white/60 h-12"
                  placeholder="Unknown"
                  type="number"
                  maxLength={4}
                />
              ) : (
                <p className="text-xl font-bold text-white truncate">
                  {vehicleYear || 'Unknown'}
                </p>
              )}
            </div>

            {/* Color */}
            <div className="bg-purple-500 dark:bg-purple-600 rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-bold text-white/90 mb-2">COLOR</p>
              {isEditing ? (
                <Input
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  className="text-xl font-bold bg-white/20 border-white/40 text-white placeholder:text-white/60 h-12"
                  placeholder="Unknown"
                />
              ) : (
                <p className="text-xl font-bold text-white truncate">
                  {vehicleColor || 'Unknown'}
                </p>
              )}
            </div>
          </div>

          {/* Edit Plate Number Link - Hidden when editing (plate click is primary method) */}
          {!isEditing && (
            <div className="pt-2">
              <button
                onClick={() => setIsEditing(true)}
                className="w-full text-left text-blue-600 dark:text-blue-400 font-bold text-base flex items-center gap-2 hover:underline touch-manipulation"
              >
                <Edit3 className="h-4 w-4" />
                Edit Plate Number
              </button>
            </div>
          )}

          {/* Self-Contained Sticker Verification */}
          <div className="space-y-3">
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              Self-Contained Sticker Verification
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Tap/click the matching sticker if vehicle is self-contained. Only one can be selected.
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              {/* Green Sticker */}
              <button
                onClick={() => {
                  if (isEditing || !selfContained) {
                    setSelfContained(selfContained === 'green' ? 'none' : 'green');
                  }
                }}
                disabled={!isEditing && selfContained !== 'none' && selfContained !== 'green'}
                className={cn(
                  "relative rounded-xl border-4 p-3 transition-all",
                  selfContained === 'green'
                    ? "border-green-500 bg-green-50 dark:bg-green-950/30 shadow-lg scale-[1.05] ring-4 ring-green-300"
                    : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-green-400"
                )}
              >
                <div className="aspect-square rounded-lg flex items-center justify-center mb-2 relative overflow-hidden shadow-lg bg-white">
                  <img 
                    src={greenStickerImage} 
                    alt="Green self-contained sticker"
                    className={cn(
                      "w-full h-full object-contain rounded-lg p-1",
                      selfContained !== 'green' && "opacity-70"
                    )}
                  />
                  {selfContained === 'green' && (
                    <div className="absolute top-1 right-1 bg-green-600 rounded-full p-1 shadow-lg">
                      <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {selfContained !== 'green' && selfContained !== 'none' && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
                      <XCircle className="h-12 w-12 text-white/90 drop-shadow-lg" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
                <p className={cn(
                  "text-xs font-semibold text-center",
                  selfContained === 'green' 
                    ? "text-green-700 dark:text-green-300 font-black"
                    : "text-gray-600 dark:text-gray-400"
                )}>
                  Green Sticker
                </p>
              </button>

              {/* Blue Sticker */}
              <button
                onClick={() => {
                  if (isEditing || !selfContained) {
                    setSelfContained(selfContained === 'blue' ? 'none' : 'blue');
                  }
                }}
                disabled={!isEditing && selfContained !== 'none' && selfContained !== 'blue'}
                className={cn(
                  "relative rounded-xl border-4 p-3 transition-all",
                  selfContained === 'blue'
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-lg scale-[1.05] ring-4 ring-blue-300"
                    : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400"
                )}
              >
                <div className="aspect-square rounded-lg flex items-center justify-center mb-2 relative overflow-hidden shadow-lg bg-white">
                  <img 
                    src={blueStickerImage} 
                    alt="Blue self-contained sticker (NZS 5465)"
                    className={cn(
                      "w-full h-full object-contain rounded-lg p-1",
                      selfContained !== 'blue' && "opacity-70"
                    )}
                  />
                  {selfContained === 'blue' && (
                    <div className="absolute top-1 right-1 bg-blue-600 rounded-full p-1 shadow-lg">
                      <CheckCircle2 className="h-6 w-6 text-white" strokeWidth={3} />
                    </div>
                  )}
                  {selfContained !== 'blue' && selfContained !== 'none' && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
                      <XCircle className="h-12 w-12 text-white/90 drop-shadow-lg" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
                <p className={cn(
                  "text-xs font-semibold text-center",
                  selfContained === 'blue'
                    ? "text-blue-700 dark:text-blue-300 font-black"
                    : "text-gray-600 dark:text-gray-400"
                )}>
                  Blue Sticker (NZS 5465)
                </p>
              </button>
            </div>

            {/* Self-Contained Status Badge */}
            {selfContained === 'green' && (
              <div className="bg-green-50 dark:bg-green-950/30 border-2 border-green-500 rounded-xl p-4 text-center">
                <p className="text-base font-black text-green-700 dark:text-green-300 flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  ✓ Self-Contained (GREEN Sticker)
                </p>
              </div>
            )}
            {selfContained === 'blue' && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-500 rounded-xl p-4 text-center">
                <p className="text-base font-black text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  ✓ Self-Contained (BLUE Sticker NZS 5465)
                </p>
              </div>
            )}
            {selfContained === 'none' && (
              <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-500 rounded-xl p-4 text-center">
                <p className="text-base font-black text-red-600 dark:text-red-400 flex items-center justify-center gap-2">
                  <XCircle className="h-5 w-5" />
                  ✗ NOT Self-Contained
                </p>
              </div>
            )}
          </div>

          {/* Loading Indicator */}
          {isLoadingDetails && (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">Loading vehicle details...</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3 pt-4">
            {isEditing ? (
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => {
                    setIsEditing(false);
                    // Reset to original values
                    setPlateNumber(initialPlate);
                    setVehicleMake(initialMake || '');
                    setVehicleModel(initialModel || '');
                    setVehicleColor(initialColor || '');
                    setVehicleYear(initialYear || '');
                    setSelfContained(hasGreenSticker ? 'green' : hasBlueSticker ? 'blue' : 'none');
                  }}
                  variant="outline"
                  className="h-16 text-base font-bold border-2"
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateDetails}
                  className="h-16 text-base font-bold bg-blue-600 hover:bg-blue-700"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>Saving...</>
                  ) : (
                    <>
                      <Save className="h-5 w-5 mr-2" />
                      Update Details
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <>
                <Button
                  onClick={() => onCheck({
                    isSelfContained: selfContained !== 'none',
                    hasGreenSticker: selfContained === 'green',
                    hasBlueSticker: selfContained === 'blue',
                  })}
                  className="w-full h-16 text-base font-bold bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  ✓ Check
                </Button>
                
                {/* Retake and Cancel Row */}
                <div className="grid grid-cols-2 gap-3">
                  {onRetake && (
                    <Button
                      onClick={onRetake}
                      variant="outline"
                      className="h-14 text-sm font-bold border-2 border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    >
                      <RotateCcw className="h-5 w-5 mr-2" />
                      Retake Photo
                    </Button>
                  )}
                  <Button
                    onClick={onClose}
                    variant="outline"
                    className="h-14 text-sm font-bold border-2 border-gray-400 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <X className="h-5 w-5 mr-2" />
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
