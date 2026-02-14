import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { MultiPhotoUpload } from '@/components/features/MultiPhotoUpload';
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
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useFlaggedVehicles } from '@/hooks/useFlaggedVehicles';
import { VehicleCard } from '@/components/features/VehicleCard';

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
    photos: [] as string[],
  });
  
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);

  // Handle photo change with ALPR + AI analysis on first photo
  const handleCreatePhotosChange = async (photos: string[]) => {
    const previousCount = formData.photos.length;
    setFormData(prev => ({ ...prev, photos }));
    
    // If this is the first photo being added, trigger ALPR + analysis
    if (previousCount === 0 && photos.length === 1) {
      await analyzeFirstPhoto(photos[0]);
    }
  };
  
  // ALPR + AI analysis for first photo (same workflow as field officer)
  const analyzeFirstPhoto = async (photoUrl: string) => {
    setIsAnalyzingPhoto(true);
    toast.info('🤖 ALPR recognizing plate number...');
    
    try {
      // Step 1: ALPR - Recognize plate number from photo
      const { data: alprData, error: alprError } = await supabase.functions.invoke('recognize-plate', {
        body: { photoUrl },
      });
      
      if (alprError) throw alprError;
      
      const recognizedPlate = alprData?.results?.[0]?.plate?.toUpperCase().trim();
      
      if (!recognizedPlate) {
        toast.warning('Could not recognize plate number from photo - please enter manually');
        return;
      }
      
      toast.success(`✅ Plate recognized: ${recognizedPlate}`);
      
      // Step 2: Search canonical_vehicles for existing record
      const { data: canonical, error: canonicalError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', recognizedPlate)
        .maybeSingle();
      
      if (canonicalError && canonicalError.code !== 'PGRST116') {
        throw canonicalError;
      }
      
      if (canonical) {
        // Found existing canonical record - auto-populate all fields
        toast.success('✅ Found existing vehicle record - auto-populating details');
        
        const vehicleDesc = [
          canonical.vehicle_color,
          canonical.vehicle_year,
          canonical.vehicle_make,
          canonical.vehicle_model,
        ].filter(Boolean).join(' ');
        
        setFormData(prev => ({
          ...prev,
          plate_number: recognizedPlate,
          vehicle_description: vehicleDesc || prev.vehicle_description,
          priority: canonical.is_flagged ? 'high' : 'medium',
          confirmed_homeless: canonical.homeless_status === 'confirmed',
          notes: canonical.is_flagged 
            ? `Previously flagged: ${canonical.flagged_reason || 'No reason specified'}` 
            : prev.notes,
        }));
      } else {
        // No canonical record - use AI analysis like field officer workflow
        toast.info('No existing record - using AI to analyze vehicle details');
        setFormData(prev => ({ ...prev, plate_number: recognizedPlate }));
        await analyzeVehicleDetails(recognizedPlate, photoUrl);
      }
      
    } catch (error: any) {
      console.error('ALPR/Analysis failed:', error);
      toast.error('Failed to process photo: ' + error.message);
    } finally {
      setIsAnalyzingPhoto(false);
    }
  };
  
  // Vehicle AI analysis helper (extract make/model/color from photo)
  const analyzeVehicleDetails = async (plateNumber: string, photoUrl: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber: plateNumber.toUpperCase().trim(),
          photoUrl,
        },
      });
      
      if (error) throw error;
      
      if (data?.analysis) {
        const analysis = data.analysis;
        
        const vehicleDesc = [
          analysis.color,
          analysis.year,
          analysis.make,
          analysis.model,
        ].filter(Boolean).join(' ');
        
        setFormData(prev => ({
          ...prev,
          vehicle_description: vehicleDesc || prev.vehicle_description,
          priority: analysis.has_green_sticker || analysis.has_blue_sticker ? 'low' : prev.priority,
        }));
        
        toast.success(`✅ AI detected: ${vehicleDesc || 'Vehicle details'}`);
      }
    } catch (error: any) {
      console.error('AI analysis failed:', error);
      toast.error('AI analysis failed: ' + error.message);
    }
  };
  
  const handleCreate = async () => {
    if (!formData.plate_number) {
      toast.error('Please enter a plate number');
      return;
    }

    try {
      // Create flagged vehicle record with photos
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
        attachments: formData.photos.length > 0 ? formData.photos.map(url => ({ url, type: 'photo' })) : null,
      });
      
      // Update canonical vehicle with flagged status
      await updateCanonicalVehicleFlagged(formData.plate_number, formData.priority, formData.notes || '');
      
      toast.success(`✅ Vehicle ${formData.plate_number} flagged successfully`);
      setIsCreateDialogOpen(false);
      setFormData({ plate_number: '', vehicle_description: '', last_known_site: '', name_contact: '', confirmed_homeless: false, priority: 'medium', notes: '', photos: [] });
    } catch (error: any) {
      console.error('Failed to create flagged vehicle:', error);
      toast.error('Failed to flag vehicle: ' + error.message);
    }
  };
  
  // Update canonical_vehicles table with flagged status
  const updateCanonicalVehicleFlagged = async (
    plateNumber: string,
    priority: string,
    reason: string
  ) => {
    try {
      const { error } = await supabase
        .from('canonical_vehicles')
        .update({
          is_flagged: true,
          flagged_priority: priority,
          flagged_reason: reason || 'Flagged by admin',
          flagged_at: new Date().toISOString(),
          flagged_by: user?.id,
        })
        .eq('plate_number', plateNumber.toUpperCase().trim());
      
      if (error) throw error;
      
      console.log('✅ Canonical vehicle flagged:', plateNumber);
    } catch (error: any) {
      console.error('Failed to update canonical vehicle:', error);
      // Don't throw - flagged_vehicles record was created successfully
      toast.warning('Vehicle flagged but canonical record update failed');
    }
  };

  const handleUpdate = async () => {
    if (!editingVehicle) return;

    try {
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
          attachments: editingVehicle.photos?.length > 0 ? editingVehicle.photos.map((url: string) => ({ url, type: 'photo' })) : null,
        },
      });
      
      // Update canonical vehicle if priority/notes changed
      if (editingVehicle.is_active) {
        await updateCanonicalVehicleFlagged(
          editingVehicle.plate_number,
          editingVehicle.priority,
          editingVehicle.notes || ''
        );
      }
      
      toast.success('Flagged vehicle updated');
      setIsEditDialogOpen(false);
      setEditingVehicle(null);
    } catch (error: any) {
      console.error('Failed to update flagged vehicle:', error);
      toast.error('Failed to update: ' + error.message);
    }
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
                        <VehicleCard
                          plateNumber={vehicle.plate_number}
                          vehicleColor={vehicle.vehicle_description?.split(' ')[0]}
                          vehicleYear={parseInt(vehicle.vehicle_description?.split(' ')[1] || '0') || undefined}
                          vehicleMake={vehicle.vehicle_description?.split(' ')[2]}
                          vehicleModel={vehicle.vehicle_description?.split(' ')[3]}
                          isFlagged={vehicle.is_active}
                          isHomeless={vehicle.confirmed_homeless}
                          size="sm"
                          showPhoto={true}
                          showDetails={true}
                        />
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
                              // Convert attachments to photos array for editing
                              const photos = vehicle.attachments?.map((a: any) => a.url) || [];
                              setEditingVehicle({ ...vehicle, photos });
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Flag Vehicle</DialogTitle>
            <DialogDescription>Add a known problem vehicle to the watch list</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Plate Number</Label>
              <Input
                value={formData.plate_number}
                onChange={(e) => setFormData({ ...formData, plate_number: e.target.value.toUpperCase() })}
                placeholder="Will be auto-populated from first photo"
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  Evidence Photos
                  {isAnalyzingPhoto && (
                    <span className="text-xs text-blue-600 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      AI analyzing...
                    </span>
                  )}
                </Label>
                {formData.photos.length === 0 && (
                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                    <Sparkles className="h-3 w-3 mr-1" />
                    ALPR ready
                  </Badge>
                )}
              </div>
              <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                <MultiPhotoUpload
                  photos={formData.photos}
                  onPhotosChange={handleCreatePhotosChange}
                  maxPhotos={5}
                  label=""
                />
              </div>
              {formData.photos.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  💡 First photo will auto-recognize plate number with ALPR + search canonical records
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Flag Vehicle</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsEditDialogOpen(false);
          setEditingVehicle(null);
        } else {
          setIsEditDialogOpen(true);
        }
      }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
              <div className="space-y-2">
                <Label>Evidence Photos</Label>
                <MultiPhotoUpload
                  photos={editingVehicle.photos || []}
                  onPhotosChange={(photos) => setEditingVehicle({ ...editingVehicle, photos })}
                  maxPhotos={5}
                  label=""
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
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
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
              
              {/* View Photos */}
              {viewingVehicle.attachments && viewingVehicle.attachments.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Evidence Photos ({viewingVehicle.attachments.length})</Label>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {viewingVehicle.attachments.map((attachment: any, index: number) => (
                      <img
                        key={index}
                        src={attachment.url}
                        alt={`Photo ${index + 1}`}
                        className="w-full h-24 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => window.open(attachment.url, '_blank')}
                      />
                    ))}
                  </div>
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
