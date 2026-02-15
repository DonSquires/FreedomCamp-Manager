/**
 * PersonRecordsManager - Manage person records and interaction history
 * 
 * Features:
 * - List all person records with filters
 * - Create/edit person records
 * - View interaction history
 * - Link to vehicles and zones
 * - Homeless verification workflow
 * - Risk level assessment
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  User,
  Users,
  Plus,
  Search,
  Filter,
  MapPin,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  X,
  Edit,
  Eye,
  Home,
  Shield,
  FileText,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface PersonRecord {
  id: string;
  full_name: string;
  date_of_birth: string | null;
  zone_id: string;
  organization_id: string;
  tent_location_description: string | null;
  vehicle_association: string | null;
  homeless_claimed: boolean;
  homeless_confirmed: boolean;
  homeless_confirmed_by: string | null;
  homeless_confirmed_at: string | null;
  id_verified: boolean;
  freedom_camping_act_applies: boolean;
  trespass_notice_issued: boolean;
  trespass_notice_date: string | null;
  last_contact_at: string | null;
  total_interactions: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical' | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  zone_name?: string;
  vehicle_plate?: string;
}

interface PersonInteraction {
  id: string;
  interaction_type: string;
  interaction_at: string;
  officer_name: string;
  zone_name: string | null;
  officer_notes: string | null;
  outcome: string | null;
  requires_follow_up: boolean;
  photos: string[];
}

interface PersonRecordsManagerProps {
  organizationId?: string;
  zoneId?: string;
}

export function PersonRecordsManager({ organizationId, zoneId }: PersonRecordsManagerProps) {
  const [view, setView] = useState<'list' | 'detail' | 'create'>('list');
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonRecord | null>(null);
  const [interactions, setInteractions] = useState<PersonInteraction[]>([]);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterHomeless, setFilterHomeless] = useState<'all' | 'claimed' | 'confirmed'>('all');
  const [filterRisk, setFilterRisk] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all');
  const [filterFollowUp, setFilterFollowUp] = useState(false);
  
  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingInteractions, setIsLoadingInteractions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    full_name: '',
    date_of_birth: '',
    tent_location_description: '',
    homeless_claimed: false,
    homeless_confirmed: false,
    id_verified: false,
    freedom_camping_act_applies: false,
    trespass_notice_issued: false,
    trespass_notice_date: '',
    risk_level: 'low' as 'low' | 'medium' | 'high' | 'critical',
    notes: '',
  });

  useEffect(() => {
    loadPersonRecords();
  }, [organizationId, zoneId]);

  const loadPersonRecords = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('person_records')
        .select(`
          *,
          zones!inner(name)
        `)
        .order('last_contact_at', { ascending: false, nullsFirst: false });

      if (organizationId) {
        query = query.eq('organization_id', organizationId);
      }
      
      if (zoneId) {
        query = query.eq('zone_id', zoneId);
      }

      const { data, error } = await query;

      if (error) throw error;

      const mapped = (data || []).map((p: any) => ({
        ...p,
        zone_name: p.zones?.name,
        vehicle_plate: p.vehicle_association || null, // Use vehicle_association field from table
      }));

      setPersons(mapped);
    } catch (error: any) {
      console.error('Failed to load person records:', error);
      toast.error('Failed to load person records: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadPersonInteractions = async (personId: string) => {
    setIsLoadingInteractions(true);
    try {
      const { data, error } = await supabase
        .rpc('get_person_interaction_history', { p_person_id: personId });

      if (error) throw error;

      setInteractions(data || []);
    } catch (error: any) {
      console.error('Failed to load interactions:', error);
      toast.error('Failed to load interaction history');
    } finally {
      setIsLoadingInteractions(false);
    }
  };

  const handleViewPerson = (person: PersonRecord) => {
    setSelectedPerson(person);
    loadPersonInteractions(person.id);
    setView('detail');
  };

  const handleEditPerson = (person: PersonRecord) => {
    setSelectedPerson(person);
    setFormData({
      full_name: person.full_name,
      date_of_birth: person.date_of_birth || '',
      tent_location_description: person.tent_location_description || '',
      homeless_claimed: person.homeless_claimed,
      homeless_confirmed: person.homeless_confirmed,
      id_verified: person.id_verified,
      freedom_camping_act_applies: person.freedom_camping_act_applies,
      trespass_notice_issued: person.trespass_notice_issued,
      trespass_notice_date: person.trespass_notice_date || '',
      risk_level: person.risk_level || 'low',
      notes: person.notes || '',
    });
    setView('create');
  };

  const handleCreateNew = () => {
    setSelectedPerson(null);
    setFormData({
      full_name: '',
      date_of_birth: '',
      tent_location_description: '',
      homeless_claimed: false,
      homeless_confirmed: false,
      id_verified: false,
      freedom_camping_act_applies: false,
      trespass_notice_issued: false,
      trespass_notice_date: '',
      risk_level: 'low',
      notes: '',
    });
    setView('create');
  };

  const handleSave = async () => {
    if (!formData.full_name.trim()) {
      toast.error('Full name is required');
      return;
    }

    setIsSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.user.id)
        .single();

      if (!profile) throw new Error('Profile not found');

      const personData = {
        full_name: formData.full_name.trim(),
        date_of_birth: formData.date_of_birth || null,
        tent_location_description: formData.tent_location_description.trim() || null,
        homeless_claimed: formData.homeless_claimed,
        homeless_confirmed: formData.homeless_confirmed,
        homeless_confirmed_by: formData.homeless_confirmed ? user.user.id : null,
        homeless_confirmed_at: formData.homeless_confirmed ? new Date().toISOString() : null,
        id_verified: formData.id_verified,
        freedom_camping_act_applies: formData.freedom_camping_act_applies,
        trespass_notice_issued: formData.trespass_notice_issued,
        trespass_notice_date: formData.trespass_notice_date || null,
        risk_level: formData.risk_level,
        notes: formData.notes.trim() || null,
      };

      if (selectedPerson) {
        // Update existing
        const { error } = await supabase
          .from('person_records')
          .update(personData)
          .eq('id', selectedPerson.id);

        if (error) throw error;
        toast.success('Person record updated successfully');
      } else {
        // Create new
        const { error } = await supabase
          .from('person_records')
          .insert({
            ...personData,
            organization_id: organizationId || profile.organization_id,
            zone_id: zoneId,
            user_id: user.user.id,
          });

        if (error) throw error;
        toast.success('Person record created successfully');
      }

      await loadPersonRecords();
      setView('list');
    } catch (error: any) {
      console.error('Failed to save person record:', error);
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const filteredPersons = persons.filter((person) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !person.full_name.toLowerCase().includes(query) &&
        !person.tent_location_description?.toLowerCase().includes(query) &&
        !person.vehicle_plate?.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    // Homeless filter
    if (filterHomeless === 'claimed' && !person.homeless_claimed) return false;
    if (filterHomeless === 'confirmed' && !person.homeless_confirmed) return false;

    // Risk filter
    if (filterRisk !== 'all' && person.risk_level !== filterRisk) return false;

    // Follow-up filter
    if (filterFollowUp && person.total_interactions === 0) return false;

    return true;
  });

  const getRiskBadgeVariant = (risk: string | null) => {
    switch (risk) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'outline';
    }
  };

  const getInteractionTypeIcon = (type: string) => {
    switch (type) {
      case 'first_contact': return <User className="h-4 w-4" />;
      case 'welfare_check': return <Heart className="h-4 w-4" />;
      case 'incident_report': return <AlertTriangle className="h-4 w-4" />;
      case 'hs_report': return <Shield className="h-4 w-4" />;
      case 'trespass_notice': return <FileText className="h-4 w-4" />;
      case 'homeless_verification': return <Home className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  // List View
  if (view === 'list') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Person Records
              </CardTitle>
              <Button onClick={handleCreateNew}>
                <Plus className="h-4 w-4 mr-2" />
                New Person
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search and Filters */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, location, or vehicle plate..."
                  className="pl-10"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={filterHomeless === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterHomeless('all')}
                >
                  All
                </Button>
                <Button
                  variant={filterHomeless === 'claimed' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterHomeless('claimed')}
                >
                  <Home className="h-3 w-3 mr-1" />
                  Homeless Claimed
                </Button>
                <Button
                  variant={filterHomeless === 'confirmed' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterHomeless('confirmed')}
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Homeless Confirmed
                </Button>
                <Button
                  variant={filterFollowUp ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterFollowUp(!filterFollowUp)}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Requires Follow-up
                </Button>
              </div>

              <div className="flex gap-2">
                <Label className="text-sm">Risk Level:</Label>
                {['all', 'low', 'medium', 'high', 'critical'].map((level) => (
                  <Button
                    key={level}
                    variant={filterRisk === level ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilterRisk(level as any)}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Person List */}
            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Loading person records...</p>
              </div>
            ) : filteredPersons.length === 0 ? (
              <Alert>
                <User className="h-4 w-4" />
                <AlertDescription>
                  {searchQuery || filterHomeless !== 'all' || filterRisk !== 'all' || filterFollowUp
                    ? 'No person records match the current filters'
                    : 'No person records found. Create the first one to track individuals in zones.'}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-3">
                {filteredPersons.map((person) => (
                  <Card key={person.id} className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-lg">{person.full_name}</h3>
                            {person.risk_level && (
                              <Badge variant={getRiskBadgeVariant(person.risk_level)}>
                                {person.risk_level.toUpperCase()}
                              </Badge>
                            )}
                            {person.homeless_confirmed && (
                              <Badge variant="secondary">
                                <Home className="h-3 w-3 mr-1" />
                                Homeless Confirmed
                              </Badge>
                            )}
                            {person.homeless_claimed && !person.homeless_confirmed && (
                              <Badge variant="outline">
                                <Home className="h-3 w-3 mr-1" />
                                Homeless Claimed
                              </Badge>
                            )}
                            {person.id_verified && (
                              <Badge variant="secondary">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                ID Verified
                              </Badge>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-sm">
                            {person.zone_name && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                {person.zone_name}
                              </div>
                            )}
                            {person.tent_location_description && (
                              <div className="text-muted-foreground truncate">
                                📍 {person.tent_location_description}
                              </div>
                            )}
                            {person.vehicle_plate && (
                              <div className="font-mono font-bold">
                                🚗 {person.vehicle_plate}
                              </div>
                            )}
                            {person.total_interactions > 0 && (
                              <div className="flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                {person.total_interactions} interaction{person.total_interactions !== 1 ? 's' : ''}
                              </div>
                            )}
                          </div>

                          {person.last_contact_at && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              Last contact: {new Date(person.last_contact_at).toLocaleDateString('en-NZ')}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleViewPerson(person)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditPerson(person)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Detail View
  if (view === 'detail' && selectedPerson) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {selectedPerson.full_name}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => handleEditPerson(selectedPerson)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setView('list')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Person Details */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Full Name</Label>
                <p className="font-semibold">{selectedPerson.full_name}</p>
              </div>
              {selectedPerson.date_of_birth && (
                <div>
                  <Label className="text-muted-foreground">Date of Birth</Label>
                  <p>{new Date(selectedPerson.date_of_birth).toLocaleDateString('en-NZ')}</p>
                </div>
              )}
              <div>
                <Label className="text-muted-foreground">Zone</Label>
                <p className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {selectedPerson.zone_name}
                </p>
              </div>
              {selectedPerson.tent_location_description && (
                <div>
                  <Label className="text-muted-foreground">Tent/Structure Location</Label>
                  <p>{selectedPerson.tent_location_description}</p>
                </div>
              )}
            </div>

            {/* Status Badges */}
            <div className="flex flex-wrap gap-2">
              {selectedPerson.homeless_confirmed && (
                <Badge variant="secondary">
                  <Home className="h-3 w-3 mr-1" />
                  Homeless Confirmed
                </Badge>
              )}
              {selectedPerson.homeless_claimed && !selectedPerson.homeless_confirmed && (
                <Badge variant="outline">
                  <Home className="h-3 w-3 mr-1" />
                  Homeless Claimed
                </Badge>
              )}
              {selectedPerson.id_verified && (
                <Badge variant="secondary">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  ID Verified
                </Badge>
              )}
              {selectedPerson.trespass_notice_issued && (
                <Badge variant="destructive">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Trespass Notice Issued
                </Badge>
              )}
              {selectedPerson.risk_level && (
                <Badge variant={getRiskBadgeVariant(selectedPerson.risk_level)}>
                  Risk: {selectedPerson.risk_level.toUpperCase()}
                </Badge>
              )}
            </div>

            {/* Interaction History */}
            <div className="border-t pt-4">
              <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Interaction History ({selectedPerson.total_interactions})
              </h3>

              {isLoadingInteractions ? (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : interactions.length === 0 ? (
                <Alert>
                  <AlertDescription>No interactions recorded yet</AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3">
                  {interactions.map((interaction) => (
                    <Card key={interaction.id} className="bg-muted/30">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-1">
                            {getInteractionTypeIcon(interaction.interaction_type)}
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold capitalize">
                                {interaction.interaction_type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(interaction.interaction_at).toLocaleString('en-NZ')}
                              </span>
                            </div>
                            <p className="text-sm">
                              By: {interaction.officer_name}
                              {interaction.zone_name && ` • Zone: ${interaction.zone_name}`}
                            </p>
                            {interaction.officer_notes && (
                              <p className="text-sm text-muted-foreground italic">
                                "{interaction.officer_notes}"
                              </p>
                            )}
                            {interaction.outcome && (
                              <p className="text-sm">
                                <strong>Outcome:</strong> {interaction.outcome}
                              </p>
                            )}
                            {interaction.requires_follow_up && (
                              <Badge variant="destructive" className="mt-1">
                                Requires Follow-up
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Create/Edit View
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {selectedPerson ? 'Edit Person Record' : 'Create Person Record'}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={() => setView('list')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="John Doe"
            />
          </div>

          <div>
            <Label htmlFor="date_of_birth">Date of Birth</Label>
            <Input
              id="date_of_birth"
              type="date"
              value={formData.date_of_birth}
              onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="tent_location">Tent/Structure Location</Label>
            <Input
              id="tent_location"
              value={formData.tent_location_description}
              onChange={(e) => setFormData({ ...formData, tent_location_description: e.target.value })}
              placeholder="Near south carpark, blue tent"
            />
          </div>

          <div className="space-y-2">
            <Label>Status & Verification</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="homeless_claimed"
                  checked={formData.homeless_claimed}
                  onChange={(e) => setFormData({ ...formData, homeless_claimed: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="homeless_claimed" className="cursor-pointer font-normal">
                  Person claims homeless status
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="homeless_confirmed"
                  checked={formData.homeless_confirmed}
                  onChange={(e) => setFormData({ ...formData, homeless_confirmed: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="homeless_confirmed" className="cursor-pointer font-normal">
                  Homeless status confirmed (by officer)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="id_verified"
                  checked={formData.id_verified}
                  onChange={(e) => setFormData({ ...formData, id_verified: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="id_verified" className="cursor-pointer font-normal">
                  ID verified
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="freedom_camping_act"
                  checked={formData.freedom_camping_act_applies}
                  onChange={(e) => setFormData({ ...formData, freedom_camping_act_applies: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="freedom_camping_act" className="cursor-pointer font-normal">
                  Freedom Camping Act applies
                </Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Trespass Notice</Label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="trespass_notice"
                checked={formData.trespass_notice_issued}
                onChange={(e) => setFormData({ ...formData, trespass_notice_issued: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="trespass_notice" className="cursor-pointer font-normal">
                Trespass notice issued
              </Label>
            </div>
            {formData.trespass_notice_issued && (
              <Input
                type="date"
                value={formData.trespass_notice_date}
                onChange={(e) => setFormData({ ...formData, trespass_notice_date: e.target.value })}
                placeholder="Date issued"
              />
            )}
          </div>

          <div>
            <Label htmlFor="risk_level">Risk Level</Label>
            <select
              id="risk_level"
              value={formData.risk_level}
              onChange={(e) => setFormData({ ...formData, risk_level: e.target.value as any })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <Label htmlFor="notes">Officer Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes about this person..."
              rows={4}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {selectedPerson ? 'Update' : 'Create'} Record
                </>
              )}
            </Button>
            <Button variant="outline" onClick={() => setView('list')}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
