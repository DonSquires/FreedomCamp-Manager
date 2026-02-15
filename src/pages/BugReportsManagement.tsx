/**
 * Bug Reports Management - Admin view for reviewing and resolving reports
 * Shows all submitted issues with filtering, status updates, and resolution tracking
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Bug,
  Lightbulb,
  Zap,
  TrendingUp,
  Palette,
  Database,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  User,
  Calendar,
  Monitor,
  Image as ImageIcon,
  Filter,
  Search,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { formatDistanceToNow } from 'date-fns';

const ISSUE_TYPE_ICONS: any = {
  bug: Bug,
  feature_request: Lightbulb,
  enhancement: TrendingUp,
  performance: Zap,
  ui_ux: Palette,
  data_issue: Database,
  other: HelpCircle,
};

const ISSUE_TYPE_COLORS: any = {
  bug: 'text-red-600 bg-red-50 border-red-200',
  feature_request: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  enhancement: 'text-blue-600 bg-blue-50 border-blue-200',
  performance: 'text-orange-600 bg-orange-50 border-orange-200',
  ui_ux: 'text-purple-600 bg-purple-50 border-purple-200',
  data_issue: 'text-green-600 bg-green-50 border-green-200',
  other: 'text-gray-600 bg-gray-50 border-gray-200',
};

const STATUS_COLORS: any = {
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  acknowledged: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  investigating: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  in_progress: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  closed: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  wont_fix: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  duplicate: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const SEVERITY_COLORS: any = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-white',
  low: 'bg-blue-500 text-white',
};

export function BugReportsManagement() {
  const { user } = useAuthStore();
  const [reports, setReports] = useState<any[]>([]);
  const [filteredReports, setFilteredReports] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [newStatus, setNewStatus] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadReports();
  }, [user]);

  useEffect(() => {
    applyFilters();
  }, [reports, statusFilter, typeFilter, severityFilter, searchQuery]);

  const loadReports = async () => {
    if (!user) return;

    try {
      let query = supabase
        .from('bug_reports')
        .select(`
          *,
          user:user_id (first_name, last_name, email, role),
          resolver:resolved_by (first_name, last_name, email)
        `)
        .order('created_at', { ascending: false });

      // Filter by organization for non-master users
      if (user.role !== 'master') {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setReports(data || []);
    } catch (error: any) {
      console.error('Failed to load bug reports:', error);
      toast.error('Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...reports];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(r => r.issue_type === typeFilter);
    }

    if (severityFilter !== 'all') {
      filtered = filtered.filter(r => r.severity === severityFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query) ||
        r.user?.email?.toLowerCase().includes(query)
      );
    }

    setFilteredReports(filtered);
  };

  const handleUpdateStatus = async () => {
    if (!selectedReport || !newStatus) return;

    try {
      const updates: any = {
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      if (['resolved', 'closed'].includes(newStatus)) {
        updates.resolved_by = user?.id;
        updates.resolved_at = new Date().toISOString();
        updates.resolution_notes = resolutionNotes.trim() || null;
      }

      const { error } = await supabase
        .from('bug_reports')
        .update(updates)
        .eq('id', selectedReport.id);

      if (error) throw error;

      toast.success('✅ Status updated successfully');
      setShowDetailModal(false);
      loadReports();
    } catch (error: any) {
      console.error('Failed to update status:', error);
      toast.error('Failed to update status');
    }
  };

  const getStats = () => {
    return {
      total: reports.length,
      submitted: reports.filter(r => r.status === 'submitted').length,
      inProgress: reports.filter(r => ['acknowledged', 'investigating', 'in_progress'].includes(r.status)).length,
      resolved: reports.filter(r => r.status === 'resolved').length,
      critical: reports.filter(r => r.severity === 'critical' && !['resolved', 'closed'].includes(r.status)).length,
    };
  };

  const stats = getStats();

  const openDetailModal = (report: any) => {
    setSelectedReport(report);
    setNewStatus(report.status);
    setResolutionNotes(report.resolution_notes || '');
    setShowDetailModal(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading bug reports...</p>
        </div>
      </div>
    );
  }

  const Icon = selectedReport ? ISSUE_TYPE_ICONS[selectedReport.issue_type] : Bug;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Bug Reports & Issues</h1>
        <p className="text-muted-foreground">
          Review and manage user-submitted bugs, feature requests, and issues
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total Reports</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.submitted}</div>
            <div className="text-sm text-muted-foreground">New</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-orange-600">{stats.inProgress}</div>
            <div className="text-sm text-muted-foreground">In Progress</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
            <div className="text-sm text-muted-foreground">Resolved</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">{stats.critical}</div>
            <div className="text-sm text-muted-foreground">Critical Open</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search reports..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="bug">Bug</SelectItem>
                  <SelectItem value="feature_request">Feature Request</SelectItem>
                  <SelectItem value="enhancement">Enhancement</SelectItem>
                  <SelectItem value="performance">Performance</SelectItem>
                  <SelectItem value="ui_ux">UI/UX</SelectItem>
                  <SelectItem value="data_issue">Data Issue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      <div className="space-y-4">
        {filteredReports.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Bug className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No reports found</p>
            </CardContent>
          </Card>
        ) : (
          filteredReports.map((report) => {
            const TypeIcon = ISSUE_TYPE_ICONS[report.issue_type] || Bug;
            const typeColor = ISSUE_TYPE_COLORS[report.issue_type] || ISSUE_TYPE_COLORS.other;
            
            return (
              <Card
                key={report.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => openDetailModal(report)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`h-12 w-12 rounded-lg border-2 ${typeColor} flex items-center justify-center shrink-0`}>
                      <TypeIcon className="h-6 w-6" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-semibold text-lg">{report.title}</h3>
                        <div className="flex items-center gap-2 shrink-0">
                          {report.severity && (
                            <Badge className={SEVERITY_COLORS[report.severity]}>
                              {report.severity}
                            </Badge>
                          )}
                          <Badge className={STATUS_COLORS[report.status]}>
                            {report.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                        {report.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {report.user?.first_name} {report.user?.last_name}
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                        </div>
                        <div className="flex items-center gap-1">
                          <Monitor className="h-3 w-3" />
                          v{report.app_version}
                        </div>
                        {report.screenshots?.length > 0 && (
                          <div className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {report.screenshots.length} screenshot{report.screenshots.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Detail Modal */}
      {selectedReport && (
        <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className={`h-12 w-12 rounded-lg border-2 ${ISSUE_TYPE_COLORS[selectedReport.issue_type]} flex items-center justify-center`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <DialogTitle>{selectedReport.title}</DialogTitle>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedReport.severity && (
                      <Badge className={SEVERITY_COLORS[selectedReport.severity]}>
                        {selectedReport.severity}
                      </Badge>
                    )}
                    <Badge className={STATUS_COLORS[selectedReport.status]}>
                      {selectedReport.status.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Description */}
              <div>
                <h4 className="font-semibold mb-2">Description</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {selectedReport.description}
                </p>
              </div>

              {/* Additional Details */}
              {selectedReport.steps_to_reproduce && (
                <div>
                  <h4 className="font-semibold mb-2">Steps to Reproduce</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedReport.steps_to_reproduce}
                  </p>
                </div>
              )}

              {(selectedReport.expected_behavior || selectedReport.actual_behavior) && (
                <div className="grid grid-cols-2 gap-4">
                  {selectedReport.expected_behavior && (
                    <div>
                      <h4 className="font-semibold mb-2 text-sm">Expected Behavior</h4>
                      <p className="text-sm text-muted-foreground">
                        {selectedReport.expected_behavior}
                      </p>
                    </div>
                  )}
                  {selectedReport.actual_behavior && (
                    <div>
                      <h4 className="font-semibold mb-2 text-sm">Actual Behavior</h4>
                      <p className="text-sm text-muted-foreground">
                        {selectedReport.actual_behavior}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Screenshots */}
              {selectedReport.screenshots?.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Screenshots</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedReport.screenshots.map((url: string, index: number) => (
                      <a
                        key={index}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative"
                      >
                        <img
                          src={url}
                          alt={`Screenshot ${index + 1}`}
                          className="w-full h-32 object-cover rounded-lg border"
                        />
                        <div className="absolute inset-0 bg-black/50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ExternalLink className="h-6 w-6 text-white" />
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* System Info */}
              <div>
                <h4 className="font-semibold mb-2">System Information</h4>
                <div className="grid grid-cols-2 gap-2 text-sm bg-muted p-3 rounded-lg">
                  <div><span className="text-muted-foreground">Version:</span> {selectedReport.app_version}</div>
                  <div><span className="text-muted-foreground">Page:</span> {selectedReport.current_page}</div>
                  <div><span className="text-muted-foreground">Device:</span> {
                    selectedReport.device_info?.isMobile ? 'Mobile' :
                    selectedReport.device_info?.isTablet ? 'Tablet' : 'Desktop'
                  }</div>
                  <div><span className="text-muted-foreground">Network:</span> {selectedReport.network_status}</div>
                </div>
              </div>

              {/* Update Status */}
              <div className="space-y-3 border-t pt-4">
                <h4 className="font-semibold">Update Status</h4>
                <div className="space-y-2">
                  <Label>New Status</Label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="acknowledged">Acknowledged</SelectItem>
                      <SelectItem value="investigating">Investigating</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="wont_fix">Won't Fix</SelectItem>
                      <SelectItem value="duplicate">Duplicate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                {['resolved', 'closed'].includes(newStatus) && (
                  <div className="space-y-2">
                    <Label>Resolution Notes</Label>
                    <Textarea
                      placeholder="Describe how this was resolved..."
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDetailModal(false)}>
                Close
              </Button>
              <Button onClick={handleUpdateStatus}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Update Status
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
