/**
 * UNIVERSAL FILTERS COMPONENT
 * Reusable organization and zone filters for all pages
 * 
 * Features:
 * - Organization selector (master users only)
 * - Zone selector (admin + master users)
 * - Auto-loads based on user role and permissions
 * - Cascading filters (zone list updates when org changes)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, Building2, MapPin, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

interface UniversalFiltersProps {
  selectedOrganization: string;
  selectedZone: string;
  onOrganizationChange: (orgId: string) => void;
  onZoneChange: (zoneId: string) => void;
  showCard?: boolean;
  className?: string;
}

export function UniversalFilters({
  selectedOrganization,
  selectedZone,
  onOrganizationChange,
  onZoneChange,
  showCard = true,
  className = '',
}: UniversalFiltersProps) {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';
  const isAdminOrMaster = user?.role === 'admin' || user?.role === 'master';

  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [isLoadingZones, setIsLoadingZones] = useState(false);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [zones, setZones] = useState<Array<{ id: string; name: string }>>([]);

  // Load organizations (master only)
  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  // Load zones when organization changes
  useEffect(() => {
    if (isAdminOrMaster) {
      loadZones();
    }
  }, [selectedOrganization, isAdminOrMaster]);

  const loadOrganizations = async () => {
    setIsLoadingOrgs(true);
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    } finally {
      setIsLoadingOrgs(false);
    }
  };

  const loadZones = async () => {
    setIsLoadingZones(true);
    try {
      let query = supabase
        .from('zones')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      // Filter by organization
      if (isMaster && selectedOrganization !== 'all') {
        query = query.eq('organization_id', selectedOrganization);
      } else if (!isMaster && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setZones(data || []);

      // Reset zone selection if current zone not in new list
      if (selectedZone !== 'all' && !data?.find(z => z.id === selectedZone)) {
        onZoneChange('all');
      }
    } catch (error: any) {
      console.error('Failed to load zones:', error);
      toast.error('Failed to load zones');
    } finally {
      setIsLoadingZones(false);
    }
  };

  const FilterContent = () => (
    <div className={`grid grid-cols-1 ${isMaster ? 'md:grid-cols-2' : 'md:grid-cols-1'} gap-4`}>
      {/* Organization Selector - Master Only */}
      {isMaster && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <Building2 className="h-4 w-4 text-blue-600" />
            Organization
          </Label>
          <Select 
            value={selectedOrganization} 
            onValueChange={onOrganizationChange}
            disabled={isLoadingOrgs}
          >
            <SelectTrigger className="border-2">
              <SelectValue>
                {isLoadingOrgs ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  selectedOrganization === 'all' 
                    ? 'All Organizations' 
                    : organizations.find(o => o.id === selectedOrganization)?.name || 'Select Organization'
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
              {organizations.map(org => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Zone Selector - Admin + Master */}
      {isAdminOrMaster && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <MapPin className="h-4 w-4 text-green-600" />
            Zone
          </Label>
          <Select 
            value={selectedZone} 
            onValueChange={onZoneChange}
            disabled={isLoadingZones}
          >
            <SelectTrigger className="border-2">
              <SelectValue>
                {isLoadingZones ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  selectedZone === 'all' 
                    ? 'All Zones' 
                    : zones.find(z => z.id === selectedZone)?.name || 'Select Zone'
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Zones</SelectItem>
              {zones.map(zone => (
                <SelectItem key={zone.id} value={zone.id}>
                  {zone.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );

  if (!isAdminOrMaster) {
    // Don't show filters for regular officers
    return null;
  }

  if (showCard) {
    return (
      <Card className={`border-2 border-blue-500/30 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40 ${className}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
            <Filter className="h-4 w-4" />
            Universal Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FilterContent />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={className}>
      <FilterContent />
    </div>
  );
}
