import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  Car,
  Eye,
  Loader2,
  Search,
  MapPin,
  Clock,
  ShieldAlert,
  AlertTriangle,
  Edit2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { usePlateScans } from '@/hooks/usePlateScans';
import { useAuthStore } from '@/stores/authStore';

export function OfficerScanReport() {
  const { user } = useAuthStore();
  const { data: scans = [], isLoading, updatePlateScan, deletePlateScan } = usePlateScans();

  console.log('🔍 [OFFICER SCAN REPORT] Loaded:', {
    total_scans: scans.length,
    user_scans: scans.filter(s => s.scanned_by === user?.id).length,
    user_id: user?.id
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedScan, setSelectedScan] = useState<any>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const myScans = scans.filter(scan => scan.scanned_by === user?.id);

  const filteredScans = myScans.filter(scan => {
    const matchesSearch = 
      scan.plate_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scan.zone?.name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const handleViewDetails = (scan: any) => {
    setSelectedScan(scan);
    setShowDetailDialog(true);
  };

  const handleEdit = (scan: any) => {
    setSelectedScan(scan);
    setEditNotes(scan.review_notes || '');
    setShowEditDialog(true);
  };

  const submitEdit = async () => {
    if (!selectedScan) return;

    setIsProcessing(true);
    try {
      await updatePlateScan(selectedScan.id, {
        review_notes: editNotes,
      });

      toast.success('Scan updated');
      setShowEditDialog(false);
      setSelectedScan(null);
      setEditNotes('');
    } catch (error) {
      toast.error('Failed to update scan');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (scanId: string) => {
    if (!confirm('Delete this scan? This cannot be undone.')) return;

    try {
      await deletePlateScan(scanId);
    } catch (error) {
      // Error already handled in hook
    }
  };

  const unreviewedCount = myScans.filter(s => !s.reviewed).length;
  const reviewedCount = myScans.filter(s => s.reviewed).length;
  const flaggedCount = myScans.filter(s => s.flagged_vehicle_detected).length;

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
        <h2 className="text-2xl font-bold mb-1">My Scan Report</h2>
        <p className="text-muted-foreground">
          View and manage your plate scans from driving mode
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Car className="h-4 w-4 text-primary" />
              Total Scans
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{myScans.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-500">{unreviewedCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              Flagged Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{flaggedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Scans List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <CardTitle className="text-base">My Scans</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search plates or zones..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
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
                          {!scan.reviewed ? (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                              Pending
                            </Badge>
                          ) : (
                            <Badge variant="default">Reviewed</Badge>
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
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewDetails(scan)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {!scan.reviewed && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEdit(scan)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-500 hover:text-red-600"
                              onClick={() => handleDelete(scan.id)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </>
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

                    {scan.reviewed && scan.review_action && (
                      <div className="mt-3 p-2 bg-muted/30 rounded text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          {scan.review_action === 'approved' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                          {scan.review_action === 'rejected' && <XCircle className="h-4 w-4 text-red-500" />}
                          {scan.review_action === 'needs_followup' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                          <p className="font-medium">
                            {scan.review_action === 'approved' && 'Approved'}
                            {scan.review_action === 'rejected' && 'Rejected'}
                            {scan.review_action === 'needs_followup' && 'Needs Follow-up'}
                          </p>
                        </div>
                        {scan.review_notes && (
                          <p className="text-muted-foreground">{scan.review_notes}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Scan Details: {selectedScan?.plate_number}</DialogTitle>
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
                <p className="text-muted-foreground">Scanned At</p>
                <p className="font-medium">
                  {selectedScan?.scanned_at && new Date(selectedScan.scanned_at).toLocaleString('en-NZ')}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">AI Confidence</p>
                <p className="font-medium">{selectedScan?.confidence_score ? `${(selectedScan.confidence_score * 100).toFixed(0)}%` : 'N/A'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium">{selectedScan?.reviewed ? 'Reviewed' : 'Pending Review'}</p>
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

            {selectedScan?.review_notes && (
              <div className="p-3 bg-muted/30 rounded">
                <p className="text-sm font-medium mb-1">Notes</p>
                <p className="text-sm">{selectedScan.review_notes}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setShowDetailDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Scan Notes</DialogTitle>
            <DialogDescription>
              Add or update notes for this scan
            </DialogDescription>
          </DialogHeader>

          <div>
            <Textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Add notes about this scan..."
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
