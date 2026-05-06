/**
 * DynamicPricing — B-32
 *
 * Admin page to manage time-of-day / day-of-week parking pricing rules.
 *
 * Features:
 *   - List all pricing_rules for the org (with zone name, time restrictions,
 *     multiplier / flat-override, active toggle)
 *   - Add / edit rule dialog (zone picker, day-of-week, hour range, multiplier
 *     OR flat override, label, notes)
 *   - Delete rule with confirmation
 *   - Live price preview card: pick a zone and datetime to see effective fee
 *   - 4 summary stat cards: Total rules, Active rules, Zone-specific, Org-wide
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Gauge,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  DollarSign,
  ToggleLeft,
  Globe,
  MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import type { Database } from '@/types/database'

type PricingRule = Database['public']['Tables']['pricing_rules']['Row']
type ZoneRow = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name' | 'fee_nzd'>

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatHour(h: number | null) {
  if (h === null) return '—'
  const suffix = h >= 12 ? 'pm' : 'am'
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${display}${suffix}`
}

function timeLabel(rule: PricingRule) {
  const day = rule.day_of_week !== null ? DAY_NAMES[rule.day_of_week] : 'Every day'
  if (rule.hour_from === null) return day
  return `${day} ${formatHour(rule.hour_from)}–${formatHour(rule.hour_to)}`
}

interface RuleForm {
  zone_id: string | ''
  label: string
  day_of_week: string | ''
  hour_from: string | ''
  hour_to: string | ''
  mode: 'multiplier' | 'flat'
  multiplier: string
  flat_override_nzd: string
  is_active: boolean
  notes: string
}

const BLANK_FORM: RuleForm = {
  zone_id: '',
  label: '',
  day_of_week: '',
  hour_from: '',
  hour_to: '',
  mode: 'multiplier',
  multiplier: '1.0',
  flat_override_nzd: '',
  is_active: true,
  notes: '',
}

export default function DynamicPricing() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PricingRule | null>(null)
  const [form, setForm] = useState<RuleForm>(BLANK_FORM)
  const [deleteTarget, setDeleteTarget] = useState<PricingRule | null>(null)

  // Preview state
  const [previewZoneId, setPreviewZoneId] = useState('')
  const [previewDatetime, setPreviewDatetime] = useState(() => {
    const now = new Date()
    return now.toISOString().slice(0, 16)
  })
  const [previewResult, setPreviewResult] = useState<{ effective_fee_nzd: number; applied_rule_label: string | null; base_fee_nzd: number } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: rules = [], isLoading } = useQuery<PricingRule[]>({
    queryKey: ['pricing-rules', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('organization_id', orgId)
        .order('label')
      return (data ?? []) as PricingRule[]
    },
    enabled: !!orgId,
  })

  const { data: zones = [] } = useQuery<ZoneRow[]>({
    queryKey: ['zones-minimal', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name, fee_nzd')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      return (data ?? []) as ZoneRow[]
    },
    enabled: !!orgId,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const upsert = useMutation({
    mutationFn: async (payload: Database['public']['Tables']['pricing_rules']['Insert']) => {
      if (editing) {
        const { error } = await supabase
          .from('pricing_rules')
          .update(payload)
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('pricing_rules').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-rules', orgId] })
      setDialogOpen(false)
      toast.success(editing ? 'Rule updated' : 'Rule created')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pricing_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pricing-rules', orgId] })
      setDeleteTarget(null)
      toast.success('Rule deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('pricing_rules')
        .update({ is_active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pricing-rules', orgId] }),
  })

  // ── Handlers ──────────────────────────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm(BLANK_FORM)
    setDialogOpen(true)
  }

  function openEdit(rule: PricingRule) {
    setEditing(rule)
    setForm({
      zone_id: rule.zone_id ?? '',
      label: rule.label,
      day_of_week: rule.day_of_week !== null ? String(rule.day_of_week) : '',
      hour_from: rule.hour_from !== null ? String(rule.hour_from) : '',
      hour_to: rule.hour_to !== null ? String(rule.hour_to) : '',
      mode: rule.flat_override_nzd !== null ? 'flat' : 'multiplier',
      multiplier: String(rule.multiplier),
      flat_override_nzd: rule.flat_override_nzd !== null ? String(rule.flat_override_nzd) : '',
      is_active: rule.is_active,
      notes: rule.notes ?? '',
    })
    setDialogOpen(true)
  }

  function buildPayload(): Database['public']['Tables']['pricing_rules']['Insert'] {
    return {
      organization_id: orgId,
      zone_id: form.zone_id || null,
      label: form.label.trim(),
      day_of_week: form.day_of_week !== '' ? Number(form.day_of_week) : null,
      hour_from: form.hour_from !== '' ? Number(form.hour_from) : null,
      hour_to: form.hour_to !== '' ? Number(form.hour_to) : null,
      multiplier: form.mode === 'multiplier' ? Number(form.multiplier) : 1.0,
      flat_override_nzd: form.mode === 'flat' && form.flat_override_nzd !== '' ? Number(form.flat_override_nzd) : null,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    }
  }

  function handleSave() {
    if (!form.label.trim()) { toast.error('Label is required'); return }
    upsert.mutate(buildPayload())
  }

  async function handlePreview() {
    if (!previewZoneId) { toast.error('Select a zone to preview'); return }
    setPreviewLoading(true)
    try {
      const result = await edgeFunctions.calculateDynamicPrice({
        zone_id: previewZoneId,
        datetime_iso: new Date(previewDatetime).toISOString(),
      })
      setPreviewResult(result as unknown as { effective_fee_nzd: number; applied_rule_label: string | null; base_fee_nzd: number })
    } catch {
      toast.error('Preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeCount = rules.filter(r => r.is_active).length
  const zoneSpecific = rules.filter(r => r.zone_id !== null).length
  const orgWide = rules.filter(r => r.zone_id === null).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-lg mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gauge className="h-6 w-6 text-primary" />
              Dynamic Pricing Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Set time-of-day and day-of-week pricing rules for parking zones
            </p>
          </div>
          <Button onClick={openAdd} className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Rule
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Rules', value: rules.length, icon: Gauge },
            { label: 'Active', value: activeCount, icon: ToggleLeft },
            { label: 'Zone-specific', value: zoneSpecific, icon: MapPin },
            { label: 'Org-wide', value: orgWide, icon: Globe },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <Icon className="h-8 w-8 text-muted-foreground opacity-40" />
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Price preview */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Price Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[160px]">
                <Label className="text-xs">Zone</Label>
                <Select value={previewZoneId} onValueChange={setPreviewZoneId}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="Select zone…" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <Label className="text-xs">Datetime</Label>
                <Input
                  type="datetime-local"
                  value={previewDatetime}
                  onChange={e => setPreviewDatetime(e.target.value)}
                  className="h-8 text-sm mt-1"
                />
              </div>
              <Button size="sm" onClick={handlePreview} disabled={previewLoading}>
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Preview'}
              </Button>
            </div>
            {previewResult && (
              <div className="mt-3 p-3 rounded bg-muted text-sm space-y-1">
                <p>Base fee: <span className="font-semibold">${previewResult.base_fee_nzd?.toFixed(2) ?? '—'} / hr</span></p>
                <p>Effective fee: <span className="font-semibold text-primary">${previewResult.effective_fee_nzd?.toFixed(2)} / hr</span></p>
                {previewResult.applied_rule_label && (
                  <p className="text-muted-foreground text-xs">Rule applied: {previewResult.applied_rule_label}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rules table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pricing Rules</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading…</span>
              </div>
            ) : rules.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Gauge className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No pricing rules yet.</p>
                <p className="text-xs mt-1">Add a rule to override zone base fees for specific times.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.label}</TableCell>
                      <TableCell>
                        {r.zone_id ? (
                          <div className="flex items-center gap-1 text-xs">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            {zones.find(z => z.id === r.zone_id)?.name ?? r.zone_id.slice(0, 8)}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">All zones</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{timeLabel(r)}</TableCell>
                      <TableCell>
                        {r.flat_override_nzd !== null ? (
                          <span className="font-semibold text-sm">${r.flat_override_nzd.toFixed(2)}/hr</span>
                        ) : (
                          <span className="font-semibold text-sm">×{r.multiplier.toFixed(2)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={r.is_active}
                          onCheckedChange={checked => toggleActive.mutate({ id: r.id, is_active: checked })}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Pricing Rule' : 'Add Pricing Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Label *</Label>
              <Input
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Weekend peak rate"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Zone (leave blank for all zones)</Label>
              <Select value={form.zone_id} onValueChange={v => setForm(f => ({ ...f, zone_id: v === '__all__' ? '' : v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="All zones (org-wide)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All zones (org-wide)</SelectItem>
                  {zones.map(z => (
                    <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Day of week</Label>
                <Select value={form.day_of_week} onValueChange={v => setForm(f => ({ ...f, day_of_week: v === '__any__' ? '' : v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Every day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">Every day</SelectItem>
                    {DAY_NAMES.map((d, i) => (
                      <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Hour range (24h)</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    placeholder="From"
                    value={form.hour_from}
                    onChange={e => setForm(f => ({ ...f, hour_from: e.target.value }))}
                    className="w-20 text-sm"
                  />
                  <span className="self-center text-muted-foreground">–</span>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    placeholder="To"
                    value={form.hour_to}
                    onChange={e => setForm(f => ({ ...f, hour_to: e.target.value }))}
                    className="w-20 text-sm"
                  />
                </div>
              </div>
            </div>
            <div>
              <Label>Rate type</Label>
              <div className="flex gap-3 mt-1">
                {(['multiplier', 'flat'] as const).map(mode => (
                  <label key={mode} className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input
                      type="radio"
                      checked={form.mode === mode}
                      onChange={() => setForm(f => ({ ...f, mode }))}
                    />
                    {mode === 'multiplier' ? 'Multiplier (×)' : 'Flat override ($/hr)'}
                  </label>
                ))}
              </div>
            </div>
            {form.mode === 'multiplier' ? (
              <div>
                <Label>Multiplier</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={form.multiplier}
                  onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))}
                  className="mt-1"
                  placeholder="e.g. 1.5 for 50% increase"
                />
              </div>
            ) : (
              <div>
                <Label>Flat rate (NZD / hr)</Label>
                <Input
                  type="number"
                  step="0.50"
                  min="0"
                  value={form.flat_override_nzd}
                  onChange={e => setForm(f => ({ ...f, flat_override_nzd: e.target.value }))}
                  className="mt-1"
                  placeholder="e.g. 5.00"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={checked => setForm(f => ({ ...f, is_active: checked }))}
              />
              <Label>Active</Label>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editing ? 'Save changes' : 'Create rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pricing rule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.label}" will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
