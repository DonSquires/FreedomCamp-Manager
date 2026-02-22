/**
 * Global Header Filter Ribbon
 * Date, Organization, Zone filters + Refresh button
 * All admin pages should include this component
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar as CalendarIcon, Building2, MapPin, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGlobalFilters } from '@/stores/globalFiltersStore';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface GlobalFilterRibbonProps {
  onRefresh?: () => void;
  showOrgFilter?: boolean;
  showZoneFilter?: boolean;
}

export function GlobalFilterRibbon({ 
  onRefresh, 
  showOrgFilter = true,
  showZoneFilter = true 
}: GlobalFilterRibbonProps) {
  const { user } = useAuthStore();
  const {
    dateFrom,
    dateTo,
    datePreset,
    organizationId,
    organizationName,
    zoneId,
    zoneName,
    setDateRange,
    setToday,
    setYesterday,
    setPrevDay,
    setNextDay,
    setOrganization,
    setZone,
  } = useGlobalFilters();

  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);

  // Load organizations (for masters only)
  useEffect(() => {
    const loadOrganizations = async () => {
      if (user?.role !== 'master') return;

      try {
        const { data, error } = await supabase.rpc('get_all_organizations_list');
        
        if (error) throw error;
        
        setOrganizations(data || []);
      } catch (error: any) {
        console.error('Failed to load organizations:', error);
      }
    };

    loadOrganizations();
  }, [user?.role]);

  // Load zones based on selected organization
  useEffect(() => {
    const loadZones = async () => {
      try {
        let query = supabase
          .from('zones')
          .select('id, name, organization_id')
          .eq('is_active', true)
          .order('name');

        // If organization is selected, filter by org
        if (organizationId) {
          query = query.eq('organization_id', organizationId);
        } else if (user?.organization_id) {
          // Otherwise, filter by user's organization
          query = query.eq('organization_id', user.organization_id);
        }

        const { data, error } = await query;

        if (error) throw error;

        setZones(data || []);
      } catch (error: any) {
        console.error('Failed to load zones:', error);
      }
    };

    loadZones();
  }, [organizationId, user?.organization_id]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
      toast.success('Data refreshed');
    } catch (error: any) {
      toast.error('Failed to refresh: ' + error.message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFromDateSelect = (date: Date | undefined) => {
    if (!date) return;

    const newFrom = date.toISOString().split('T')[0];
    
    // If the new "from" date is after the current "to" date, update "to" to match
    if (newFrom > dateTo) {
      setDateRange(newFrom, newFrom, 'custom');
      toast.info('"To" date adjusted to match "From" date');
    } else {
      setDateRange(newFrom, dateTo, 'custom');
    }
    
    setShowFromCalendar(false);
  };

  const handleToDateSelect = (date: Date | undefined) => {
    if (!date) return;

    const newTo = date.toISOString().split('T')[0];
    
    // Prevent "to" date from being before "from" date
    if (newTo < dateFrom) {
      toast.error('"To" date cannot be before "From" date');
      return;
    }
    
    setDateRange(dateFrom, newTo, 'custom');
    setShowToCalendar(false);
  };

  return (
    <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-40">
      <div className="flex flex-wrap items-center gap-3 p-4">
        {/* Date Range Controls */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={setPrevDay}
            className="h-9"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant={datePreset === 'today' ? 'default' : 'outline'}
              size="sm"
              onClick={setToday}
              className="h-9"
            >
              Today
            </Button>
            <Button
              variant={datePreset === 'yesterday' ? 'default' : 'outline'}
              size="sm"
              onClick={setYesterday}
              className="h-9"
            >
              Yesterday
            </Button>
          </div>

          {/* From Date Picker */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-medium">From:</span>
            <Popover open={showFromCalendar} onOpenChange={setShowFromCalendar}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "h-9 w-[140px] justify-start text-left font-normal",
                    !dateFrom && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(new Date(dateFrom), 'dd MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(dateFrom)}
                  onSelect={handleFromDateSelect}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* To Date Picker */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-medium">To:</span>
            <Popover open={showToCalendar} onOpenChange={setShowToCalendar}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "h-9 w-[140px] justify-start text-left font-normal",
                    !dateTo && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(new Date(dateTo), 'dd MMM yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(dateTo)}
                  onSelect={handleToDateSelect}
                  disabled={(date) => date < new Date(dateFrom)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={setNextDay}
            className="h-9"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Organization Filter (Masters Only) */}
        {showOrgFilter && user?.role === 'master' && (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <Select
              value={organizationId || 'all'}
              onValueChange={(value) => {
                if (value === 'all') {
                  setOrganization(null, null);
                  setZone(null, null); // Reset zone when org changes
                } else {
                  const org = organizations.find(o => o.id === value);
                  setOrganization(value, org?.name || null);
                  setZone(null, null); // Reset zone when org changes
                }
              }}
            >
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder="All Organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Organizations</SelectItem>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Zone Filter */}
        {showZoneFilter && (
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <Select
              value={zoneId || 'all'}
              onValueChange={(value) => {
                if (value === 'all') {
                  setZone(null, null);
                } else {
                  const zone = zones.find(z => z.id === value);
                  setZone(value, zone?.name || null);
                }
              }}
            >
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue placeholder="All Zones" />
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
        )}

        {/* Active Filters Display */}
        <div className="flex items-center gap-2 ml-auto">
          {organizationName && (
            <Badge variant="secondary">
              <Building2 className="h-3 w-3 mr-1" />
              {organizationName}
            </Badge>
          )}
          {zoneName && (
            <Badge variant="secondary">
              <MapPin className="h-3 w-3 mr-1" />
              {zoneName}
            </Badge>
          )}
        </div>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-9"
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
