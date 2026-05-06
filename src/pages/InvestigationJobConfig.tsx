/**
 * InvestigationJobConfig — B-77
 *
 * Configuration manager for investigation_job_templates and investigation_job_types.
 *
 * Templates tab:
 *  - KPI: Active / Inactive
 *  - Table: name, job_type, key, default_priority, active badge
 *  - Activate / Deactivate toggle action
 *
 * Types tab:
 *  - KPI: Active / System defaults
 *  - Table: name, value, description, active badge, system badge
 *  - Create new type dialog
 *  - Activate / Deactivate toggle
 *
 * Route: /investigation-job-config — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Briefcase, RefreshCw, AlertCircle, Loader2,
  Plus, CheckCircle2, XCircle, ShieldCheck,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type JobTemplate = Database['public']['Tables']['investigation_job_templates']['Row']
type JobType     = Database['public']['Tables']['investigation_job_types']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvestigationJobConfig() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [tab, setTab] = useState<'templates' | 'types'>('templates')
  const [showCreateType, setShowCreateType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeValue, setNewTypeValue] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: templates = [], isLoading: loadingTemplates, refetch: refetchTemplates } = useQuery<JobTemplate[]>({
    queryKey: ['investigation-job-templates', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_job_templates')
        .select('*')
        .eq('organization_id', orgId!)
        .order('template_name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: jobTypes = [], isLoading: loadingTypes, refetch: refetchTypes } = useQuery<JobType[]>({
    queryKey: ['investigation-job-types', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_job_types')
        .select('*')
        .eq('organization_id', orgId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const toggleTemplate = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('investigation_job_templates')
        .update({ is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Template updated')
      qc.invalidateQueries({ queryKey: ['investigation-job-templates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleType = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('investigation_job_types')
        .update({ is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Type updated')
      qc.invalidateQueries({ queryKey: ['investigation-job-types'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createType = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('investigation_job_types').insert({
        organization_id: orgId!,
        name: newTypeName.trim(),
        value: newTypeValue.trim(),
        description: newTypeDesc.trim() || null,
        is_active: true,
        created_by: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job type created')
      setShowCreateType(false)
      setNewTypeName('')
      setNewTypeValue('')
      setNewTypeDesc('')
      qc.invalidateQueries({ queryKey: ['investigation-job-types'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Investigation Job Config</h1>
              <p className="text-sm text-muted-foreground">Manage job templates and types</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => tab === 'templates' ? refetchTemplates() : refetchTypes()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as 'templates' | 'types')}>
          <TabsList>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="types">Job Types</TabsTrigger>
          </TabsList>

          {/* ── Templates tab ─────────────────────────────────────────── */}
          <TabsContent value="templates" className="space-y-4">
            <div className="grid grid-cols-2 gap-4 mt-2">
              {[
                { label: 'Active',   value: templates.filter(t => t.is_active).length,  colour: 'text-green-700' },
                { label: 'Inactive', value: templates.filter(t => !t.is_active).length, colour: 'text-gray-500' },
              ].map(kpi => (
                <Card key={kpi.label}>
                  <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
                </Card>
              ))}
            </div>

            {loadingTemplates ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : templates.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <AlertCircle className="h-8 w-8" /><p>No templates found</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Job Type</TableHead>
                      <TableHead>Default Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.template_name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{t.template_key}</TableCell>
                        <TableCell>{t.job_type}</TableCell>
                        <TableCell>{t.default_priority ?? '—'}</TableCell>
                        <TableCell>
                          <Badge className={t.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                            {t.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm" variant="outline"
                            disabled={toggleTemplate.isPending}
                            onClick={() => toggleTemplate.mutate({ id: t.id, is_active: !t.is_active })}
                          >
                            {t.is_active ? <><XCircle className="h-4 w-4 mr-1" /> Deactivate</> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Activate</>}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Types tab ─────────────────────────────────────────────── */}
          <TabsContent value="types" className="space-y-4">
            <div className="flex items-center justify-between mt-2">
              <div className="grid grid-cols-2 gap-4 flex-1 mr-4">
                {[
                  { label: 'Active',          value: jobTypes.filter(t => t.is_active).length,          colour: 'text-green-700' },
                  { label: 'System Defaults', value: jobTypes.filter(t => t.is_system_default).length, colour: 'text-blue-700' },
                ].map(kpi => (
                  <Card key={kpi.label}>
                    <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
                    <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
                  </Card>
                ))}
              </div>
              <Button onClick={() => setShowCreateType(true)}>
                <Plus className="h-4 w-4 mr-1" /> New Type
              </Button>
            </div>

            {loadingTypes ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobTypes.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{t.value}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{t.description ?? '—'}</TableCell>
                        <TableCell>
                          {t.is_system_default && <Badge className="bg-blue-100 text-blue-800 mr-1"><ShieldCheck className="h-3 w-3 mr-1" />System</Badge>}
                        </TableCell>
                        <TableCell>
                          <Badge className={t.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                            {t.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm" variant="outline"
                            disabled={toggleType.isPending || !!t.is_system_default}
                            onClick={() => toggleType.mutate({ id: t.id, is_active: !t.is_active })}
                          >
                            {t.is_active ? <><XCircle className="h-4 w-4 mr-1" /> Deactivate</> : <><CheckCircle2 className="h-4 w-4 mr-1" /> Activate</>}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Create type dialog */}
      <Dialog open={showCreateType} onOpenChange={setShowCreateType}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Job Type</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="e.g. Background Check" />
            </div>
            <div className="space-y-1">
              <Label>Value (slug) *</Label>
              <Input value={newTypeValue} onChange={e => setNewTypeValue(e.target.value)} placeholder="e.g. background_check" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={newTypeDesc} onChange={e => setNewTypeDesc(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateType(false)}>Cancel</Button>
            <Button
              disabled={!newTypeName.trim() || !newTypeValue.trim() || createType.isPending}
              onClick={() => createType.mutate()}
            >
              {createType.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
