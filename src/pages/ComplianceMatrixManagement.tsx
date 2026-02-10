/**
 * ComplianceMatrixManagement - Matrix Version Control with Diff View
 * Manage zone compliance criteria with full audit trail and version comparison
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Settings,
  Plus,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Archive,
  FileText,
  Clock,
  TrendingDown,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface MatrixVersion {
  id: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  organization_name: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  self_contained_required: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  day_visit_only: boolean;
  allowed_days: string[];
  homeless_exemption: boolean;
  change_reason: string | null;
  change_notes: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

interface MatrixStats {
  total_observations: number;
  compliant_count: number;
  non_compliant_count: number;
  compliance_rate: number;
  unique_vehicles: number;
  breach_types: { [key: string]: number };
}

export function ComplianceMatrixManagement() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [selectedZone, setSelectedZone] = useState<string>('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDiffDialog, setShowDiffDialog] = useState(false);
  const [compareVersions, setCompareVersions] = useState<[MatrixVersion | null, MatrixVersion | null]>([null, null]);
  const [matrixStats, setMatrixStats] = useState<MatrixStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // New version form state
  const [formData, setFormData] = useState({
    selfContainedRequired: true,
    nightsPerMonth: 28,
    maxConsecutiveNights: 3,
    dayVisitOnly: false,
    allowedDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    homelessExemption: true,
    changeReason: '',
    changeNotes: '',
  });

  // Fetch zones
  const { data: zones } = useQuery({
    queryKey: ['zones_for_matrix'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, organization:organizations(name)')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch observation statistics for active matrix
  const fetchMatrixStats = async (matrixId: string) => {
    setStatsLoading(true);
    try {
      console.log('🔍 Fetching compliance_results for matrix_id:', matrixId);
      
      const { data, error, count } = await supabase
        .from('compliance_results')
        .select('is_compliant, violation_reasons, vehicle_id', { count: 'exact' })
        .eq('matrix_id', matrixId);

      if (error) {
        console.error('❌ Error fetching compliance_results:', error);
        throw error;
      }

      console.log('📊 Query result:', { count, recordsReturned: data?.length || 0 });

      if (!data || data.length === 0) {
        console.warn('⚠️ No compliance_results found for this matrix. This could mean:');
        console.warn('  1. No observations have been evaluated against this matrix yet');
        console.warn('  2. Observations exist but compliance results were never created');
        console.warn('  3. Matrix was created after observations were recorded');
        console.warn('  💡 Solution: Run a recalculation to evaluate existing observations');
        
        setMatrixStats({
          total_observations: 0,
          compliant_count: 0,
          non_compliant_count: 0,
          compliance_rate: 0,
          unique_vehicles: 0,
          breach_types: {},
        });
        return;
      }

      const total = data?.length || 0;
      const compliant = data?.filter(r => r.is_compliant).length || 0;
      const nonCompliant = total - compliant;
      const uniqueVehicles = new Set(data?.map(r => r.vehicle_id)).size;

      // Count breach types
      const breachTypes: { [key: string]: number } = {};
      data?.forEach(r => {
        if (!r.is_compliant && r.violation_reasons) {
          r.violation_reasons.forEach((reason: string) => {
            breachTypes[reason] = (breachTypes[reason] || 0) + 1;
          });
        }
      });

      console.log('✅ Stats calculated:', {
        total_observations: total,
        compliant_count: compliant,
        non_compliant_count: nonCompliant,
        compliance_rate: total > 0 ? Math.round((compliant / total) * 100) : 0,
        unique_vehicles: uniqueVehicles,
        breach_types: breachTypes,
      });

      setMatrixStats({
        total_observations: total,
        compliant_count: compliant,
        non_compliant_count: nonCompliant,
        compliance_rate: total > 0 ? Math.round((compliant / total) * 100) : 0,
        unique_vehicles: uniqueVehicles,
        breach_types: breachTypes,
      });
    } catch (error) {
      console.error('❌ Failed to fetch matrix stats:', error);
      toast.error('Failed to load compliance statistics');
    } finally {
      setStatsLoading(false);
    }
  };

  // Fetch matrix versions for selected zone
  const { data: matrixVersions, refetch: refetchVersions } = useQuery({
    queryKey: ['matrix_versions', selectedZone],
    queryFn: async () => {
      if (!selectedZone) return [];

      const { data, error } = await supabase
        .from('zone_compliance_matrix')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name),
          created_by_user:user_profiles!zone_compliance_matrix_created_by_fkey(first_name, last_name)
        `)
        .eq('zone_id', selectedZone)
        .order('version', { ascending: false });

      if (error) throw error;

      return (data || []).map((m: any) => ({
        id: m.id,
        zone_id: m.zone_id,
        zone_name: m.zone?.name || 'Unknown',
        organization_id: m.organization_id,
        organization_name: m.organization?.name || 'Unknown',
        version: m.version,
        effective_from: m.effective_from,
        effective_to: m.effective_to,
        self_contained_required: m.self_contained_required,
        nights_per_month: m.nights_per_month,
        max_consecutive_nights: m.max_consecutive_nights,
        day_visit_only: m.day_visit_only,
        allowed_days: m.allowed_days,
        homeless_exemption: m.homeless_exemption,
        change_reason: m.change_reason,
        change_notes: m.change_notes,
        created_by: m.created_by,
        created_by_name: m.created_by_user ? `${m.created_by_user.first_name} ${m.created_by_user.last_name}` : 'Unknown',
        created_at: m.created_at,
      }));
    },
    enabled: !!selectedZone,
  });

  // Load stats when active version changes
  useEffect(() => {
    const activeVersion = matrixVersions?.find(v => v.effective_to === null);
    if (activeVersion) {
      console.log('📊 Loading stats for matrix:', activeVersion.id);
      fetchMatrixStats(activeVersion.id);
    }
  }, [matrixVersions]);

  // Create new matrix version mutation
  const createVersion = useMutation({
    mutationFn: async () => {
      const activeVersion = matrixVersions?.find(v => v.effective_to === null);
      
      const { data, error } = await supabase.rpc('create_matrix_version', {
        p_zone_id: selectedZone,
        p_self_contained_required: formData.selfContainedRequired,
        p_nights_per_month: formData.nightsPerMonth,
        p_max_consecutive_nights: formData.maxConsecutiveNights,
        p_day_visit_only: formData.dayVisitOnly,
        p_allowed_days: formData.allowedDays,
        p_homeless_exemption: formData.homelessExemption,
        p_change_reason: formData.changeReason,
        p_change_notes: formData.changeNotes,
        p_created_by: user?.id,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success('✅ New matrix version created - drift detection will run automatically');
      await refetchVersions();
      setShowCreateDialog(false);
      resetForm();
      // Reload stats for new version
      const newActive = matrixVersions?.find(v => v.effective_to === null);
      if (newActive) {
        await fetchMatrixStats(newActive.id);
      }
    },
    onError: (error: any) => {
      toast.error('Failed to create matrix version: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      selfContainedRequired: true,
      nightsPerMonth: 28,
      maxConsecutiveNights: 3,
      dayVisitOnly: false,
      allowedDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      homelessExemption: true,
      changeReason: '',
      changeNotes: '',
    });
  };

  const handleOpenCreateDialog = () => {
    const activeVersion = matrixVersions?.find(v => v.effective_to === null);
    
    if (activeVersion) {
      setFormData({
        selfContainedRequired: activeVersion.self_contained_required,
        nightsPerMonth: activeVersion.nights_per_month,
        maxConsecutiveNights: activeVersion.max_consecutive_nights,
        dayVisitOnly: activeVersion.day_visit_only,
        allowedDays: activeVersion.allowed_days,
        homelessExemption: activeVersion.homeless_exemption,
        changeReason: '',
        changeNotes: '',
      });
    }
    
    setShowCreateDialog(true);
  };

  const handleCompareToCurrent = (version: MatrixVersion) => {
    const currentVersion = matrixVersions?.find(v => v.effective_to === null);
    if (currentVersion) {
      setCompareVersions([version, currentVersion]);
      setShowDiffDialog(true);
    }
  };

  const renderDiff = (label: string, oldValue: any, newValue: any) => {
    const changed = JSON.stringify(oldValue) !== JSON.stringify(newValue);
    
    return (
      <div className={`p-3 rounded-lg border ${changed ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-500/30' : 'bg-muted/50'}`}>
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="flex items-center gap-3">
          <span className={`font-semibold ${changed ? 'text-red-600 line-through' : ''}`}>
            {JSON.stringify(oldValue)}
          </span>
          {changed && (
            <>
              <ArrowRight className="h-4 w-4 text-amber-600" />
              <span className="font-semibold text-green-600">
                {JSON.stringify(newValue)}
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  const activeVersion = matrixVersions?.find(v => v.effective_to === null);
  const archivedVersions = matrixVersions?.filter(v => v.effective_to !== null);

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Settings className="h-8 w-8 text-purple-500" />
            Compliance Matrix Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage zone compliance criteria with version control and audit trail
          </p>
        </div>

        {/* Zone Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={selectedZone} onValueChange={setSelectedZone}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a zone to manage" />
              </SelectTrigger>
              <SelectContent>
                {zones?.map((zone) => (
                  <SelectItem key={zone.id} value={zone.id}>
                    {zone.name} • {(zone.organization as any)?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedZone && (
          <>
            {/* Active Version - Enhanced Display */}
            {activeVersion && (
              <Card className="border-2 border-green-500 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
                <CardHeader className="bg-green-500/10 dark:bg-green-500/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-green-500 rounded-lg">
                        <CheckCircle2 className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <CardTitle className="text-xl text-gray-900 dark:text-white">Current Compliance Matrix</CardTitle>
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                          All observations are measured against these criteria
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="px-3 py-1 bg-green-600 text-white text-base">
                        Version {activeVersion.version}
                      </Badge>
                      <Button onClick={handleOpenCreateDialog} size="sm" className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        New Version
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {/* Observation Statistics */}
                  {statsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Clock className="h-6 w-6 animate-spin text-blue-600" />
                    </div>
                  ) : matrixStats && matrixStats.total_observations === 0 ? (
                    <div className="p-6 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">No Observations Evaluated Yet</h4>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                            This compliance matrix has no observations evaluated against it. This happens when:
                          </p>
                          <ul className="text-sm text-amber-800 dark:text-amber-200 list-disc list-inside space-y-1 mb-4">
                            <li>The matrix was created after observations were recorded</li>
                            <li>Observations exist but haven't been evaluated yet</li>
                            <li>No vehicles have been scanned in this zone</li>
                          </ul>
                          <div className="flex items-center gap-2">
                            <Button
                              onClick={() => {
                                // Navigate to recalculation page
                                const activeVersion = matrixVersions?.find(v => v.effective_to === null);
                                if (activeVersion) {
                                  toast.info('Navigate to Admin Recalculation page to evaluate existing observations');
                                }
                              }}
                              variant="outline"
                              size="sm"
                              className="bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300"
                            >
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Run Recalculation
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : matrixStats && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide mb-4 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Observation Statistics (All Time)
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="p-4 bg-blue-100 dark:bg-blue-900/40 rounded-lg border-2 border-blue-300 dark:border-blue-700">
                          <div className="text-xs text-blue-900 dark:text-blue-100 font-semibold mb-1">Total Observations</div>
                          <div className="text-2xl font-black text-blue-900 dark:text-blue-100">
                            {matrixStats.total_observations.toLocaleString()}
                          </div>
                          <div className="text-xs text-blue-700 dark:text-blue-200 mt-1">
                            {matrixStats.unique_vehicles} unique vehicles
                          </div>
                        </div>
                        <div className="p-4 bg-green-100 dark:bg-green-900/40 rounded-lg border-2 border-green-300 dark:border-green-700">
                          <div className="text-xs text-green-900 dark:text-green-100 font-semibold mb-1">Compliant</div>
                          <div className="text-2xl font-black text-green-900 dark:text-green-100">
                            {matrixStats.compliant_count.toLocaleString()}
                          </div>
                          <div className="text-xs text-green-700 dark:text-green-200 mt-1">
                            {matrixStats.compliance_rate}% compliance rate
                          </div>
                        </div>
                        <div className="p-4 bg-red-100 dark:bg-red-900/40 rounded-lg border-2 border-red-300 dark:border-red-700">
                          <div className="text-xs text-red-900 dark:text-red-100 font-semibold mb-1">Non-Compliant</div>
                          <div className="text-2xl font-black text-red-900 dark:text-red-100">
                            {matrixStats.non_compliant_count.toLocaleString()}
                          </div>
                          <div className="text-xs text-red-700 dark:text-red-200 mt-1">
                            {100 - matrixStats.compliance_rate}% breach rate
                          </div>
                        </div>
                        <div className="p-4 bg-purple-100 dark:bg-purple-900/40 rounded-lg border-2 border-purple-300 dark:border-purple-700">
                          <div className="text-xs text-purple-900 dark:text-purple-100 font-semibold mb-1">Breach Types</div>
                          <div className="text-2xl font-black text-purple-900 dark:text-purple-100">
                            {Object.keys(matrixStats.breach_types).length}
                          </div>
                          <div className="text-xs text-purple-700 dark:text-purple-200 mt-1">
                            Different violations
                          </div>
                        </div>
                      </div>
                      {Object.keys(matrixStats.breach_types).length > 0 && (
                        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                          <div className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">Top Breach Types:</div>
                          <div className="space-y-1">
                            {Object.entries(matrixStats.breach_types)
                              .sort(([, a], [, b]) => b - a)
                              .slice(0, 5)
                              .map(([type, count]) => (
                                <div key={type} className="flex items-center justify-between text-sm">
                                  <span className="text-amber-900 dark:text-amber-100">
                                    {type.replace(/_/g, ' ').toUpperCase()}
                                  </span>
                                  <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700">
                                    {count} observations
                                  </Badge>
                                </div>
                              ))
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Core Compliance Rules */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide mb-4 flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      Core Compliance Rules
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Self-Contained Required */}
                      <div className={`p-5 rounded-xl border-2 ${
                        activeVersion.self_contained_required 
                          ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-500' 
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                      }`}>
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                            Self-Contained Required
                          </p>
                          {activeVersion.self_contained_required ? (
                            <CheckCircle2 className="h-5 w-5 text-blue-600" />
                          ) : (
                            <XCircle className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                          {activeVersion.self_contained_required ? 'YES' : 'NO'}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          {activeVersion.self_contained_required 
                            ? 'Vehicles must be certified self-contained' 
                            : 'Any vehicle type allowed'}
                        </p>
                      </div>

                      {/* Nights Per Month */}
                      <div className="p-5 bg-purple-50 dark:bg-purple-950/30 rounded-xl border-2 border-purple-500">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                            Nights Per Month
                          </p>
                          <Clock className="h-5 w-5 text-purple-600" />
                        </div>
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                          {activeVersion.nights_per_month}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          Maximum nights allowed in 30 days
                        </p>
                      </div>

                      {/* Max Consecutive Nights */}
                      <div className="p-5 bg-amber-50 dark:bg-amber-950/30 rounded-xl border-2 border-amber-500">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                            Max Consecutive
                          </p>
                          <AlertTriangle className="h-5 w-5 text-amber-600" />
                        </div>
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                          {activeVersion.max_consecutive_nights}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          Maximum consecutive nights in zone
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Additional Rules */}
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide mb-4 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Additional Rules
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Day Visit Only */}
                      <div className={`p-5 rounded-xl border-2 ${
                        activeVersion.day_visit_only 
                          ? 'bg-red-50 dark:bg-red-950/30 border-red-500' 
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                      }`}>
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                            Day Visit Only
                          </p>
                          {activeVersion.day_visit_only ? (
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                          {activeVersion.day_visit_only ? 'YES' : 'NO'}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          {activeVersion.day_visit_only 
                            ? 'No overnight stays permitted' 
                            : 'Overnight stays allowed per rules'}
                        </p>
                      </div>

                      {/* Homeless Exemption */}
                      <div className={`p-5 rounded-xl border-2 ${
                        activeVersion.homeless_exemption 
                          ? 'bg-green-50 dark:bg-green-950/30 border-green-500' 
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                      }`}>
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                            Homeless Exemption
                          </p>
                          {activeVersion.homeless_exemption ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : (
                            <XCircle className="h-5 w-5 text-gray-400" />
                          )}
                        </div>
                        <p className="text-3xl font-black text-gray-900 dark:text-white">
                          {activeVersion.homeless_exemption ? 'YES' : 'NO'}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          {activeVersion.homeless_exemption 
                            ? 'Confirmed homeless exempt from limits' 
                            : 'No exemptions for homeless'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Allowed Days */}
                  {activeVersion.allowed_days && activeVersion.allowed_days.length < 7 && (
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wide mb-3">
                        Allowed Days
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                          <Badge
                            key={day}
                            variant={activeVersion.allowed_days.includes(day) ? 'default' : 'outline'}
                            className={activeVersion.allowed_days.includes(day) 
                              ? 'bg-green-600 text-white' 
                              : 'bg-red-100 text-red-600 border-red-300'}
                          >
                            {day}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="pt-4 border-t border-gray-300 dark:border-gray-600">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-white/60 dark:bg-gray-900/60 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Effective From</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {new Date(activeVersion.effective_from).toLocaleDateString('en-NZ', {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                      <div className="p-4 bg-white/60 dark:bg-gray-900/60 rounded-lg">
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Created By</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {activeVersion.created_by_name}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {new Date(activeVersion.created_at).toLocaleString('en-NZ')}
                        </p>
                      </div>
                    </div>

                    {activeVersion.change_reason && (
                      <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-1">Change Reason:</p>
                        <p className="text-sm text-blue-900 dark:text-blue-100">{activeVersion.change_reason}</p>
                        {activeVersion.change_notes && (
                          <p className="text-xs text-blue-700 dark:text-blue-200 mt-2">{activeVersion.change_notes}</p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Version History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Archive className="h-4 w-4" />
                  Version History ({archivedVersions?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {archivedVersions && archivedVersions.length > 0 ? (
                  <div className="space-y-3">
                    {archivedVersions.map((version) => (
                      <div key={version.id} className="p-4 bg-muted/50 rounded-lg border">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <Badge variant="outline">Version {version.version}</Badge>
                            <span className="ml-2 text-sm font-semibold">Archived</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCompareToCurrent(version)}
                          >
                            <TrendingDown className="h-3 w-3 mr-1" />
                            Compare to Current
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-2">
                          <div>
                            <p className="text-xs text-muted-foreground">Nights/Month</p>
                            <p className="font-semibold">{version.nights_per_month}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Max Consecutive</p>
                            <p className="font-semibold">{version.max_consecutive_nights}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Self-Contained</p>
                            <p className="font-semibold">{version.self_contained_required ? 'Required' : 'Not Required'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Day Visit</p>
                            <p className="font-semibold">{version.day_visit_only ? 'Only' : 'No'}</p>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Effective: {new Date(version.effective_from).toLocaleDateString('en-NZ')} → {
                            version.effective_to ? new Date(version.effective_to).toLocaleDateString('en-NZ') : 'Present'
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No archived versions
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Create Version Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Matrix Version</DialogTitle>
              <DialogDescription>
                Define compliance criteria for {zones?.find(z => z.id === selectedZone)?.name}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Criteria Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="nights-per-month">Nights Per Month</Label>
                  <Input
                    id="nights-per-month"
                    type="number"
                    min="0"
                    max="31"
                    value={formData.nightsPerMonth}
                    onChange={(e) => setFormData({ ...formData, nightsPerMonth: parseInt(e.target.value) })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="max-consecutive">Max Consecutive Nights</Label>
                  <Input
                    id="max-consecutive"
                    type="number"
                    min="0"
                    max="31"
                    value={formData.maxConsecutiveNights}
                    onChange={(e) => setFormData({ ...formData, maxConsecutiveNights: parseInt(e.target.value) })}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={formData.selfContainedRequired}
                    onCheckedChange={(checked) => setFormData({ ...formData, selfContainedRequired: !!checked })}
                  />
                  <span className="text-sm font-medium">Self-Contained Vehicle Required</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={formData.dayVisitOnly}
                    onCheckedChange={(checked) => setFormData({ ...formData, dayVisitOnly: !!checked })}
                  />
                  <span className="text-sm font-medium">Day Visit Only (No Overnight Stays)</span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={formData.homelessExemption}
                    onCheckedChange={(checked) => setFormData({ ...formData, homelessExemption: !!checked })}
                  />
                  <span className="text-sm font-medium">Homeless Exemption Allowed</span>
                </label>
              </div>

              <div>
                <Label htmlFor="change-reason">Change Reason (Required)</Label>
                <Input
                  id="change-reason"
                  value={formData.changeReason}
                  onChange={(e) => setFormData({ ...formData, changeReason: e.target.value })}
                  placeholder="e.g., Updated council policy for summer season"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="change-notes">Additional Notes (Optional)</Label>
                <textarea
                  id="change-notes"
                  value={formData.changeNotes}
                  onChange={(e) => setFormData({ ...formData, changeNotes: e.target.value })}
                  placeholder="Any additional context about this change..."
                  className="w-full mt-1 p-3 border rounded-md min-h-[100px]"
                />
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Creating a new version will archive the current version and trigger drift detection for affected observations.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createVersion.mutate()}
                disabled={!formData.changeReason || createVersion.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Create Version
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Diff Dialog */}
        <Dialog open={showDiffDialog} onOpenChange={setShowDiffDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Version Comparison</DialogTitle>
              <DialogDescription>
                Compare Version {compareVersions[0]?.version} → Version {compareVersions[1]?.version}
              </DialogDescription>
            </DialogHeader>

            {compareVersions[0] && compareVersions[1] && (
              <div className="space-y-3 py-4">
                {renderDiff('Self-Contained Required', compareVersions[0].self_contained_required, compareVersions[1].self_contained_required)}
                {renderDiff('Nights Per Month', compareVersions[0].nights_per_month, compareVersions[1].nights_per_month)}
                {renderDiff('Max Consecutive Nights', compareVersions[0].max_consecutive_nights, compareVersions[1].max_consecutive_nights)}
                {renderDiff('Day Visit Only', compareVersions[0].day_visit_only, compareVersions[1].day_visit_only)}
                {renderDiff('Homeless Exemption', compareVersions[0].homeless_exemption, compareVersions[1].homeless_exemption)}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDiffDialog(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
