/**
 * Manual Entry Modal
 * 
 * Auto-triggered when both ALPR and OCR detection fail
 * Allows officer to manually enter plate and vehicle details
 * Maintains photo and GPS association
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AlertTriangle, Camera, CheckCircle2, MapPin, X } from 'lucide-react';
import { toast } from 'sonner';

interface ManualEntryModalProps {
  open: boolean;
  capturedPhoto: string; // base64 data URL
  photoUrl: string; // uploaded storage URL
  gpsLocation: { lat: number; lng: number; accuracy: number } | null;
  zoneName: string;
  onSubmit: (data: ManualEntryData) => void;
  onCancel: () => void;
}

export interface ManualEntryData {
  plateNumber: string;
  make?: string;
  model?: string;
  color?: string;
  year?: number;
  selfContained: boolean;
  selfContainedExpiry?: string;
  notes?: string;
}

export function ManualEntryModal({
  open,
  capturedPhoto,
  photoUrl,
  gpsLocation,
  zoneName,
  onSubmit,
  onCancel,
}: ManualEntryModalProps) {
  const [plateNumber, setPlateNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [year, setYear] = useState('');
  const [selfContained, setSelfContained] = useState<'no' | 'yes'>('no');
  const [selfContainedExpiry, setSelfContainedExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    // Validate required fields
    if (!plateNumber.trim()) {
      toast.error('Plate number is required');
      return;
    }

    // Validate plate format (basic NZ format check)
    const plateRegex = /^[A-Z0-9]{1,6}$/;
    const normalizedPlate = plateNumber.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    
    if (!plateRegex.test(normalizedPlate)) {
      toast.error('Invalid plate format. Use only letters and numbers (up to 6 characters)');
      return;
    }

    // Validate year if provided
    if (year && (parseInt(year) < 1900 || parseInt(year) > new Date().getFullYear() + 1)) {
      toast.error('Invalid year. Must be between 1900 and ' + (new Date().getFullYear() + 1));
      return;
    }

    // Validate expiry date if self-contained
    if (selfContained === 'yes' && !selfContainedExpiry) {
      toast.error('Self-contained expiry date required');
      return;
    }

    setIsSubmitting(true);

    const data: ManualEntryData = {
      plateNumber: normalizedPlate,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      color: color.trim() || undefined,
      year: year ? parseInt(year) : undefined,
      selfContained: selfContained === 'yes',
      selfContainedExpiry: selfContained === 'yes' ? selfContainedExpiry : undefined,
      notes: notes.trim() || undefined,
    };

    onSubmit(data);
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
              Detection Failed - Manual Entry Required
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Both ALPR and OCR detection failed. Please review the photo and enter details manually.
          </p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Photo Preview */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Captured Photo:</Label>
            <div className="relative rounded-lg overflow-hidden border-2 border-amber-500 bg-black">
              <img 
                src={capturedPhoto} 
                alt="Captured vehicle" 
                className="w-full h-auto max-h-64 object-contain"
              />
              <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm rounded px-2 py-1 flex items-center gap-1">
                <Camera className="h-3 w-3 text-white" />
                <span className="text-xs text-white font-mono">Saved</span>
              </div>
            </div>
          </div>

          {/* Zone & GPS Info */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Zone:</p>
              <p className="text-sm font-semibold truncate">{zoneName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                GPS Accuracy:
              </p>
              <p className="text-sm font-semibold">
                {gpsLocation 
                  ? `±${Math.round(gpsLocation.accuracy)}m` 
                  : 'Not available'}
              </p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Plate Number - Required */}
            <div className="space-y-2">
              <Label htmlFor="plate" className="text-sm font-semibold">
                Plate Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="plate"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="text-lg font-mono font-bold text-center uppercase"
                maxLength={6}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Enter exactly as shown on plate (letters and numbers only, up to 6 characters)
              </p>
            </div>

            {/* Vehicle Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="make" className="text-sm">Vehicle Make</Label>
                <Input
                  id="make"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="Toyota"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="model" className="text-sm">Vehicle Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Camry"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="color" className="text-sm">Vehicle Color</Label>
                <Input
                  id="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="Silver"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="year" className="text-sm">Vehicle Year</Label>
                <Input
                  id="year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2018"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                />
              </div>
            </div>

            {/* Self-Contained Status */}
            <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <Label className="text-sm font-semibold">Self-Contained Status:</Label>
              <RadioGroup value={selfContained} onValueChange={(v: any) => setSelfContained(v)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="not-self-contained" />
                  <Label htmlFor="not-self-contained" className="cursor-pointer">
                    No - Not self-contained
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="is-self-contained" />
                  <Label htmlFor="is-self-contained" className="cursor-pointer">
                    Yes - Self-contained (green or blue sticker visible)
                  </Label>
                </div>
              </RadioGroup>

              {/* Conditional Expiry Date */}
              {selfContained === 'yes' && (
                <div className="space-y-2 mt-3 pl-6 border-l-2 border-blue-400">
                  <Label htmlFor="expiry" className="text-sm">
                    Expiry Date <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="expiry"
                    type="date"
                    value={selfContainedExpiry}
                    onChange={(e) => setSelfContainedExpiry(e.target.value)}
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for self-contained vehicles
                  </p>
                </div>
              )}
            </div>

            {/* Officer Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes" className="text-sm">Officer Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional observations about the vehicle or detection failure reason..."
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isSubmitting || !plateNumber.trim()}
            className="gap-2"
          >
            {isSubmitting ? (
              <>Processing...</>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Submit Manual Entry
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
