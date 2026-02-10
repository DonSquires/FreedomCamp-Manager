/**
 * Field Investigation Work - For field officers to work on assigned investigation jobs
 * Features: View jobs, add notes, take GPS-watermarked photos, track police involvement
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  FileText,
  Camera,
  MapPin,
  Calendar,
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  Shield,
  Upload,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { addGPSWatermark } from '@/lib/imageProcessing';

interface InvestigationJob {
  id: string;
  reference_number: string;
  job_type: string;
  location_address: string;
  property_details: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  briefing_notes: string | null;
  instructions: string | null;
  priority: string;
  due_date: string | null;
  status: string;
  created_at: string;
  assigned_at: string | null;
}

interface InvestigationFinding {
  id: string;
  job_id: string;
  visit_date: string;
  findings_summary: string | null;
  structures_found: string | null;
  vehicles_found: string | null;
  persons_contacted: any[];
  evidence_photos: string[];
  officer_notes: string | null;
  police_involved: boolean;
  police_event_number: string | null;
  police_officer_number: string | null;
}

export function FieldInvestigationWork() {
  const { user } = useAuthStore();
  const [jobs, setJobs] = useState<InvestigationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<InvestigationJob | null>(null);
  const [findings, setFindings] = useState<Partial<InvestigationFinding>>({
    findings_summary: '',
    structures_found: '',
    vehicles_found: '',
    persons_contacted: [],
    evidence_photos: [],
    officer_notes: '',
    police_involved: false,
    police_event_number: '',
    police_officer_number: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<GeolocationPosition | null>(null);
  
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Get current GPS location
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation(position);
          console.log('📍 GPS location acquired:', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          console.warn('GPS location failed:', error);
          toast.warning('GPS location unavailable - photos will not have GPS watermark');
        },
        { enableHighAccuracy: true, maximumAge: 60000 }
      );
    }
  }, []);

  // Load assigned jobs
  useEffect(() => {
    loadJobs();

    // Real-time subscription
    const channel = supabase
      .channel('my_investigation_jobs')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'investigation_jobs',
          filter: `assigned_to=eq.${user?.id}`,
        },
        () => {
          console.log('🔄 Investigation job updated');
          loadJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('investigation_jobs')
        .select('*')
        .eq('assigned_to', user?.id)
        .in('status', ['assigned', 'in_progress'])
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error: any) {
      console.error('Failed to load jobs:', error);
      toast.error('Failed to load investigation jobs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTakePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploadingPhoto(true);
    try {
      const uploadedUrls: string[] = [];

      for (const file of Array.from(files)) {
        // Add GPS watermark
        let processedFile = file;
        if (currentLocation) {
          processedFile = await addGPSWatermark(file, {
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
            accuracy: currentLocation.coords.accuracy,
          });
          console.log('✅ GPS watermark added to photo');
        } else {
          // Add timestamp-only watermark
          processedFile = await addGPSWatermark(file, null);
          console.log('⚠️ Timestamp-only watermark added (GPS unavailable)');
        }

        // Upload to Supabase Storage
        const fileName = `${user?.id}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, processedFile);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        uploadedUrls.push(publicUrl);
      }

      setFindings(prev => ({
        ...prev,
        evidence_photos: [...(prev.evidence_photos || []), ...uploadedUrls],
      }));

      toast.success(`${uploadedUrls.length} photo(s) uploaded with GPS watermark`);
    } catch (error: any) {
      console.error('Photo upload failed:', error);
      toast.error('Failed to upload photo: ' + error.message);
    } finally {
      setIsUploadingPhoto(false);
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  };

  const handleSubmitFindings = async () => {
    if (!selectedJob) return;

    if (!findings.findings_summary?.trim()) {
      toast.error('Please add a findings summary');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('investigation_findings')
        .insert({
          job_id: selectedJob.id,
          visit_date: new Date().toISOString(),
          findings_summary: findings.findings_summary,
          structures_found: findings.structures_found || null,
          vehicles_found: findings.vehicles_found || null,
          persons_contacted: findings.persons_contacted || [],
          evidence_photos: findings.evidence_photos || [],
          officer_notes: findings.officer_notes || null,
          police_involved: findings.police_involved || false,
          police_event_number: findings.police_event_number || null,
          police_officer_number: findings.police_officer_number || null,
          completed_by: user?.id,
        });

      if (error) throw error;

      // Update job status to in_progress
      await supabase
        .from('investigation_jobs')
        .update({ status: 'in_progress' })
        .eq('id', selectedJob.id);

      toast.success('✅ Investigation findings submitted');
      setSelectedJob(null);
      setFindings({
        findings_summary: '',
        structures_found: '',
        vehicles_found: '',
        persons_contacted: [],
        evidence_photos: [],
        officer_notes: '',
        police_involved: false,
        police_event_number: '',
        police_officer_number: '',
      });
      loadJobs();
    } catch (error: any) {
      console.error('Failed to submit findings:', error);
      toast.error('Failed to submit findings: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      assigned: 'bg-blue-500/10 text-blue-500',
      in_progress: 'bg-purple-500/10 text-purple-500',
    };
    return (
      <Badge variant="outline" className={variants[status as keyof typeof variants]}>
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const variants = {
      urgent: 'bg-red-500/10 text-red-500',
      high: 'bg-orange-500/10 text-orange-500',
      medium: 'bg-amber-500/10 text-amber-500',
      low: 'bg-blue-500/10 text-blue-500',
    };
    return (
      <Badge variant="outline" className={variants[priority as keyof typeof variants]}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h2 className="text-2xl font-bold mb-2">My Investigation Jobs</h2>
        <p className="text-muted-foreground">
          Complete assigned investigation jobs with photos and findings
        </p>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-16">
            <FileText className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-semibold">No Active Jobs</p>
            <p className="text-sm text-muted-foreground mt-2">
              You don't have any assigned investigation jobs
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <Card key={job.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-bold text-lg">{job.reference_number}</h3>
                      {getStatusBadge(job.status)}
                      {getPriorityBadge(job.priority)}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {job.job_type.replace('_', ' ').toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    {job.location_address}
                  </div>
                  {job.due_date && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      Due: {new Date(job.due_date).toLocaleDateString('en-NZ')}
                    </div>
                  )}
                </div>

                {job.briefing_notes && (
                  <div className="p-3 bg-muted rounded-lg mb-4">
                    <p className="text-sm whitespace-pre-line">{job.briefing_notes}</p>
                  </div>
                )}

                <Button
                  onClick={() => setSelectedJob(job)}
                  className="w-full"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Work on Investigation
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Investigation Work Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Investigation: {selectedJob?.reference_number}
            </DialogTitle>
          </DialogHeader>

          {selectedJob && (
            <div className="space-y-6">
              {/* Job Details */}
              <div className="p-4 bg-muted rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <p className="font-semibold">{selectedJob.location_address}</p>
                </div>
                {selectedJob.property_details && (
                  <p className="text-sm text-muted-foreground">
                    {selectedJob.property_details}
                  </p>
                )}
                {selectedJob.instructions && (
                  <div className="p-3 bg-background rounded border">
                    <p className="text-sm font-semibold mb-1">Instructions:</p>
                    <p className="text-sm whitespace-pre-line">{selectedJob.instructions}</p>
                  </div>
                )}
              </div>

              {/* Findings Form */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Findings Summary *</Label>
                  <Textarea
                    value={findings.findings_summary || ''}
                    onChange={(e) => setFindings({ ...findings, findings_summary: e.target.value })}
                    placeholder="Describe what you found during the site visit..."
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Structures Found</Label>
                    <Input
                      value={findings.structures_found || ''}
                      onChange={(e) => setFindings({ ...findings, structures_found: e.target.value })}
                      placeholder="e.g., Tent, tarpaulin shelter"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Vehicles Found</Label>
                    <Input
                      value={findings.vehicles_found || ''}
                      onChange={(e) => setFindings({ ...findings, vehicles_found: e.target.value })}
                      placeholder="e.g., ABC123, DEF456"
                    />
                  </div>
                </div>

                {/* Evidence Photos */}
                <div className="space-y-2">
                  <Label>Evidence Photos (GPS + Timestamp Watermarked)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      onChange={handleTakePhoto}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={isUploadingPhoto}
                      className="flex-1"
                    >
                      {isUploadingPhoto ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Camera className="h-4 w-4 mr-2" />
                          Take Photo
                        </>
                      )}
                    </Button>
                    {currentLocation ? (
                      <Badge className="bg-green-500">
                        GPS: {currentLocation.coords.accuracy?.toFixed(0)}m
                      </Badge>
                    ) : (
                      <Badge variant="destructive">No GPS</Badge>
                    )}
                  </div>
                  {findings.evidence_photos && findings.evidence_photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {findings.evidence_photos.map((url, idx) => (
                        <div key={idx} className="relative group">
                          <img
                            src={url}
                            alt={`Evidence ${idx + 1}`}
                            className="w-full h-32 object-cover rounded border"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              setFindings({
                                ...findings,
                                evidence_photos: findings.evidence_photos?.filter((_, i) => i !== idx),
                              });
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Police Involvement */}
                <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="police-involved"
                      checked={findings.police_involved || false}
                      onCheckedChange={(checked) =>
                        setFindings({ ...findings, police_involved: checked as boolean })
                      }
                    />
                    <Label htmlFor="police-involved" className="flex items-center gap-2 font-semibold">
                      <Shield className="h-4 w-4 text-blue-600" />
                      Police Involved
                    </Label>
                  </div>

                  {findings.police_involved && (
                    <div className="grid grid-cols-2 gap-4 pl-6">
                      <div className="space-y-2">
                        <Label>Police Event Number</Label>
                        <Input
                          value={findings.police_event_number || ''}
                          onChange={(e) =>
                            setFindings({ ...findings, police_event_number: e.target.value })
                          }
                          placeholder="e.g., P-123456789"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Police Officer Number</Label>
                        <Input
                          value={findings.police_officer_number || ''}
                          onChange={(e) =>
                            setFindings({ ...findings, police_officer_number: e.target.value })
                          }
                          placeholder="e.g., QA1234"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Officer Notes */}
                <div className="space-y-2">
                  <Label>Additional Notes</Label>
                  <Textarea
                    value={findings.officer_notes || ''}
                    onChange={(e) => setFindings({ ...findings, officer_notes: e.target.value })}
                    placeholder="Any additional observations or notes..."
                    rows={3}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedJob(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitFindings} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Submit Findings
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
