/**
 * OrganizationSelector - Reusable organization filter for master users
 * Shows "All Organizations" option + list of all organizations
 * Only visible to master users
 */

import { useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

interface Organization {
  id: string;
  name: string;
}

interface OrganizationSelectorProps {
  selectedOrg: string;
  onOrgChange: (orgId: string) => void;
  organizations: Organization[];
  setOrganizations: (orgs: Organization[]) => void;
  label?: string;
  showLabel?: boolean;
}

export function OrganizationSelector({
  selectedOrg,
  onOrgChange,
  organizations,
  setOrganizations,
  label = 'Organization',
  showLabel = true,
}: OrganizationSelectorProps) {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  const loadOrganizations = async () => {
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
    }
  };

  // Don't render if not master user
  if (!isMaster) {
    return null;
  }

  return (
    <div className="space-y-2">
      {showLabel && (
        <Label 
          htmlFor="organization-selector" 
          className="text-gray-700 dark:text-gray-200 font-semibold flex items-center gap-2"
        >
          <Building2 className="h-4 w-4" />
          {label}
        </Label>
      )}
      <Select value={selectedOrg} onValueChange={onOrgChange}>
        <SelectTrigger 
          id="organization-selector" 
          className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-600" />
              <span>All Organizations</span>
            </div>
          </SelectItem>
          {organizations.map(org => (
            <SelectItem key={org.id} value={org.id}>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-gray-500" />
                <span>{org.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
