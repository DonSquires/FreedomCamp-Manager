import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  Flag,
  Edit,
  Trash2,
  Plus,
  Car,
  Building2,
  Home,
  MapPin,
  Calendar,
  User,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useFlaggedVehicles } from '@/hooks/useFlaggedVehicles';

export function FlaggedVehicles() {
  const { user } = useAuthStore();
  const { data: organizations = [] } = useOrganizations();
  const { data: flaggedVehicles, isLoading, createFlaggedVehicle, updateFlaggedVehicle, deleteFlaggedVehicle } = useFlaggedVehicles(user?.role === 'master' ? 'all' : user?.organization_id);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  const [editingVehicle, setEditingVehicle] = useState<any>(null);
  const [viewingVehicle, setViewingVehicle] = useState<any>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<any>(null);

  const [formData, setFormData] = useState({
    plate_number: '',
    vehicle_description: '',
    last_known_site: '',
    name_contact: '',
    confirmed_homeless: false,
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    notes: '',
  });

  const handleCreate = async () => {
    if (!formData.plate_number) {
      toast.error('Please enter a plate number');
      return;
    }

    await createFlaggedVehicle.mutateAsync({
      organization_id: user?.organization_id || '',
      created_by: user?.id || '',
      plate_number: formData.plate_number,
      vehicle_description: formData.vehicle_description || null,
      last_known_site: formData.last_known_site || null,
      name_contact: formData.name_contact || null,
      confirmed_homeless: formData.confirmed_homeless,
      priority: formData.priority,
      notes: formData.notes || null,
      is_active: true,
      date_recorded: new Date().toISOString().split('T')[0],
    });

    setIsCreateDialogOpen(false);
    setFormData({ plate_number: '', vehicle_description: '', last_known_site: '', name_contact: '', confirmed_homeless: false, priority: 'medium', notes: '' });
  };

  const handleUpdate = async () => {
    if (!editingVehicle) return;

    await updateFlaggedVehicle.mutateAsync({
      id: editingVehicle.id,
      updates: {
        plate_number: editingVehicle.plate_number,
        vehicle_description: editingVehicle.vehicle_description,
        last_known_site: editingVehicle.last_known_site,
        name_contact: editingVehicle.name_contact,
        confirmed_homeless: editingVehicle.confirmed_homeless,
        priority: editingVehicle.priority,
        is_active: editingVehicle.is_active,
        notes: editingVehicle.notes,
      },
    });

    setIsEditDialogOpen(false);
    setEditingVehicle(null);
  };

  const handleDelete = async () => {
    if (!vehicleToDelete) return;
    await deleteFlaggedVehicle.mutateAsync(vehicleToDelete.id);
    setIsDeleteDialogOpen(false);
    setVehicleToDelete(null);
  };

  const getPriorityBadge = (priority: string) => {
    const badges = {
      low: { label: 'Low', className: 'bg-blue-500/10 text-blue-500' },
      medium: { label: 'Medium', className: 'bg-amber-500/10 text-amber-600' },
      high: { label: 'High', className: 'bg-red-500/10 text-red-500' },
      urgent: { label: 'Urgent', className: 'bg-red-600/10 text-red-600' },
    };
    const badge = badges[priority as keyof typeof badges] || badges.medium;
    return <Badge variant="outline" className={badge.className}>{badge.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Flagged Vehicles</h2>
          <p className="text-muted-foreground">
            Known problem vehicles requiring attention
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Flag Vehicle
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading flagged vehicles...</div>
            </div>
          ) : flaggedVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Flag className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No flagged vehicles</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plate Number</TableHead>
                    <TableHead>Last Known Site</TableHead>
                    {user?.role === 'master' && <TableHead>Organization</TableHead>}
                    <TableHead>Priority</TableHead>
                    <TableHead>Homeless Status</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flaggedVehicles.map((vehicle) => (
                    <TableRow
                      key={vehicle.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setViewingVehicle(vehicle);
                        setIsViewDialogOpen(true);
                      }}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Car className="h-4 w-4 text-muted-foreground" />
                          {vehicle.plate_number}
                        </div>
                        {vehicle.vehicle_description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {vehicle.vehicle_description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {vehicle.last_known_site ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            {vehicle.last_known_site}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      {user?.role === 'master' && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            {vehicle.organization?.name || '-'}
                          </div>
                        </TableCell>
                      )}
                      <TableCell>{getPriorityBadge(vehicle.priority)}</TableCell>
                      <TableCell>
                        {vehicle.confirmed_homeless ? (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                            <Home className="h-3 w-3 mr-1" />
                            Confirmed Homeless
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {vehicle.is_active ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-500">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-500/10 text-gray-500">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingVehicle({ ...vehicle });
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
                              setVehicleToDelete(vehicle);
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
            <DialogTitle>Flag Vehicle</DialogTitle>
            <DialogDescription>Add a known problem vehicle to the watch list</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Plate Number *</Label>
              <Input
                value={formData.plate_number}
                onChange={(e) => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })}
                placeholder="Enter plate number"
              />
            </div>
            <div className="space-y-2">
              <Label>Vehicle Description</Label>
              <Input
                value={formData.vehicle_description}
                onChange={(e) => setFormData({ ...formData, vehicle_description: e.target.value })}
                placeholder="e.g., White Toyota Hiace"
              />
            </div>
            <div className="space-y-2">
              <Label>Last Known Site</Label>
              <Input
                value={formData.last_known_site}
                onChange={(e) => setFormData({ ...formData, last_known_site: e.target.value })}
                placeholder="e.g., Tahunanui Beach"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Name</Label>
              <Input
                value={formData.name_contact}
                onChange={(e) => setFormData({ ...formData, name_contact: e.target.value })}
                placeholder="Owner or contact name"
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={formData.priority} onValueChange={(value: any) => setFormData({ ...formData, priority: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Confirmed Homeless</Label>
              <Switch checked={formData.confirmed_homeless} onCheckedChange={(checked) => setFormData({ ...formData, confirmed_homeless: checked })} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                placeholder="Additional notes about this vehicle..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Flag Vehicle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Flagged Vehicle</DialogTitle>
          </DialogHeader>
          {editingVehicle && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Plate Number *</Label>
                <Input
                  value={editingVehicle.plate_number}
                  onChange={(e) => setEditingVehicle({ ...editingVehicle, plate_number: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="space-y-2">
                <Label>Vehicle Description</Label>
                <Input
                  value={editingVehicle.vehicle_description || ''}
                  onChange={(e) => setEditingVehicle({ ...editingVehicle, vehicle_description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Last Known Site</Label>
                <Input
                  value={editingVehicle.last_known_site || ''}
                  onChange={(e) => setEditingVehicle({ ...editingVehicle, last_known_site: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input
                  value={editingVehicle.name_contact || ''}
                  onChange={(e) => setEditingVehicle({ ...editingVehicle, name_contact: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={editingVehicle.priority} onValueChange={(value: any) => setEditingVehicle({ ...editingVehicle, priority: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Confirmed Homeless</Label>
                <Switch checked={editingVehicle.confirmed_homeless} onCheckedChange={(checked) => setEditingVehicle({ ...editingVehicle, confirmed_homeless: checked })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={editingVehicle.is_active} onCheckedChange={(checked) => setEditingVehicle({ ...editingVehicle, is_active: checked })} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editingVehicle.notes || ''}
                  onChange={(e) => setEditingVehicle({ ...editingVehicle, notes: e.target.value })}
                  rows={3}
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
              <Flag className="h-5 w-5" />
              {viewingVehicle?.plate_number}
            </DialogTitle>
          </DialogHeader>
          {viewingVehicle && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Priority</Label>
                  <div className="mt-1">{getPriorityBadge(viewingVehicle.priority)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    {viewingVehicle.is_active ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-500">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-500/10 text-gray-500">Inactive</Badge>
                    )}
                  </div>
                </div>
              </div>
              {viewingVehicle.vehicle_description && (
                <div>
                  <Label className="text-xs text-muted-foreground">Vehicle Description</Label>
                  <p className="text-sm font-medium">{viewingVehicle.vehicle_description}</p>
                </div>
              )}
              {viewingVehicle.last_known_site && (
                <div>
                  <Label className="text-xs text-muted-foreground">Last Known Site</Label>
                  <p className="text-sm font-medium">{viewingVehicle.last_known_site}</p>
                </div>
              )}
              {viewingVehicle.name_contact && (
                <div>
                  <Label className="text-xs text-muted-foreground">Contact Name</Label>
                  <p className="text-sm font-medium">{viewingVehicle.name_contact}</p>
                </div>
              )}
              {viewingVehicle.confirmed_homeless && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded">
                  <Label className="text-xs text-amber-600 font-semibold">Confirmed Homeless Status</Label>
                </div>
              )}
              {viewingVehicle.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm mt-1 p-3 bg-muted/50 rounded">{viewingVehicle.notes}</p>
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
            <AlertDialogTitle>Delete Flagged Vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{vehicleToDelete?.plate_number}</strong> from the flagged vehicles list?
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
