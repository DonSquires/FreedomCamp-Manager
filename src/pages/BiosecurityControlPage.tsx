import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { AppLayout } from "@/components/features/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import {
  Leaf, TreePine, MapPin, PlusCircle, RefreshCw, BarChart3,
  CheckCircle, XCircle, FileText, AlertTriangle, Users, Filter,
  Printer, Eye, Radio, Clock
} from "lucide-react";

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  assigned: "bg-blue-100 text-blue-800",
  en_route: "bg-indigo-100 text-indigo-800",
  on_scene: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-800",
  referred: "bg-orange-100 text-orange-800",
};

const INSPECTION_LABELS: Record<string, string> = {
  routine: "Routine",
  complaint: "Complaint",
  follow_up: "Follow-up",
  targeted: "Targeted",
};

const NOTICE_TYPE_LABELS: Record<string, string> = {
  notice_of_direction: "Notice of Direction",
  infringement_notice: "Infringement Notice",
  formal_warning: "Formal Warning",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

export default function BiosecurityControlPage() {
  const { user } = useAuthStore();
  const orgId = user?.organization_id;
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState("jobs");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const [form, setForm] = useState({
    title: "",
    address: "",
    inspection_type: "routine",
    complaint_source: "public",
    priority: "normal",
    has_prior_notice: false,
    has_management_plan: false,
    safety_notes: "",
    assigned_to: "",
  });

  // Jobs query
  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ["biosecurity_jobs", orgId, statusFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from("biosecurity_jobs")
        .select("*, assigned_officer:user_profiles!biosecurity_jobs_assigned_to_fkey(full_name)")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Assessments query
  const { data: assessments = [], isLoading: assessmentsLoading, refetch: refetchAssessments } = useQuery({
    queryKey: ["biosecurity_assessments", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("biosecurity_assessments")
        .select("*, officer:user_profiles!biosecurity_assessments_officer_id_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Notices query
  const { data: notices = [], isLoading: noticesLoading, refetch: refetchNotices } = useQuery({
    queryKey: ["biosecurity_notices", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("biosecurity_notices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Officers for assignment
  const { data: officers = [] } = useQuery({
    queryKey: ["officers", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .eq("organization_id", orgId)
        .in("role", ["officer", "admin_officer"]);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });

  // Create job mutation
  const createJobMutation = useMutation({
    mutationFn: async () => {
      const { data: jobNumber } = await (supabase as any).rpc("next_biosecurity_job_number", { p_org_id: orgId });
      const payload: any = {
        organization_id: orgId,
        job_number: jobNumber,
        title: form.title || `Biosecurity Inspection – ${form.address}`,
        address: form.address,
        inspection_type: form.inspection_type,
        complaint_source: form.complaint_source,
        priority: form.priority,
        has_prior_notice: form.has_prior_notice,
        has_management_plan: form.has_management_plan,
        safety_notes: form.safety_notes,
        status: form.assigned_to ? "assigned" : "pending",
        created_by: user?.id,
      };
      if (form.assigned_to) payload.assigned_to = form.assigned_to;
      const { error } = await (supabase as any).from("biosecurity_jobs").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Biosecurity job created");
      setShowCreateDialog(false);
      setForm({ title: "", address: "", inspection_type: "routine", complaint_source: "public", priority: "normal", has_prior_notice: false, has_management_plan: false, safety_notes: "", assigned_to: "" });
      qc.invalidateQueries({ queryKey: ["biosecurity_jobs"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to create job"),
  });

  // Analytics
  const totalJobs = jobs.length;
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const completedThisMonth = jobs.filter(j => j.status === "completed" && j.completed_at >= thisMonthStart).length;
  const statusCounts = jobs.reduce((acc: Record<string, number>, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});

  const topSpecies = (assessments as any[]).reduce((acc: Record<string, number>, a: any) => {
    if (a.plant_species) acc[a.plant_species] = (acc[a.plant_species] || 0) + 1;
    return acc;
  }, {});
  const topSpeciesEntry = Object.entries(topSpecies).sort((a, b) => (b[1] as number) - (a[1] as number))[0];

  const handleRefresh = () => {
    refetchJobs();
    refetchAssessments();
    refetchNotices();
  };

  return (
    <AppLayout>
      <div className="space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Leaf className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Biosecurity Control</h1>
              <p className="text-sm text-gray-500">Chilean Needlegrass (Nassella neesiana) — Biosecurity Act 1993</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowCreateDialog(true)}>
              <PlusCircle className="h-4 w-4 mr-1" /> New Job
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="jobs"><TreePine className="h-4 w-4 mr-1 inline" />Jobs</TabsTrigger>
            <TabsTrigger value="assessments"><Eye className="h-4 w-4 mr-1 inline" />Assessments</TabsTrigger>
            <TabsTrigger value="notices"><FileText className="h-4 w-4 mr-1 inline" />Notices</TabsTrigger>
            <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-1 inline" />Analytics</TabsTrigger>
          </TabsList>

          {/* JOBS TAB */}
          <TabsContent value="jobs">
            <Card>
              <CardHeader className="bg-emerald-600 text-white rounded-t-lg py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <TreePine className="h-4 w-4" /> Active Jobs
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4" />
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-36 h-7 text-xs bg-white text-gray-800 border-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        {Object.keys(STATUS_BADGE).map(s => (
                          <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {jobsLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading…</div>
                ) : jobs.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No jobs found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Job #</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Title</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Address</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Priority</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Officer</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {jobs.map((job: any) => (
                          <tr key={job.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-emerald-700">{job.job_number || "—"}</td>
                            <td className="px-3 py-2 font-medium max-w-[160px] truncate">{job.title}</td>
                            <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate">
                              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.address}</span>
                            </td>
                            <td className="px-3 py-2">{INSPECTION_LABELS[job.inspection_type] || job.inspection_type}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[job.priority] || ""}`}>
                                {job.priority}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] || ""}`}>
                                {job.status?.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{job.assigned_officer?.full_name || "Unassigned"}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(job.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ASSESSMENTS TAB */}
          <TabsContent value="assessments">
            <Card>
              <CardHeader className="bg-emerald-600 text-white rounded-t-lg py-3 px-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Eye className="h-4 w-4" /> Field Assessments
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {assessmentsLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading…</div>
                ) : assessments.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No assessments submitted yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Officer</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Address</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Species</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Density</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Stage</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Recommended Action</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">AI Confidence</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Submitted</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {assessments.map((a: any) => (
                          <tr key={a.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{a.officer?.full_name || "—"}</td>
                            <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">{a.address}</td>
                            <td className="px-3 py-2 italic text-emerald-700">{a.plant_species || "—"}</td>
                            <td className="px-3 py-2">
                              {a.density_category && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  a.density_category === "high" ? "bg-red-100 text-red-700" :
                                  a.density_category === "medium" ? "bg-orange-100 text-orange-700" :
                                  "bg-green-100 text-green-700"
                                }`}>{a.density_category}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-600">{a.infestation_stage || "—"}</td>
                            <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{a.recommended_action || "—"}</td>
                            <td className="px-3 py-2">
                              {a.ai_confidence != null ? (
                                <span className={`text-xs font-semibold ${a.ai_confidence >= 0.8 ? "text-green-600" : a.ai_confidence >= 0.5 ? "text-orange-500" : "text-red-500"}`}>
                                  {Math.round(a.ai_confidence * 100)}%
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(a.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* NOTICES TAB */}
          <TabsContent value="notices">
            <Card>
              <CardHeader className="bg-emerald-600 text-white rounded-t-lg py-3 px-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Biosecurity Notices
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {noticesLoading ? (
                  <div className="p-8 text-center text-gray-400">Loading…</div>
                ) : notices.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">No notices issued yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Notice #</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Recipient</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Address</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Comply By</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Penalty (NZD)</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Species</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Issued</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {notices.map((n: any) => (
                          <tr key={n.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-emerald-700">{n.notice_number || "—"}</td>
                            <td className="px-3 py-2">{NOTICE_TYPE_LABELS[n.notice_type] || n.notice_type}</td>
                            <td className="px-3 py-2 font-medium">{n.recipient_name || "—"}</td>
                            <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">{n.recipient_address || "—"}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                n.status === "complied" ? "bg-green-100 text-green-700" :
                                n.status === "issued" ? "bg-blue-100 text-blue-700" :
                                n.status === "overdue" ? "bg-red-100 text-red-700" :
                                "bg-gray-100 text-gray-700"
                              }`}>{n.status}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-600">{n.comply_by ? new Date(n.comply_by).toLocaleDateString("en-NZ") : "—"}</td>
                            <td className="px-3 py-2">{n.penalty_amount_nzd != null ? `$${Number(n.penalty_amount_nzd).toLocaleString()}` : "—"}</td>
                            <td className="px-3 py-2 italic text-gray-600">{n.species_identified || "—"}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(n.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ANALYTICS TAB */}
          <TabsContent value="analytics">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-100 p-2 rounded-lg"><TreePine className="h-5 w-5 text-emerald-600" /></div>
                    <div>
                      <p className="text-2xl font-bold">{totalJobs}</p>
                      <p className="text-xs text-gray-500">Total Jobs</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-100 p-2 rounded-lg"><CheckCircle className="h-5 w-5 text-green-600" /></div>
                    <div>
                      <p className="text-2xl font-bold">{completedThisMonth}</p>
                      <p className="text-xs text-gray-500">Completed This Month</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-emerald-100 p-2 rounded-lg"><Leaf className="h-5 w-5 text-emerald-600" /></div>
                    <div>
                      <p className="text-sm font-bold truncate">{topSpeciesEntry ? topSpeciesEntry[0] : "—"}</p>
                      <p className="text-xs text-gray-500">Top Species Found</p>
                      {topSpeciesEntry && <p className="text-xs text-gray-400">{String(topSpeciesEntry[1])} detections</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-100 p-2 rounded-lg"><FileText className="h-5 w-5 text-blue-600" /></div>
                    <div>
                      <p className="text-2xl font-bold">{notices.length}</p>
                      <p className="text-xs text-gray-500">Total Notices</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="bg-emerald-600 text-white rounded-t-lg py-3 px-4">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Jobs by Status
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-24 text-center ${STATUS_BADGE[status] || "bg-gray-100 text-gray-700"}`}>
                        {status.replace("_", " ")}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-3 rounded-full"
                          style={{ width: totalJobs > 0 ? `${((count as number) / totalJobs) * 100}%` : "0%" }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-gray-700 w-8 text-right">{count as number}</span>
                    </div>
                  ))}
                  {Object.keys(statusCounts).length === 0 && (
                    <p className="text-center text-gray-400 py-4">No data available.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Job Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Leaf className="h-5 w-5 text-emerald-600" /> New Biosecurity Job
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Title</Label>
                <Input
                  placeholder="e.g. Chilean Needlegrass inspection – 12 Main Rd"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <Label>Address <span className="text-red-500">*</span></Label>
                <Input
                  placeholder="Property address"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Inspection Type</Label>
                  <Select value={form.inspection_type} onValueChange={v => setForm(f => ({ ...f, inspection_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="routine">Routine</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                      <SelectItem value="targeted">Targeted</SelectItem>
                    </SelectContent>
                  </Select>
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
              </div>
              <div>
                <Label>Complaint Source</Label>
                <Select value={form.complaint_source} onValueChange={v => setForm(f => ({ ...f, complaint_source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="officer_initiated">Officer Initiated</SelectItem>
                    <SelectItem value="council_referral">Council Referral</SelectItem>
                    <SelectItem value="mpi_referral">MPI Referral</SelectItem>
                    <SelectItem value="landowner_report">Landowner Report</SelectItem>
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
              <div className="flex items-center justify-between">
                <Label>Has Prior Notice</Label>
                <Switch
                  checked={form.has_prior_notice}
                  onCheckedChange={v => setForm(f => ({ ...f, has_prior_notice: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Has Management Plan</Label>
                <Switch
                  checked={form.has_management_plan}
                  onCheckedChange={v => setForm(f => ({ ...f, has_management_plan: v }))}
                />
              </div>
              <div>
                <Label>Safety Notes</Label>
                <Textarea
                  placeholder="Any hazards or special instructions…"
                  value={form.safety_notes}
                  onChange={e => setForm(f => ({ ...f, safety_notes: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!form.address || createJobMutation.isPending}
                onClick={() => createJobMutation.mutate()}
              >
                {createJobMutation.isPending ? "Creating…" : "Create Job"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
