import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wind, Flame, AlertTriangle, MapPin, PlusCircle, RefreshCw, BarChart3, CheckCircle, XCircle, FileText, Clock, Users, Filter, Eye, Radio } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatDateTime(val: string | null) {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
}

const SMOKE_OPACITY_LABELS: Record<string, string> = {
  light: 'Light', moderate: 'Moderate', heavy: 'Heavy', very_heavy: 'Very Heavy', black: 'Black',
};
const NOTICE_TYPE_LABELS: Record<string, string> = {
  abatement_notice: 'Abatement Notice',
  infringement_notice: 'Infringement Notice',
  prosecution_referral: 'Prosecution Referral',
};
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800', dispatched: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-orange-100 text-orange-800', completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-700',
};
const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800', urgent: 'bg-red-100 text-red-800',
};

export default function SmokeComplaintControlPage() {
  const { user, profile } = useAuthStore();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('jobs');
  const [statusFilter, setStatusFilter] = useState('all');
  const [oohFilter, setOohFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', address: '', suburb: '', complaint_source: 'public',
    complaint_time: new Date().toISOString().slice(0, 16),
    priority: 'normal', has_prior_notice: false, has_repeat_offender: false,
    complaint_description: '', safety_notes: '', assigned_to: '',
  });

  const orgId = profile?.organisation_id;

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['smoke_jobs', orgId, statusFilter, oohFilter],
    queryFn: async () => {
      let q = supabase.from('smoke_jobs').select('*').order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (oohFilter === 'ooh') q = q.eq('is_out_of_hours', true);
      if (oohFilter === 'in_hours') q = q.eq('is_out_of_hours', false);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  const { data: assessments = [], isLoading: assLoading } = useQuery({
    queryKey: ['smoke_assessments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('smoke_assessments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: notices = [], isLoading: noticesLoading } = useQuery({
    queryKey: ['smoke_notices'],
    queryFn: async () => {
      const { data, error } = await supabase.from('smoke_notices').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: officers = [] } = useQuery({
    queryKey: ['user_profiles', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').eq('organisation_id', orgId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  const createJobMutation = useMutation({
    mutationFn: async () => {
      const { data: jobNum } = await supabase.rpc('next_smoke_job_number', { p_org_id: orgId });
      const now = new Date();
      const h = now.getHours();
      const is_out_of_hours = h >= 23 || h < 7;
      const { error } = await supabase.from('smoke_jobs').insert({
        job_number: jobNum,
        title: form.title,
        address: form.address,
        suburb: form.suburb,
        complaint_source: form.complaint_source,
        complaint_time: new Date(form.complaint_time).toISOString(),
        priority: form.priority,
        has_prior_notice: form.has_prior_notice,
        has_repeat_offender: form.has_repeat_offender,
        complaint_description: form.complaint_description,
        safety_notes: form.safety_notes,
        assigned_to: form.assigned_to || null,
        is_out_of_hours,
        status: 'open',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Smoke job created');
      qc.invalidateQueries({ queryKey: ['smoke_jobs'] });
      setShowCreate(false);
      setForm({ title: '', address: '', suburb: '', complaint_source: 'public', complaint_time: new Date().toISOString().slice(0, 16), priority: 'normal', has_prior_notice: false, has_repeat_offender: false, complaint_description: '', safety_notes: '', assigned_to: '' });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create job'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('smoke_jobs').update({ status, ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}) }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['smoke_jobs'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Analytics
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: analyticsJobs = [] } = useQuery({
    queryKey: ['smoke_analytics', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('smoke_jobs').select('*').gte('created_at', monthStart);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
  const { data: analyticsAssessments = [] } = useQuery({
    queryKey: ['smoke_analytics_ass'],
    queryFn: async () => {
      const { data } = await supabase.from('smoke_assessments').select('fire_type, ai_confidence').gte('created_at', monthStart);
      return data || [];
    },
  });

  const totalMonthJobs = analyticsJobs.length;
  const oohCount = analyticsJobs.filter((j: any) => j.is_out_of_hours).length;
  const inHoursCount = totalMonthJobs - oohCount;
  const noticesThisMonth = notices.filter((n: any) => n.created_at >= monthStart).length;
  const fireTypeCounts: Record<string, number> = {};
  analyticsAssessments.forEach((a: any) => { if (a.fire_type) fireTypeCounts[a.fire_type] = (fireTypeCounts[a.fire_type] || 0) + 1; });
  const topFireTypes = Object.entries(fireTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <AppLayout>
      <div className="space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-amber-600 p-2 rounded-lg">
              <Flame className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Smoke Complaint Control</h1>
              <p className="text-sm text-gray-500">RMA s.17A Out-of-Hours Enforcement</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchJobs(); qc.invalidateQueries({ queryKey: ['smoke_assessments'] }); qc.invalidateQueries({ queryKey: ['smoke_notices'] }); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setShowCreate(true)}>
              <PlusCircle className="h-4 w-4 mr-1" /> New Job
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-xs text-gray-500">Total Jobs</p>
                  <p className="text-2xl font-bold">{jobs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-xs text-gray-500">OOH Jobs</p>
                  <p className="text-2xl font-bold text-amber-600">{jobs.filter((j: any) => j.is_out_of_hours).length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-xs text-gray-500">Open/Urgent</p>
                  <p className="text-2xl font-bold text-red-600">{jobs.filter((j: any) => j.status === 'open' || j.priority === 'urgent').length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-xs text-gray-500">Notices Issued</p>
                  <p className="text-2xl font-bold">{notices.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-amber-50 border border-amber-200">
            <TabsTrigger value="jobs" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
              <Flame className="h-4 w-4 mr-1" /> Jobs
            </TabsTrigger>
            <TabsTrigger value="assessments" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
              <Wind className="h-4 w-4 mr-1" /> Assessments
            </TabsTrigger>
            <TabsTrigger value="notices" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
              <FileText className="h-4 w-4 mr-1" /> Notices
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
              <BarChart3 className="h-4 w-4 mr-1" /> Analytics
            </TabsTrigger>
          </TabsList>

          {/* JOBS TAB */}
          <TabsContent value="jobs">
            <Card>
              <CardHeader className="bg-amber-600 text-white rounded-t-lg py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Flame className="h-4 w-4" /> Active Smoke Jobs
                  </CardTitle>
                  <div className="flex gap-2">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-32 h-8 bg-amber-700 border-amber-500 text-white text-xs">
                        <Filter className="h-3 w-3 mr-1" /><SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="dispatched">Dispatched</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={oohFilter} onValueChange={setOohFilter}>
                      <SelectTrigger className="w-32 h-8 bg-amber-700 border-amber-500 text-white text-xs">
                        <Clock className="h-3 w-3 mr-1" /><SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Hours</SelectItem>
                        <SelectItem value="ooh">OOH Only</SelectItem>
                        <SelectItem value="in_hours">In Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {jobsLoading ? (
                  <div className="p-8 text-center text-gray-500">Loading jobs…</div>
                ) : jobs.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No smoke jobs found</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50">
                        <TableHead>Job #</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>OOH</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead>Complaint Time</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((job: any) => (
                        <TableRow key={job.id} className="hover:bg-amber-50/50">
                          <TableCell className="font-mono text-xs font-semibold text-amber-700">{job.job_number}</TableCell>
                          <TableCell className="font-medium">{job.title || '—'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm">
                              <MapPin className="h-3 w-3 text-gray-400" />{job.address}
                            </div>
                          </TableCell>
                          <TableCell>
                            {job.is_out_of_hours && (
                              <Badge className="bg-amber-500 text-white text-xs font-bold">OOH</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[job.priority] || 'bg-gray-100'}`}>
                              {job.priority?.toUpperCase()}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[job.status] || 'bg-gray-100'}`}>
                              {job.status?.replace('_', ' ')}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{job.assigned_to || '—'}</TableCell>
                          <TableCell className="text-xs text-gray-500">{formatDateTime(job.complaint_time)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {job.status === 'open' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                                  onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'dispatched' })}>
                                  <Radio className="h-3 w-3 mr-1" /> Dispatch
                                </Button>
                              )}
                              {job.status === 'dispatched' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                  onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'in_progress' })}>
                                  <Eye className="h-3 w-3 mr-1" /> In Progress
                                </Button>
                              )}
                              {(job.status === 'in_progress' || job.status === 'dispatched') && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50"
                                  onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'completed' })}>
                                  <CheckCircle className="h-3 w-3 mr-1" /> Complete
                                </Button>
                              )}
                              {job.status !== 'cancelled' && job.status !== 'completed' && (
                                <Button size="sm" variant="outline" className="h-7 text-xs border-gray-300 text-gray-600 hover:bg-gray-50"
                                  onClick={() => updateStatusMutation.mutate({ id: job.id, status: 'cancelled' })}>
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ASSESSMENTS TAB */}
          <TabsContent value="assessments">
            <Card>
              <CardHeader className="bg-amber-600 text-white rounded-t-lg py-3 px-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wind className="h-4 w-4" /> Smoke Assessments
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {assLoading ? (
                  <div className="p-8 text-center text-gray-500">Loading assessments…</div>
                ) : assessments.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No assessments recorded</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50">
                        <TableHead>Officer</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Smoke Opacity</TableHead>
                        <TableHead>Prohibited Materials</TableHead>
                        <TableHead>Recommended Action</TableHead>
                        <TableHead>AI Confidence</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assessments.map((a: any) => (
                        <TableRow key={a.id} className="hover:bg-amber-50/50">
                          <TableCell className="text-sm">{a.officer_id || '—'}</TableCell>
                          <TableCell className="text-sm">{a.address || '—'}</TableCell>
                          <TableCell>
                            {a.smoke_opacity ? (
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.smoke_opacity === 'black' || a.smoke_opacity === 'very_heavy' ? 'bg-red-100 text-red-800' : a.smoke_opacity === 'heavy' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {SMOKE_OPACITY_LABELS[a.smoke_opacity] || a.smoke_opacity}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>
                            {a.prohibited_materials_suspected ? (
                              <Badge className="bg-red-100 text-red-800 border border-red-200 text-xs">Yes</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">No</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{a.recommended_action || '—'}</TableCell>
                          <TableCell>
                            {a.ai_confidence != null ? (
                              <span className={`text-sm font-semibold ${a.ai_confidence >= 0.8 ? 'text-green-600' : a.ai_confidence >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                                {Math.round(a.ai_confidence * 100)}%
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">{formatDateTime(a.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* NOTICES TAB */}
          <TabsContent value="notices">
            <Card>
              <CardHeader className="bg-amber-600 text-white rounded-t-lg py-3 px-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Enforcement Notices
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {noticesLoading ? (
                  <div className="p-8 text-center text-gray-500">Loading notices…</div>
                ) : notices.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No notices issued</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50">
                        <TableHead>Notice #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Penalty (NZD)</TableHead>
                        <TableHead>Comply By</TableHead>
                        <TableHead>Issued</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notices.map((n: any) => (
                        <TableRow key={n.id} className="hover:bg-amber-50/50">
                          <TableCell className="font-mono text-xs font-semibold text-amber-700">{n.notice_number}</TableCell>
                          <TableCell>
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              {NOTICE_TYPE_LABELS[n.notice_type] || n.notice_type}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{n.recipient_name || '—'}</TableCell>
                          <TableCell className="text-sm">{n.recipient_address || '—'}</TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${n.status === 'complied' ? 'bg-green-100 text-green-800' : n.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                              {n.status || '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm font-medium">{n.penalty_amount_nzd ? `$${n.penalty_amount_nzd.toLocaleString()}` : '—'}</TableCell>
                          <TableCell className="text-xs text-gray-500">{n.comply_by ? formatDateTime(n.comply_by) : '—'}</TableCell>
                          <TableCell className="text-xs text-gray-500">{formatDateTime(n.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="bg-amber-600 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> This Month Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-gray-600 flex items-center gap-2"><Flame className="h-4 w-4 text-amber-500" /> Total Jobs</span>
                    <span className="font-bold text-lg">{totalMonthJobs}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-gray-600 flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" /> Out-of-Hours</span>
                    <span className="font-bold text-lg text-amber-600">{oohCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-gray-600 flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" /> In-Hours</span>
                    <span className="font-bold text-lg text-green-600">{inHoursCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-sm text-gray-600 flex items-center gap-2"><FileText className="h-4 w-4 text-blue-500" /> Notices Issued</span>
                    <span className="font-bold text-lg text-blue-600">{noticesThisMonth}</span>
                  </div>
                  {totalMonthJobs > 0 && (
                    <div className="pt-2">
                      <p className="text-xs text-gray-500 mb-2">OOH Breakdown</p>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div className="bg-amber-500 h-3 rounded-full" style={{ width: `${Math.round((oohCount / totalMonthJobs) * 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>OOH: {Math.round((oohCount / totalMonthJobs) * 100)}%</span>
                        <span>In-Hours: {Math.round((inHoursCount / totalMonthJobs) * 100)}%</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="bg-amber-600 text-white rounded-t-lg py-3 px-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Flame className="h-4 w-4" /> Top Fire Types
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {topFireTypes.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">No fire type data this month</div>
                  ) : (
                    <div className="space-y-3">
                      {topFireTypes.map(([type, count]) => (
                        <div key={type} className="flex items-center gap-3">
                          <span className="text-sm text-gray-700 w-40 capitalize">{type.replace(/_/g, ' ')}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${Math.round((count / (topFireTypes[0][1] || 1)) * 100)}%` }} />
                          </div>
                          <span className="text-sm font-semibold text-amber-700 w-6 text-right">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* CREATE JOB DIALOG */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-600" /> New Smoke Complaint Job
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label>Title</Label>
              <Input placeholder="Brief description" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Address <span className="text-red-500">*</span></Label>
              <Input placeholder="Street address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} required />
            </div>
            <div>
              <Label>Suburb</Label>
              <Input placeholder="Suburb" value={form.suburb} onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))} />
            </div>
            <div>
              <Label>Complaint Source</Label>
              <Select value={form.complaint_source} onValueChange={v => setForm(f => ({ ...f, complaint_source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="officer_initiated">Officer Initiated</SelectItem>
                  <SelectItem value="council_referral">Council Referral</SelectItem>
                  <SelectItem value="repeat_trigger">Repeat Trigger</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Complaint Time</Label>
              <Input type="datetime-local" value={form.complaint_time} onChange={e => setForm(f => ({ ...f, complaint_time: e.target.value }))} />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assign to Officer</Label>
              <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {officers.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Checkbox id="prior_notice" checked={form.has_prior_notice} onCheckedChange={v => setForm(f => ({ ...f, has_prior_notice: !!v }))} />
              <Label htmlFor="prior_notice">Has Prior Notice</Label>
            </div>
            <div className="flex items-center gap-3 pt-5">
              <Checkbox id="repeat_offender" checked={form.has_repeat_offender} onCheckedChange={v => setForm(f => ({ ...f, has_repeat_offender: !!v }))} />
              <Label htmlFor="repeat_offender">Repeat Offender</Label>
            </div>
            <div className="col-span-2">
              <Label>Complaint Description</Label>
              <Textarea placeholder="Details of the complaint…" rows={3} value={form.complaint_description} onChange={e => setForm(f => ({ ...f, complaint_description: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <Label>Safety Notes</Label>
              <Textarea placeholder="Any safety concerns…" rows={2} value={form.safety_notes} onChange={e => setForm(f => ({ ...f, safety_notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => createJobMutation.mutate()} disabled={!form.address || createJobMutation.isPending}>
              {createJobMutation.isPending ? 'Creating…' : 'Create Job'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
