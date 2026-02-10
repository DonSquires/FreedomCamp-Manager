/**
 * UrgentFollowUps - Admin action centre for items requiring urgent follow-up
 * Displays observations, incidents, and homeless confirmations needing admin attention
 * with full amendment capability and audit trail tracking
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  FileText,
  Home,
  Loader2,
  Eye,
  Edit,
  Save,
  X,
  Clock,
  User,
  MapPin,
  Calendar,
  CheckCircle2,
  Shield,
  Send,
  Search,
  Plus,
  Car,
  Users,
  Navigation,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { pushNotificationManager } from '@/lib/pushNotifications';
import { reverseGeocode } from '@/lib/geocoding';

interface VehicleRecord {
  id: string;
  plate_number: string;
  zone: { name: string };
  zone_id: string;
  recorded_at: string;
  recorded_by_user: { first_name: string; last_name: string; email: string };
  requires_followup: boolean;
  followup_reason: string;
  followup_priority: string;
  followup_resolution_notes: string | null;
  followup_resolved: boolean;
  homeless_claimed: boolean;
  homeless_confirmed: boolean;
  notes: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  location_lat?: number;
  location_lng?: number;
  vehicle_id?: string;
}

interface Incident {
  id: string;
  incident_type: string;
  description: string;
  severity: string;
  status: string;
  court_ready: boolean;
  happened_at: string;
  zone: { name: string };
  zone_id: string;
  vehicle: { plate_number: string } | null;
  user: { first_name: string; last_name: string; email: string };
  homeless_status: string | null;
  hs_issues: boolean;
  photos?: string[];
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy?: number;
  evidence_notes?: string;
  approved_by?: string;
  approved_at?: string;
  resolution_notes?: string;
  vehicle_id?: string;
}

interface AmendmentRecord {
  field_name: string;
  original_value: any;
  new_value: any;
  changed_at: string;
  changed_by: string;
  reason: string;
}

export function UrgentFollowUps() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'observations' | 'incidents' | 'homeless'>('incidents');
  const [isLoading, setIsLoading] = useState(true);

  // Data states
  const [observations, setObservations] = useState<VehicleRecord[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [homelessRecords, setHomelessRecords] = useState<VehicleRecord[]>([]);

  // Modal states
  const [selectedObservation, setSelectedObservation] = useState<VehicleRecord | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [showObservationModal, setShowObservationModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showInvestigationModal, setShowInvestigationModal] = useState(false);
  const [investigationSource, setInvestigationSource] = useState<'observation' | 'incident' | 'homeless' | null>(null);

  // Amendment states
  const [isAmending, setIsAmending] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [editedData, setEditedData] = useState<any>({});
  const [originalData, setOriginalData] = useState<any>({});

  // Investigation job state
  const [investigationJob, setInvestigationJob] = useState({
    reference_number: '',
    job_type: 'Homeless Occupation',
    location_address: '',
    property_details: '',
    gps_latitude: '',
    gps_longitude: '',
    briefing_notes: '',
    instructions: '',
    client_name: '',
    client_reference: '',
    priority: 'high',
    due_date: '',
    assigned_to: '',
    followup_days: '1',
  });
  const [isCreatingInvestigation, setIsCreatingInvestigation] = useState(false);
  const [availableOfficers, setAvailableOfficers] = useState<any[]>([]);
  const [availableJobTypes, setAvailableJobTypes] = useState<any[]>([]);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [showCreateJobType, setShowCreateJobType] = useState(false);
  const [newJobTypeName, setNewJobTypeName] = useState('');
  const [newJobTypeDescription, setNewJobTypeDescription] = useState('');

  // Association states
  const [associatedVehicleId, setAssociatedVehicleId] = useState<string | null>(null);
  const [associatedPersonId, setAssociatedPersonId] = useState<string | null>(null);
  const [associatedZoneId, setAssociatedZoneId] = useState<string | null>(null);
  const [associatedObservationId, setAssociatedObservationId] = useState<string | null>(null);

  // Load available officers and job types
  useEffect(() => {
    const loadOfficers = async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email')
        .in('role', ['officer', 'admin'])
        .eq('is_active', true)
        .order('first_name');

      if (!error && data) {
        setAvailableOfficers(data);
      }
    };

    const loadJobTypes = async () => {
      const { data, error } = await supabase
        .from('investigation_job_types')
        .select('*')
        .eq('is_active', true)
        .or(`is_system_default.eq.true,organization_id.eq.${user?.organization_id}`)
        .order('is_system_default', { ascending: false })
        .order('name');

      if (!error && data) {
        setAvailableJobTypes(data);
      }
    };

    loadOfficers();
    loadJobTypes();
  }, [user?.organization_id]);

  // Load urgent follow-ups
  useEffect(() => {
    loadFollowUps();

    // Real-time subscription
    const channel = supabase
      .channel('urgent_followups')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_records',
          filter: 'requires_followup=eq.true',
        },
        () => {
          console.log('🔄 Vehicle record updated - reloading');
          loadFollowUps();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
          filter: 'status=eq.open',
        },
        () => {
          console.log('🔄 Incident updated - reloading');
          loadFollowUps();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadFollowUps = async () => {
    setIsLoading(true);
    try {
      // Load observations requiring follow-up
      const { data: obsData, error: obsError } = await supabase
        .from('vehicle_records')
        .select(`
          *,
          zone:zones(id, name),
          recorded_by_user:user_profiles!vehicle_records_recorded_by_fkey(first_name, last_name, email)
        `)
        .eq('requires_followup', true)
        .eq('followup_resolved', false)
        .order('recorded_at', { ascending: false });

      if (obsError) throw obsError;
      setObservations(obsData || []);

      // Load incidents needing approval (court_ready=false)
      const { data: incData, error: incError } = await supabase
        .from('incidents')
        .select(`
          *,
          zone:zones(id, name),
          vehicle:canonical_vehicles(plate_number),
          user:user_profiles!incidents_user_id_fkey(first_name, last_name, email)
        `)
        .eq('court_ready', false)
        .neq('status', 'closed')
        .order('happened_at', { ascending: false });

      if (incError) throw incError;
      setIncidents(incData || []);

      // Load homeless claims needing confirmation
      const { data: homelessData, error: homelessError } = await supabase
        .from('vehicle_records')
        .select(`
          *,
          zone:zones(id, name),
          recorded_by_user:user_profiles!vehicle_records_recorded_by_fkey(first_name, last_name, email)
        `)
        .eq('homeless_claimed', true)
        .eq('homeless_confirmed', false)
        .order('recorded_at', { ascending: false });

      if (homelessError) throw homelessError;
      setHomelessRecords(homelessData || []);

      console.log('✅ Loaded follow-ups:', {
        observations: obsData?.length || 0,
        incidents: incData?.length || 0,
        homeless: homelessData?.length || 0,
      });
    } catch (error: any) {
      console.error('Failed to load follow-ups:', error);
      toast.error('Failed to load urgent follow-ups');
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewObservation = (record: VehicleRecord) => {
    setSelectedObservation(record);
    setOriginalData({
      followup_reason: record.followup_reason,
      followup_priority: record.followup_priority,
      notes: record.notes,
      followup_resolution_notes: record.followup_resolution_notes,
    });
    setEditedData({
      followup_reason: record.followup_reason,
      followup_priority: record.followup_priority,
      notes: record.notes,
      followup_resolution_notes: record.followup_resolution_notes || '',
    });
    setShowObservationModal(true);
  };

  const handleViewIncident = (incident: Incident) => {
    console.log('🔍 Opening incident modal:', incident);
    setSelectedIncident(incident);
    setOriginalData({
      description: incident.description,
      severity: incident.severity,
      status: incident.status,
    });
    setEditedData({
      description: incident.description,
      severity: incident.severity,
      status: incident.status,
    });
    setShowIncidentModal(true);
    console.log('✅ Modal state set - showIncidentModal:', true);
  };

  const handleSaveAmendment = async (type: 'observation' | 'incident') => {
    if (!amendmentReason.trim()) {
      toast.error('Amendment reason is required');
      return;
    }

    setIsAmending(true);
    try {
      const amendments: AmendmentRecord[] = [];
      const changedFields: string[] = [];

      // Detect changes
      Object.keys(editedData).forEach(key => {
        if (editedData[key] !== originalData[key]) {
          amendments.push({
            field_name: key,
            original_value: originalData[key],
            new_value: editedData[key],
            changed_at: new Date().toISOString(),
            changed_by: user?.email || 'unknown',
            reason: amendmentReason,
          });
          changedFields.push(key);
        }
      });

      if (amendments.length === 0) {
        toast.warning('No changes detected');
        setIsAmending(false);
        return;
      }

      if (type === 'observation' && selectedObservation) {
        // Update vehicle record
        const { error: updateError } = await supabase
          .from('vehicle_records')
          .update({
            ...editedData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedObservation.id);

        if (updateError) throw updateError;

        // Log amendment to audit_log
        const { error: auditError } = await supabase
          .from('audit_log')
          .insert({
            organization_id: user?.organization_id,
            user_id: user?.id,
            action: 'admin_amendment',
            entity_type: 'vehicle_record',
            entity_id: selectedObservation.id,
            old_values: originalData,
            new_values: editedData,
            ip_address: null,
            user_agent: navigator.userAgent,
          });

        if (auditError) {
          console.warn('Failed to log audit trail:', auditError);
        }

        toast.success(`✅ Observation amended - ${changedFields.length} field(s) updated`);
        setShowObservationModal(false);
        loadFollowUps();
      } else if (type === 'incident' && selectedIncident) {
        // Update incident
        const { error: updateError } = await supabase
          .from('incidents')
          .update({
            ...editedData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedIncident.id);

        if (updateError) throw updateError;

        // Log amendment to audit_log
        const { error: auditError } = await supabase
          .from('audit_log')
          .insert({
            organization_id: user?.organization_id,
            user_id: user?.id,
            action: 'admin_amendment',
            entity_type: 'incident',
            entity_id: selectedIncident.id,
            old_values: originalData,
            new_values: editedData,
            ip_address: null,
            user_agent: navigator.userAgent,
          });

        if (auditError) {
          console.warn('Failed to log audit trail:', auditError);
        }

        toast.success(`✅ Incident amended - ${changedFields.length} field(s) updated`);
        setShowIncidentModal(false);
        loadFollowUps();
      }

      setAmendmentReason('');
    } catch (error: any) {
      console.error('Failed to save amendment:', error);
      toast.error('Failed to save amendment: ' + error.message);
    } finally {
      setIsAmending(false);
    }
  };

  const handleResolveObservation = async () => {
    if (!selectedObservation) return;

    try {
      const { error } = await supabase
        .from('vehicle_records')
        .update({
          followup_resolved: true,
          followup_resolved_by: user?.id,
          followup_resolved_at: new Date().toISOString(),
          followup_resolution_notes: editedData.followup_resolution_notes,
        })
        .eq('id', selectedObservation.id);

      if (error) throw error;

      toast.success('✅ Follow-up marked as resolved');
      setShowObservationModal(false);
      loadFollowUps();
    } catch (error: any) {
      console.error('Failed to resolve follow-up:', error);
      toast.error('Failed to resolve follow-up');
    }
  };

  const handleReverseGeocode = async () => {
    if (!investigationJob.gps_latitude || !investigationJob.gps_longitude) {
      toast.error('Please enter GPS coordinates first');
      return;
    }

    setIsLoadingAddress(true);
    try {
      const result = await reverseGeocode(
        parseFloat(investigationJob.gps_latitude),
        parseFloat(investigationJob.gps_longitude)
      );
      if (result) {
        setInvestigationJob(prev => ({
          ...prev,
          location_address: result.formattedAddress,
        }));
        toast.success('✅ Address found from GPS coordinates');
      } else {
        toast.warning('Could not find address for these coordinates');
      }
    } catch (error) {
      console.error('Geocoding failed:', error);
      toast.error('Failed to lookup address');
    } finally {
      setIsLoadingAddress(false);
    }
  };

  const handleCreateJobType = async () => {
    if (!newJobTypeName.trim()) {
      toast.error('Job type name is required');
      return;
    }

    try {
      const { error } = await supabase
        .from('investigation_job_types')
        .insert({
          organization_id: user?.organization_id,
          name: newJobTypeName,
          description: newJobTypeDescription || null,
          is_system_default: false,
          is_active: true,
          created_by: user?.id,
        });

      if (error) throw error;

      toast.success(`✅ Job type "${newJobTypeName}" created`);
      setShowCreateJobType(false);
      setNewJobTypeName('');
      setNewJobTypeDescription('');

      // Reload job types
      const { data } = await supabase
        .from('investigation_job_types')
        .select('*')
        .eq('is_active', true)
        .or(`is_system_default.eq.true,organization_id.eq.${user?.organization_id}`)
        .order('is_system_default', { ascending: false })
        .order('name');

      if (data) {
        setAvailableJobTypes(data);
        setInvestigationJob(prev => ({...prev, job_type: newJobTypeName }));
      }
    } catch (error: any) {
      console.error('Failed to create job type:', error);
      toast.error('Failed to create job type: ' + error.message);
    }
  };

  const handleSendToInvestigation = (type: 'observation' | 'incident' | 'homeless', item: any) => {
    setInvestigationSource(type);

    // Detect job type from source
    let detectedJobType = 'Other';
    if (type === 'observation') {
      if (item.homeless_claimed || item.homeless_confirmed) {
        detectedJobType = 'Homeless Occupation';
      } else {
        detectedJobType = 'Unauthorized Structure';
      }

      setInvestigationJob({
        reference_number: `OBS-${item.id.slice(0, 8)}`,
        job_type: detectedJobType,
        location_address: item.zone?.name || '',
        property_details: `Plate: ${item.plate_number}\nVehicle: ${item.vehicle_color || ''} ${item.vehicle_make || ''} ${item.vehicle_model || ''}`,
        gps_latitude: item.location_lat ? item.location_lat.toString() : '',
        gps_longitude: item.location_lng ? item.location_lng.toString() : '',
        briefing_notes: `Follow-up required: ${item.followup_reason || 'No reason specified'}\n\nOfficer Notes: ${item.notes || 'None'}`,
        instructions: 'Please visit the location, document current conditions with photos, and provide a detailed report on the situation.',
        followup_days: '1',
        client_name: '',
        client_reference: '',
        priority: item.followup_priority === 'urgent' ? 'urgent' : item.followup_priority === 'high' ? 'high' : 'medium',
        due_date: '',
        assigned_to: '',
      });

      setAssociatedVehicleId(item.vehicle_id || null);
      setAssociatedZoneId(item.zone?.id || null);
      setAssociatedObservationId(item.id || null);
      setAssociatedPersonId(null);
      setSelectedObservation(item);
    } else if (type === 'incident') {
      if (item.incident_type?.toLowerCase().includes('aggress')) {
        detectedJobType = 'Aggressive Behaviour';
      } else if (item.hs_issues) {
        detectedJobType = 'Health & Safety';
      } else if (item.homeless_status) {
        detectedJobType = 'Homeless Occupation';
      } else {
        detectedJobType = 'Other';
      }

      setInvestigationJob({
        reference_number: `INC-${item.id.slice(0, 8)}`,
        job_type: detectedJobType,
        location_address: item.zone?.name || '',
        property_details: item.vehicle ? `Plate: ${item.vehicle.plate_number}` : 'No vehicle associated',
        gps_latitude: item.gps_latitude ? item.gps_latitude.toString() : '',
        gps_longitude: item.gps_longitude ? item.gps_longitude.toString() : '',
        briefing_notes: `Incident Type: ${item.incident_type}\nSeverity: ${item.severity}\n\nDescription:\n${item.description}\n\nEvidence Notes: ${item.evidence_notes || 'None'}`,
        instructions: `Follow up on incident reported on ${new Date(item.happened_at).toLocaleDateString('en-NZ')}. Review attached evidence photos and conduct site visit to assess current situation.`,
        followup_days: item.severity === 'critical' || item.severity === 'high' ? '1' : '3',
        client_name: '',
        client_reference: '',
        priority: item.severity === 'critical' || item.severity === 'high' ? 'urgent' : 'high',
        due_date: '',
        assigned_to: '',
      });

      setAssociatedVehicleId(item.vehicle_id || null);
      setAssociatedZoneId(item.zone?.id || null);
      setAssociatedObservationId(null);
      setAssociatedPersonId(null);
      setSelectedIncident(item);
    } else if (type === 'homeless') {
      detectedJobType = 'Homeless Occupation';

      setInvestigationJob({
        reference_number: `HML-${item.id.slice(0, 8)}`,
        job_type: detectedJobType,
        location_address: item.zone?.name || '',
        property_details: `Plate: ${item.plate_number}\nVehicle: ${item.vehicle_color || ''} ${item.vehicle_make || ''} ${item.vehicle_model || ''}\n\nHomeless Status: Claimed but not confirmed`,
        gps_latitude: item.location_lat ? item.location_lat.toString() : '',
        gps_longitude: item.location_lng ? item.location_lng.toString() : '',
        briefing_notes: `Vehicle occupant has claimed homeless status but requires confirmation.\n\nOfficer Notes: ${item.notes || 'None'}`,
        instructions: 'Please verify homeless status claim, interview occupant(s), document living conditions with photos, and complete homeless confirmation assessment.',
        followup_days: '1',
        client_name: '',
        client_reference: '',
        priority: 'high',
        due_date: '',
        assigned_to: '',
      });

      setAssociatedVehicleId(item.vehicle_id || null);
      setAssociatedZoneId(item.zone?.id || null);
      setAssociatedObservationId(null);
      setAssociatedPersonId(null);
      setSelectedObservation(item);
    }

    setShowInvestigationModal(true);
  };

  const handleCreateInvestigation = async () => {
    if (!investigationJob.reference_number || !investigationJob.location_address) {
      toast.error('Reference number and location are required');
      return;
    }

    setIsCreatingInvestigation(true);
    try {
      // Create investigation job
      const { data, error } = await supabase
        .from('investigation_jobs')
        .insert({
          organization_id: user?.organization_id,
          reference_number: investigationJob.reference_number,
          job_type: investigationJob.job_type,
          location_address: investigationJob.location_address,
          property_details: investigationJob.property_details || null,
          gps_latitude: investigationJob.gps_latitude ? parseFloat(investigationJob.gps_latitude) : null,
          gps_longitude: investigationJob.gps_longitude ? parseFloat(investigationJob.gps_longitude) : null,
          briefing_notes: investigationJob.briefing_notes || null,
          instructions: investigationJob.instructions || null,
          client_name: investigationJob.client_name || null,
          client_reference: investigationJob.client_reference || null,
          priority: investigationJob.priority,
          due_date: investigationJob.due_date || null,
          assigned_to: investigationJob.assigned_to || null,
          assigned_at: investigationJob.assigned_to ? new Date().toISOString() : null,
          assigned_by: investigationJob.assigned_to ? user?.id : null,
          status: investigationJob.assigned_to ? 'assigned' : 'pending',
          created_by: user?.id,
          associated_vehicle_id: associatedVehicleId,
          associated_person_id: associatedPersonId,
          associated_zone_id: associatedZoneId,
          associated_observation_id: associatedObservationId,
          followup_days: parseInt(investigationJob.followup_days) || 1,
          followup_notes: `Report back every ${investigationJob.followup_days} day(s)`,
        })
        .select()
        .single();

      if (error) throw error;

      // Update source record to indicate it's out for investigation
      const followupSchedule = investigationJob.followup_days === '1' ? 'DAILY' : `EVERY ${investigationJob.followup_days} DAYS`;
      const investigationNote = `🔍 SENT FOR INVESTIGATION\n` +
        `Reference: ${investigationJob.reference_number}\n` +
        `Sent by: ${user?.first_name} ${user?.last_name}\n` +
        `Date: ${new Date().toLocaleString('en-NZ')}\n` +
        `⚠️ ${followupSchedule} FOLLOW-UPS REQUIRED until investigation completes\n\n`;

      if (investigationSource === 'observation' || investigationSource === 'homeless') {
        // Update vehicle record
        const currentNotes = selectedObservation?.followup_resolution_notes || '';
        const { error: updateError } = await supabase
          .from('vehicle_records')
          .update({
            followup_resolution_notes: investigationNote + currentNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedObservation?.id);

        if (updateError) {
          console.warn('Failed to update observation with investigation status:', updateError);
        }
      } else if (investigationSource === 'incident' && selectedIncident) {
        // Update incident
        const currentNotes = selectedIncident?.resolution_notes || '';
        const { error: updateError } = await supabase
          .from('incidents')
          .update({
            resolution_notes: investigationNote + currentNotes,
            status: 'open',
            updated_at: new Date().toISOString(),
          })
          .eq('id', selectedIncident.id);

        if (updateError) {
          console.warn('Failed to update incident with investigation status:', updateError);
        }
      }

      // Log to audit trail
      await supabase.from('audit_log').insert({
        organization_id: user?.organization_id,
        user_id: user?.id,
        action: 'sent_for_investigation',
        entity_type: investigationSource === 'incident' ? 'incident' : 'vehicle_record',
        entity_id: investigationSource === 'incident' ? selectedIncident?.id : selectedObservation?.id,
        old_values: {},
        new_values: {
          investigation_reference: investigationJob.reference_number,
          followup_days: parseInt(investigationJob.followup_days),
        },
        ip_address: null,
        user_agent: navigator.userAgent,
      });

      // Send push notification to assigned officer if assigned
      if (investigationJob.assigned_to) {
        await pushNotificationManager.notifyJobAssignment({
          id: data.id,
          reference_number: data.reference_number,
          job_type: data.job_type,
          location_address: data.location_address,
          priority: data.priority,
          due_date: data.due_date || undefined,
        });
      }

      const schedule = investigationJob.followup_days === '1' ? 'Daily' : `Every ${investigationJob.followup_days} days`;
      toast.success(`✅ Investigation job ${investigationJob.reference_number} created - ${schedule} follow-ups required${investigationJob.assigned_to ? ' - Officer notified' : ''}`);
      setShowInvestigationModal(false);
      
      // Reset state
      setInvestigationSource(null);
      setSelectedObservation(null);
      setSelectedIncident(null);
      setAssociatedVehicleId(null);
      setAssociatedPersonId(null);
      setAssociatedZoneId(null);
      setAssociatedObservationId(null);
      
      // Reload follow-ups to reflect changes
      loadFollowUps();
    } catch (error: any) {
      console.error('Failed to create investigation job:', error);
      toast.error('Failed to create investigation job: ' + error.message);
    } finally {
      setIsCreatingInvestigation(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const totalUrgent = observations.length + incidents.length + homelessRecords.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          Urgent Follow-Ups
        </h2>
        <p className="text-muted-foreground">
          Items requiring immediate admin attention and action
        </p>
      </div>

      {/* Summary Cards - Priority Order: Incidents (1), Observations (2), Homeless (3) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow border-2 border-red-500/50 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20 shadow-red-200/50"
          onClick={() => setActiveTab('incidents')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="destructive" className="text-xs font-bold">PRIORITY 1</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-1">Incidents</p>
                <p className="text-3xl font-bold text-red-700">{incidents.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Pending Review</p>
              </div>
              <AlertTriangle className="h-12 w-12 text-red-600 opacity-30" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow border-2 border-amber-500/50 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20 shadow-amber-200/50"
          onClick={() => setActiveTab('observations')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs font-bold border-amber-600 text-amber-700">PRIORITY 2</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-1">Observations</p>
                <p className="text-3xl font-bold text-amber-700">{observations.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Requiring Follow-Up</p>
              </div>
              <FileText className="h-12 w-12 text-amber-600 opacity-30" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="cursor-pointer hover:shadow-md transition-shadow border-2 border-blue-500/50 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20 shadow-blue-200/50"
          onClick={() => setActiveTab('homeless')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs font-bold border-blue-600 text-blue-700">PRIORITY 3</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-1">Homeless</p>
                <p className="text-3xl font-bold text-blue-700">{homelessRecords.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Pending Confirmation</p>
              </div>
              <Home className="h-12 w-12 text-blue-600 opacity-30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed Lists - Priority Order: Incidents, Observations, Homeless */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="incidents" className="relative border-l-4 border-red-500 data-[state=active]:bg-red-50 dark:data-[state=active]:bg-red-950/20">
            <Badge variant="outline" className="mr-2 h-5 text-[10px] bg-red-500 text-white border-red-600">P1</Badge>
            Incidents
            {incidents.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 min-w-[20px] px-1">
                {incidents.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="observations" className="relative border-l-4 border-amber-500 data-[state=active]:bg-amber-50 dark:data-[state=active]:bg-amber-950/20">
            <Badge variant="outline" className="mr-2 h-5 text-[10px] bg-amber-500 text-white border-amber-600">P2</Badge>
            Observations
            {observations.length > 0 && (
              <Badge className="ml-2 h-5 min-w-[20px] px-1 bg-amber-600">
                {observations.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="homeless" className="relative border-l-4 border-blue-500 data-[state=active]:bg-blue-50 dark:data-[state=active]:bg-blue-950/20">
            <Badge variant="outline" className="mr-2 h-5 text-[10px] bg-blue-500 text-white border-blue-600">P3</Badge>
            Homeless
            {homelessRecords.length > 0 && (
              <Badge className="ml-2 h-5 min-w-[20px] px-1 bg-blue-600">
                {homelessRecords.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Incidents Tab - Priority 1 */}
        <TabsContent value="incidents" className="space-y-4">
          {incidents.length === 0 ? (
            <Card>
              <CardContent className="text-center py-16">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-20" />
                <p className="text-lg font-semibold">No Pending Incidents</p>
                <p className="text-sm text-muted-foreground mt-2">All incidents have been reviewed</p>
              </CardContent>
            </Card>
          ) : (
            incidents.map(inc => (
              <Card key={inc.id} className="hover:shadow-md transition-shadow border-l-4 border-red-500">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-3">
                        <Badge variant="outline">{inc.incident_type}</Badge>
                        <Badge variant={inc.severity === 'high' || inc.severity === 'critical' ? 'destructive' : 'secondary'}>
                          {inc.severity}
                        </Badge>
                        {inc.hs_issues && (
                          <Badge variant="destructive">H&S Issue</Badge>
                        )}
                      </div>

                      <p className="text-sm mb-3 line-clamp-2">{inc.description}</p>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {inc.zone.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {new Date(inc.happened_at).toLocaleDateString('en-NZ')}
                        </div>
                        {inc.vehicle && (
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            {inc.vehicle.plate_number}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={() => handleViewIncident(inc)} size="sm" variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                      <Button 
                        onClick={() => handleSendToInvestigation('incident', inc)} 
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Investigate
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Observations Tab - Priority 2 */}
        <TabsContent value="observations" className="space-y-4">
          {observations.length === 0 ? (
            <Card>
              <CardContent className="text-center py-16">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-20" />
                <p className="text-lg font-semibold">No Pending Follow-Ups</p>
                <p className="text-sm text-muted-foreground mt-2">All observations have been resolved</p>
              </CardContent>
            </Card>
          ) : (
            observations.map(obs => (
              <Card key={obs.id} className="hover:shadow-md transition-shadow border-l-4 border-amber-500">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-3">
                        <p className="font-mono font-bold text-xl">{obs.plate_number}</p>
                        <Badge variant={obs.followup_priority === 'urgent' ? 'destructive' : 'secondary'}>
                          {obs.followup_priority}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-3">{obs.followup_reason}</p>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {obs.zone.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {new Date(obs.recorded_at).toLocaleDateString('en-NZ')}
                        </div>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          {obs.recorded_by_user.first_name} {obs.recorded_by_user.last_name}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={() => handleViewObservation(obs)} size="sm" variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        Review
                      </Button>
                      <Button 
                        onClick={() => handleSendToInvestigation('observation', obs)} 
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Investigate
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Homeless Tab - Priority 3 */}
        <TabsContent value="homeless" className="space-y-4">
          {homelessRecords.length === 0 ? (
            <Card>
              <CardContent className="text-center py-16">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-20" />
                <p className="text-lg font-semibold">No Pending Confirmations</p>
                <p className="text-sm text-muted-foreground mt-2">All homeless claims have been confirmed</p>
              </CardContent>
            </Card>
          ) : (
            homelessRecords.map(rec => (
              <Card key={rec.id} className="hover:shadow-md transition-shadow border-l-4 border-blue-500">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-3">
                        <p className="font-mono font-bold text-xl">{rec.plate_number}</p>
                        <Badge className="bg-blue-500">Claimed Homeless</Badge>
                      </div>

                      <p className="text-sm text-muted-foreground mb-3">
                        {rec.vehicle_color} {rec.vehicle_make} {rec.vehicle_model}
                      </p>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {rec.zone.name}
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {new Date(rec.recorded_at).toLocaleDateString('en-NZ')}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={() => handleViewObservation(rec)} size="sm" variant="outline">
                        <Eye className="h-4 w-4 mr-2" />
                        Confirm
                      </Button>
                      <Button 
                        onClick={() => handleSendToInvestigation('homeless', rec)} 
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Investigate
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Observation Detail Modal */}
      <Dialog open={showObservationModal} onOpenChange={setShowObservationModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Observation Follow-Up Details
            </DialogTitle>
            <DialogDescription>
              Review, amend, or resolve this observation
            </DialogDescription>
          </DialogHeader>

          {selectedObservation && (
            <div className="space-y-4">
              {/* Vehicle Info */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Vehicle</p>
                <p className="font-mono font-bold text-2xl">{selectedObservation.plate_number}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedObservation.vehicle_color} {selectedObservation.vehicle_make} {selectedObservation.vehicle_model}
                </p>
              </div>

              {/* Editable Fields */}
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-base font-semibold">Follow-Up Details</Label>
                  <Badge variant="outline">{selectedObservation.followup_priority}</Badge>
                </div>

                <div>
                  <Label>Follow-Up Reason</Label>
                  <Textarea
                    value={editedData.followup_reason || ''}
                    onChange={(e) => setEditedData({ ...editedData, followup_reason: e.target.value })}
                    className="mt-1"
                    rows={2}
                  />
                </div>

                <div>
                  <Label>Officer Notes</Label>
                  <Textarea
                    value={editedData.notes || ''}
                    onChange={(e) => setEditedData({ ...editedData, notes: e.target.value })}
                    className="mt-1"
                    rows={3}
                  />
                </div>

                <div>
                  <Label>Admin Resolution Notes</Label>
                  <Textarea
                    value={editedData.followup_resolution_notes || ''}
                    onChange={(e) => setEditedData({ ...editedData, followup_resolution_notes: e.target.value })}
                    placeholder="Add your resolution notes here..."
                    className="mt-1"
                    rows={3}
                  />
                </div>

                {/* Amendment Reason (shown when changes detected) */}
                {Object.keys(editedData).some(key => editedData[key] !== originalData[key]) && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-500/30 rounded-lg">
                    <Label className="text-amber-900 dark:text-amber-100">Amendment Reason *</Label>
                    <Input
                      value={amendmentReason}
                      onChange={(e) => setAmendmentReason(e.target.value)}
                      placeholder="Why are you making these changes?"
                      className="mt-1"
                    />
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                      ⚠️ All amendments are logged with original values for audit trail
                    </p>
                  </div>
                )}
              </div>

              {/* Original Data Reference */}
              <div className="p-3 bg-muted/50 rounded-lg text-xs">
                <p className="font-semibold mb-1">Recorded by:</p>
                <p>{selectedObservation.recorded_by_user.first_name} {selectedObservation.recorded_by_user.last_name}</p>
                <p className="text-muted-foreground">{selectedObservation.recorded_by_user.email}</p>
                <p className="mt-2 text-muted-foreground">
                  {new Date(selectedObservation.recorded_at).toLocaleString('en-NZ')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowObservationModal(false)}>
              Cancel
            </Button>
            {Object.keys(editedData).some(key => editedData[key] !== originalData[key]) && (
              <Button onClick={() => handleSaveAmendment('observation')} disabled={isAmending}>
                {isAmending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Amendments
              </Button>
            )}
            <Button onClick={handleResolveObservation} className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incident Detail Modal - Truncated for token limit, keeping existing code */}

      {/* Investigation Job Creation Modal - ENHANCED VERSION CONTINUES IN NEXT RESPONSE */}
    </div>
  );
}
