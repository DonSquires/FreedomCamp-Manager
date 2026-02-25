import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Car,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Eye,
  Loader2,
  Search,
  Filter,
  MapPin,
  User,
  Clock,
  ShieldAlert,
  FileText,
} from 'lucide-react';
import { usePlateScans } from '@/hooks/usePlateScans';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

export function BulkScanReview() {
  const { user } = useAuthStore();
  const { data: scans, isLoading, updatePlateScan } = usePlateScans();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unreviewed' | 'flagged' | 'breach'>('unreviewed');
  const [selectedScan, setSelectedScan] = useState<any>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected' | 'needs_followup'>('approved');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  const filteredScans = scans.filter(scan => {
    // Search filter
    const matchesSearch = 
      scan.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scan.zone?.name.toLowerCase().includes(searchQuery.toLowerCase());

    // Mode filter
    let matchesFilter = true;
    if (filterMode === 'unreviewed') matchesFilter = !scan.reviewed;
    if (filterMode === 'flagged') matchesFilter = scan.flagged_vehicle_detected;
    if (filterMode === 'breach') matchesFilter = scan.breach_detected;

    return matchesSearch && matchesFilter;
  });

  const handleReview = (scan: any) => {
    setSelectedScan(scan);
    setReviewNotes(scan.review_notes || '');
    setReviewAction(scan.review_action || 'approved');
    setShowReviewDialog(true);
  };

  const submitReview = async () => {
    if (!selectedScan) return;

    setIsProcessing(true);
    try {
      await updatePlateScan(selectedScan.id, {
        reviewed: true,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
        review_action: reviewAction,
      });

      toast.success('Review saved');
      setShowReviewDialog(false);
      setSelectedScan(null);
      setReviewNotes('');
    } catch (error) {
      toast.error('Failed to save review');
    } finally {
      setIsProcessing(false);
    }
  };

  const convertToVehicleRecord = async () => {
    if (!selectedScan) return;

    setIsProcessing(true);
    try {
      // Create vehicle observation
      const { data: vehicleRecord, error: vehicleError } = await supabase
        .from('observations')
        .insert({
          organization_id: selectedScan.organization_id,
          zone_id: selectedScan.zone_id,
          plate_number: selectedScan.plate_number,
          recorded_by: selectedScan.scanned_by,
          recorded_at: selectedScan.scanned_at,
          gps_latitude: selectedScan.gps_latitude,
          gps_longitude: selectedScan.gps_longitude,
          vehicle_make: selectedScan.ai_vehicle_make,
          vehicle_model: selectedScan.ai_vehicle_model,
          vehicle_color: selectedScan.ai_vehicle_color,
          self_contained: selectedScan.ai_likely_self_contained,
          is_compliant: !selectedScan.breach_detected,
          officer_notes: `Converted from bulk scan. ${selectedScan.violation_summary || ''}`,
        })
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      // Update plate scan
      await updatePlateScan(selectedScan.id, {
        converted_to_record: true,
        vehicle_record_id: vehicleRecord.observation_id,
        reviewed: true,
        reviewed_by: user?.id,
        reviewed_at: new Date().toISOString(),
        review_action: 'approved',
      });

      toast.success('Converted to vehicle record');
      setShowConvertDialog(false);
      setSelectedScan(null);
    } catch (error: any) {
      console.error('Failed to convert scan:', error);
      toast.error('Failed to convert scan');
    } finally {
      setIsProcessing(false);
    }
  };

  const unreviewedCount = scans.filter(s => !s.reviewed).length;
  const flaggedCount = scans.filter(s => s.flagged_vehicle_detected).length;
  const breachCount = scans.filter(s => s.breach_detected).length;

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">Admin Access Required</h3>
        <p className="text-muted-foreground">
          Only administrators can review bulk scans.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold mb-1">Bulk Scan Review</h2>
        <p className="text-muted-foreground">
          Review plate scans from driving mode before converting to vehicle records
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Unreviewed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{unreviewedCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              Flagged Vehicles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{flaggedCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Breaches Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">{breachCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle className="text-base">Scans</CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search plates or zones..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filterMode} onValueChange={(value: any) => setFilterMode(value)}>
                <SelectTrigger className="w-40">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Scans</SelectItem>
                  <SelectItem value="unreviewed">Unreviewed</SelectItem>
                  <SelectItem value="flagged">Flagged</SelectItem>
                  <SelectItem value="breach">Breaches</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredScans.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No scans found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredScans.map((scan) => (
                <Card key={scan.id} className={`${scan.flagged_vehicle_detected ? 'border-red-500/50 bg-red-500/5' : scan.breach_detected ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-lg">{scan.plate_number}</p>
                          {!scan.reviewed && (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                              Needs Review
                            </Badge>
                          )}
                          {scan.flagged_vehicle_detected && (
                            <Badge variant="destructive">Flagged</Badge>
                          )}
                          {scan.breach_detected && (
                            <Badge variant="outline" className="border-orange-500/50 text-orange-500">
                              Breach
                            </Badge>
                          )}
                          {scan.converted_to_record && (
                            <Badge variant="default">Converted</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {scan.zone?.name || 'Unknown Zone'}
                            </span>
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {scan.scanned_by_user?.first_name} {scan.scanned_by_user?.last_name}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(scan.scanned_at).toLocaleString('en-NZ', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {scan.ai_vehicle_make && (
                            <p className="text-xs">
                              <Car className="h-3 w-3 inline mr-1" />
                              {scan.ai_vehicle_make} {scan.ai_vehicle_model} ({scan.ai_vehicle_color})
                            </p>
                          )}
                          {scan.violation_summary && (
                            <p className="text-xs text-orange-600">{scan.violation_summary}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReview(scan)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          {scan.reviewed ? 'View' : 'Review'}
                        </Button>
                        {!scan.converted_to_record && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedScan(scan);
                              setShowConvertDialog(true);
                            }}
                          >
                            <FileText className="h-4 w-4 mr-1" />
                            Convert
                          </Button>
                        )}
                      </div>
                    </div>

                    {scan.scanned_photo && (
                      <div className="mt-3">
                        <img
                          src={scan.scanned_photo}
                          alt="Scanned vehicle"
                          className="w-full rounded border max-h-48 object-cover"
                        />
                      </div>
                    )}

                    {scan.reviewed && scan.review_notes && (
                      <div className="mt-3 p-2 bg-muted/30 rounded text-sm">
                        <p className="font-medium mb-1">Review Notes:</p>
                        <p className="text-muted-foreground">{scan.review_notes}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="text-muted-foreground">
                            Reviewed by {scan.reviewed_by_user?.first_name} {scan.reviewed_by_user?.last_name}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {scan.review_action}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Scan: {selectedScan?.plate_number}</DialogTitle>
            <DialogDescription>
              Review scan details and take action
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {selectedScan?.scanned_photo && (
              <div>
                <img
                  src={selectedScan.scanned_photo}
                  alt="Scanned vehicle"
                  className="w-full rounded border"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Zone</p>
                <p className="font-medium">{selectedScan?.zone?.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Scanned By</p>
                <p className="font-medium">
                  {selectedScan?.scanned_by_user?.first_name} {selectedScan?.scanned_by_user?.last_name}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Scanned At</p>
                <p className="font-medium">
                  {selectedScan?.scanned_at && new Date(selectedScan.scanned_at).toLocaleString('en-NZ')}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">AI Confidence</p>
                <p className="font-medium">{selectedScan?.confidence_score ? `${(selectedScan.confidence_score * 100).toFixed(0)}%` : 'N/A'}</p>
              </div>
            </div>

            {selectedScan?.ai_vehicle_make && (
              <div className="p-3 bg-muted/30 rounded">
                <p className="text-sm font-medium mb-1">AI Detection</p>
                <p className="text-sm">
                  {selectedScan.ai_vehicle_make} {selectedScan.ai_vehicle_model} ({selectedScan.ai_vehicle_color})
                </p>
                {selectedScan.ai_likely_self_contained && (
                  <p className="text-sm text-green-600 mt-1">✓ Likely self-contained</p>
                )}
              </div>
            )}

            {selectedScan?.violation_summary && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                <p className="text-sm font-medium mb-1 text-amber-600">Violation Detected</p>
                <p className="text-sm">{selectedScan.violation_summary}</p>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Action</label>
                <Select value={reviewAction} onValueChange={(value: any) => setReviewAction(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        Approve
                      </div>
                    </SelectItem>
                    <SelectItem value="rejected">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-500" />
                        Reject
                      </div>
                    </SelectItem>
                    <SelectItem value="needs_followup">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        Needs Follow-up
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Review Notes</label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add review notes..."
                  rows={3}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={submitReview} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Review'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <AlertDialog open={showConvertDialog} onOpenChange={setShowConvertDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to Vehicle Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a full vehicle record from this scan and mark it as reviewed.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={convertToVehicleRecord} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Converting...
                </>
              ) : (
                'Convert to Record'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
