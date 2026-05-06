/**
 * LMRBridge -- B-35
 *
 * LMR / Radio Bridge Administration.
 *
 * Manages Zello Gateway integration for Land Mobile Radio (LMR) bridging.
 *
 * Features:
 *   - List bridge configurations (gateway URL, channel, direction, active)
 *   - Add / edit config dialog
 *   - Delete config with confirmation
 *   - Live session log: last 50 relay sessions across all org configs
 *   - Session details: unit ID/alias, direction, duration, transcript snippet
 *   - Emergency sessions highlighted in red
 *   - Stat cards: total sessions, active configs, LMR-to-PTT, PTT-to-LMR counts
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
  Radio,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Siren,
  ArrowRightLeft,
  ArrowRight,
  ArrowLeft,
  Activity,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import type { Database } from '@/types/database'

type BridgeConfig = Database['public']['Tables']['lmr_bridge_config']['Row']
type BridgeSession = Database['public']['Tables']['lmr_bridge_sessions']['Row']

const DIRECTION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  bidirectional: { label: 'Bidirectional', icon: ArrowRightLeft },
  inbound:       { label: 'LMR → PTT',     icon: ArrowRight },
  outbound:      { label: 'PTT → LMR',     icon: ArrowLeft },
}

interface ConfigForm {
  label: string
  gateway_url: string
  gateway_token: string
  radio_channel: string
  direction: string
  is_active: boolean
  notes: string
}

const BLANK_FORM: ConfigForm = {
  label: '',
  gateway_url: '',
  gateway_token: '',
  radio_channel: 'tactical',
  direction: 'bidirectional',
  is_active: true,
  notes: '',
}

function durationLabel(ms: number | null): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function LMRBridge() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BridgeConfig | null>(null)
  const [form, setForm] = useState<ConfigForm>(BLANK_FORM)
  const [deleteTarget, setDeleteTarget] = useState<BridgeConfig | null>(null)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: configs = [], isLoading: loadingConfigs } = useQuery<BridgeConfig[]>({
    queryKey: ['lmr-configs', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('lmr_bridge_config')
        .select('*')
        .eq('organization_id', orgId)
        .order('label')
      return (data ?? []) as BridgeConfig[]
    },
    enabled: !!orgId,
  })

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<BridgeSession[]>({
    queryKey: ['lmr-sessions', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('lmr_bridge_sessions')
        .select('*')
        .eq('organization_id', orgId)
        .order('started_at', { ascending: false })
        .limit(50)
      return (data ?? []) as BridgeSession[]
    },
    enabled: !!orgId,
    refetchInterval: 15_000,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const upsert = useMutation({
    mutationFn: async (payload: Database['public']['Tables']['lmr_bridge_config']['Insert']) => {
      if (editing) {
        const { error } = await supabase.from('lmr_bridge_config').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('lmr_bridge_config').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lmr-configs', orgId] })
      setDialogOpen(false)
      toast.success(editing ? 'Config updated' : 'Config created')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('lmr_bridge_config').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lmr-configs', orgId] })
      setDeleteTarget(null)
      toast.success('Config deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('lmr_bridge_config').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lmr-configs', orgId] }),
  })

  // ── Handlers ──────────────────────────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm(BLANK_FORM)
    setDialogOpen(true)
  }

  function openEdit(cfg: BridgeConfig) {
    setEditing(cfg)
    setForm({
      label: cfg.label,
      gateway_url: cfg.gateway_url,
      gateway_token: '',  // never pre-populate tokens
      radio_channel: cfg.radio_channel,
      direction: cfg.direction,
      is_active: cfg.is_active,
      notes: cfg.notes ?? '',
    })
    setDialogOpen(true)
  }

  function handleSave() {
    if (!form.label.trim()) { toast.error('Label is required'); return }
    if (!form.gateway_url.trim()) { toast.error('Gateway URL is required'); return }
    const payload: Database['public']['Tables']['lmr_bridge_config']['Insert'] = {
      organization_id: orgId,
      label: form.label.trim(),
      gateway_url: form.gateway_url.trim(),
      gateway_token: form.gateway_token.trim() || null,
      radio_channel: form.radio_channel.trim() || 'tactical',
      direction: form.direction,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    }
    upsert.mutate(payload)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeConfigs = configs.filter(c => c.is_active).length
  const lmrToPtt = sessions.filter(s => s.direction === 'lmr_to_ptt').length
  const pttToLmr = sessions.filter(s => s.direction === 'ptt_to_lmr').length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-lg mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-primary" />
              LMR / Radio Bridge
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Zello Gateway integration for Land Mobile Radio bridging
            </p>
          </div>
          <Button onClick={openAdd} className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Config
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Configs', value: configs.length, icon: Radio },
            { label: 'Active', value: activeConfigs, icon: Activity },
            { label: 'LMR → PTT', value: lmrToPtt, icon: ArrowRight },
            { label: 'PTT → LMR', value: pttToLmr, icon: ArrowLeft },
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

        {/* Bridge configs */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bridge Configurations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingConfigs ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : configs.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Radio className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No bridge configs yet.</p>
                <p className="text-xs mt-1">Add a Zello Gateway config to start bridging LMR traffic.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Gateway URL</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map(cfg => {
                    const dir = DIRECTION_LABELS[cfg.direction] ?? DIRECTION_LABELS.bidirectional
                    const DirIcon = dir.icon
                    return (
                      <TableRow key={cfg.id}>
                        <TableCell className="font-medium">{cfg.label}</TableCell>
                        <TableCell className="font-mono text-xs">{cfg.radio_channel}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs">
                            <DirIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {dir.label}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <span className="text-xs text-muted-foreground truncate block">{cfg.gateway_url}</span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={cfg.is_active}
                            onCheckedChange={checked => toggleActive.mutate({ id: cfg.id, is_active: checked })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(cfg)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(cfg)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Session log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Live Session Log
              <span className="ml-auto text-xs font-normal text-muted-foreground">Last 50 · auto-refreshes every 15s</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingSessions ? (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Activity className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No bridge sessions recorded yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Unit / Speaker</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Transcript</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map(s => {
                    const dirEntry = DIRECTION_LABELS[s.direction]
                    const DirIcon = dirEntry?.icon ?? ArrowRightLeft
                    return (
                      <TableRow key={s.id} className={s.is_emergency ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDateTime(s.started_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs">
                            {s.is_emergency && <Siren className="h-3.5 w-3.5 text-red-500" />}
                            <DirIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{dirEntry?.label ?? s.direction}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.direction === 'lmr_to_ptt'
                            ? (s.radio_unit_alias ?? s.radio_unit_id ?? '—')
                            : (s.ptt_speaker_name ?? '—')}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{s.channel_id}</TableCell>
                        <TableCell className="text-xs">{durationLabel(s.duration_ms)}</TableCell>
                        <TableCell className="max-w-[200px]">
                          {s.transcript ? (
                            <span className="text-xs text-muted-foreground italic truncate block">{s.transcript}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bridge Config' : 'Add Bridge Config'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Label *</Label>
              <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Nelson P25 Trunked" className="mt-1" />
            </div>
            <div>
              <Label>Gateway URL * <span className="text-xs text-muted-foreground">(Zello Gateway WebSocket)</span></Label>
              <Input value={form.gateway_url} onChange={e => setForm(f => ({ ...f, gateway_url: e.target.value }))} placeholder="wss://gateway.example.com/connect" className="mt-1 font-mono text-sm" />
            </div>
            <div>
              <Label>Gateway Token <span className="text-xs text-muted-foreground">(leave blank to keep existing)</span></Label>
              <Input type="password" value={form.gateway_token} onChange={e => setForm(f => ({ ...f, gateway_token: e.target.value }))} placeholder="••••••••" className="mt-1" autoComplete="new-password" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Radio Channel</Label>
                <Input value={form.radio_channel} onChange={e => setForm(f => ({ ...f, radio_channel: e.target.value }))} placeholder="tactical" className="mt-1" />
              </div>
              <div>
                <Label>Direction</Label>
                <Select value={form.direction} onValueChange={v => setForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bidirectional">Bidirectional</SelectItem>
                    <SelectItem value="inbound">LMR → PTT only</SelectItem>
                    <SelectItem value="outbound">PTT → LMR only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={checked => setForm(f => ({ ...f, is_active: checked }))} />
              <Label>Active</Label>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {editing ? 'Save changes' : 'Create config'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bridge config?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.label}" and all its session logs will be permanently deleted.
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
