/**
 * DuplicateScanModal - Warning when vehicle already scanned recently
 * Gives option to cancel duplicate or continue to add H&S/Incident
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  X as XIcon,
  FileText,
  Loader2,
  Clock,
  User,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface DuplicateScanModalProps {
  plateNumber: string;
  vehicleId?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  photoUrl?: string;
  observationId: string; // The new observation just created
  duplicateInfo: {
    recordedBy: string;
    recordedByName: string;
    recordedAt: string;
    zoneName: string;
    isSameOfficer: boolean;
  };
  onCancel: () => void;
  onContinueUpdate: () => void;
}

export function DuplicateScanModal({
  plateNumber,
  vehicleId,
  vehicleMake,
  vehicleModel,
  vehicleColor,
  photoUrl,
  observationId,
  duplicateInfo,
  onCancel,
  onContinueUpdate,
}: DuplicateScanModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleCancelRecord = async () => {
    setIsDeleting(true);

    try {
      // Delete the just-created observation
      const { error: deleteError } = await supabase
        .from('vehicle_observations_v2')
        .delete()
        .eq('observation_id', observationId);

      if (deleteError) {
        console.error('Failed to delete duplicate observation:', deleteError);
        throw deleteError;
      }

      console.log('✅ Duplicate observation deleted:', observationId);
      
      toast.success('Duplicate scan cancelled', {
        description: 'Record has been removed from the system',
      });
      
      onCancel();
    } catch (error: any) {
      console.error('❌ Failed to cancel duplicate:', error);
      toast.error('Failed to cancel record: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleContinueUpdate = () => {
    toast.info('Opening vehicle record for H&S or Incident update');
    onContinueUpdate();
  };

  const timeAgo = () => {
    const now = new Date();
    const recorded = new Date(duplicateInfo.recordedAt);
    const diffMs = now.getTime() - recorded.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    }
    
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200">
      <Card className="max-w-lg w-full bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-500 shadow-2xl animate-in zoom-in duration-300">
        <CardHeader className="pb-3">
          <div className="flex flex-col items-center text-center gap-4 pt-2">
            <div className="p-4 rounded-full bg-amber-100 dark:bg-amber-900/30 ring-4 ring-white dark:ring-gray-900 text-amber-600">
              <AlertTriangle className="h-12 w-12" />
            </div>
            <CardTitle className="text-4xl font-black leading-tight text-amber-900 dark:text-amber-100">
              ⚠️ DUPLICATE
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Vehicle Photo */}
          {photoUrl && (
            <div className="relative rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
              <img 
                src={photoUrl} 
                alt={`Vehicle ${plateNumber}`}
                className="w-full h-48 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm px-4 py-2">
                <p className="text-white font-mono font-black text-2xl tracking-wider">
                  {plateNumber}
                </p>
                {(vehicleMake || vehicleModel || vehicleColor) && (
                  <p className="text-white/80 text-sm">
                    {[vehicleColor, vehicleMake, vehicleModel].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Duplicate Information - Simplified */}
          <div className="p-6 bg-white dark:bg-gray-900 rounded-lg border-2 border-amber-300 dark:border-amber-700 text-center space-y-4">
            <p className="font-black text-3xl leading-tight text-amber-900 dark:text-amber-100">
              Already Scanned by
            </p>
            <p className="font-black text-5xl leading-tight text-primary">
              {duplicateInfo.recordedByName.split(' ')[0]}
            </p>
            <p className="text-2xl font-bold text-muted-foreground">
              {timeAgo()}
            </p>
          </div>

          {/* Instructions - Simplified */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border-2 border-blue-300 dark:border-blue-700 text-center">
            <p className="text-xl font-bold leading-relaxed text-blue-900 dark:text-blue-100">
              Add H&S or Incident?
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <Button
              variant="outline"
              onClick={handleCancelRecord}
              disabled={isDeleting}
              className="h-24 text-2xl font-black touch-manipulation border-2 border-red-300 text-red-600 hover:bg-red-50"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-8 w-8 mr-2 animate-spin" />
                  Wait...
                </>
              ) : (
                <>
                  <XIcon className="h-8 w-8 mr-2" />
                  Cancel
                </>
              )}
            </Button>
            <Button
              variant="default"
              onClick={handleContinueUpdate}
              className="h-24 text-2xl font-black bg-primary hover:bg-primary/90 touch-manipulation shadow-lg"
            >
              <FileText className="h-8 w-8 mr-2" />
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
