import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OrganizationSelector } from '@/components/features/OrganizationSelector';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuditLogs, useActivityStats, AuditLog, AuditLogFilters } from '@/hooks/useAuditLogs';
import { useUsers } from '@/hooks/useUsers';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useAuthStore } from '@/stores/authStore';
import {
  Activity,
  Users,
  TrendingUp,
  Calendar,
  Filter,
  Search,
  Eye,
  FileText,
  AlertCircle,
  BarChart3,
  Download,
  RefreshCw,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';

export function ActivityDashboard() {
  const { user: currentUser } = useAuthStore();
  
  // Debug logging
  console.log('🔍 ActivityDashboard - Current user:', JSON.stringify(currentUser, null, 2));
  console.log('🔍 ActivityDashboard - User email:', currentUser?.email);
  console.log('🔍 ActivityDashboard - User role:', currentUser?.role);
  
  // Check super admin access (support both email variations)
  const isSuperAdmin = currentUser && (
    currentUser.email === 'don.squire@firstsecurity.co.nz' || 
    currentUser.email === 'don.squires@firstsecurity.co.nz'
  );
  
  console.log('🔍 ActivityDashboard - Is super admin?', isSuperAdmin);

  // If not authenticated, show loading
  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <div className="h-16 w-16 mx-auto border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading user session...</p>
        </div>
      </div>
    );
  }

  // Redirect if not super admin
  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <AlertCircle className="h-16 w-16 mx-auto text-red-500" />
          <h2 className="text-2xl font-bold">Access Denied</h2>
          <p className="text-muted-foreground">
            This dashboard is only accessible to super administrators.
          </p>
          <div className="mt-4 p-4 bg-muted rounded-lg text-sm text-left max-w-md mx-auto">
            <p className="font-medium mb-2">Debug Info:</p>
            <p className="text-xs font-mono">
              Email: {currentUser?.email || 'Not set'}<br />
              Role: {currentUser?.role || 'Not set'}<br />
              User ID: {currentUser?.id || 'Not set'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const [filters, setFilters] = useState<AuditLogFilters>({
    start_date: subDays(new Date(), 30).toISOString(),
    end_date: new Date().toISOString(),
    limit: 100,
  });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [orgSelectorOrganizations, setOrgSelectorOrganizations] = useState<{ id: string; name: string }[]>([]);

  const { data: logs = [], isLoading: logsLoading } = useAuditLogs(filters);
  const { data: stats, isLoading: statsLoading } = useActivityStats(filters);
  const { data: users = [] } = useUsers();
  const { data: organizations = [] } = useOrganizations();

  // Filter logs by search term
  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const term = searchTerm.toLowerCase();
    return logs.filter(log => 
      log.action.toLowerCase().includes(term) ||
      log.entity_type.toLowerCase().includes(term) ||
      log.user?.email.toLowerCase().includes(term) ||
      log.user?.first_name?.toLowerCase().includes(term) ||
      log.user?.last_name?.toLowerCase().includes(term)
    );
  }, [logs, searchTerm]);

  const getActionBadge = (action: string) => {
    if (action.includes('create') || action.includes('insert')) {
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Create</Badge>;
    }
    if (action.includes('update') || action.includes('edit')) {
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Update</Badge>;
    }
    if (action.includes('delete') || action.includes('remove')) {
      return <Badge className="bg-red-500/10 text-red-600 border-red-500/20">Delete</Badge>;
    }
    if (action.includes('login') || action.includes('auth')) {
      return <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20">Auth</Badge>;
    }
    return <Badge variant="outline">{action}</Badge>;
  };

  const exportToCSV = () => {
    const csvData = [
      ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Organization'],
      ...filteredLogs.map(log => [
        format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
        log.user ? `${log.user.first_name} ${log.user.last_name}` : 'System',
        log.user?.email || 'N/A',
        log.action,
        log.entity_type,
        log.entity_id || 'N/A',
        log.organization?.name || 'N/A',
      ])
    ];

    const csv = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    toast.success('Activity log exported to CSV');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Activity className="h-7 w-7 text-primary" />
            Activity Dashboard
          </h2>
          <p className="text-muted-foreground">System-wide user activity monitoring and audit trail</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* High-Level Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="border-border">
              <CardContent className="pt-6">
                <div className="h-20 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Actions</p>
                  <p className="text-3xl font-bold mt-2">{stats.total_actions.toLocaleString()}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Activity className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Active Users</p>
                  <p className="text-3xl font-bold mt-2">{stats.unique_users}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Top Action</p>
                  <p className="text-lg font-bold mt-2">
                    {stats.actions_by_type[0]?.action || 'N/A'}
                  </p>
                  <p className="text-sm text-muted-foreground">{stats.actions_by_type[0]?.count || 0} times</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Date Range</p>
                  <p className="text-sm font-bold mt-2">
                    {format(new Date(filters.start_date || ''), 'MMM d')} - {format(new Date(filters.end_date || ''), 'MMM d')}
                  </p>
                  <p className="text-xs text-muted-foreground">{stats.timeline.length} days</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Calendar className="h-6 w-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Breakdown Charts */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top Actions */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Top Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.actions_by_type.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm font-medium">{item.action}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{
                            width: `${(item.count / stats.actions_by_type[0].count) * 100}%`
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Users */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Most Active Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.top_users.slice(0, 10).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <Badge variant="outline" className="w-6 h-6 rounded-full flex items-center justify-center p-0 text-xs">
                        {idx + 1}
                      </Badge>
                      <span className="text-sm font-medium truncate">{item.user_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${(item.count / stats.top_users[0].count) * 100}%`
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold w-12 text-right">{item.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={filters.user_id || 'all'}
                onValueChange={(value) => setFilters({ ...filters, user_id: value === 'all' ? undefined : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.first_name} {user.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <OrganizationSelector
                selectedOrg={filters.organization_id || 'all'}
                onOrgChange={(value) => setFilters({ ...filters, organization_id: value === 'all' ? undefined : value })}
                organizations={orgSelectorOrganizations}
                setOrganizations={setOrgSelectorOrganizations}
              />
            </div>

            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={filters.start_date ? format(new Date(filters.start_date), 'yyyy-MM-dd') : ''}
                onChange={(e) => setFilters({ ...filters, start_date: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
              />
            </div>

            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={filters.end_date ? format(new Date(filters.end_date), 'yyyy-MM-dd') : ''}
                onChange={(e) => setFilters({ ...filters, end_date: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
              />
            </div>

            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Action, entity, user..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Log Table */}
      <Card className="border-border">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Activity Log ({filteredLogs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading activity logs...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No activity found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedLog(log)}>
                    <TableCell className="font-mono text-xs">
                      {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">
                          {log.user ? `${log.user.first_name} ${log.user.last_name}` : 'System'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {log.user?.email || 'N/A'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.entity_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {log.organization?.name || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setSelectedLog(log)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Activity Log Detail</DialogTitle>
            <DialogDescription>
              Complete information about this activity
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Timestamp</Label>
                  <p className="font-mono text-sm">{format(new Date(selectedLog.created_at), 'PPpp')}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Action</Label>
                  <p className="text-sm">{getActionBadge(selectedLog.action)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">User</Label>
                  <p className="text-sm font-medium">
                    {selectedLog.user ? `${selectedLog.user.first_name} ${selectedLog.user.last_name}` : 'System'}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedLog.user?.email || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <p className="text-sm capitalize">{selectedLog.user?.role || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Entity Type</Label>
                  <p className="text-sm">{selectedLog.entity_type}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Entity ID</Label>
                  <p className="text-sm font-mono">{selectedLog.entity_id || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Organization</Label>
                  <p className="text-sm">{selectedLog.organization?.name || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">IP Address</Label>
                  <p className="text-sm font-mono">{selectedLog.ip_address || 'N/A'}</p>
                </div>
              </div>

              {selectedLog.user_agent && (
                <div>
                  <Label className="text-xs text-muted-foreground">User Agent</Label>
                  <p className="text-xs font-mono bg-muted p-2 rounded mt-1">{selectedLog.user_agent}</p>
                </div>
              )}

              {selectedLog.old_values && Object.keys(selectedLog.old_values).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Old Values</Label>
                  <div className="space-y-1 mt-1">
                    {Object.entries(selectedLog.old_values).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2 text-xs p-2 bg-muted rounded">
                        <span className="font-semibold text-muted-foreground min-w-32">{key}:</span>
                        <span className="font-mono flex-1">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedLog.new_values && Object.keys(selectedLog.new_values).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">New Values</Label>
                  <div className="space-y-1 mt-1">
                    {Object.entries(selectedLog.new_values).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2 text-xs p-2 bg-muted rounded">
                        <span className="font-semibold text-muted-foreground min-w-32">{key}:</span>
                        <span className="font-mono flex-1">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
