import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface AuditLog {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: any;
  new_values: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user?: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    role: string;
  };
  organization?: {
    id: string;
    name: string;
  };
}

export interface AuditLogFilters {
  user_id?: string;
  organization_id?: string;
  action?: string;
  entity_type?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

export interface ActivityStats {
  total_actions: number;
  unique_users: number;
  actions_by_type: { action: string; count: number }[];
  actions_by_entity: { entity_type: string; count: number }[];
  top_users: { user_id: string; user_name: string; count: number }[];
  timeline: { date: string; count: number }[];
}

// Fetch audit logs with filters
export function useAuditLogs(filters?: AuditLogFilters) {
  return useQuery({
    queryKey: ['audit_logs', filters],
    queryFn: async () => {
      let query = supabase
        .from('audit_log')
        .select(`
          *,
          user:user_profiles!audit_log_user_id_fkey(
            id,
            first_name,
            last_name,
            email,
            role
          ),
          organization:organizations!audit_log_organization_id_fkey(
            id,
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (filters?.user_id) {
        query = query.eq('user_id', filters.user_id);
      }
      if (filters?.organization_id) {
        query = query.eq('organization_id', filters.organization_id);
      }
      if (filters?.action) {
        query = query.eq('action', filters.action);
      }
      if (filters?.entity_type) {
        query = query.eq('entity_type', filters.entity_type);
      }
      if (filters?.start_date) {
        query = query.gte('created_at', filters.start_date);
      }
      if (filters?.end_date) {
        query = query.lte('created_at', filters.end_date);
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as AuditLog[];
    },
  });
}

// Get activity statistics
export function useActivityStats(filters?: AuditLogFilters) {
  return useQuery({
    queryKey: ['activity_stats', filters],
    queryFn: async () => {
      let query = supabase.from('audit_log').select('*');

      if (filters?.start_date) {
        query = query.gte('created_at', filters.start_date);
      }
      if (filters?.end_date) {
        query = query.lte('created_at', filters.end_date);
      }
      if (filters?.organization_id) {
        query = query.eq('organization_id', filters.organization_id);
      }

      const { data: logs, error } = await query;
      if (error) throw error;

      // Calculate statistics
      const total_actions = logs.length;
      const unique_users = new Set(logs.map(log => log.user_id).filter(Boolean)).size;

      // Actions by type
      const actionCounts: Record<string, number> = {};
      logs.forEach(log => {
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
      });
      const actions_by_type = Object.entries(actionCounts)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count);

      // Actions by entity
      const entityCounts: Record<string, number> = {};
      logs.forEach(log => {
        entityCounts[log.entity_type] = (entityCounts[log.entity_type] || 0) + 1;
      });
      const actions_by_entity = Object.entries(entityCounts)
        .map(([entity_type, count]) => ({ entity_type, count }))
        .sort((a, b) => b.count - a.count);

      // Top users - need to fetch user details
      const userCounts: Record<string, number> = {};
      logs.forEach(log => {
        if (log.user_id) {
          userCounts[log.user_id] = (userCounts[log.user_id] || 0) + 1;
        }
      });

      const topUserIds = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([user_id]) => user_id);

      let top_users: { user_id: string; user_name: string; count: number }[] = [];
      if (topUserIds.length > 0) {
        const { data: users } = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, email')
          .in('id', topUserIds);

        if (users) {
          top_users = topUserIds.map(user_id => {
            const user = users.find(u => u.id === user_id);
            return {
              user_id,
              user_name: user ? `${user.first_name} ${user.last_name}` : 'Unknown User',
              count: userCounts[user_id],
            };
          });
        }
      }

      // Timeline (last 30 days)
      const timelineCounts: Record<string, number> = {};
      logs.forEach(log => {
        const date = new Date(log.created_at).toISOString().split('T')[0];
        timelineCounts[date] = (timelineCounts[date] || 0) + 1;
      });
      const timeline = Object.entries(timelineCounts)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        total_actions,
        unique_users,
        actions_by_type,
        actions_by_entity,
        top_users,
        timeline,
      } as ActivityStats;
    },
  });
}

// Log an activity
export interface LogActivityInput {
  action: string;
  entity_type: string;
  entity_id?: string;
  old_values?: any;
  new_values?: any;
}

export function useLogActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogActivityInput) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get user profile for organization_id
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      // Get client info
      const user_agent = navigator.userAgent;
      
      const { error } = await supabase.from('audit_log').insert({
        user_id: user.id,
        organization_id: profile?.organization_id || null,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id || null,
        old_values: input.old_values || null,
        new_values: input.new_values || null,
        user_agent,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit_logs'] });
      queryClient.invalidateQueries({ queryKey: ['activity_stats'] });
    },
    onError: (error: any) => {
      console.error('Failed to log activity:', error);
      // Don't show toast for logging errors - they're background operations
    },
  });
}

// Delete old audit logs (super admin only)
export function useDeleteAuditLogs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (before_date: string) => {
      const { error } = await supabase
        .from('audit_log')
        .delete()
        .lt('created_at', before_date);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Old audit logs deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['audit_logs'] });
      queryClient.invalidateQueries({ queryKey: ['activity_stats'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to delete audit logs: ${error.message}`);
    },
  });
}
