/**
 * Enforcement Job Completion Component
 * Mobile-friendly on-site enforcement workflow with:
 * - Quick completion with outcomes
 * - Photo evidence capture
 * - GPS stamping
 * - Print enforcement documents (Notice to Vacate)
 */

import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  Shield,
  Camera,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  Printer,
  FileText,
  Upload,
  Car,
  AlertTriangle,
  Home,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface EnforcementJobCompletionProps {
  jobId: string;
  plateNumber: string;
  zoneName: string;
  zoneId: string;
  actionType: 'warning' | 'notice' | 'tow' | 'other';
  breachDetails?: {
    nightsStayed?: number;
    consecutiveNights?: number;
    violationType?: string;
  };
  vehicleId?: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function EnforcementJobCompletion({
  jobId,
  plateNumber,
  zoneName,
  zoneId,
  actionType,
  breachDetails,
  vehicleId,
  onComplete,
  onCancel,
}: EnforcementJobCompletionProps) {
  const { user } = useAuthStore();
  const [outcome, setOutcome] = useState<'completed' | 'not_on_site' | 'cancelled'>('completed');
  const [completionNotes, setCompletionNotes] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [generatedNotice, setGeneratedNotice] = useState<{
    referenceNumber: string;
    html: string;
    deadline: string;
  } | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Get GPS on mount
  useState(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => console.error('GPS error:', error),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        // Upload to Supabase Storage
        const fileName = `enforcement/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = await supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        return publicUrl;
      });

      const uploadedUrls = await Promise.all(uploadPromises);
      setEvidencePhotos((prev) => [...prev, ...uploadedUrls]);
      toast.success(`${uploadedUrls.length} photo(s) uploaded`);
    } catch (error: any) {
      console.error('Photo upload failed:', error);
      toast.error('Failed to upload photos: ' + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerateNotice = async () => {
    setIsPrinting(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-notice-to-vacate', {
        body: {
          zoneId,
          plateNumber,
          vehicleId,
          nightsStayed: breachDetails?.nightsStayed,
          breachDate: new Date().toISOString().split('T')[0],
          breachDetails: breachDetails || {},
          issuedBy: user?.id,
          deliveryMethod: 'printed_onsite',
        },
      });

      if (error) throw error;

      if (data?.success && data?.notice) {
        setGeneratedNotice({
          referenceNumber: data.notice.reference_number,
          html: data.notice.html,
          deadline: data.notice.vacate_deadline,
        });
        setShowPrintDialog(true);
        toast.success('Notice to Vacate generated - ready to print');
      } else {
        throw new Error('Failed to generate notice');
      }
    } catch (error: any) {
      console.error('Notice generation failed:', error);
      toast.error('Failed to generate notice: ' + error.message);
    } finally {
      setIsPrinting(false);
    }
  };

  const handlePrint = () => {
    if (!generatedNotice) return;

    // Open print dialog with generated HTML
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(generatedNotice.html);
      printWindow.document.close();
      printWindow.print();
      toast.success('Print dialog opened');
    }
  };

  const handleComplete = async () => {
    if (!completionNotes.trim() && outcome !== 'completed') {
      toast.error('Please add completion notes');
      return;
    }

    setIsSubmitting(true);
    try {
      // Update enforcement action
      const updates: any = {
        breach_status: outcome === 'completed' ? 'completed' : outcome === 'not_on_site' ? 'not_on_site' : 'cancelled',
        completion_outcome: outcome,
        completion_notes: completionNotes || null,
        completed_by: user?.id,
        completed_at: new Date().toISOString(),
      };

      // If completed successfully, mark as delivered
      if (outcome === 'completed') {
        updates.status = 'delivered';
        updates.delivered_at = new Date().toISOString();
        
        // Add evidence photos if any
        if (evidencePhotos.length > 0) {
          updates.attachments = JSON.stringify(
            evidencePhotos.map((url) => ({
              type: 'photo_evidence',
              url,
              timestamp: new Date().toISOString(),
              gps: gpsLocation,
            }))
          );
        }
      }

      const { error } = await supabase
        .from('enforcement_actions')
        .update(updates)
        .eq('id', jobId);

      if (error) throw error;

      const outcomeMessage =
        outcome === 'completed'
          ? 'Enforcement completed successfully'
          : outcome === 'not_on_site'
          ? 'Marked as vehicle not on site'
          : 'Job cancelled';

      toast.success(outcomeMessage);
      onComplete();
    } catch (error: any) {
      console.error('Failed to complete job:', error);
      toast.error('Failed to complete job: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-primary" />
            Complete Enforcement Job
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Vehicle Details */}
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-base font-bold">
              <Car className="h-5 w-5" />
              {plateNumber}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {zoneName}
            </div>
            <Badge variant="outline" className="capitalize">
              {actionType === 'notice' ? 'Notice to Vacate' : actionType}
            </Badge>
            
            {/* Breach Details */}
            {breachDetails && (
              <div className="text-xs space-y-1 mt-2 pt-2 border-t">
                {breachDetails.nightsStayed && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    {breachDetails.nightsStayed} night(s) stayed
                  </div>
                )}
                {breachDetails.consecutiveNights && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    {breachDetails.consecutiveNights} consecutive night(s)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* GPS Status */}
          {gpsLocation && (
            <Alert>
              <MapPin className="h-4 w-4" />
              <AlertDescription className="text-xs">
                GPS: {gpsLocation.lat.toFixed(6)}, {gpsLocation.lng.toFixed(6)} (±
                {gpsLocation.accuracy.toFixed(0)}m)
              </AlertDescription>
            </Alert>
          )}

          {/* Print Notice (for "notice" action type only) */}
          {actionType === 'notice' && (
            <div className="space-y-2">
              <Label>Notice to Vacate</Label>
              <Button
                onClick={handleGenerateNotice}
                disabled={isPrinting || !!generatedNotice}
                className="w-full h-12 gap-2"
                variant={generatedNotice ? 'outline' : 'default'}
              >
                {isPrinting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating Notice...
                  </>
                ) : generatedNotice ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Notice Generated - Ready to Print
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4" />
                    Generate Notice to Vacate
                  </>
                )}
              </Button>
              
              {generatedNotice && (
                <Button
                  onClick={() => setShowPrintDialog(true)}
                  className="w-full h-12 gap-2"
                  variant="secondary"
                >
                  <Printer className="h-4 w-4" />
                  Print Notice (Ref: {generatedNotice.referenceNumber})
                </Button>
              )}
            </div>
          )}

          {/* Photo Evidence */}
          <div className="space-y-2">
            <Label>Photo Evidence (Optional)</Label>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handlePhotoUpload}
              className="hidden"
            />
            <Button
              onClick={() => photoInputRef.current?.click()}
              disabled={isUploading}
              variant="outline"
              className="w-full h-12 gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Take Photos ({evidencePhotos.length})
                </>
              )}
            </Button>
            
            {/* Photo Preview */}
            {evidencePhotos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {evidencePhotos.map((url, index) => (
                  <div key={index} className="relative aspect-square">
                    <img
                      src={url}
                      alt={`Evidence ${index + 1}`}
                      className="w-full h-full object-cover rounded-lg border"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Completion Outcome */}
          <div className="space-y-2">
            <Label>Outcome *</Label>
            <Select value={outcome} onValueChange={(value: any) => setOutcome(value)}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <div>
                      <div className="font-semibold">Completed</div>
                      <div className="text-xs text-muted-foreground">Action delivered successfully</div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="not_on_site">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-gray-600" />
                    <div>
                      <div className="font-semibold">Not On Site</div>
                      <div className="text-xs text-muted-foreground">Vehicle already gone</div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="cancelled">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <div>
                      <div className="font-semibold">Cancelled</div>
                      <div className="text-xs text-muted-foreground">Job cancelled</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            
            <p className="text-xs text-muted-foreground">
              {outcome === 'completed' && 'Enforcement delivered - breach will be auto-closed'}
              {outcome === 'not_on_site' && 'Vehicle no longer present - breach auto-closed'}
              {outcome === 'cancelled' && 'Job cancelled without completion'}
            </p>
          </div>

          {/* Completion Notes */}
          <div className="space-y-2">
            <Label>Completion Notes</Label>
            <Textarea
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Details about the enforcement action..."
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onCancel} className="flex-1 h-12">
              Cancel
            </Button>
            <Button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="flex-1 h-12 gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Complete Job
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Print Dialog */}
      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print Notice to Vacate</DialogTitle>
            <DialogDescription>
              Review and print the enforcement notice
            </DialogDescription>
          </DialogHeader>
          {generatedNotice && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-muted rounded-lg space-y-2 text-sm">
                <div>
                  <strong>Reference:</strong> {generatedNotice.referenceNumber}
                </div>
                <div>
                  <strong>Vehicle:</strong> {plateNumber}
                </div>
                <div>
                  <strong>Location:</strong> {zoneName}
                </div>
                <div>
                  <strong>Vacate By:</strong>{' '}
                  {new Date(generatedNotice.deadline).toLocaleString('en-NZ')}
                </div>
              </div>

              <Alert>
                <Printer className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  This notice will be printed and must be placed on the vehicle or delivered in person.
                  <br />
                  <strong>Important:</strong> Ensure evidence photos are taken showing notice placement.
                </AlertDescription>
              </Alert>

              {/* Document Preview (scrollable) */}
              <div className="max-h-96 overflow-y-auto border rounded-lg p-4 bg-white text-xs">
                <div dangerouslySetInnerHTML={{ __html: generatedNotice.html }} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPrintDialog(false)}>
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-2">
              <Printer className="h-4 w-4" />
              Print Notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
