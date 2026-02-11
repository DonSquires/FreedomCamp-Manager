import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useVehicles } from '@/hooks/useVehicles';
import { useZones } from '@/hooks/useZones';
import { useAuthStore } from '@/stores/authStore';
import { UserX, CheckCircle, XCircle, AlertTriangle, FileText, MapPin, Calendar, Filter, X, Loader2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface HomelessClaim {
  id: string;
  plate_number: string;
  zone_name: string;
  zone_id: string;
  recorded_at: string;
  recorded_by: string;
  officer_name: string;
  evidence_photos: string[];
  notes: string;
  behavioral_flags: string[];
  is_compliant: boolean;
  homeless_confirmed: boolean | null;
  homeless_confirmation_notes: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export function HomelessClaimsReview() {
  const { user } = useAuthStore();
  const { data: allVehicles = [], refetch } = useVehicles(user?.organization_id || 'all');
  const { data: zones = [] } = useZones();
  
  const [selectedClaim, setSelectedClaim] = useState<HomelessClaim | null>(null);
  const [confirmationNotes, setConfirmationNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'pending' | 'confirmed' | 'declined' | 'all'>('pending');

  // Bulk Actions
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkAction, setBulkAction] = useState<'confirm' | 'decline' | null>(null);
  const [bulkNotes, setBulkNotes] = useState('');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Advanced Filters
  const [filterZone, setFilterZone] = useState<string>('all');
  const [filterOfficer, setFilterOfficer] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Extract homeless claims from vehicle records with all filters
  const homelessClaims: HomelessClaim[] = useMemo(() => {
    return allVehicles
      .filter(v => v.homeless_claimed) // Only homeless claimed vehicles
      .filter(v => {
        // Status filter
        if (filterStatus === 'pending') return v.homeless_confirmed === null;
        if (filterStatus === 'confirmed') return v.homeless_confirmed === true;
        if (filterStatus === 'declined') return v.homeless_confirmed === false;
        return true; // 'all'
      })
      .filter(v => {
        // Zone filter
        if (filterZone !== 'all') return v.zone_id === filterZone;
        return true;
      })
      .filter(v => {
        // Officer filter
        if (filterOfficer !== 'all') return v.recorded_by === filterOfficer;
        return true;
      })
      .filter(v => {
        // Date range filters
        if (filterStartDate) {
          const recordDate = new Date(v.recorded_at);
          const startDate = new Date(filterStartDate);
          startDate.setHours(0, 0, 0, 0);
          if (recordDate < startDate) return false;
        }
        if (filterEndDate) {
          const recordDate = new Date(v.recorded_at);
          const endDate = new Date(filterEndDate);
          endDate.setHours(23, 59, 59, 999);
          if (recordDate > endDate) return false;
        }
        return true;
      })
      .map(v => ({
        id: v.id,
        plate_number: v.plate_number,
        zone_name: (v as any).zone?.name || 'Unknown Zone',
        zone_id: v.zone_id,
        recorded_at: v.recorded_at,
        recorded_by: v.recorded_by || '',
        officer_name: `${(v as any).recorded_by_user?.first_name || ''} ${(v as any).recorded_by_user?.last_name || ''}`.trim() || 'Unknown',
        evidence_photos: Array.isArray(v.evidence_photos) ? v.evidence_photos : [],
        notes: v.notes || '',
        behavioral_flags: Array.isArray(v.behavioral_flags) ? v.behavioral_flags : [],
        is_compliant: v.is_compliant,
        homeless_confirmed: v.homeless_confirmed ?? null,
        homeless_confirmation_notes: v.homeless_confirmation_notes || null,
        confirmed_by: v.confirmed_by || null,
        confirmed_at: v.confirmed_at || null,
      }));
  }, [allVehicles, filterStatus, filterZone, filterOfficer, filterStartDate, filterEndDate]);

  // Get unique officers for filter dropdown
  const uniqueOfficers = useMemo(() => {
    const officers = new Map<string, string>();
    allVehicles
      .filter(v => v.homeless_claimed && v.recorded_by)
      .forEach(v => {
        const name = `${(v as any).recorded_by_user?.first_name || ''} ${(v as any).recorded_by_user?.last_name || ''}`.trim();
        if (name && v.recorded_by) {
          officers.set(v.recorded_by, name);
        }
      });
    return Array.from(officers.entries()).map(([id, name]) => ({ id, name }));
  }, [allVehicles]);

  const pendingCount = homelessClaims.filter(c => c.homeless_confirmed === null).length;
  const confirmedCount = homelessClaims.filter(c => c.homeless_confirmed === true).length;
  const declinedCount = homelessClaims.filter(c => c.homeless_confirmed === false).length;

  const hasActiveFilters = filterZone !== 'all' || filterOfficer !== 'all' || filterStartDate !== '' || filterEndDate !== '';

  // Bulk selection helpers
  const pendingClaims = homelessClaims.filter(c => c.homeless_confirmed === null);
  const allPendingSelected = pendingClaims.length > 0 && pendingClaims.every(c => selectedClaimIds.has(c.id));
  const somePendingSelected = pendingClaims.some(c => selectedClaimIds.has(c.id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedClaimIds(new Set());
    } else {
      setSelectedClaimIds(new Set(pendingClaims.map(c => c.id)));
    }
  };

  const toggleSelectClaim = (claimId: string) => {
    const newSelection = new Set(selectedClaimIds);
    if (newSelection.has(claimId)) {
      newSelection.delete(claimId);
    } else {
      newSelection.add(claimId);
    }
    setSelectedClaimIds(newSelection);
  };

  const clearFilters = () => {
    setFilterZone('all');
    setFilterOfficer('all');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  const handleConfirmHomeless = async (confirm: boolean) => {
    if (!selectedClaim || !user) return;
    
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('vehicle_records')
        .update({
          homeless_confirmed: confirm,
          homeless_confirmation_notes: confirmationNotes || null,
          confirmed_by: user.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', selectedClaim.id);

      if (error) throw error;

      toast.success(confirm ? 'Homeless status confirmed' : 'Homeless claim declined');
      
      // Refetch data and close dialog
      await refetch();
      setSelectedClaim(null);
      setConfirmationNotes('');
    } catch (error: any) {
      console.error('Failed to update homeless status:', error);
      toast.error(error.message || 'Failed to update claim');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || !user || selectedClaimIds.size === 0) return;

    setIsBulkProcessing(true);
    try {
      const claimIds = Array.from(selectedClaimIds);
      const confirm = bulkAction === 'confirm';

      const { error } = await supabase
        .from('vehicle_records')
        .update({
          homeless_confirmed: confirm,
          homeless_confirmation_notes: bulkNotes || null,
          confirmed_by: user.id,
          confirmed_at: new Date().toISOString(),
        })
        .in('id', claimIds);

      if (error) throw error;

      toast.success(
        `✅ ${claimIds.length} claim${claimIds.length === 1 ? '' : 's'} ${confirm ? 'confirmed' : 'declined'}`
      );

      // Reset state
      setSelectedClaimIds(new Set());
      setShowBulkDialog(false);
      setBulkAction(null);
      setBulkNotes('');
      await refetch();
    } catch (error: any) {
      console.error('Bulk action failed:', error);
      toast.error(error.message || 'Bulk action failed');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const openBulkDialog = (action: 'confirm' | 'decline') => {
    setBulkAction(action);
    setShowBulkDialog(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Homeless Claims Review</h2>
        <p className="text-muted-foreground">Confirm or decline homeless status claims from field officers</p>
      </div>

      {/* Status Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card 
          className={`cursor-pointer transition-all ${filterStatus === 'pending' ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-amber-500/20 bg-amber-500/5'}`}
          onClick={() => setFilterStatus('pending')}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
                <p className="text-3xl font-bold mt-1">{pendingCount}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${filterStatus === 'confirmed' ? 'border-green-500 ring-2 ring-green-500/20' : 'border-green-500/20 bg-green-500/5'}`}
          onClick={() => setFilterStatus('confirmed')}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Confirmed</p>
                <p className="text-3xl font-bold mt-1">{confirmedCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer transition-all ${filterStatus === 'declined' ? 'border-red-500 ring-2 ring-red-500/20' : 'border-red-500/20 bg-red-500/5'}`}
          onClick={() => setFilterStatus('declined')}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Declined</p>
                <p className="text-3xl font-bold mt-1">{declinedCount}</p>
              </div>
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Advanced Filters */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Advanced Filters
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Zone Filter */}
            <div className="space-y-2">
              <Label className="text-xs">Zone</Label>
              <Select value={filterZone} onValueChange={setFilterZone}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Officer Filter */}
            <div className="space-y-2">
              <Label className="text-xs">Officer</Label>
              <Select value={filterOfficer} onValueChange={setFilterOfficer}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Officers</SelectItem>
                  {uniqueOfficers.map((officer) => (
                    <SelectItem key={officer.id} value={officer.id}>
                      {officer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label className="text-xs">Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label className="text-xs">End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span>
                Showing {homelessClaims.length} of {allVehicles.filter(v => v.homeless_claimed).length} homeless claims
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Actions Bar */}
      {filterStatus === 'pending' && selectedClaimIds.size > 0 && (
        <Card className="border-primary bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">
                    {selectedClaimIds.size} claim{selectedClaimIds.size === 1 ? '' : 's'} selected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Process multiple claims with a single decision
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedClaimIds(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => openBulkDialog('decline')}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Decline All
                </Button>
                <Button
                  size="sm"
                  onClick={() => openBulkDialog('confirm')}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm All
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Claims List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserX className="h-5 w-5" />
            {filterStatus === 'pending' ? 'Pending Claims' : 
             filterStatus === 'confirmed' ? 'Confirmed Claims' : 
             filterStatus === 'declined' ? 'Declined Claims' : 'All Claims'}
            <Badge variant="outline" className="ml-auto">
              {homelessClaims.length} {homelessClaims.length === 1 ? 'claim' : 'claims'}
            </Badge>
          </CardTitle>
          {filterStatus === 'pending' && pendingClaims.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <Checkbox
                id="select-all"
                checked={allPendingSelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate = somePendingSelected && !allPendingSelected;
                  }
                }}
                onCheckedChange={toggleSelectAll}
              />
              <Label htmlFor="select-all" className="text-sm font-normal cursor-pointer">
                Select all pending claims ({pendingClaims.length})
              </Label>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {homelessClaims.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <UserX className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No Claims</p>
              <p className="text-sm">
                {filterStatus === 'pending' ? 'No pending homeless claims to review' : 
                 `No ${filterStatus} homeless claims`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {homelessClaims.map((claim) => (
                <Card 
                  key={claim.id}
                  className={`border-border transition-all ${
                    claim.homeless_confirmed === null ? 'bg-amber-500/5' : ''
                  } ${
                    selectedClaimIds.has(claim.id) ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Checkbox for pending claims only */}
                      {claim.homeless_confirmed === null && (
                        <div className="pt-1">
                          <Checkbox
                            checked={selectedClaimIds.has(claim.id)}
                            onCheckedChange={() => toggleSelectClaim(claim.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      )}
                      
                      {/* Main content - clickable */}
                      <div 
                        className="flex-1 cursor-pointer"
                        onClick={() => setSelectedClaim(claim)}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold">{claim.plate_number}</h3>
                          {claim.homeless_confirmed === null && (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                          {claim.homeless_confirmed === true && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Confirmed
                            </Badge>
                          )}
                          {claim.homeless_confirmed === false && (
                            <Badge variant="outline" className="bg-red-500/10 text-red-600">
                              <XCircle className="h-3 w-3 mr-1" />
                              Declined
                            </Badge>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-2">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {claim.zone_name}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(claim.recorded_at).toLocaleDateString('en-NZ', {
                              timeZone: 'Pacific/Auckland',
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm text-muted-foreground">Officer:</span>
                          <span className="text-sm font-medium">{claim.officer_name}</span>
                        </div>

                        {claim.notes && (
                          <div className="bg-muted/30 rounded p-2 text-sm mb-2">
                            <p className="text-muted-foreground text-xs mb-1">Field Notes:</p>
                            <p>{claim.notes}</p>
                          </div>
                        )}

                        {claim.homeless_confirmation_notes && (
                          <div className="bg-blue-500/10 rounded p-2 text-sm border border-blue-500/20">
                            <p className="text-blue-600 text-xs mb-1">Admin Notes:</p>
                            <p className="text-blue-600">{claim.homeless_confirmation_notes}</p>
                          </div>
                        )}
                      </div>

                      {/* Side badges */}
                      <div className="flex flex-col gap-2">
                        {claim.evidence_photos.length > 0 && (
                          <Badge variant="outline" className="whitespace-nowrap">
                            <FileText className="h-3 w-3 mr-1" />
                            {claim.evidence_photos.length} {claim.evidence_photos.length === 1 ? 'photo' : 'photos'}
                          </Badge>
                        )}
                        {claim.behavioral_flags.length > 1 && (
                          <Badge variant="outline" className="whitespace-nowrap">
                            {claim.behavioral_flags.length - 1} other flags
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedClaim} onOpenChange={() => setSelectedClaim(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5" />
              Review Homeless Claim
            </DialogTitle>
            <DialogDescription>
              Confirm or decline the homeless status claim for this vehicle
            </DialogDescription>
          </DialogHeader>

          {selectedClaim && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Plate Number</Label>
                  <p className="font-bold text-lg">{selectedClaim.plate_number}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Zone</Label>
                  <p className="font-semibold">{selectedClaim.zone_name}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Recorded By</Label>
                  <p className="font-semibold">{selectedClaim.officer_name}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Recorded At</Label>
                  <p className="font-semibold">
                    {new Date(selectedClaim.recorded_at).toLocaleDateString('en-NZ', {
                      timeZone: 'Pacific/Auckland',
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>

              {selectedClaim.notes && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <Label className="text-xs text-muted-foreground">Field Officer Notes</Label>
                  <p className="text-sm mt-1">{selectedClaim.notes}</p>
                </div>
              )}

              {selectedClaim.evidence_photos.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">Evidence Photos ({selectedClaim.evidence_photos.length})</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedClaim.evidence_photos.map((url, idx) => (
                      <img 
                        key={idx} 
                        src={url} 
                        alt={`Evidence ${idx + 1}`}
                        className="w-full h-32 object-cover rounded border border-border"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="admin-notes">Admin Review Notes</Label>
                <Textarea
                  id="admin-notes"
                  placeholder="Add notes about your decision (optional)..."
                  value={confirmationNotes}
                  onChange={(e) => setConfirmationNotes(e.target.value)}
                  rows={3}
                  disabled={selectedClaim.homeless_confirmed !== null}
                />
              </div>

              {selectedClaim.homeless_confirmed === null && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-sm text-amber-600 font-medium">⚠️ Decision Impact:</p>
                  <ul className="text-sm text-amber-600 mt-1 space-y-1">
                    <li>• <strong>Confirm:</strong> Marks vehicle as confirmed homeless, may trigger different enforcement protocols</li>
                    <li>• <strong>Decline:</strong> Removes homeless status, vehicle treated as standard compliance case</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {selectedClaim?.homeless_confirmed === null ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setSelectedClaim(null)}
                  disabled={isProcessing}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleConfirmHomeless(false)}
                  disabled={isProcessing}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Decline Claim
                </Button>
                <Button
                  onClick={() => handleConfirmHomeless(true)}
                  disabled={isProcessing}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm Homeless
                </Button>
              </>
            ) : (
              <Button onClick={() => setSelectedClaim(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkAction === 'confirm' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Bulk Confirm Homeless Claims
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-500" />
                  Bulk Decline Homeless Claims
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {bulkAction === 'confirm'
                ? `Confirm homeless status for ${selectedClaimIds.size} vehicle${selectedClaimIds.size === 1 ? '' : 's'}`
                : `Decline homeless claims for ${selectedClaimIds.size} vehicle${selectedClaimIds.size === 1 ? '' : 's'}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Selected Claims Summary */}
            <div className="p-3 bg-muted/50 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-2 block">
                Selected Claims ({selectedClaimIds.size})
              </Label>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {homelessClaims
                  .filter(c => selectedClaimIds.has(c.id))
                  .map((claim) => (
                    <div key={claim.id} className="flex items-center justify-between text-sm p-2 bg-background rounded">
                      <div>
                        <span className="font-mono font-semibold">{claim.plate_number}</span>
                        <span className="text-muted-foreground ml-2">• {claim.zone_name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{claim.officer_name}</span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Bulk Notes */}
            <div className="space-y-2">
              <Label htmlFor="bulk-notes">Admin Review Notes</Label>
              <Textarea
                id="bulk-notes"
                placeholder="Add notes that will apply to all selected claims (optional)..."
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                These notes will be applied to all {selectedClaimIds.size} selected claim{selectedClaimIds.size === 1 ? '' : 's'}
              </p>
            </div>

            {/* Impact Warning */}
            <div className={`border rounded-lg p-3 ${
              bulkAction === 'confirm'
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-red-500/10 border-red-500/20'
            }`}>
              <p className={`text-sm font-medium mb-2 ${
                bulkAction === 'confirm' ? 'text-green-600' : 'text-red-600'
              }`}>
                ⚠️ Bulk Action Impact:
              </p>
              <ul className={`text-sm space-y-1 ${
                bulkAction === 'confirm' ? 'text-green-600' : 'text-red-600'
              }`}>
                {bulkAction === 'confirm' ? (
                  <>
                    <li>• All {selectedClaimIds.size} vehicle{selectedClaimIds.size === 1 ? '' : 's'} will be marked as confirmed homeless</li>
                    <li>• May trigger different enforcement protocols for these vehicles</li>
                    <li>• This action will be recorded in audit logs</li>
                  </>
                ) : (
                  <>
                    <li>• All {selectedClaimIds.size} homeless claim{selectedClaimIds.size === 1 ? '' : 's'} will be declined</li>
                    <li>• Vehicle{selectedClaimIds.size === 1 ? '' : 's'} will be treated as standard compliance case{selectedClaimIds.size === 1 ? '' : 's'}</li>
                    <li>• This action will be recorded in audit logs</li>
                  </>
                )}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkDialog(false);
                setBulkNotes('');
              }}
              disabled={isBulkProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={bulkAction === 'confirm' ? 'default' : 'destructive'}
              onClick={handleBulkAction}
              disabled={isBulkProcessing}
            >
              {isBulkProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {bulkAction === 'confirm' ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Confirm {selectedClaimIds.size} Claim{selectedClaimIds.size === 1 ? '' : 's'}
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 mr-2" />
                      Decline {selectedClaimIds.size} Claim{selectedClaimIds.size === 1 ? '' : 's'}
                    </>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
