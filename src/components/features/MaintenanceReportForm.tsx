/**
 * MaintenanceReportForm Component
 * Create maintenance reports for infrastructure/facilities issues
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  X,
  Save,
  Camera,
  Loader2,
  MapPin,
  Wrench,
} from 'lucide-react';
import { SessionScan } from './SessionList';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface MaintenanceReportFormProps {
  scan: SessionScan;
  onClose: () => void;
  onSuccess: () => void;
}

export function MaintenanceReportForm({
  scan,
  onClose,
  onSuccess,
}: MaintenanceReportFormProps) {
  const { user } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issueType, setIssueType] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error('Please describe the maintenance issue');
      return;
    }

    setIsSubmitting(true);

    try {
      // Create maintenance report as an incident with specific type
      const { error } = await supabase
        .from('incidents')
        .insert({
          organization_id: scan.organizationId,
          user_id: user?.id,
          zone_id: scan.zoneId,
          vehicle_id: scan.vehicleId,
          incident_type: 'maintenance',
          description: `MAINTENANCE ISSUE\n\nType: ${issueType}\nLocation: ${location}\n\n${description}`,
          severity: priority,
          status: 'pending',
          gps_latitude: scan.gpsLocation?.lat,
          gps_longitude: scan.gpsLocation?.lng,
          gps_accuracy: scan.gpsAccuracy,
          happened_at: new Date().toISOString(),
        });

      if (error) throw error;

      toast.success('Maintenance report created');
      onSuccess();
    } catch (error: any) {
      console.error('Failed to create maintenance report:', error);
      toast.error('Failed to create report: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
          <CardHeader className="border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl flex items-center gap-2">
                <Wrench className="h-6 w-6 text-orange-600" />
                Maintenance Report
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="font-mono">
                {scan.plateNumber}
              </Badge>
              <Badge variant="secondary">
                <MapPin className="h-3 w-3 mr-1" />
                {scan.zoneName}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Issue Type */}
            <div className="space-y-2">
              <Label htmlFor="issue-type">Issue Type *</Label>
              <select
                id="issue-type"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full p-2 rounded-md border bg-background"
                required
              >
                <option value="">Select type...</option>
                <option value="Signage Damage">Signage Damage</option>
                <option value="Lighting Issue">Lighting Issue</option>
                <option value="Waste Bins">Waste Bins</option>
                <option value="Road Surface">Road Surface</option>
                <option value="Parking Bay Markings">Parking Bay Markings</option>
                <option value="Barrier/Fence Damage">Barrier/Fence Damage</option>
                <option value="Toilet Facilities">Toilet Facilities</option>
                <option value="Landscaping">Landscaping</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label htmlFor="priority">Priority *</Label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full p-2 rounded-md border bg-background"
              >
                <option value="low">Low - Cosmetic/Non-urgent</option>
                <option value="medium">Medium - Should be addressed soon</option>
                <option value="high">High - Safety concern/Urgent</option>
              </select>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">Specific Location</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Near parking bay 5, entrance gate..."
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Issue Description *</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the maintenance issue in detail..."
                rows={6}
                className="resize-none"
                required
              />
            </div>

            {/* Info Box */}
            <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                <strong>Note:</strong> This report will be sent to the maintenance team for action. Include photos if possible for faster resolution.
              </p>
            </div>
          </CardContent>

          <div className="p-4 border-t bg-muted/30 flex gap-3 flex-shrink-0">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !description.trim() || !issueType}
              className="flex-1 h-12"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5 mr-2" />
                  Submit Report
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
