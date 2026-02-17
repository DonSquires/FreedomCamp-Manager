import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, FileText, Home, Loader2, Eye, CheckCircle2, XCircle, MapPin, Car, Flag, Activity, Shield, BellRing, Image as ImageIcon, Edit3, Camera, Bug } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
// Router not used - AdminPortal uses tab-based navigation
// Removed VehicleEditDrawer - incompatible props

interface VehicleRecord {
  id: string;
  plate_number: string;
  zone: { name: string; id: string };
  recorded_at: string;
  requires_followup: boolean;
  followup_reason: string;
  followup_priority: string;
  homeless_claimed: boolean;
  location_lat?: number;
  location_lng?: number;
  notes?: string;
  evidence_photos?: any;
}

interface IncidentRecord {
  id: string;
  plate_number: string;
  zone: { id: string; name: string };
  incident_type: string;
  description: string;
  severity: string;
  status: string;
  court_ready: boolean;
  recorded_at: string;
  photos?: string[];
  photo_metadata_ids?: string[];
  gps_latitude?: number;
  gps_longitude?: number;
  user_profiles?: { first_name: string; last_name: string };
}

interface BugReport {
  id: string;
  title: string;
  description: string;
  issue_type: string;
  severity: string;
  status: string;
  created_at: string;
  user_profiles: { first_name: string; last_name: string; email: string };
  app_version: string;
  current_page: string;
}

interface UrgentFollowUpsProps {
  onTabChange?: (tab: string) => void;
}

export function UrgentFollowUps({ onTabChange }: UrgentFollowUpsProps = {}) {
  const [activeTab, setActiveTab] = useState<'observations' | 'homeless' | 'incidents' | 'bug-reports'>('observations');
  const [isLoading, setIsLoading] = useState(true);
  const [observations, setObservations] = useState<VehicleRecord[]>([]);
  const [homelessRecords, setHomelessRecords] = useState<VehicleRecord[]>([]);
  const [incidentRecords, setIncidentRecords] = useState<IncidentRecord[]>([]);
  const [bugReports, setBugReports] = useState<BugReport[]>([]);
  
  // Review Modal State
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<VehicleRecord | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  
  // Vehicle Details Modal State
  const [isVehicleDetailsOpen, setIsVehicleDetailsOpen] = useState(false);
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [loadingVehicleDetails, setLoadingVehicleDetails] = useState(false);
  
  // Homeless Confirmation State
  const [confirmationNotes, setConfirmationNotes] = useState('');

  useEffect(() => {
    loadFollowUps();
  }, []);

  const loadFollowUps = async () => {
    setIsLoading(true);
    try {
      console.log('📋 Loading Urgent Follow-Ups...');
      
      // Get user's organization and role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      console.log('✅ User authenticated:', user.id);

      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('❌ Profile error:', profileError);
        throw profileError;
      }
      if (!profile?.organization_id) throw new Error('Organization not found');
      
      console.log('✅ Organization ID:', profile.organization_id, 'Role:', profile.role);
      const isMaster = profile.role === 'master';

      // Load ACTIVE BREACHES from breach_alerts table (FIXED: Use plate_number directly)
      console.log('🔥 Loading active breaches...');
      const { data: breachData, error: breachError } = await supabase
        .from('breach_alerts')
        .select(`
          *,
          zones!inner(id, name, organization_id)
        `)
        .eq('zones.organization_id', profile.organization_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50);

      if (breachError) {
        console.error('❌ Breach alerts error:', breachError);
        throw breachError;
      }
      
      console.log(`✅ Loaded ${breachData?.length || 0} active breaches`);
      
      // Transform to match interface (use plate_number from breach_alerts directly)
      const breaches = (breachData || []).map(breach => ({
        id: breach.id,
        plate_number: breach.plate_number || 'Unknown', // ✅ Direct from breach_alerts table
        zone: { name: breach.zones.name, id: breach.zones.id },
        recorded_at: breach.created_at,
        requires_followup: true,
        followup_reason: breach.breach_type + (breach.breach_details?.reason ? ': ' + breach.breach_details.reason : ''),
        followup_priority: 'high',
        homeless_claimed: false,
      }));
      
      setObservations(breaches);

      // Load homeless claims (UPDATED FOR NEW SCHEMA)
      console.log('🏠 Loading homeless claims...');
      const { data: homelessVehicles, error: homelessVehiclesError } = await supabase
        .from('canonical_vehicles')
        .select('plate_number')
        .eq('homeless_status', 'claimed');

      if (homelessVehiclesError) {
        console.error('❌ Homeless vehicles error:', homelessVehiclesError);
        throw homelessVehiclesError;
      }
      
      const homelessPlates = homelessVehicles?.map(v => v.plate_number) || [];
      console.log(`✅ Found ${homelessPlates.length} vehicles claiming homeless`);
      
      // Only query observations if there are homeless plates (avoid empty IN clause)
      let homelessRecords: VehicleRecord[] = [];
      
      if (homelessPlates.length > 0) {
        console.log('🔍 Loading observations for homeless vehicles...');
        const { data: homelessData, error: homelessError } = await supabase
          .from('vehicle_observations_v2')
          .select(`
            observation_id,
            plate_number,
            zone_id,
            recorded_at,
            officer_notes,
            zones!inner(id, name, organization_id)
          `)
          .eq('zones.organization_id', profile.organization_id)
          .in('plate_number', homelessPlates)
          .order('recorded_at', { ascending: false })
          .limit(50);

        if (homelessError) {
          console.error('❌ Homeless observations error:', homelessError);
          throw homelessError;
        }
        
        console.log(`✅ Loaded ${homelessData?.length || 0} homeless observations`);
        
        // Transform to match interface
        homelessRecords = (homelessData || []).map(obs => ({
          id: obs.observation_id,
          plate_number: obs.plate_number,
          zone: { name: obs.zones.name, id: obs.zones.id },
          recorded_at: obs.recorded_at,
          requires_followup: false,
          followup_reason: '',
          followup_priority: 'medium',
          homeless_claimed: true,
          notes: obs.officer_notes,
        }));
      } else {
        console.log('ℹ️ No homeless vehicles - skipping observations query');
      }
      
      setHomelessRecords(homelessRecords);

      // Load incidents requiring review (NEW)
      console.log('📸 Loading incidents...');
      const { data: incidentData, error: incidentError } = await supabase
        .from('incidents')
        .select(`
          *,
          zone:zones(id, name),
          user_profiles!incidents_user_id_fkey(first_name, last_name)
        `)
        .eq('organization_id', profile.organization_id)
        .eq('court_ready', false)
        .neq('status', 'closed')
        .order('recorded_at', { ascending: false });

      if (incidentError) {
        console.error('❌ Incidents error:', incidentError);
        throw incidentError;
      }
      
      console.log(`✅ Loaded ${incidentData?.length || 0} incidents`);
      setIncidentRecords(incidentData || []);

      // Load bug reports (submitted status) - ONLY FOR MASTERS
      if (isMaster) {
        console.log('🐛 Loading bug reports (master user)...');
        const { data: bugData, error: bugError } = await supabase
          .from('bug_reports')
          .select(`
            *,
            user_profiles(first_name, last_name, email)
          `)
          .eq('status', 'submitted')
          .order('created_at', { ascending: false });

        if (bugError) {
          console.error('❌ Failed to load bug reports:', bugError);
          throw bugError;
        }
        
        console.log(`✅ Loaded ${bugData?.length || 0} bug reports`);
        setBugReports(bugData || []);
      } else {
        console.log('ℹ️ Bug reports skipped (non-master user)');
        setBugReports([]);
      }
      
      console.log('✅ All urgent follow-ups loaded successfully');
    } catch (error: any) {
      console.error('❌ Failed to load follow-ups:', error);
      toast.error('Failed to load urgent follow-ups: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReview = async (record: VehicleRecord) => {
    setLoadingVehicleDetails(true);
    setIsVehicleDetailsOpen(true);
    
    try {
      // Get canonical vehicle data
      const { data: canonical } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', record.plate_number)
        .single();
      
      // Get recent observations with photos
      const { data: observations } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          *,
          zones!inner(name),
          user_profiles!vehicle_observations_v2_recorded_by_fkey(first_name, last_name)
        `)
        .eq('plate_number', record.plate_number)
        .order('recorded_at', { ascending: false })
        .limit(5);
      
      // Get photos from photo_metadata
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id || '')
        .single();
      
      const { data: photos } = await supabase
        .from('photo_metadata')
        .select('*')
        .eq('organization_id', profile?.organization_id || '')
        .ilike('storage_path', `%${record.plate_number}%`)
        .order('captured_at', { ascending: false })
        .limit(10);
      
      setVehicleDetails({
        ...record,
        canonical,
        observations: observations || [],
        photos: photos || [],
        recordPhotos: [], // No evidence_photos in new schema
      });
    } catch (error: any) {
      console.error('Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setLoadingVehicleDetails(false);
    }
  };

  const handleSendToEnforcement = async (record: VehicleRecord) => {
    setIsProcessing(true);
    try {
      // Get the user's ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get organization ID
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) throw new Error('Organization not found');

      // Create enforcement action (observation_id from record.id)
      const { error: enforcementError } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: profile.organization_id,
          user_id: user.id,
          zone_id: (record.zone as any).id,
          plate_number: record.plate_number,
          action_type: 'warning',
          observation_id: record.id, // observation_id is the record.id
          notes: resolutionNotes || record.followup_reason,
          status: 'pending',
        });

      if (enforcementError) throw enforcementError;

      toast.success('Sent to enforcement - Warning notice pending');
      loadFollowUps();
      setIsReviewModalOpen(false);
      setResolutionNotes('');
    } catch (error: any) {
      console.error('Failed to send to enforcement:', error);
      toast.error('Failed to send to enforcement: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismiss = async (recordId: string) => {
    setIsProcessing(true);
    try {
      // Just remove from queue - no table to update in new schema
      toast.success('Follow-up dismissed - No action taken');
      loadFollowUps();
      setIsReviewModalOpen(false);
      setResolutionNotes('');
    } catch (error: any) {
      console.error('Failed to dismiss follow-up:', error);
      toast.error('Failed to dismiss follow-up');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmHomeless = async (record: VehicleRecord) => {
    setIsProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update canonical_vehicles
      const { error: canonicalError } = await supabase
        .from('canonical_vehicles')
        .update({
          homeless_status: 'confirmed',
          homeless_confirmed_at: new Date().toISOString(),
          homeless_confirmed_by: user.id,
          homeless_notes: confirmationNotes || null,
        })
        .eq('plate_number', record.plate_number);

      if (canonicalError) throw canonicalError;

      toast.success('Homeless status confirmed - vehicle now FC Act exempt');
      loadFollowUps();
      setIsReviewModalOpen(false);
      setConfirmationNotes('');
    } catch (error: any) {
      console.error('Failed to confirm homeless status:', error);
      toast.error('Failed to confirm homeless status');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismissHomelessClaim = async (recordId: string) => {
    setIsProcessing(true);
    try {
      if (!selectedRecord) throw new Error('No record selected');
      
      // Update canonical_vehicles to remove homeless claim
      const { error } = await supabase
        .from('canonical_vehicles')
        .update({
          homeless_status: 'none',
        })
        .eq('plate_number', selectedRecord.plate_number);

      if (error) throw error;

      toast.success('Homeless claim dismissed');
      loadFollowUps();
      setIsReviewModalOpen(false);
    } catch (error: any) {
      console.error('Failed to dismiss claim:', error);
      toast.error('Failed to dismiss claim');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          Urgent Follow-Ups
        </h2>
        <p className="text-muted-foreground">Items requiring immediate attention</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer" onClick={() => setActiveTab('observations')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Observations</p>
                <p className="text-3xl font-bold">{observations.length}</p>
              </div>
              <FileText className="h-12 w-12 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => setActiveTab('incidents')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Incident Reports</p>
                <p className="text-3xl font-bold">{incidentRecords.length}</p>
              </div>
              <Camera className="h-12 w-12 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer" onClick={() => setActiveTab('homeless')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Homeless Claims</p>
                <p className="text-3xl font-bold">{homelessRecords.length}</p>
              </div>
              <Home className="h-12 w-12 text-muted-foreground opacity-20" />
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800" onClick={() => setActiveTab('bug-reports')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-700 dark:text-red-300 mb-1 font-semibold">Bug Reports</p>
                <p className="text-3xl font-bold text-red-600">{bugReports.length}</p>
              </div>
              <Bug className="h-12 w-12 text-red-500 opacity-30" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="observations">
            Observations {observations.length > 0 && <Badge className="ml-2">{observations.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="incidents">
            Incidents {incidentRecords.length > 0 && <Badge className="ml-2">{incidentRecords.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="homeless">
            Homeless {homelessRecords.length > 0 && <Badge className="ml-2">{homelessRecords.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="bug-reports" className="text-red-600">
            Bug Reports {bugReports.length > 0 && <Badge variant="destructive" className="ml-2">{bugReports.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="observations" className="space-y-4">
          {observations.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No urgent follow-ups</p>
              </CardContent>
            </Card>
          ) : (
            observations.map(obs => (
              <Card key={obs.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-mono font-bold text-xl mb-2">{obs.plate_number}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {(obs.zone as any)?.name || 'Unknown Zone'}
                        </span>
                      </div>
                      <p className="text-sm text-red-600 mb-3 font-medium">
                        <AlertTriangle className="h-4 w-4 inline mr-1" />
                        LOCATION VIOLATION: {obs.followup_reason}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge variant={obs.followup_priority === 'high' ? 'destructive' : 'secondary'}>
                          {obs.followup_priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(obs.recorded_at).toLocaleDateString('en-NZ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => handleReview(obs)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setSelectedRecord(obs);
                          setIsReviewModalOpen(true);
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Resolve
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="incidents" className="space-y-4">
          {incidentRecords.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No incident reports requiring review</p>
              </CardContent>
            </Card>
          ) : (
            incidentRecords.map(incident => (
              <Card key={incident.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      {/* Vehicle Photo */}
                      {incident.photos && incident.photos.length > 0 && (
                        <div className="mb-3 rounded-lg overflow-hidden border-2 border-primary/20">
                          <img 
                            src={incident.photos[0]} 
                            alt={`Incident ${incident.plate_number || 'evidence'}`}
                            className="w-full h-48 object-cover"
                          />
                        </div>
                      )}
                      
                      {incident.plate_number && (
                        <p className="font-mono font-bold text-xl mb-2">{incident.plate_number}</p>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {incident.zone?.name || 'Unknown Zone'}
                        </span>
                      </div>
                      <p className="text-sm text-red-600 mb-2 font-medium">
                        <AlertTriangle className="h-4 w-4 inline mr-1" />
                        {incident.incident_type}
                      </p>
                      <p className="text-sm text-muted-foreground mb-3">
                        {incident.description}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge variant={incident.severity === 'high' ? 'destructive' : 'secondary'}>
                          {incident.severity} severity
                        </Badge>
                        <Badge variant="outline">
                          {incident.status}
                        </Badge>
                        {incident.user_profiles && (
                          <span className="text-xs text-muted-foreground">
                            By {incident.user_profiles.first_name} {incident.user_profiles.last_name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(incident.recorded_at).toLocaleDateString('en-NZ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => {
                          if (onTabChange) {
                            onTabChange('incident-reports');
                          } else {
                            toast.info('Navigate to Incident Reports tab to view this incident');
                          }
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="homeless" className="space-y-4">
          {homelessRecords.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No homeless claims pending review</p>
              </CardContent>
            </Card>
          ) : (
            homelessRecords.map(rec => (
              <Card key={rec.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-mono font-bold text-xl mb-2">{rec.plate_number}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {(rec.zone as any)?.name || 'Unknown Zone'}
                        </span>
                      </div>
                      <Badge className="bg-cyan-500 mb-3">
                        <Home className="h-3 w-3 mr-1" />
                        Claimed Homeless
                      </Badge>
                      {rec.notes && (
                        <p className="text-sm text-muted-foreground mt-2 p-2 bg-muted rounded">
                          {rec.notes}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm"
                        onClick={() => {
                          setSelectedRecord(rec);
                          setIsReviewModalOpen(true);
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Confirm
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleDismissHomelessClaim(rec.id)}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="bug-reports" className="space-y-4">
          {bugReports.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No bug reports pending review</p>
              </CardContent>
            </Card>
          ) : (
            bugReports.map(report => (
              <Card key={report.id} className="border-red-200 dark:border-red-800">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Bug className="h-5 w-5 text-red-600" />
                        <h3 className="font-bold text-lg">{report.title}</h3>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-3">
                        {report.description}
                      </p>
                      
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300">
                          {report.issue_type.replace('_', ' ')}
                        </Badge>
                        <Badge variant={report.severity === 'critical' ? 'destructive' : report.severity === 'high' ? 'default' : 'secondary'}>
                          {report.severity} severity
                        </Badge>
                        <Badge variant="outline">
                          {report.status}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">Reported by:</span>
                          <span>{report.user_profiles.first_name} {report.user_profiles.last_name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">Page:</span>
                          <span>{report.current_page}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">Version:</span>
                          <span>{report.app_version}</span>
                        </div>
                        <div className="ml-auto">
                          {new Date(report.created_at).toLocaleString('en-NZ')}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => {
                          if (onTabChange) {
                            onTabChange('bug-reports');
                          } else {
                            toast.info('Navigate to Bug Reports to view full details');
                          }
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Review Modal for Resolving Follow-ups */}
      <Dialog open={isReviewModalOpen && activeTab === 'observations'} onOpenChange={(open) => {
        setIsReviewModalOpen(open);
        if (!open) setResolutionNotes('');
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              Resolve Follow-up
            </DialogTitle>
            <DialogDescription>
              Choose how to handle this location violation
            </DialogDescription>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-6 py-4">
              {/* Vehicle Photo */}
              {selectedRecord.evidence_photos && Array.isArray(selectedRecord.evidence_photos) && selectedRecord.evidence_photos.length > 0 && (
                <div className="relative rounded-xl overflow-hidden border-2 border-primary/20">
                  <img 
                    src={selectedRecord.evidence_photos[0]} 
                    alt={`Vehicle ${selectedRecord.plate_number}`}
                    className="w-full h-64 object-cover"
                  />
                  <div className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {selectedRecord.evidence_photos.length} photo{selectedRecord.evidence_photos.length !== 1 ? 's' : ''}
                  </div>
                </div>
              )}

              {/* Violation Summary */}
              <Card className="border-2 border-red-200 dark:border-red-800">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-bold text-lg mb-1">{selectedRecord.plate_number}</p>
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {(selectedRecord.zone as any)?.name}
                        </span>
                      </div>
                      <div className="text-sm text-red-700 dark:text-red-300 font-semibold p-2 bg-red-50 dark:bg-red-950/30 rounded">
                        🚨 LOCATION VIOLATION: {selectedRecord.followup_reason}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Resolution Notes */}
              <div className="space-y-2">
                <Label htmlFor="resolution-notes" className="text-sm font-semibold">
                  Resolution Notes (Optional)
                </Label>
                <Textarea
                  id="resolution-notes"
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Add any additional context or notes about this decision..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-muted-foreground mb-2">
                  Choose Action:
                </div>
                
                {/* Send to Enforcement */}
                <Card className="border-2 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                      onClick={() => !isProcessing && handleSendToEnforcement(selectedRecord)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center flex-shrink-0">
                        <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-red-700 dark:text-red-300 mb-1">
                          Send to Enforcement
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Creates a warning notice and assigns to enforcement team for immediate action
                        </p>
                      </div>
                      {isProcessing ? (
                        <Loader2 className="h-5 w-5 animate-spin text-red-600" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Dismiss (No Action) */}
                <Card className="border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900/20 transition-colors cursor-pointer"
                      onClick={() => !isProcessing && handleDismiss(selectedRecord.id)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <XCircle className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          Dismiss (No Action Required)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Mark as resolved without enforcement - false alarm or resolved situation
                        </p>
                      </div>
                      {isProcessing ? (
                        <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-gray-600" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Cancel Button */}
              <div className="flex justify-end pt-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setIsReviewModalOpen(false);
                    setResolutionNotes('');
                  }}
                  disabled={isProcessing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Homeless Confirmation Modal */}
      <Dialog open={isReviewModalOpen && activeTab === 'homeless'} onOpenChange={setIsReviewModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Homeless Status</DialogTitle>
            <DialogDescription>
              Confirm that this vehicle is homeless and exempt from overstay enforcement
            </DialogDescription>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-4 py-4">
              {/* Vehicle Photo */}
              {selectedRecord.evidence_photos && Array.isArray(selectedRecord.evidence_photos) && selectedRecord.evidence_photos.length > 0 && (
                <div className="relative rounded-xl overflow-hidden border-2 border-cyan-300">
                  <img 
                    src={selectedRecord.evidence_photos[0]} 
                    alt={`Vehicle ${selectedRecord.plate_number}`}
                    className="w-full h-48 object-cover"
                  />
                  <div className="absolute top-2 right-2 bg-cyan-600 text-white px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <Home className="h-3 w-3" />
                    Homeless Claim
                  </div>
                </div>
              )}

              <div className="p-3 bg-cyan-50 dark:bg-cyan-950/30 rounded border border-cyan-200 dark:border-cyan-800">
                <p className="font-mono font-bold mb-1">{selectedRecord.plate_number}</p>
                <p className="text-sm text-muted-foreground">{(selectedRecord.zone as any)?.name}</p>
              </div>
              
              <div className="space-y-2">
                <Label>Confirmation Notes (Optional)</Label>
                <Textarea
                  value={confirmationNotes}
                  onChange={(e) => setConfirmationNotes(e.target.value)}
                  placeholder="Add any notes about the confirmation..."
                  rows={3}
                />
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  ⚠️ Confirming homeless status will exempt this vehicle from overstay enforcement and mark them as protected under the Freedom Camping Act.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsReviewModalOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => handleConfirmHomeless(selectedRecord)}
                  disabled={isProcessing}
                  className="bg-cyan-600 hover:bg-cyan-700"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Confirm Homeless
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Vehicle Details Dialog */}
      <Dialog open={isVehicleDetailsOpen} onOpenChange={setIsVehicleDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-3">
              <Car className="h-6 w-6 text-primary" />
              {vehicleDetails?.plate_number}
            </DialogTitle>
            <DialogDescription>
              Vehicle Review & History
            </DialogDescription>
          </DialogHeader>
          
          {loadingVehicleDetails ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : vehicleDetails ? (
            <div className="space-y-6">
              {/* Vehicle Photo Gallery */}
              {(vehicleDetails.photos?.length > 0 || vehicleDetails.recordPhotos?.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Vehicle Photos
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // TODO: Open full photo editor/viewer
                        toast.info('Photo editor coming soon');
                      }}
                    >
                      <Edit3 className="h-3 w-3 mr-1" />
                      Edit Details
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {/* From photo_metadata */}
                    {vehicleDetails.photos?.slice(0, 3).map((photo: any) => (
                      <div key={photo.id} className="relative aspect-[4/3] rounded-lg overflow-hidden border-2 border-primary/20 group cursor-pointer">
                        <img 
                          src={photo.photo_url} 
                          alt="Vehicle"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                          <p className="text-xs text-white font-semibold">
                            {new Date(photo.captured_at).toLocaleDateString('en-NZ')}
                          </p>
                        </div>
                      </div>
                    ))}
                    {/* From evidence_photos (legacy) */}
                    {vehicleDetails.recordPhotos?.slice(0, 3 - (vehicleDetails.photos?.length || 0)).map((url: string, idx: number) => (
                      <div key={`record-${idx}`} className="relative aspect-[4/3] rounded-lg overflow-hidden border-2 border-muted group cursor-pointer">
                        <img 
                          src={url} 
                          alt="Vehicle"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                      </div>
                    ))}
                  </div>
                  {(vehicleDetails.photos?.length + (vehicleDetails.recordPhotos?.length || 0)) > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => toast.info('Photo gallery coming soon')}
                    >
                      View all {vehicleDetails.photos?.length + (vehicleDetails.recordPhotos?.length || 0)} photos
                    </Button>
                  )}
                </div>
              )}

              {/* Vehicle Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground mb-1">Make/Model</div>
                    <div className="font-semibold">
                      {vehicleDetails.canonical?.vehicle_make || vehicleDetails.vehicle_make || 'Unknown'}{' '}
                      {vehicleDetails.canonical?.vehicle_model || vehicleDetails.vehicle_model || ''}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground mb-1">Color</div>
                    <div className="font-semibold">
                      {vehicleDetails.canonical?.vehicle_color || vehicleDetails.vehicle_color || 'Unknown'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground mb-1">Zone</div>
                    <div className="font-semibold">{(vehicleDetails.zone as any)?.name || 'Unknown'}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Flags & Status */}
              {(vehicleDetails.canonical?.is_flagged || vehicleDetails.canonical?.homeless_status || vehicleDetails.requires_followup) && (
                <div className="flex flex-wrap gap-2">
                  {vehicleDetails.canonical?.is_flagged && (
                    <Badge variant="destructive" className="gap-1">
                      <Flag className="h-3 w-3" />
                      Flagged: {vehicleDetails.canonical.flagged_reason}
                    </Badge>
                  )}
                  {vehicleDetails.canonical?.homeless_status === 'confirmed' && (
                    <Badge variant="outline" className="gap-1 bg-cyan-100 text-cyan-800">
                      <Home className="h-3 w-3" />
                      Homeless (Confirmed)
                    </Badge>
                  )}
                  {vehicleDetails.canonical?.homeless_status === 'claimed' && (
                    <Badge variant="outline" className="gap-1 bg-cyan-50 text-cyan-700">
                      <Home className="h-3 w-3" />
                      Claiming Homeless
                    </Badge>
                  )}
                  {vehicleDetails.requires_followup && (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Follow-up Required
                    </Badge>
                  )}
                </div>
              )}

              {/* Follow-up Details */}
              {vehicleDetails.followup_reason && (
                <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                  <CardContent className="p-4">
                    <div className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
                      Follow-up Required:
                    </div>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {vehicleDetails.followup_reason}
                    </p>
                    {vehicleDetails.notes && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        Notes: {vehicleDetails.notes}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Recent Observations */}
              {vehicleDetails.observations && vehicleDetails.observations.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Recent Observations ({vehicleDetails.observations.length})
                  </h3>
                  <div className="space-y-2">
                    {vehicleDetails.observations.map((obs: any) => (
                      <Card key={obs.observation_id}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={obs.is_breach ? 'destructive' : obs.is_compliant ? 'outline' : 'default'}>
                                  {obs.is_breach ? 'Breach' : obs.is_compliant ? 'Compliant' : 'Non-Compliant'}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(obs.recorded_at).toLocaleDateString('en-NZ')}
                                </span>
                              </div>
                              <div className="text-sm">
                                <span className="text-muted-foreground">Zone:</span> {obs.zones?.name || 'Unknown'}
                              </div>
                              <div className="text-sm">
                                <span className="text-muted-foreground">Officer:</span>{' '}
                                {obs.user_profiles ? `${obs.user_profiles.first_name} ${obs.user_profiles.last_name}` : 'Unknown'}
                              </div>
                              {obs.officer_notes && (
                                <div className="text-xs mt-2 p-2 bg-muted/50 rounded">
                                  {obs.officer_notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
