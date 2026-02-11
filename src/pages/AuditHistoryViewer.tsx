/**
 * AuditHistoryViewer - Complete change trail with field-level diffs
 * Shows audit_log entries filtered by entity type with before/after comparisons
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  History,
  Search,
  Filter,
  Calendar,
  User,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  user_id: string | null;
  created_at: string;
  old_values: any;
  new_values: any;
  user_profiles?: {
    first_name: string;
    last_name: string;
  };
}

export function AuditHistoryViewer() {
  const [isLoading, setIsLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const entityTypes = ['all', 'VEHICLE', 'OBSERVATION', 'ZONE', 'ORG', 'MATRIX', 'ENFORCEMENT'];
  const actionTypes = ['all', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'RECALCULATE', 'LINK'];

  useEffect(() => {
    loadAuditLogs();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [logs, searchQuery, filterType, filterAction]);

  const loadAuditLogs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_log')
        .select(`
          id,
          entity_type,
          entity_id,
          action,
          user_id,
          created_at,
          old_values,
          new_values,
          user_profiles!audit_log_user_id_fkey(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      setLogs(data || []);
    } catch (error: any) {
      console.error('Failed to load audit logs:', error);
      toast.error('Failed to load audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...logs];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        log =>
          log.entity_id?.toLowerCase().includes(query) ||
          log.entity_type?.toLowerCase().includes(query) ||
          log.action?.toLowerCase().includes(query)
      );
    }

    // Type filter
    if (filterType !== 'all') {
      filtered = filtered.filter(log => log.entity_type === filterType);
    }

    // Action filter
    if (filterAction !== 'all') {
      filtered = filtered.filter(log => log.action === filterAction);
    }

    setFilteredLogs(filtered);
  };

  const renderChanges = (oldValues: any, newValues: any) => {
    // If no old values, this is a CREATE action - show new values
    if (!oldValues && newValues) {
      return (
        <div className="space-y-2 text-xs">
          <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-800">
            <div className="font-semibold text-green-900 dark:text-green-100 mb-1">Created:</div>
            <pre className="font-mono text-xs overflow-x-auto">
              {JSON.stringify(newValues, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    // If no new values, this is a DELETE action - show old values
    if (oldValues && !newValues) {
      return (
        <div className="space-y-2 text-xs">
          <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-800">
            <div className="font-semibold text-red-900 dark:text-red-100 mb-1">Deleted:</div>
            <pre className="font-mono text-xs overflow-x-auto">
              {JSON.stringify(oldValues, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    // UPDATE action - show field-by-field diff
    if (oldValues && newValues) {
      const allKeys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
      const changes: Array<{ field: string; old: any; new: any; changed: boolean }> = [];

      allKeys.forEach(key => {
        const oldVal = oldValues[key];
        const newVal = newValues[key];
        const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
        changes.push({ field: key, old: oldVal, new: newVal, changed });
      });

      return (
        <div className="space-y-2 text-xs">
          {changes.filter(c => c.changed).map(({ field, old: oldVal, new: newVal }) => (
            <div key={field} className="p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
              <div className="font-semibold text-amber-900 dark:text-amber-100 mb-1">{field}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground">Before:</div>
                  <div className="font-mono text-red-600 dark:text-red-400 break-all">
                    {JSON.stringify(oldVal, null, 2)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">After:</div>
                  <div className="font-mono text-green-600 dark:text-green-400 break-all">
                    {JSON.stringify(newVal, null, 2)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    return <p className="text-xs text-muted-foreground">No changes recorded</p>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <History className="h-8 w-8" />
          Audit History
        </h1>
        <p className="text-muted-foreground">
          Complete change trail with field-level diffs
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by ID, type, action..."
                  className="pl-9"
                />
              </div>
            </div>

            {/* Entity Type Filter */}
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                {entityTypes.map(type => (
                  <SelectItem key={type} value={type}>
                    {type === 'all' ? 'All Types' : type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Action Filter */}
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map(action => (
                  <SelectItem key={action} value={action}>
                    {action === 'all' ? 'All Actions' : action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Audit Entries ({filteredLogs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No audit logs found</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredLogs.map(log => (
                <div key={log.id} className="border rounded-lg">
                  <div
                    className="p-4 cursor-pointer hover:bg-muted transition-colors"
                    onClick={() =>
                      setExpandedLog(expandedLog === log.id ? null : log.id)
                    }
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline">{log.entity_type}</Badge>
                          <Badge
                            variant={
                              log.action === 'CREATE' || log.action.startsWith('INSERT')
                                ? 'default'
                                : log.action === 'DELETE'
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {log.action}
                          </Badge>
                          {log.entity_id && (
                            <span className="text-xs font-mono text-muted-foreground">
                              {log.entity_id.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        {expandedLog === log.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(log.created_at).toLocaleString('en-NZ', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: 'Pacific/Auckland',
                        })}
                      </div>
                      {log.user_profiles && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {log.user_profiles.first_name} {log.user_profiles.last_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expanded Changes */}
                  {expandedLog === log.id && (
                    <div className="p-4 border-t bg-muted/30">
                      <div className="text-sm font-semibold mb-2">Changes:</div>
                      {renderChanges(log.old_values, log.new_values)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
