import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  AlertOctagon,
  Edit,
  Trash2,
  Plus,
  MapPin,
  Building2,
  Clock,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useZones } from '@/hooks/useZones';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useIncidents } from '@/hooks/useIncidents';

export function Incidents() {
  const { user } = useAuthStore();
  const { data: zones = [] } = useZones();
  const { data: organizations = [] } = useOrganizations();
  const { data: incidents, isLoading, createIncident, updateIncident, deleteIncident } = useIncidents(user?.role === 'master' ? 'all' : user?.organization_id);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const [editingIncident, setEditingIncident] = useState<any>(null);
  const [viewingIncident, setViewingIncident] = useState<any>(null);
  const [incidentToDelete, setIncidentToDelete] = useState<any>(null);

  const [formData, setFormData] = useState({
    zone_id: '',
    incident_type: 'vandalism' as 'vandalism' | 'theft' | 'assault' | 'harassment' | 'noise' | 'littering' | 'damage' | 'other',
    severity: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    description: '',
  });

  const handleCreate = async () => {
    if (!formData.zone_id || !formData.description) {
      toast.error('Please fill in required fields');
      return;
    }

    const zone = zones.find(z => z.id === formData.zone_id);
    
    await createIncident.mutateAsync({
      organization_id: user?.organization_id || zone?.organization_id || '',
      user_id: user?.id || '',
      zone_id: formData.zone_id,
      incident_type: formData.incident_type,
      severity: formData.severity,
      description: formData.description,
      status: 'pending',
      attachments: [],
      recorded_at: new Date().toISOString(),
    });

    setIsCreateDialogOpen(false);
    setFormData({ zone_id: '', incident_type: 'vandalism', severity: 'medium', description: '' });
  };

  const handleUpdate = async () => {
    if (!editingIncident) return;

    await updateIncident.mutateAsync({
      id: editingIncident.id,
      updates: {
        zone_id: editingIncident.zone_id,
        incident_type: editingIncident.incident_type,
        severity: editingIncident.severity,
        description: editingIncident.description,
        status: editingIncident.status,
        resolution_notes: editingIncident.resolution_notes,
      },
    });

    setIsEditDialogOpen(false);
    setEditingIncident(null);
  };

  const handleDelete = async () => {
    if (!incidentToDelete) return;
    await deleteIncident.mutateAsync(incidentToDelete.id);
    setIsDeleteDialogOpen(false);
    setIncidentToDelete(null);
  };

  const getSeverityBadge = (severity: string) => {
    const badges = {
      low: { label: 'Low', className: 'bg-blue-500/10 text-blue-500' },
      medium: { label: 'Medium', className: 'bg-amber-500/10 text-amber-600' },
      high: { label: 'High', className: 'bg-red-500/10 text-red-500' },
      critical: { label: 'Critical', className: 'bg-red-600/10 text-red-600' },
    };
    const badge = badges[severity as keyof typeof badges] || badges.medium;
    return <Badge variant="outline" className={badge.className}>{badge.label}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      pending: { label: 'Pending', className: 'bg-amber-500/10 text-amber-600' },
      investigating: { label: 'Investigating', className: 'bg-blue-500/10 text-blue-500' },
      resolved: { label: 'Resolved', className: 'bg-green-500/10 text-green-500' },
      closed: { label: 'Closed', className: 'bg-gray-500/10 text-gray-500' },
    };
    const badge = badges[status as keyof typeof badges] || badges.pending;
    return <Badge variant="outline" className={badge.className}>{badge.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Incidents</h2>
          <p className="text-muted-foreground">
            Security incidents (vandalism, theft, assault, etc.)
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Report Incident
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading incidents...</div>
            </div>
          ) : incidents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertOctagon className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No incidents reported</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Zone</TableHead>
                    {user?.role === 'master' && <TableHead>Organization</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead>Recorded At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((incident) => (
                    <TableRow
                      key={incident.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setViewingIncident(incident);
                        setIsViewDialogOpen(true);
                      }}
                    >
                      <TableCell className="capitalize font-medium">{incident.incident_type}</TableCell>
                      <TableCell>{getSeverityBadge(incident.severity)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {incident.zone?.name || '-'}
                        </div>
                      </TableCell>
                      {user?.role === 'master' && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            {incident.organization?.name || '-'}
                          </div>
                        </TableCell>
                      )}
                      <TableCell>{getStatusBadge(incident.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {new Date(incident.recorded_at).toLocaleString('en-NZ', {
                            timeZone: 'Pacific/Auckland',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingIncident({ ...incident });
                              setIsEditDialogOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIncidentToDelete(incident);
                              setIsDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Incident</DialogTitle>
            <DialogDescription>Record a security incident</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Zone *</Label>
              <Select value={formData.zone_id} onValueChange={(value) => setFormData({ ...formData, zone_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.filter(z => !z.merged_into_zone_id).map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Incident Type *</Label>
                <Select value={formData.incident_type} onValueChange={(value: any) => setFormData({ ...formData, incident_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vandalism">Vandalism</SelectItem>
                    <SelectItem value="theft">Theft</SelectItem>
                    <SelectItem value="assault">Assault</SelectItem>
                    <SelectItem value="harassment">Harassment</SelectItem>
                    <SelectItem value="noise">Noise Complaint</SelectItem>
                    <SelectItem value="littering">Littering</SelectItem>
                    <SelectItem value="damage">Property Damage</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity *</Label>
                <Select value={formData.severity} onValueChange={(value: any) => setFormData({ ...formData, severity: value })}>
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
              <Label>Description *</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
                placeholder="Describe the incident..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Report Incident</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Incident</DialogTitle>
          </DialogHeader>
          {editingIncident && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editingIncident.status} onValueChange={(value: any) => setEditingIncident({ ...editingIncident, status: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={editingIncident.severity} onValueChange={(value: any) => setEditingIncident({ ...editingIncident, severity: value })}>
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
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editingIncident.description}
                  onChange={(e) => setEditingIncident({ ...editingIncident, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Resolution Notes</Label>
                <Textarea
                  value={editingIncident.resolution_notes || ''}
                  onChange={(e) => setEditingIncident({ ...editingIncident, resolution_notes: e.target.value })}
                  rows={3}
                  placeholder="Add resolution notes..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdate}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertOctagon className="h-5 w-5" />
              Incident Details
            </DialogTitle>
          </DialogHeader>
          {viewingIncident && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <p className="text-sm font-medium capitalize">{viewingIncident.incident_type}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Severity</Label>
                  <div className="mt-1">{getSeverityBadge(viewingIncident.severity)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">{getStatusBadge(viewingIncident.status)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Zone</Label>
                  <p className="text-sm font-medium">{viewingIncident.zone?.name || '-'}</p>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Description</Label>
                <p className="text-sm mt-1 p-3 bg-muted/50 rounded">{viewingIncident.description}</p>
              </div>
              {viewingIncident.resolution_notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Resolution Notes</Label>
                  <p className="text-sm mt-1 p-3 bg-green-500/10 rounded">{viewingIncident.resolution_notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this incident report?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
