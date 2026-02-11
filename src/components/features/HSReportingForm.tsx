/**
 * HSReportingForm - Health & Safety issue reporting
 * Report hazards, damaged infrastructure, or suspicious activity
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { SessionScan } from './SessionList';

interface HSReportingFormProps {
  scan?: SessionScan;
  onClose: () => void;
  onSuccess?: (reportId: string) => void;
}

const HS_ISSUE_TYPES = [
  'Broken Glass',
  'Damaged Infrastructure',
  'Fire Hazard',
  'Chemical Spill',
  'Electrical Hazard',
  'Sharp Objects',
  'Unsafe Structure',
  'Environmental Contamination',
  'Medical Emergency',
  'Suspicious Package',
  'Other',
];

const HS_SEVERITY_LEVELS = [
  { value: 'low', label: 'Low', color: 'bg-blue-500', description: 'Minor issue, no immediate danger' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-500', description: 'Moderate risk, requires attention' },
  { value: 'high', label: 'High', color: 'bg-red-500', description: 'Significant risk, urgent action needed' },
  { value: 'critical', label: 'Critical', color: 'bg-purple-500', description: 'Immediate danger, emergency response' },
];

export function HSReportingForm({ scan, onClose, onSuccess }: HSReportingFormProps) {
  const [issueType, setIssueType] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePhotoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      setPhotos(prev => [...prev, ...Array.from(files)]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!details.trim()) {
      toast.error('Please provide issue details');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload photos to storage
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const fileName = `hs-reports/${Date.now()}_${Math.random().toString(36).slice(2)}_${photo.name}`;
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, photo);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        photoUrls.push(publicUrl);
      }

      // Get current GPS location
      let gpsLocation: { lat: number; lng: number; accuracy: number } | null = null;
      if ('geolocation' in navigator) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 5000,
            });
          });
          gpsLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };
        } catch (error) {
          console.warn('GPS not available:', error);
        }
      }

      // Create H&S report
      const { data: report, error: reportError } = await supabase
        .from('health_safety_reports')
        .insert({
          organization_id: scan?.organizationId,
          zone_id: scan?.zoneId,
          details: `${issueType ? `[${issueType}] ` : ''}${details}`,
          severity,
          status: 'pending',
          location_lat: gpsLocation?.lat,
          location_lng: gpsLocation?.lng,
          attachments: photoUrls.map(url => ({ url, type: 'photo' })),
        })
        .select('id')
        .single();

      if (reportError) throw reportError;

      toast.success('Health & Safety report submitted successfully');
      onSuccess?.(report.id);
      onClose();
    } catch (error: any) {
      console.error('Failed to submit H&S report:', error);
      toast.error('Failed to submit report: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSeverity = HS_SEVERITY_LEVELS.find(s => s.value === severity);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-card z-10 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Report Health & Safety Issue
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Associated Vehicle (if applicable) */}
          {scan && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <p className="text-xs text-muted-foreground">Related to Vehicle Scan:</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-mono font-bold">{scan.plateNumber}</p>
                  {scan.vehicleMake && (
                    <p className="text-xs text-muted-foreground">
                      {scan.vehicleColor && `${scan.vehicleColor} `}
                      {scan.vehicleMake} {scan.vehicleModel}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {scan.zoneName}
              </div>
            </div>
          )}

          {/* Issue Type (Optional) */}
          <div>
            <Label htmlFor="issue-type">Issue Type (Optional)</Label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger id="issue-type" className="mt-1">
                <SelectValue placeholder="Select issue type or leave blank" />
              </SelectTrigger>
              <SelectContent>
                {HS_ISSUE_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Severity */}
          <div>
            <Label>Severity Level</Label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {HS_SEVERITY_LEVELS.map(level => (
                <button
                  key={level.value}
                  onClick={() => setSeverity(level.value)}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    severity === level.value
                      ? `border-primary ${level.color} text-white`
                      : 'border-border bg-card hover:border-primary/50'
                  }`}
                >
                  <p className="text-sm font-semibold mb-1">{level.label}</p>
                  <p className={`text-xs ${severity === level.value ? 'text-white/80' : 'text-muted-foreground'}`}>
                    {level.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Details */}
          <div>
            <Label htmlFor="details">
              Issue Details <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Describe the health & safety issue, location, and any immediate risks..."
              className="mt-1 min-h-32"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Include specific location details, visible hazards, and any actions already taken
            </p>
          </div>

          {/* Photo Upload */}
          <div>
            <Label>Evidence Photos</Label>
            <div className="mt-2 space-y-3">
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
                id="hs-photo-upload"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('hs-photo-upload')?.click()}
                className="w-full"
              >
                <Camera className="h-4 w-4 mr-2" />
                Add Photos ({photos.length})
              </Button>

              {/* Photo Previews */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={URL.createObjectURL(photo)}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-24 object-cover rounded-lg border"
                      />
                      <button
                        onClick={() => removePhoto(idx)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Severity Warning */}
          {selectedSeverity && (selectedSeverity.value === 'high' || selectedSeverity.value === 'critical') && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-semibold text-red-900 dark:text-red-100 mb-1">
                ⚠️ {selectedSeverity.value === 'critical' ? 'Critical' : 'High'} Severity Alert
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">
                {selectedSeverity.value === 'critical'
                  ? 'This report will trigger an immediate emergency response. If there is immediate danger, call emergency services first.'
                  : 'This report will be escalated for urgent review and action.'}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !details.trim()}
              className="flex-1"
            >
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
