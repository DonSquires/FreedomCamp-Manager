import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  MapPin,
  Calendar,
  FileText,
  Camera,
  Upload,
  ExternalLink,
  User,
  Clock,
  CheckCircle,
  AlertTriangle,
  Car,
  Home,
  Sun,
  Cloud,
  CloudRain,
  Wind,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

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
  client_name: string | null;
  priority: string;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface PersonContacted {
  name: string;
  dob: string;
  address: string;
  phone: string;
  notes: string;
}

export function FieldInvestigations() {
  const { user } = useAuthStore();
  
  const [myJobs, setMyJobs] = useState<InvestigationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<InvestigationJob | null>(null);
  const [isCompletingJob, setIsCompletingJob] = useState(false);

  // Completion form state
  const [visitDate, setVisitDate] = useState('');
  const [arrivedAt, setArrivedAt] = useState('');
  const [departedAt, setDepartedAt] = useState('');
  const [findingsSummary, setFindingsSummary] = useState('');
  const [structuresFound, setStructuresFound] = useState('');
  const [vehiclesFound, setVehiclesFound] = useState('');
  const [personsContacted, setPersonsContacted] = useState<PersonContacted[]>([]);
  const [recommendations, setRecommendations] = useState('');
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [officerNotes, setOfficerNotes] = useState('');
  const [weatherConditions, setWeatherConditions] = useState('');
  const [accessNotes, setAccessNotes] = useState('');
  const [evidencePhotos, setEvidencePhotos] = useState<string[]>([]);
  const [vehiclePhotos, setVehiclePhotos] = useState<string[]>([]);
  const [structurePhotos, setStructurePhotos] = useState<string[]>([]);

  useEffect(() => {
    if (user?.id) {
      loadMyJobs();
    }
  }, [user?.id]);

  const loadMyJobs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('investigation_jobs')
        .select('*')
        .eq('assigned_to', user?.id)
        .in('status', ['assigned', 'in_progress'])
        .order('priority', { ascending: true })
        .order('due_date', { ascending: true });

      if (error) throw error;

      setMyJobs(data || []);
    } catch (error: any) {
      console.error('Failed to load jobs:', error);
      toast.error('Failed to load investigation jobs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartJob = async (job: InvestigationJob) => {
    try {
      const { error } = await supabase
        .from('investigation_jobs')
        .update({ status: 'in_progress' })
        .eq('id', job.id);

      if (error) throw error;

      setSelectedJob(job);
      setVisitDate(new Date().toISOString().split('T')[0]);
      setArrivedAt(new Date().toISOString());
      
      toast.success('Job started');
      loadMyJobs();
    } catch (error: any) {
      console.error('Failed to start job:', error);
      toast.error('Failed to start job');
    }
  };

  const handleCompleteJob = async () => {
    if (!selectedJob) return;

    setIsCompletingJob(true);
    try {
      // Create findings record
      const { error: findingsError } = await supabase
        .from('investigation_findings')
        .insert({
          job_id: selectedJob.id,
          visit_date: visitDate,
          arrived_at: arrivedAt,
          departed_at: departedAt || new Date().toISOString(),
          findings_summary: findingsSummary,
          structures_found: structuresFound,
          vehicles_found: vehiclesFound,
          persons_contacted: personsContacted,
          recommendations,
          follow_up_required: followUpRequired,
          follow_up_notes: followUpNotes,
          officer_notes: officerNotes,
          weather_conditions: weatherConditions,
          access_notes: accessNotes,
          evidence_photos: evidencePhotos,
          vehicle_photos: vehiclePhotos,
          structure_photos: structurePhotos,
          completed_by: user?.id,
        });

      if (findingsError) throw findingsError;

      // Update job status
      const { error: jobError } = await supabase
        .from('investigation_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user?.id,
        })
        .eq('id', selectedJob.id);

      if (jobError) throw jobError;

      toast.success('Investigation job completed successfully');
      setSelectedJob(null);
      resetForm();
      loadMyJobs();
    } catch (error: any) {
      console.error('Failed to complete job:', error);
      toast.error('Failed to complete job: ' + error.message);
    } finally {
      setIsCompletingJob(false);
    }
  };

  const resetForm = () => {
    setVisitDate('');
    setArrivedAt('');
    setDepartedAt('');
    setFindingsSummary('');
    setStructuresFound('');
    setVehiclesFound('');
    setPersonsContacted([]);
    setRecommendations('');
    setFollowUpRequired(false);
    setFollowUpNotes('');
    setOfficerNotes('');
    setWeatherConditions('');
    setAccessNotes('');
    setEvidencePhotos([]);
    setVehiclePhotos([]);
    setStructurePhotos([]);
  };

  const addPerson = () => {
    setPersonsContacted([
      ...personsContacted,
      { name: '', dob: '', address: '', phone: '', notes: '' },
    ]);
  };

  const updatePerson = (index: number, field: keyof PersonContacted, value: string) => {
    const updated = [...personsContacted];
    updated[index][field] = value;
    setPersonsContacted(updated);
  };

  const removePerson = (index: number) => {
    setPersonsContacted(personsContacted.filter((_, i) => i !== index));
  };

  const getPriorityBadge = (priority: string) => {
    const variants = {
      low: 'bg-blue-500/10 text-blue-500',
      medium: 'bg-amber-500/10 text-amber-500',
      high: 'bg-orange-500/10 text-orange-500',
      urgent: 'bg-red-500/10 text-red-500',
    };

    return (
      <Badge variant="outline" className={variants[priority as keyof typeof variants] || ''}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">My Investigation Jobs</h2>
        <p className="text-muted-foreground">
          View and complete assigned investigation tasks
        </p>
      </div>

      {/* My Jobs List */}
      <div className="grid gap-4 md:grid-cols-2">
        {isLoading ? (
          <div className="col-span-2 text-center py-12 text-muted-foreground">
            Loading your jobs...
          </div>
        ) : myJobs.length === 0 ? (
          <div className="col-span-2 text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No active investigation jobs</p>
            <p className="text-sm">Jobs assigned to you will appear here</p>
          </div>
        ) : (
          myJobs.map((job) => (
            <Card key={job.id} className="border-2">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{job.reference_number}</CardTitle>
                    <CardDescription className="mt-1">
                      <Badge variant="outline" className="text-xs mr-2">
                        {job.job_type.replace('_', ' ').toUpperCase()}
                      </Badge>
                      {getPriorityBadge(job.priority)}
                    </CardDescription>
                  </div>
                  {job.status === 'assigned' && (
                    <Button size="sm" onClick={() => handleStartJob(job)}>
                      Start Job
                    </Button>
                  )}
                  {job.status === 'in_progress' && (
                    <Button size="sm" variant="outline" onClick={() => setSelectedJob(job)}>
                      Complete
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{job.location_address}</p>
                    {job.property_details && (
                      <p className="text-xs text-muted-foreground mt-0.5">{job.property_details}</p>
                    )}
                  </div>
                </div>

                {job.gps_latitude && job.gps_longitude && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      window.open(
                        `https://www.google.com/maps/dir/?api=1&destination=${job.gps_latitude},${job.gps_longitude}`,
                        '_blank'
                      )
                    }
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Get Directions
                  </Button>
                )}

                {job.briefing_notes && (
                  <div className="p-2 bg-muted/50 rounded text-xs">
                    <p className="font-semibold mb-1">Briefing:</p>
                    <p className="text-muted-foreground">{job.briefing_notes}</p>
                  </div>
                )}

                {job.instructions && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
                    <p className="font-semibold text-amber-600 mb-1">Instructions:</p>
                    <p className="text-amber-700">{job.instructions}</p>
                  </div>
                )}

                {job.due_date && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Due: {new Date(job.due_date).toLocaleDateString('en-NZ')}
                  </div>
                )}

                {job.client_name && (
                  <div className="text-xs text-muted-foreground">
                    Client: {job.client_name}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Completion Dialog */}
      <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete Investigation: {selectedJob?.reference_number}</DialogTitle>
            <DialogDescription>
              Enter your findings and complete the investigation report
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="findings" className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="findings">Findings</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="photos">Photos</TabsTrigger>
              <TabsTrigger value="recommendations">Summary</TabsTrigger>
            </TabsList>

            <TabsContent value="findings" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Visit Date</Label>
                  <Input
                    type="date"
                    value={visitDate}
                    onChange={(e) => setVisitDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Arrived At</Label>
                  <Input
                    type="time"
                    value={arrivedAt ? new Date(arrivedAt).toTimeString().slice(0, 5) : ''}
                    onChange={(e) =>
                      setArrivedAt(new Date(`${visitDate}T${e.target.value}`).toISOString())
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Departed At</Label>
                  <Input
                    type="time"
                    value={departedAt ? new Date(departedAt).toTimeString().slice(0, 5) : ''}
                    onChange={(e) =>
                      setDepartedAt(new Date(`${visitDate}T${e.target.value}`).toISOString())
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Findings Summary</Label>
                <Textarea
                  value={findingsSummary}
                  onChange={(e) => setFindingsSummary(e.target.value)}
                  placeholder="Describe what you found at the site..."
                  rows={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Structures Found</Label>
                  <Textarea
                    value={structuresFound}
                    onChange={(e) => setStructuresFound(e.target.value)}
                    placeholder="e.g., Tent, wooden shelter, tarpaulin..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vehicles Found</Label>
                  <Textarea
                    value={vehiclesFound}
                    onChange={(e) => setVehiclesFound(e.target.value)}
                    placeholder="Include plate numbers if visible..."
                    rows={3}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Weather Conditions</Label>
                  <Input
                    value={weatherConditions}
                    onChange={(e) => setWeatherConditions(e.target.value)}
                    placeholder="e.g., Clear, cloudy, raining..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Access Notes</Label>
                  <Input
                    value={accessNotes}
                    onChange={(e) => setAccessNotes(e.target.value)}
                    placeholder="How did you access the site?"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Persons Contacted</Label>
                <Button size="sm" onClick={addPerson}>
                  <User className="h-4 w-4 mr-2" />
                  Add Person
                </Button>
              </div>

              {personsContacted.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No persons contacted</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {personsContacted.map((person, index) => (
                    <Card key={index} className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-base">Person {index + 1}</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removePerson(index)}
                          >
                            Remove
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs">Full Name</Label>
                            <Input
                              value={person.name}
                              onChange={(e) => updatePerson(index, 'name', e.target.value)}
                              placeholder="John Doe"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Date of Birth</Label>
                            <Input
                              type="date"
                              value={person.dob}
                              onChange={(e) => updatePerson(index, 'dob', e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Address</Label>
                          <Input
                            value={person.address}
                            onChange={(e) => updatePerson(index, 'address', e.target.value)}
                            placeholder="Current address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Phone</Label>
                          <Input
                            value={person.phone}
                            onChange={(e) => updatePerson(index, 'phone', e.target.value)}
                            placeholder="Contact number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Notes</Label>
                          <Textarea
                            value={person.notes}
                            onChange={(e) => updatePerson(index, 'notes', e.target.value)}
                            placeholder="Additional information..."
                            rows={2}
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="photos" className="space-y-4">
              <div className="text-sm text-muted-foreground mb-4">
                Photos will be uploaded to the evidence bucket. Click "Upload Photo" to add images.
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>General Evidence Photos</Label>
                  <Button variant="outline" className="w-full">
                    <Camera className="h-4 w-4 mr-2" />
                    Upload Photo ({evidencePhotos.length})
                  </Button>
                </div>
                
                <div className="space-y-2">
                  <Label>Vehicle Photos</Label>
                  <Button variant="outline" className="w-full">
                    <Car className="h-4 w-4 mr-2" />
                    Upload Photo ({vehiclePhotos.length})
                  </Button>
                </div>
                
                <div className="space-y-2">
                  <Label>Structure Photos</Label>
                  <Button variant="outline" className="w-full">
                    <Home className="h-4 w-4 mr-2" />
                    Upload Photo ({structurePhotos.length})
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="recommendations" className="space-y-4">
              <div className="space-y-2">
                <Label>Recommendations</Label>
                <Textarea
                  value={recommendations}
                  onChange={(e) => setRecommendations(e.target.value)}
                  placeholder="What actions do you recommend?"
                  rows={4}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={followUpRequired}
                    onChange={(e) => setFollowUpRequired(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label>Follow-up Visit Required</Label>
                </div>

                {followUpRequired && (
                  <div className="space-y-2 ml-6">
                    <Label>Follow-up Notes</Label>
                    <Textarea
                      value={followUpNotes}
                      onChange={(e) => setFollowUpNotes(e.target.value)}
                      placeholder="Describe what needs to be done in the follow-up..."
                      rows={3}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Officer Notes (Internal)</Label>
                <Textarea
                  value={officerNotes}
                  onChange={(e) => setOfficerNotes(e.target.value)}
                  placeholder="Any additional notes or observations..."
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedJob(null)}>
              Cancel
            </Button>
            <Button onClick={handleCompleteJob} disabled={isCompletingJob}>
              {isCompletingJob ? (
                <>Processing...</>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Complete Investigation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
