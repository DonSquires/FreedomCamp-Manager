/**
 * InvestigationJobConfig — B-77
 *
 * Admin config for investigation_job_templates and investigation_job_types.
 *
 * Features:
 *  - Tabbed: Job Templates | Job Types
 *
 * Templates tab:
 *  - KPI: Total / Active / Inactive
 *  - Table: template_name, template_key, job_type, default_priority, is_active
 *  - Activate / Deactivate toggle per row
 *
 * Types tab:
 *  - Table: name, value, description, is_active, is_system_default
 *  - Activate / Deactivate toggle per row
 *  - Create new type dialog
 *
 * Route: /investigation-job-config — admin/master
 */

import { useState } from 'react'
import {
  FlaskConical, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, XCircle, Plus,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type InvTemplate = Database['public']['Tables']['investigation_job_templates']['Row']
type InvJobType  = Database['public']['Tables']['investigation_job_types']['Row']

interface NewTypeForm {
  name: string
  value: string
  description: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_COLOURS: Record<string, string> = {
  low:      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  normal:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  medium:   'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function InvestigationJobConfig() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [tab, setTab]               = useState('templates')
  const [searchTpl, setSearchTpl]   = useState('')
  const [searchType, setSearchType] = useState('')
  const [newTypeOpen, setNewTypeOpen] = useState(false)

  const form = useForm<NewTypeForm>({ defaultValues: { name: '', value: '', description: '' } })

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: templates = [], isLoading: tplLoading, error: tplError, refetch: refetchTpl } = useQuery<InvTemplate[]>({
    queryKey: ['investigation-job-templates', orgId],
    queryFn: async () => {
      let q = supabase.from('investigation_job_templates').select('*').order('template_name')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const { data: jobTypes = [], isLoading: typesLoading, error: typesError, refetch: refetchTypes } = useQuery<InvJobType[]>({
    queryKey: ['investigation-job-types', orgId],
    queryFn: async () => {
      let q = supabase.from('investigation_job_types').select('*').order('name')
      if (orgId) q = q.or(`organization_id.eq.${orgId},is_system_default.eq.true`)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredTpl = templates.filter(t =>
    !searchTpl || t.template_name?.toLowerCase().includes(searchTpl.toLowerCase()) ||
    t.template_key?.toLowerCase().includes(searchTpl.toLowerCase()) ||
    t.job_type?.toLowerCase().includes(searchTpl.toLowerCase())
  )

  const filteredTypes = jobTypes.filter(t =>
    !searchType || t.name?.toLowerCase().includes(searchType.toLowerCase()) ||
    t.value?.toLowerCase().includes(searchType.toLowerCase())
  )

  const activeTpl   = templates.filter(t => t.is_active).length
  const inactiveTpl = templates.filter(t => !t.is_active).length

  // ── Mutations ─────────────────────────────────────────────────────────────

  const toggleTemplate = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('investigation_job_templates').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investigation-job-templates'] }); toast.success('Template updated') },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleJobType = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('investigation_job_types').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investigation-job-types'] }); toast.success('Job type updated') },
    onError: (e: Error) => toast.error(e.message),
  })

  const createJobType = useMutation({
    mutationFn: async (values: NewTypeForm) => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      const { error } = await supabase.from('investigation_job_types').insert({
        name: values.name,
        value: values.value,
        description: values.description || null,
        organization_id: orgId,
        created_by: user.id,
        is_active: true,
        is_system_default: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investigation-job-types'] })
      toast.success('Job type created')
      setNewTypeOpen(false)
      form.reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  const isLoading = tplLoading || typesLoading
  const error     = tplError || typesError

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FlaskConical className="h-7 w-7 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Investigation Job Config</h1>
              <p className="text-sm text-muted-foreground">Manage investigation job templates and types</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetchTpl(); refetchTypes() }} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="templates">
                Job Templates
                <Badge className="ml-1.5 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs px-1.5">
                  {templates.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="types">
                Job Types
                <Badge className="ml-1.5 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs px-1.5">
                  {jobTypes.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            {/* ── Templates Tab ─────────────────────────────────────────── */}
            <TabsContent value="templates" className="mt-4 space-y-4">

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Total',    value: templates.length, colour: 'text-slate-600' },
                  { label: 'Active',   value: activeTpl,        colour: 'text-green-600' },
                  { label: 'Inactive', value: inactiveTpl,      colour: inactiveTpl > 0 ? 'text-muted-foreground' : 'text-muted-foreground' },
                ].map(({ label, value, colour }) => (
                  <Card key={label}>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <span className={`text-2xl font-bold ${colour}`}>{value}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="relative max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search templates…"
                  value={searchTpl}
                  onChange={e => setSearchTpl(e.target.value)}
                  className="pl-8"
                />
              </div>

              <Card>
                <CardContent className="p-0">
                  {filteredTpl.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">No templates found.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Template Name</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead>Job Type</TableHead>
                          <TableHead>Default Priority</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTpl.map(t => (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.template_name}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{t.template_key}</TableCell>
                            <TableCell className="text-sm capitalize">{t.job_type?.replace(/_/g, ' ')}</TableCell>
                            <TableCell>
                              {t.default_priority ? (
                                <Badge className={`capitalize ${PRIORITY_COLOURS[t.default_priority] ?? ''}`}>
                                  {t.default_priority}
                                </Badge>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              {t.is_active ? (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Active
                                </Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                  Inactive
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={toggleTemplate.isPending}
                                onClick={() => toggleTemplate.mutate({ id: t.id, is_active: !t.is_active })}
                              >
                                {t.is_active ? (
                                  <><XCircle className="h-3 w-3 mr-1" />Deactivate</>
                                ) : (
                                  <><CheckCircle2 className="h-3 w-3 mr-1" />Activate</>
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Types Tab ─────────────────────────────────────────────── */}
            <TabsContent value="types" className="mt-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search types…"
                    value={searchType}
                    onChange={e => setSearchType(e.target.value)}
                    className="pl-8"
                  />
                </div>

                <Dialog open={newTypeOpen} onOpenChange={setNewTypeOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 mr-1.5" />
                      New Type
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Create Investigation Job Type</DialogTitle>
                    </DialogHeader>
                    <form
                      onSubmit={form.handleSubmit(v => createJobType.mutate(v))}
                      className="space-y-4 mt-2"
                    >
                      <div className="space-y-1">
                        <Label>Name *</Label>
                        <Input {...form.register('name', { required: true })} placeholder="Display name" />
                      </div>
                      <div className="space-y-1">
                        <Label>Value (slug) *</Label>
                        <Input {...form.register('value', { required: true })} placeholder="e.g. welfare_check" />
                      </div>
                      <div className="space-y-1">
                        <Label>Description</Label>
                        <Input {...form.register('description')} placeholder="Optional description" />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setNewTypeOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={createJobType.isPending}>
                          {createJobType.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                          Create
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <Card>
                <CardContent className="p-0">
                  {filteredTypes.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-sm">No job types found.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>System</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTypes.map(t => (
                          <TableRow key={t.id}>
                            <TableCell className="font-medium">{t.name}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{t.value}</TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{t.description ?? '—'}</TableCell>
                            <TableCell>
                              {t.is_system_default ? (
                                <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">System</Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 text-xs">Custom</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {t.is_active ? (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />Active
                                </Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                  Inactive
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {!t.is_system_default && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2"
                                  disabled={toggleJobType.isPending}
                                  onClick={() => toggleJobType.mutate({ id: t.id, is_active: !t.is_active })}
                                >
                                  {t.is_active ? (
                                    <><XCircle className="h-3 w-3 mr-1" />Deactivate</>
                                  ) : (
                                    <><CheckCircle2 className="h-3 w-3 mr-1" />Activate</>
                                  )}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  )
}
