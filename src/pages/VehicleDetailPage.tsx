/**
 * VehicleDetailPage - Comprehensive Vehicle View
 * 
 * Shows:
 * - Full canonical vehicle record (all fields, editable)
 * - ALL observations for this vehicle (all data, with filters)
 * - Vehicle profile photo
 * - Compliance history
 * - Breach history
 * - Enforcement actions
 * 
 * Features:
 * - Edit canonical vehicle details
 * - Edit individual observations
 * - Date filtering for observations
 * - CSV export
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Edit3,
  Save,
  X,
  Calendar,
  MapPin,
  User,
  CheckCircle2,
  AlertTriangle,
  Flag,
  Home,
  Camera,
  FileText,
  Loader2,
  Download,
  Filter,
  TrendingUp,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { format } from 'date-fns';

interface CanonicalVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  homeless_status: string;
  homeless_confirmed_at: string | null;
  homeless_confirmed_by: string | null;
  homeless_notes: string | null;
  is_flagged: boolean;
  flagged_priority: string | null;
  flagged_reason: string | null;
  flagged_notes: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_company_name: string | null;
  owner_address: string | null;
  owner_address_verified: boolean;
  profile_photo: string | null;
  total_observations: number;
  total_breaches: number;
  total_incidents: number;
  first_seen_at: string;
  last_seen_at: string;
  nzscv_last_checked: string | null;
  nzscv_source: string | null;
  enforcement_count: number;
  last_enforcement_at: string | null;
  last_enforcement_type: string | null;
}

interface VehicleObservation {
  observation_id: string;
  recorded_at: string;
  zone_id: string;
  organization_id: string;
  recorded_by: string | null;
  officer_notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  self_contained: boolean;
  breach_warning: boolean;
  is_breach: boolean;
  breach_type: string | null;
  has_incident: boolean;
  has_hs_incident: boolean;
  zones?: { name: string };
  organizations?: { name: string };
  user_profiles?: { first_name: string; last_name: string };
  compliance_results?: Array<{
    is_compliant: boolean;
    is_exempt?: boolean;
    exemption_reason?: string;
    violation_reasons: string[];
  }>;
}

interface VehicleDetailPageProps {
  plateNumber: string;
  onBack: () => void;
  dateFrom?: string;
  dateTo?: string;
}

export function VehicleDetailPage({
  plateNumber,
  onBack,
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
}: VehicleDetailPageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Data
  const [canonical, setCanonical] = useState<CanonicalVehicle | null>(null);
  const [observations, setObservations] = useState<VehicleObservation[]>([]);
  const [editedCanonical, setEditedCanonical] = useState<Partial<CanonicalVehicle>>({});

  // Filters
  const today = format(new Date(), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(initialDateFrom || today);
  const [dateTo, setDateTo] = useState(initialDateTo || today);
  const [filterCompliance, setFilterCompliance] = useState<'all' | 'compliant' | 'breach'>('all');

  useEffect(() => {
    loadVehicleData();
  }, [plateNumber]);

  useEffect(() => {
    if (canonical) {
      loadObservations();
    }
  }, [canonical, dateFrom, dateTo, filterCompliance]);

  const loadVehicleData = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', plateNumber)
        .single();

      if (error) throw error;
      
      setCanonical(data as CanonicalVehicle);
      setEditedCanonical(data as CanonicalVehicle);
    } catch (error: any) {
      console.error('Failed to load vehicle:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setIsLoading(false);
    }
  };

  const loadObservations = async () => {
    if (!canonical) return;

    try {
      let query = supabase
        .from('observations')
        .select(`
          *,
          zones(name),
          organizations(name),
          user_profiles!observations_user_id_fkey(first_name, last_name),
          compliance_results(is_compliant, is_exempt, exemption_reason, violation_reasons)
        `)
        .eq('plate_number', plateNumber)
        .gte('recorded_at', `${dateFrom}T00:00:00`)
        .lte('recorded_at', `${dateTo}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (filterCompliance === 'compliant') {
        query = query.eq('is_compliant', true);
      } else if (filterCompliance === 'breach') {
        query = query.eq('is_breach', true);
      }

      const { data, error } = await query;

      if (error) throw error;
      setObservations(data || []);
    } catch (error: any) {
      console.error('Failed to load observations:', error);
      toast.error('Failed to load observations');
    }
  };

  const handleSaveCanonical = async () => {
    if (!canonical) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('canonical_vehicles')
        .update(editedCanonical)
        .eq('plate_number', plateNumber);

      if (error) throw error;

      toast.success('Vehicle details updated successfully');
      setCanonical({ ...canonical, ...editedCanonical });
      setIsEditing(false);
    } catch (error: any) {
      console.error('Failed to update vehicle:', error);
      toast.error('Failed to update vehicle details');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedCanonical(canonical || {});
    setIsEditing(false);
  };

  const exportObservations = () => {
    if (observations.length === 0) {
      toast.error('No observations to export');
      return;
    }

    const csv = [
      ['Date/Time', 'Zone', 'Organization', 'Officer', 'Self-Contained', 'Compliant', 'Breach', 'Notes'],
      ...observations.map(o => [
        format(new Date(o.recorded_at), 'yyyy-MM-dd HH:mm'),
        o.zones?.name || '',
        o.organizations?.name || '',
        o.user_profiles ? `${o.user_profiles.first_name} ${o.user_profiles.last_name}` : '',
        o.self_contained ? 'Yes' : 'No',
        o.compliance_results?.[0]?.is_compliant ? 'Yes' : 'No',
        o.is_breach ? 'Yes' : 'No',
        o.officer_notes || '',
      ]),
    ]
      .map(row => row.join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle_${plateNumber}_observations_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Observations exported');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!canonical) {
    return (
      <div className="text-center py-24">
        <AlertCircle className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-xl font-bold mb-2">Vehicle Not Found</h3>
        <p className="text-muted-foreground mb-4">No vehicle record found for plate: {plateNumber}</p>
        <Button onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <Button variant="outline" onClick={onBack} size="sm" className="mb-3">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            Vehicle Details: <span className="font-mono">{plateNumber}</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            Complete vehicle record and observation history
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && (
            <Button variant="outline" onClick={() => setIsEditing(true)}>
              <Edit3 className="h-4 w-4 mr-2" />
              Edit Vehicle
            </Button>
          )}
          {isEditing && (
            <>
              <Button variant="outline" onClick={handleCancelEdit}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSaveCanonical} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Vehicle Header Card */}
      <Card className="border-2">
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            <VehicleProfilePhoto plateNumber={plateNumber} size="xl" />
            
            <div className="flex-1 space-y-4">
              {/* Plate & Status */}
              <div>
                <h2 className="text-4xl font-mono font-black mb-3">{plateNumber}</h2>
                <div className="flex flex-wrap gap-2">
                  {canonical.is_flagged && (
                    <Badge variant="destructive" className="gap-1">
                      <Flag className="h-3 w-3" />
                      FLAGGED - {canonical.flagged_priority?.toUpperCase()}
                    </Badge>
                  )}
                  {canonical.homeless_status !== 'none' && (
                    <Badge variant="outline" className="gap-1 bg-cyan-500/10 text-cyan-600 border-cyan-500">
                      <Home className="h-3 w-3" />
                      HOMELESS - {canonical.homeless_status.toUpperCase()}
                    </Badge>
                  )}
                  {canonical.self_contained && (
                    <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-600 border-blue-500">
                      <Shield className="h-3 w-3" />
                      SELF-CONTAINED
                    </Badge>
                  )}
                </div>
              </div>

              {/* Vehicle Info Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Vehicle</div>
                  {isEditing ? (
                    <div className="space-y-1">
                      <Input
                        value={editedCanonical.vehicle_make || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, vehicle_make: e.target.value })}
                        placeholder="Make"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={editedCanonical.vehicle_model || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, vehicle_model: e.target.value })}
                        placeholder="Model"
                        className="h-8 text-sm"
                      />
                    </div>
                  ) : (
                    <div className="font-medium">
                      {canonical.vehicle_make || 'Unknown'} {canonical.vehicle_model || ''}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Year / Color</div>
                  {isEditing ? (
                    <div className="space-y-1">
                      <Input
                        type="number"
                        value={editedCanonical.vehicle_year || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, vehicle_year: parseInt(e.target.value) })}
                        placeholder="Year"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={editedCanonical.vehicle_color || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, vehicle_color: e.target.value })}
                        placeholder="Color"
                        className="h-8 text-sm"
                      />
                    </div>
                  ) : (
                    <div className="font-medium">
                      {canonical.vehicle_year || '—'} / {canonical.vehicle_color || '—'}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">First / Last Seen</div>
                  <div className="text-sm space-y-0.5">
                    <div>{format(new Date(canonical.first_seen_at), 'dd MMM yyyy')}</div>
                    <div>{format(new Date(canonical.last_seen_at), 'dd MMM yyyy')}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">Activity</div>
                  <div className="text-sm space-y-0.5">
                    <div>{canonical.total_observations} observations</div>
                    <div className="text-red-600">{canonical.total_breaches} breaches</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="observations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="observations">Observations ({observations.length})</TabsTrigger>
          <TabsTrigger value="details">Details & Owner</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="enforcement">Enforcement ({canonical.enforcement_count})</TabsTrigger>
        </TabsList>

        {/* Observations Tab */}
        <TabsContent value="observations" className="space-y-4">
          {/* Observation Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Compliance Filter</Label>
                  <select
                    value={filterCompliance}
                    onChange={(e) => setFilterCompliance(e.target.value as any)}
                    className="w-full px-3 py-2 border rounded-md bg-background"
                  >
                    <option value="all">All Observations</option>
                    <option value="compliant">Compliant Only</option>
                    <option value="breach">Breaches Only</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button variant="outline" onClick={exportObservations} className="w-full">
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Observations List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                All Observations ({observations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {observations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No observations found for selected period</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {observations.map(obs => {
                    const isCompliant = obs.compliance_results?.[0]?.is_compliant;
                    const isExempt = obs.compliance_results?.[0]?.is_exempt;

                    return (
                      <div
                        key={obs.observation_id}
                        className={`p-4 border-2 rounded-lg ${
                          obs.is_breach && isExempt
                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                            : obs.is_breach
                            ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
                            : isCompliant
                            ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                            : 'border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">
                              {format(new Date(obs.recorded_at), 'dd MMM yyyy HH:mm')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {obs.is_breach && isExempt && (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Breach (Exempt)
                              </Badge>
                            )}
                            {obs.is_breach && !isExempt && (
                              <Badge variant="destructive">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Breach
                              </Badge>
                            )}
                            {!obs.is_breach && isCompliant && (
                              <Badge variant="default">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Compliant
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-xs text-muted-foreground">Zone</div>
                            <div className="font-medium">{obs.zones?.name || 'Unknown'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Organization</div>
                            <div className="font-medium">{obs.organizations?.name || 'Unknown'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Officer</div>
                            <div className="font-medium">
                              {obs.user_profiles 
                                ? `${obs.user_profiles.first_name} ${obs.user_profiles.last_name}`
                                : 'Unknown'}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">GPS</div>
                            {obs.gps_latitude && obs.gps_longitude ? (
                              <a
                                href={`https://www.google.com/maps?q=${obs.gps_latitude},${obs.gps_longitude}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline font-mono"
                              >
                                {obs.gps_latitude.toFixed(5)}, {obs.gps_longitude.toFixed(5)}
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </div>

                        {obs.officer_notes && (
                          <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border">
                            <div className="text-xs text-muted-foreground mb-1">Officer Notes:</div>
                            <p className="text-sm">{obs.officer_notes}</p>
                          </div>
                        )}

                        {isExempt && obs.compliance_results?.[0]?.exemption_reason && (
                          <div className="mt-3 p-3 bg-amber-100 dark:bg-amber-900/30 rounded border-2 border-amber-500">
                            <div className="text-xs font-bold text-amber-900 dark:text-amber-100 mb-1">
                              ⚠️ Exempt from Enforcement
                            </div>
                            <p className="text-xs text-amber-800 dark:text-amber-200">
                              {obs.compliance_results[0].exemption_reason}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Details & Owner Tab */}
        <TabsContent value="details" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Owner Information */}
            <Card>
              <CardHeader>
                <CardTitle>Owner Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {isEditing ? (
                  <>
                    <div className="space-y-2">
                      <Label>First Name</Label>
                      <Input
                        value={editedCanonical.owner_first_name || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, owner_first_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Last Name</Label>
                      <Input
                        value={editedCanonical.owner_last_name || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, owner_last_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company Name</Label>
                      <Input
                        value={editedCanonical.owner_company_name || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, owner_company_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Address</Label>
                      <Textarea
                        value={editedCanonical.owner_address || ''}
                        onChange={(e) => setEditedCanonical({ ...editedCanonical, owner_address: e.target.value })}
                        rows={3}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Name</div>
                      <div className="font-medium">
                        {canonical.owner_first_name || canonical.owner_last_name
                          ? `${canonical.owner_first_name || ''} ${canonical.owner_last_name || ''}`.trim()
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Company</div>
                      <div className="font-medium">{canonical.owner_company_name || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Address</div>
                      <div className="font-medium whitespace-pre-wrap">
                        {canonical.owner_address || '—'}
                      </div>
                      {canonical.owner_address_verified && (
                        <Badge variant="outline" className="mt-2 bg-green-500/10 text-green-600 border-green-500">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Verified
                        </Badge>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Flagged & Homeless Status */}
            <Card>
              <CardHeader>
                <CardTitle>Status & Flags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Flagged Status */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Flag className="h-5 w-5 text-red-600" />
                    <span className="font-semibold">Flagged Vehicle</span>
                  </div>
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="is-flagged"
                          checked={editedCanonical.is_flagged || false}
                          onChange={(e) => setEditedCanonical({ ...editedCanonical, is_flagged: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <Label htmlFor="is-flagged" className="cursor-pointer">Vehicle is flagged</Label>
                      </div>
                      {editedCanonical.is_flagged && (
                        <>
                          <div className="space-y-2">
                            <Label>Priority</Label>
                            <select
                              value={editedCanonical.flagged_priority || ''}
                              onChange={(e) => setEditedCanonical({ ...editedCanonical, flagged_priority: e.target.value })}
                              className="w-full px-3 py-2 border rounded-md bg-background"
                            >
                              <option value="">Select priority</option>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <Label>Reason</Label>
                            <Input
                              value={editedCanonical.flagged_reason || ''}
                              onChange={(e) => setEditedCanonical({ ...editedCanonical, flagged_reason: e.target.value })}
                              placeholder="Reason for flagging"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea
                              value={editedCanonical.flagged_notes || ''}
                              onChange={(e) => setEditedCanonical({ ...editedCanonical, flagged_notes: e.target.value })}
                              rows={3}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      {canonical.is_flagged ? (
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Priority:</span>{' '}
                            <Badge variant="destructive">{canonical.flagged_priority?.toUpperCase()}</Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Reason:</span> {canonical.flagged_reason || '—'}
                          </div>
                          {canonical.flagged_notes && (
                            <div>
                              <span className="text-muted-foreground">Notes:</span>
                              <p className="mt-1 whitespace-pre-wrap">{canonical.flagged_notes}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not flagged</p>
                      )}
                    </>
                  )}
                </div>

                {/* Homeless Status */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Home className="h-5 w-5 text-cyan-600" />
                    <span className="font-semibold">Homeless Status</span>
                  </div>
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <select
                          value={editedCanonical.homeless_status || 'none'}
                          onChange={(e) => setEditedCanonical({ ...editedCanonical, homeless_status: e.target.value })}
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        >
                          <option value="none">None</option>
                          <option value="claimed">Claimed</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                      </div>
                      {editedCanonical.homeless_status !== 'none' && (
                        <div className="space-y-2">
                          <Label>Notes</Label>
                          <Textarea
                            value={editedCanonical.homeless_notes || ''}
                            onChange={(e) => setEditedCanonical({ ...editedCanonical, homeless_notes: e.target.value })}
                            rows={3}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <Badge
                        variant={canonical.homeless_status === 'confirmed' ? 'default' : 'outline'}
                        className={canonical.homeless_status !== 'none' ? 'bg-cyan-500/10 text-cyan-600 border-cyan-500 mb-2' : ''}
                      >
                        {canonical.homeless_status.toUpperCase()}
                      </Badge>
                      {canonical.homeless_notes && (
                        <p className="text-sm mt-2 whitespace-pre-wrap">{canonical.homeless_notes}</p>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Compliance Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-black">{canonical.total_observations}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total Observations</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-black text-red-600">{canonical.total_breaches}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total Breaches</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-black text-amber-600">{canonical.total_incidents}</div>
                  <div className="text-xs text-muted-foreground mt-1">Incidents Reported</div>
                </div>
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-3xl font-black text-purple-600">{canonical.enforcement_count}</div>
                  <div className="text-xs text-muted-foreground mt-1">Enforcements</div>
                </div>
              </div>

              {/* Self-Contained Certificate */}
              <div className="mt-6 p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-5 w-5 text-blue-600" />
                  <span className="font-semibold">Self-Contained Certificate</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Status</div>
                    <Badge variant={canonical.self_contained ? 'default' : 'outline'}>
                      {canonical.self_contained ? 'Certified' : 'Not Certified'}
                    </Badge>
                  </div>
                  {canonical.self_contained && canonical.self_contained_expiry && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Expiry Date</div>
                      <div className="font-medium">
                        {format(new Date(canonical.self_contained_expiry), 'dd MMM yyyy')}
                      </div>
                    </div>
                  )}
                  {canonical.nzscv_last_checked && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Last Checked (NZSCV)</div>
                      <div className="font-medium text-xs">
                        {format(new Date(canonical.nzscv_last_checked), 'dd MMM yyyy HH:mm')}
                      </div>
                    </div>
                  )}
                  {canonical.nzscv_source && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Source</div>
                      <div className="font-medium text-xs">{canonical.nzscv_source}</div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Enforcement Tab */}
        <TabsContent value="enforcement">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Enforcement History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {canonical.enforcement_count === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                  <p>No enforcement actions on record</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 border rounded-lg text-center">
                      <div className="text-3xl font-black text-purple-600">{canonical.enforcement_count}</div>
                      <div className="text-xs text-muted-foreground mt-1">Total Actions</div>
                    </div>
                    {canonical.last_enforcement_at && (
                      <>
                        <div className="p-4 border rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Last Action</div>
                          <div className="font-medium text-sm">
                            {format(new Date(canonical.last_enforcement_at), 'dd MMM yyyy')}
                          </div>
                        </div>
                        <div className="p-4 border rounded-lg">
                          <div className="text-xs text-muted-foreground mb-1">Type</div>
                          <div className="font-medium text-sm">{canonical.last_enforcement_type || '—'}</div>
                        </div>
                      </>
                    )}
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>View Full Enforcement Details</AlertTitle>
                    <AlertDescription>
                      Complete enforcement action history is available in the Enforcement Actions page.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
