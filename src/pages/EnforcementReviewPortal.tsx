/**
 * ENFORCEMENT REVIEW PORTAL
 * 
 * Admin dashboard for reviewing and approving breach alerts for enforcement action.
 * 
 * Data Flow:
 * 1. Officer scans vehicle → creates observation
 * 2. System evaluates compliance → creates compliance_result with rule_snapshot
 * 3. Violation detected → creates breach_alert
 * 4. Admin reviews breach → approves/rejects → updates status to 'issued'/'dismissed'
 * 
 * Schema Connections:
 * - breach_alerts.observation_id → observations.id (photo, GPS, officer notes)
 * - breach_alerts.compliance_result_id → compliance_results.id (rule_snapshot - bylaw details)
 * - breach_alerts.zone_id → zones.id (zone name, legal basis)
 * - breach_alerts.plate_number → canonical_vehicles.plate_number (vehicle details)
 * - breach_alerts.admin_reviewed_by → user_profiles.id (reviewer identity)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  MapPin,
  Calendar,
  User,
  Clock,
  Camera,
  Scale,
  Loader2,
  RefreshCw,
  Filter,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Home,
  Flag,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface BreachAlertDetail {
  id: string;
  organization_id: string;
  zone_id: string;
  zone_name: string;
  plate_number: string;
  breach_type: string;
  breach_details: any;
  status: string;
  created_at: string;
  
  // Observation details
  observation_id: string | null;
  observation_photo: string | null;
  observation_gps_lat: number | null;
  observation_gps_lng: number | null;
  observation_recorded_at: string | null;
  officer_notes: string | null;
  recorded_by_name: string | null;
  
  // Compliance result details
  compliance_result_id: string | null;
  rule_snapshot: any | null;
  rule_applied: string | null;
  
  // Vehicle details
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  is_flagged: boolean;
  homeless_status: string | null;
  
  // Review details
  admin_reviewed_by: string | null;
  admin_reviewed_at: string | null;
  admin_review_notes: string | null;
  reviewer_name: string | null;
}

export function EnforcementReviewPortal() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  const [breaches, setBreaches] = useState<BreachAlertDetail[]>([]);
  const [filteredBreaches, setFilteredBreaches] = useState<BreachAlertDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBreach, setSelectedBreach] = useState<BreachAlertDetail | null>(null);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [breachTypeFilter, setBreachTypeFilter] = useState<string>('all');
  const [availableZones, setAvailableZones] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    loadBreaches();
    loadZones();
  }, [user?.organization_id]);

  useEffect(() => {
    applyFilters();
  }, [breaches, statusFilter, zoneFilter, breachTypeFilter]);

  const loadZones = async () => {
    if (!user?.organization_id) return;

    try {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableZones(data || []);
    } catch (error: any) {
      console.error('Failed to load zones:', error);
    }
  };

  const loadBreaches = async () => {
    if (!user?.organization_id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      console.log('📋 Loading breach alerts for enforcement review...');

      // Query breach_alerts with all necessary joins
      const { data: breachData, error: breachError } = await supabase
        .from('breach_alerts')
        .select(`
          id,
          organization_id,
          zone_id,
          plate_number,
          breach_type,
          breach_details,
          status,
          observation_id,
          compliance_result_id,
          admin_reviewed_by,
          admin_reviewed_at,
          admin_review_notes,
          created_at,
          zones!inner(name),
          canonical_vehicles(
            vehicle_make,
            vehicle_model,
            vehicle_color,
            is_flagged,
            homeless_status
          )
        `)
        .eq('organization_id', user.organization_id)
        .order('created_at', { ascending: false });

      if (breachError) throw breachError;

      console.log(`✅ Loaded ${breachData?.length || 0} breach alerts`);

      // Enrich with observation and compliance result data
      const enrichedBreaches: BreachAlertDetail[] = await Promise.all(
        (breachData || []).map(async (breach) => {
          let observationData = null;
          let complianceData = null;
          let officerName = null;
          let reviewerName = null;

          // Load observation details if linked
          if (breach.observation_id) {
            const { data: obs } = await supabase
              .from('observations')
              .select(`
                id,
                photo_url,
                gps_latitude,
                gps_longitude,
                recorded_at,
                officer_notes,
                recorded_by,
                user_profiles!observations_recorded_by_fkey(first_name, last_name)
              `)
              .eq('id', breach.observation_id)
              .single();

            if (obs) {
              observationData = obs;
              if (obs.user_profiles) {
                const profile = obs.user_profiles as any;
                officerName = `${profile.first_name} ${profile.last_name}`;
              }
            }
          }

          // Load compliance result details if linked
          if (breach.compliance_result_id) {
            const { data: compRes } = await supabase
              .from('compliance_results')
              .select('id, rule_snapshot, rule_applied')
              .eq('id', breach.compliance_result_id)
              .single();

            if (compRes) {
              complianceData = compRes;
            }
          }

          // Load reviewer name if reviewed
          if (breach.admin_reviewed_by) {
            const { data: reviewer } = await supabase
              .from('user_profiles')
              .select('first_name, last_name')
              .eq('id', breach.admin_reviewed_by)
              .single();

            if (reviewer) {
              reviewerName = `${reviewer.first_name} ${reviewer.last_name}`;
            }
          }

          const vehicle = breach.canonical_vehicles as any;
          const zone = breach.zones as any;

          return {
            id: breach.id,
            organization_id: breach.organization_id,
            zone_id: breach.zone_id,
            zone_name: zone?.name || 'Unknown',
            plate_number: breach.plate_number,
            breach_type: breach.breach_type,
            breach_details: breach.breach_details,
            status: breach.status,
            created_at: breach.created_at,
            observation_id: breach.observation_id,
            observation_photo: observationData?.photo_url || null,
            observation_gps_lat: observationData?.gps_latitude || null,
            observation_gps_lng: observationData?.gps_longitude || null,
            observation_recorded_at: observationData?.recorded_at || null,
            officer_notes: observationData?.officer_notes || null,
            recorded_by_name: officerName,
            compliance_result_id: breach.compliance_result_id,
            rule_snapshot: complianceData?.rule_snapshot || null,
            rule_applied: complianceData?.rule_applied || null,
            vehicle_make: vehicle?.vehicle_make || null,
            vehicle_model: vehicle?.vehicle_model || null,
            vehicle_color: vehicle?.vehicle_color || null,
            is_flagged: vehicle?.is_flagged || false,
            homeless_status: vehicle?.homeless_status || null,
            admin_reviewed_by: breach.admin_reviewed_by,
            admin_reviewed_at: breach.admin_reviewed_at,
            admin_review_notes: breach.admin_review_notes,
            reviewer_name: reviewerName,
          };
        })
      );

      setBreaches(enrichedBreaches);

      console.log('✅ Breach alerts enriched with observation and compliance data');
    } catch (error: any) {
      console.error('❌ Failed to load breaches:', error);
      toast.error('Failed to load breach alerts: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...breaches];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(b => b.status === statusFilter);
    }

    if (zoneFilter !== 'all') {
      filtered = filtered.filter(b => b.zone_id === zoneFilter);
    }

    if (breachTypeFilter !== 'all') {
      filtered = filtered.filter(b => b.breach_type === breachTypeFilter);
    }

    setFilteredBreaches(filtered);
  };

  const handleReviewClick = (breach: BreachAlertDetail, action: 'approve' | 'reject') => {
    setSelectedBreach(breach);
    setReviewAction(action);
    setReviewNotes('');
    setIsReviewDialogOpen(true);
  };

  const handleSubmitReview = async () => {
    if (!selectedBreach || !reviewAction || !user?.id) return;

    setIsSubmitting(true);

    try {
      const newStatus = reviewAction === 'approve' ? 'issued' : 'dismissed';

      const { error } = await supabase
        .from('breach_alerts')
        .update({
          status: newStatus,
          admin_reviewed_by: user.id,
          admin_reviewed_at: new Date().toISOString(),
          admin_review_notes: reviewNotes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedBreach.id);

      if (error) throw error;

      toast.success(
        reviewAction === 'approve'
          ? '✅ Breach approved for enforcement'
          : '❌ Breach dismissed'
      );

      setIsReviewDialogOpen(false);
      setSelectedBreach(null);
      setReviewAction(null);
      setReviewNotes('');

      // Reload breaches
      loadBreaches();
    } catch (error: any) {
      console.error('❌ Failed to submit review:', error);
      toast.error('Failed to submit review: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingCount = breaches.filter(b => b.status === 'pending').length;
  const issuedCount = breaches.filter(b => b.status === 'issued').length;
  const dismissedCount = breaches.filter(b => b.status === 'dismissed').length;

  const breachTypes = Array.from(new Set(breaches.map(b => b.breach_type))).filter(Boolean);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h3 className="text-xl font-bold mb-2">Admin Access Required</h3>
            <p className="text-muted-foreground">
              Only administrators can access the Enforcement Review Portal.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-blue-600" />
              Enforcement Review Portal
            </h1>
            <p className="text-muted-foreground mt-1">
              Review and approve breach alerts for enforcement action
            </p>
          </div>
        </div>
        <Button onClick={loadBreaches} variant="outline" disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-amber-500 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <Badge variant="outline" className="bg-white dark:bg-gray-900">Pending</Badge>
            </div>
            <div className="text-4xl font-black text-amber-600">{pendingCount}</div>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Awaiting Review
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-500 bg-green-50 dark:bg-green-950/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-white" />
              </div>
              <Badge variant="outline" className="bg-white dark:bg-gray-900">Issued</Badge>
            </div>
            <div className="text-4xl font-black text-green-600">{issuedCount}</div>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Approved for Enforcement
            </p>
          </CardContent>
        </Card>

        <Card className="border-2 border-gray-500 bg-gray-50 dark:bg-gray-950/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="h-12 w-12 rounded-full bg-gray-500 flex items-center justify-center">
                <XCircle className="h-6 w-6 text-white" />
              </div>
              <Badge variant="outline" className="bg-white dark:bg-gray-900">Dismissed</Badge>
            </div>
            <div className="text-4xl font-black text-gray-600">{dismissedCount}</div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              Rejected
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Zone</Label>
              <Select value={zoneFilter} onValueChange={setZoneFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {availableZones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Breach Type</Label>
              <Select value={breachTypeFilter} onValueChange={setBreachTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {breachTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breach List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Breach Alerts ({filteredBreaches.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
          ) : filteredBreaches.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>No breach alerts found</p>
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-4 pr-4">
                {filteredBreaches.map((breach) => (
                  <Card
                    key={breach.id}
                    className={`border-2 ${
                      breach.status === 'pending'
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                        : breach.status === 'issued'
                        ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                        : 'border-gray-500 bg-gray-50 dark:bg-gray-950/20'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Photo Evidence */}
                        <div className="md:col-span-1">
                          {breach.observation_photo ? (
                            <div className="relative">
                              <img
                                src={breach.observation_photo}
                                alt={`Breach ${breach.plate_number}`}
                                className="w-full aspect-video object-cover rounded-lg border-2"
                              />
                              <Badge className="absolute top-2 right-2 bg-black/70 text-white">
                                <Camera className="h-3 w-3 mr-1" />
                                Evidence
                              </Badge>
                            </div>
                          ) : (
                            <div className="w-full aspect-video bg-muted rounded-lg border-2 border-dashed flex items-center justify-center">
                              <Camera className="h-8 w-8 text-muted-foreground opacity-30" />
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="md:col-span-2 space-y-3">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <p className="font-mono font-black text-2xl">
                                  {breach.plate_number}
                                </p>
                                {breach.is_flagged && (
                                  <Badge variant="destructive" className="gap-1">
                                    <Flag className="h-3 w-3" />
                                    FLAGGED
                                  </Badge>
                                )}
                                {breach.homeless_status === 'confirmed' && (
                                  <Badge className="gap-1 bg-cyan-600">
                                    <Home className="h-3 w-3" />
                                    HOMELESS
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {breach.vehicle_color} {breach.vehicle_make} {breach.vehicle_model}
                              </p>
                            </div>
                            <Badge
                              variant={
                                breach.status === 'pending'
                                  ? 'outline'
                                  : breach.status === 'issued'
                                  ? 'default'
                                  : 'secondary'
                              }
                            >
                              {breach.status.toUpperCase()}
                            </Badge>
                          </div>

                          {/* Violation Details */}
                          <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
                            <div className="flex items-start gap-2 mb-2">
                              <Scale className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-semibold text-red-900 dark:text-red-100 mb-1">
                                  Violation: {breach.breach_type.replace(/_/g, ' ')}
                                </p>
                                {breach.rule_snapshot && (
                                  <div className="text-sm space-y-1">
                                    <p className="text-red-800 dark:text-red-200">
                                      <strong>Bylaw:</strong>{' '}
                                      {breach.rule_snapshot.self_contained_required && 'Self-contained vehicle required. '}
                                      {breach.rule_snapshot.max_consecutive_nights && 
                                        `Maximum ${breach.rule_snapshot.max_consecutive_nights} consecutive nights. `}
                                      {breach.rule_snapshot.nights_per_month && 
                                        `Maximum ${breach.rule_snapshot.nights_per_month} nights per month.`}
                                    </p>
                                    {breach.rule_snapshot.enforcement_basis && (
                                      <p className="text-red-700 dark:text-red-300">
                                        <strong>Legal Basis:</strong> {breach.rule_snapshot.enforcement_basis}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Location & Time */}
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{breach.zone_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span>{format(new Date(breach.created_at), 'dd MMM yyyy HH:mm')}</span>
                            </div>
                            {breach.recorded_by_name && (
                              <div className="flex items-center gap-2 col-span-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span>Reported by: {breach.recorded_by_name}</span>
                              </div>
                            )}
                          </div>

                          {/* Officer Notes */}
                          {breach.officer_notes && (
                            <div className="p-2 bg-muted rounded text-sm">
                              <p className="text-xs text-muted-foreground mb-1">Officer Notes:</p>
                              <p className="line-clamp-2">{breach.officer_notes}</p>
                            </div>
                          )}

                          {/* Review Info */}
                          {breach.admin_reviewed_at && (
                            <div className="pt-3 border-t">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                <span>
                                  Reviewed by {breach.reviewer_name} on{' '}
                                  {format(new Date(breach.admin_reviewed_at), 'dd MMM yyyy HH:mm')}
                                </span>
                              </div>
                              {breach.admin_review_notes && (
                                <p className="text-sm mt-2 p-2 bg-muted rounded">
                                  {breach.admin_review_notes}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="md:col-span-1 flex flex-col gap-2">
                          {breach.status === 'pending' && (
                            <>
                              <Button
                                onClick={() => handleReviewClick(breach, 'approve')}
                                className="w-full bg-green-600 hover:bg-green-700 gap-2"
                              >
                                <ThumbsUp className="h-4 w-4" />
                                Approve
                              </Button>
                              <Button
                                onClick={() => handleReviewClick(breach, 'reject')}
                                variant="outline"
                                className="w-full gap-2"
                              >
                                <ThumbsDown className="h-4 w-4" />
                                Dismiss
                              </Button>
                            </>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedBreach(breach);
                              setIsReviewDialogOpen(true);
                              setReviewAction(null);
                            }}
                            className="w-full gap-2"
                          >
                            <Eye className="h-4 w-4" />
                            View Details
                          </Button>
                          {breach.observation_gps_lat && breach.observation_gps_lng && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                window.open(
                                  `https://www.google.com/maps?q=${breach.observation_gps_lat},${breach.observation_gps_lng}`,
                                  '_blank'
                                )
                              }
                              className="w-full gap-2"
                            >
                              <MapPin className="h-4 w-4" />
                              View Map
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              {reviewAction === 'approve'
                ? 'Approve for Enforcement'
                : reviewAction === 'reject'
                ? 'Dismiss Breach Alert'
                : 'Breach Alert Details'}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === 'approve' && 'This breach will be approved for enforcement action.'}
              {reviewAction === 'reject' && 'This breach will be dismissed and not pursued.'}
              {!reviewAction && 'Review breach alert details and evidence.'}
            </DialogDescription>
          </DialogHeader>

          {selectedBreach && (
            <div className="space-y-4">
              {/* Vehicle Info */}
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-mono font-black text-xl mb-2">{selectedBreach.plate_number}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedBreach.vehicle_color} {selectedBreach.vehicle_make}{' '}
                  {selectedBreach.vehicle_model}
                </p>
              </div>

              {/* Violation */}
              <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200">
                <div className="flex items-start gap-2">
                  <Scale className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-900 dark:text-red-100 mb-2">
                      {selectedBreach.breach_type.replace(/_/g, ' ')}
                    </p>
                    {selectedBreach.rule_snapshot && (
                      <div className="text-sm space-y-1 text-red-800 dark:text-red-200">
                        {selectedBreach.rule_snapshot.self_contained_required && (
                          <p>✓ Self-contained vehicle required in this zone</p>
                        )}
                        {selectedBreach.rule_snapshot.max_consecutive_nights && (
                          <p>
                            ✓ Maximum {selectedBreach.rule_snapshot.max_consecutive_nights}{' '}
                            consecutive nights allowed
                          </p>
                        )}
                        {selectedBreach.rule_snapshot.nights_per_month && (
                          <p>
                            ✓ Maximum {selectedBreach.rule_snapshot.nights_per_month} nights per
                            month allowed
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Evidence Photo */}
              {selectedBreach.observation_photo && (
                <div>
                  <Label className="mb-2 block">Photo Evidence</Label>
                  <img
                    src={selectedBreach.observation_photo}
                    alt="Evidence"
                    className="w-full rounded-lg border-2"
                  />
                </div>
              )}

              {/* Review Notes (if reviewing) */}
              {reviewAction && (
                <div className="space-y-2">
                  <Label htmlFor="review-notes">
                    Review Notes {reviewAction === 'reject' ? '(Required)' : '(Optional)'}
                  </Label>
                  <Textarea
                    id="review-notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder={
                      reviewAction === 'approve'
                        ? 'Add any notes about this enforcement action...'
                        : 'Explain why this breach is being dismissed...'
                    }
                    rows={4}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReviewDialogOpen(false)}>
              Cancel
            </Button>
            {reviewAction && (
              <Button
                onClick={handleSubmitReview}
                disabled={isSubmitting || (reviewAction === 'reject' && !reviewNotes.trim())}
                className={
                  reviewAction === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : reviewAction === 'approve' ? (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                {reviewAction === 'approve' ? 'Approve & Issue' : 'Dismiss'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
