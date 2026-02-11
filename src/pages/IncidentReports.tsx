
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useIncidents } from '@/hooks/useIncidents';
import { useZones } from '@/hooks/useZones';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import {
  AlertOctagon,
  Plus,
  Eye,
  CheckCircle,
  XCircle,
  FileText,
  Download,
  Image as ImageIcon,
  MapPin,
  Calendar,
  User,
  Car,
  Shield,
  Loader2,
  Camera,
  Upload,
  Home,
  AlertTriangle,
  Edit,
  Trash2,
  Save,
  X as XIcon,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

export function IncidentReports() {
  const { user } = useAuthStore();
  const { data: incidents = [], isLoading, refetch } = useIncidents();
  const { data: zones = [] } = useZones();
  const { data: organizations = [] } = useOrganizations();

  const [selectedIncident, setSelectedIncident] = useState<any>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedIncident, setEditedIncident] = useState<any>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<File[]>([]);
  const [selectedZoneForGPS, setSelectedZoneForGPS] = useState<string>('');

  // Filter incidents
  const filteredIncidents = incidents.filter(incident => {
    if (filter === 'all') return true;
    if (filter === 'pending') return !incident.court_ready && !incident.approved_by;
    if (filter === 'approved') return incident.court_ready && incident.approved_by;
    if (filter === 'rejected') return incident.status === 'closed' && !incident.court_ready;
    return true;
  });

  // Update incident
  const handleUpdateIncident = async () => {
    if (!editedIncident) return;

    setIsSubmitting(true);
    try {
      let gpsLat = editedIncident.gps_latitude;
      let gpsLng = editedIncident.gps_longitude;

      // If zone changed and GPS is missing, use zone location
      if (selectedZoneForGPS) {
        const zone = zones.find(z => z.id === selectedZoneForGPS);
        if (zone?.location_lat && zone?.location_lng) {
          gpsLat = zone.location_lat;
          gpsLng = zone.location_lng;
          toast.info('GPS coordinates set from zone location');
        }
      }

      // Upload new photos if any
      const newPhotoUrls: string[] = [];
      if (uploadedPhotos.length > 0) {
        for (const photo of uploadedPhotos) {
          const fileName = `${user?.id}/${Date.now()}_${photo.name}`;
          const { error: uploadError } = await supabase.storage
            .from('incident-evidence')
            .upload(fileName, photo);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('incident-evidence')
            .getPublicUrl(fileName);

          newPhotoUrls.push(publicUrl);
        }
      }

      // Merge existing and new photos
      const allPhotos = [...(editedIncident.photos || []), ...newPhotoUrls];

      const { error } = await supabase
        .from('incidents')
        .update({
          incident_type: editedIncident.incident_type,
          description: editedIncident.description,
          severity: editedIncident.severity,
          zone_id: editedIncident.zone_id,
          happened_at: editedIncident.happened_at,
          gps_latitude: gpsLat,
          gps_longitude: gpsLng,
          photos: allPhotos,
          evidence_notes: editedIncident.evidence_notes,
          homeless_status: editedIncident.homeless_status,
          hs_issues: editedIncident.hs_issues,
        })
        .eq('id', editedIncident.id);

      if (error) throw error;

      toast.success('Incident updated successfully');
      setIsEditMode(false);
      setEditedIncident(null);
      setUploadedPhotos([]);
      setSelectedZoneForGPS('');
      setSelectedIncident({ ...editedIncident, gps_latitude: gpsLat, gps_longitude: gpsLng, photos: allPhotos });
      refetch();
    } catch (error: any) {
      console.error('Failed to update incident:', error);
      toast.error('Failed to update incident: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete incident
  const handleDeleteIncident = async () => {
    if (!selectedIncident || !window.confirm('Are you sure you want to delete this incident? This action cannot be undone.')) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('incidents')
        .delete()
        .eq('id', selectedIncident.id);

      if (error) throw error;

      toast.success('Incident deleted successfully');
      setShowApprovalDialog(false);
      setSelectedIncident(null);
      refetch();
    } catch (error: any) {
      console.error('Failed to delete incident:', error);
      toast.error('Failed to delete incident: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Approve incident for court
  const handleApprove = async (courtReady: boolean = true) => {
    if (!selectedIncident) return;

    // Validate GPS coordinates before court approval (skip for info-only)
    if (courtReady && (!selectedIncident.gps_latitude || !selectedIncident.gps_longitude)) {
      toast.error('Cannot approve for court use - GPS coordinates are missing.');
      return;
    }

    // Validate photos before court approval (skip for info-only)
    if (courtReady && (!selectedIncident.photos || selectedIncident.photos.length === 0)) {
      toast.error('Cannot approve for court use - at least one photo is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('incidents')
        .update({
          court_ready: courtReady,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          status: courtReady ? 'resolved' : 'open',
        })
        .eq('id', selectedIncident.id);

      if (error) throw error;

      toast.success(
        courtReady
          ? '✅ Incident approved for court use. Officer has been notified.'
          : '✅ Incident approved as information only (not court-ready).',
        { duration: 5000 }
      );
      setShowApprovalDialog(false);
      setSelectedIncident(null);
      refetch();
    } catch (error: any) {
      console.error('Failed to approve incident:', error);
      toast.error('Failed to approve incident: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    const csvData = [
      [
        'ID',
        'Type',
        'Description',
        'Severity',
        'Zone',
        'Status',
        'Court Ready',
        'Photos',
        'GPS Lat',
        'GPS Lng',
        'Happened At',
        'Reported By',
        'Created At',
      ],
      ...filteredIncidents.map(i => [
        i.id,
        i.incident_type,
        i.description,
        i.severity,
        i.zone?.name || '',
        i.status,
        i.court_ready ? 'Yes' : 'No',
        i.photos?.length || 0,
        i.gps_latitude || '',
        i.gps_longitude || '',
        i.happened_at ? new Date(i.happened_at).toLocaleString('en-NZ') : '',
        i.user?.email || '',
        new Date(i.created_at).toLocaleString('en-NZ'),
      ])
    ];

    const csv = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incident-reports-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Report exported to CSV');
  };

  const isMasterOrAdmin = user?.role === 'master' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <AlertOctagon className="h-7 w-7 text-primary" />
            Incident Reports
          </h2>
          <p className="text-muted-foreground">
            Court-ready incident documentation with evidence integrity
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportToCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All Reports
            </Button>
            <Button
              variant={filter === 'pending' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('pending')}
            >
              Pending Approval
            </Button>
            <Button
              variant={filter === 'approved' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('approved')}
            >
              Court Ready
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Incidents List */}
      <div className="grid gap-4">
        {isLoading ? (
          <div className="text-center py-12">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-3" />
            <p className="text-muted-foreground">Loading incidents...</p>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="text-center py-12">
              <AlertOctagon className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="font-medium mb-1">No incidents found</p>
              <p className="text-sm text-muted-foreground">Create your first incident report to get started</p>
            </CardContent>
          </Card>
        ) : (
          filteredIncidents.map(incident => (
            <Card key={incident.id} className="border-border">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">{incident.incident_type}</Badge>
                      <Badge variant={incident.severity === 'high' ? 'destructive' : 'secondary'}>
                        {incident.severity}
                      </Badge>
                      {incident.court_ready && (
                        <Badge className="bg-green-500 text-white">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Court Ready
                        </Badge>
                      )}
                    </div>
                    <p className="font-semibold mb-1">{incident.description}</p>
                    <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mt-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        {incident.zone?.name}
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {incident.happened_at ? new Date(incident.happened_at).toLocaleString('en-NZ') : 'N/A'}
                      </div>
                      <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4" />
                        {incident.photos?.length || 0} photos
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {incident.user?.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedIncident(incident);
                        setShowApprovalDialog(true);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Approval Dialog */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{isEditMode ? 'Edit Incident' : 'Incident Details'}</span>
              {!isEditMode && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditMode(true);
                      setEditedIncident({ ...selectedIncident });
                      setSelectedZoneForGPS(selectedIncident.zone_id);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteIncident}
                    disabled={isSubmitting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              )}
            </DialogTitle>
            <DialogDescription>
              {isEditMode ? 'Update incident details and evidence' : 'Review and approve for court use'}
            </DialogDescription>
          </DialogHeader>

          {selectedIncident && (isEditMode ? (
            <div className="space-y-4 py-2">
              {/* Edit Mode */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Incident Type *</Label>
                  <Select
                    value={editedIncident.incident_type}
                    onValueChange={v => setEditedIncident({ ...editedIncident, incident_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="other">Other</SelectItem>
                      <SelectItem value="VERBAL_WARNING">Verbal Warning</SelectItem>
                      <SelectItem value="WARNING_NOTICE">Warning Notice</SelectItem>
                      <SelectItem value="TRESPASS">Trespass</SelectItem>
                      <SelectItem value="FINE">Fine</SelectItem>
                      <SelectItem value="TOWED">Towed</SelectItem>
                      <SelectItem value="THEFT">Theft</SelectItem>
                      <SelectItem value="VANDALISM">Vandalism</SelectItem>
                      <SelectItem value="ASSAULT">Assault</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Severity *</Label>
                  <Select
                    value={editedIncident.severity}
                    onValueChange={v => setEditedIncident({ ...editedIncident, severity: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Zone *</Label>
                <Select
                  value={editedIncident.zone_id}
                  onValueChange={v => {
                    setEditedIncident({ ...editedIncident, zone_id: v });
                    setSelectedZoneForGPS(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(zone => (
                      <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedZoneForGPS && zones.find(z => z.id === selectedZoneForGPS)?.location_lat && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    GPS will be set from zone location when saved
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Description *</Label>
                <Textarea
                  value={editedIncident.description}
                  onChange={e => setEditedIncident({ ...editedIncident, description: e.target.value })}
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label>Date/Time of Incident *</Label>
                <Input
                  type="datetime-local"
                  value={editedIncident.happened_at ? new Date(editedIncident.happened_at).toISOString().slice(0, 16) : ''}
                  onChange={e => setEditedIncident({ ...editedIncident, happened_at: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>GPS Coordinates</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="Latitude"
                    value={editedIncident.gps_latitude || ''}
                    onChange={e => setEditedIncident({ ...editedIncident, gps_latitude: parseFloat(e.target.value) })}
                  />
                  <Input
                    type="number"
                    step="0.000001"
                    placeholder="Longitude"
                    value={editedIncident.gps_longitude || ''}
                    onChange={e => setEditedIncident({ ...editedIncident, gps_longitude: parseFloat(e.target.value) })}
                  />
                </div>
                {(!editedIncident.gps_latitude || !editedIncident.gps_longitude) && selectedZoneForGPS && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Missing GPS - will auto-fill from zone location on save
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Photos {editedIncident.photos?.length > 0 ? `(${editedIncident.photos.length} existing)` : '(none)'}</Label>
                <div className="border-2 border-dashed border-border rounded-lg p-4">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={e => setUploadedPhotos(Array.from(e.target.files || []))}
                    className="hidden"
                    id="edit-photo-upload"
                  />
                  <label
                    htmlFor="edit-photo-upload"
                    className="flex flex-col items-center gap-2 cursor-pointer"
                  >
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {uploadedPhotos.length > 0 ? `${uploadedPhotos.length} new photo(s) selected` : 'Click to upload additional photos'}
                    </p>
                  </label>
                </div>
                {(!editedIncident.photos || editedIncident.photos.length === 0) && uploadedPhotos.length === 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Photos are optional for info-only incidents
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Evidence Notes</Label>
                <Textarea
                  value={editedIncident.evidence_notes || ''}
                  onChange={e => setEditedIncident({ ...editedIncident, evidence_notes: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditMode(false);
                    setEditedIncident(null);
                    setUploadedPhotos([]);
                    setSelectedZoneForGPS('');
                  }}
                  disabled={isSubmitting}
                >
                  <XIcon className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateIncident}
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="font-semibold">{selectedIncident.incident_type}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Severity</Label>
                  <Badge variant={selectedIncident.severity === 'high' ? 'destructive' : 'secondary'}>
                    {selectedIncident.severity}
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground">Zone</Label>
                  <p>{selectedIncident.zone?.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Happened At</Label>
                  <p>{selectedIncident.happened_at ? new Date(selectedIncident.happened_at).toLocaleString('en-NZ') : 'N/A'}</p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p>{selectedIncident.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">GPS Coordinates</Label>
                  {selectedIncident.gps_latitude && selectedIncident.gps_longitude ? (
                    <p className="font-mono text-sm">
                      {selectedIncident.gps_latitude?.toFixed(6)}, {selectedIncident.gps_longitude?.toFixed(6)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">-</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Photos</Label>
                  <p>{selectedIncident.photos?.length || 0} attached</p>
                </div>
              </div>

              {selectedIncident.evidence_notes && (
                <div>
                  <Label className="text-muted-foreground">Evidence Notes</Label>
                  <p className="text-sm">{selectedIncident.evidence_notes}</p>
                </div>
              )}

              {/* GPS/Photo Validation Warnings */}
              {(!selectedIncident.gps_latitude || !selectedIncident.gps_longitude) && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-red-500 mb-1">
                    <XCircle className="h-5 w-5" />
                    <p className="font-semibold">Missing GPS Coordinates</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This incident cannot be approved for court use because GPS coordinates are missing.
                    The incident must be recreated with valid GPS location data.
                  </p>
                </div>
              )}

              {(!selectedIncident.photos || selectedIncident.photos.length === 0) && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-red-500 mb-1">
                    <XCircle className="h-5 w-5" />
                    <p className="font-semibold">Missing Photos</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This incident cannot be approved for court use because no photos are attached.
                    Court-ready incidents require at least one photo for evidence integrity.
                  </p>
                </div>
              )}

              {selectedIncident.court_ready && (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-green-500 mb-1">
                    <CheckCircle className="h-5 w-5" />
                    <p className="font-semibold">Court Ready</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Approved by {selectedIncident.user?.email} on{' '}
                    {selectedIncident.approved_at ? new Date(selectedIncident.approved_at).toLocaleString('en-NZ') : ''}
                  </p>
                </div>
              )}
            </div>
          ))}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>
              Close
            </Button>
            {isMasterOrAdmin && selectedIncident && !selectedIncident.court_ready && !isEditMode && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleApprove(false)}
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Info className="h-4 w-4 mr-2" />
                  Approve as Info Only
                </Button>
                <Button
                  onClick={() => handleApprove(true)}
                  disabled={
                    isSubmitting ||
                    !selectedIncident.gps_latitude ||
                    !selectedIncident.gps_longitude ||
                    !selectedIncident.photos ||
                    selectedIncident.photos.length === 0
                  }
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Shield className="h-4 w-4 mr-2" />
                  Approve for Court
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
