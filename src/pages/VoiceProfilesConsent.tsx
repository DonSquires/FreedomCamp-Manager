/**
 * VoiceProfilesConsent — B-49
 *
 * Tabbed manager for radio voice profiles and consent records.
 *
 * Profiles tab (radio_voice_profiles):
 *  - KPI: Active / Revoked
 *  - Table: officer_id, provider, model_ref, enrolled_at, revoked_at, active badge
 *  - Revoke action (sets revoked_at = now())
 *
 * Consents tab (radio_voice_consents):
 *  - KPI: Active / Revoked
 *  - Table: officer_id, purpose, provider, retention_days, consented_at, revoked_at, revocation_reason
 *  - Revoke action with reason
 *
 * Route: /voice-profiles — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Mic, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, XCircle, ShieldCheck,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VoiceProfile {
  id: string
  org_id: string
  officer_id: string
  provider: string
  model_ref: string
  enrolled_at: string
  revoked_at: string | null
  is_active: boolean
  created_at: string
}

interface VoiceConsent {
  id: string
  org_id: string
  officer_id: string
  voice_profile_id: string | null
  purpose: string
  retention_days: number
  provider: string
  consented_at: string
  revoked_at: string | null
  revocation_reason: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VoiceProfilesConsent() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const isAdmin = user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master' || user?.role === 'grand_master'
  const qc = useQueryClient()

  const [activeTab, setActiveTab] = useState('profiles')
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<{ type: 'profile' | 'consent'; id: string } | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revoking, setRevoking] = useState(false)

  // ── Profiles query ─────────────────────────────────────────────────────────

  const { data: profiles = [], isLoading: profilesLoading, refetch: refetchProfiles } = useQuery({
    queryKey: ['radio-voice-profiles', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('radio_voice_profiles')
        .select('*')
        .eq('org_id', orgId!)
        .order('enrolled_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as VoiceProfile[]
    },
  })

  // ── Consents query ─────────────────────────────────────────────────────────

  const { data: consents = [], isLoading: consentsLoading, refetch: refetchConsents } = useQuery({
    queryKey: ['radio-voice-consents', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('radio_voice_consents')
        .select('*')
        .eq('org_id', orgId!)
        .order('consented_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as VoiceConsent[]
    },
  })

  // ── Revoke mutations ───────────────────────────────────────────────────────

  const revokeProfile = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await (supabase as any)
        .from('radio_voice_profiles')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['radio-voice-profiles'] })
      toast.success('Voice profile revoked')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to revoke profile'),
  })

  const revokeConsent = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase as any)
        .from('radio_voice_consents')
        .update({ revoked_at: new Date().toISOString(), revocation_reason: reason || null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['radio-voice-consents'] })
      toast.success('Consent revoked')
    },
    onError: (e: any) => toast.error(e.message || 'Failed to revoke consent'),
  })

  function openRevoke(type: 'profile' | 'consent', id: string) {
    setRevokeTarget({ type, id })
    setRevokeReason('')
    setRevokeDialogOpen(true)
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      if (revokeTarget.type === 'profile') {
        await revokeProfile.mutateAsync({ id: revokeTarget.id })
      } else {
        await revokeConsent.mutateAsync({ id: revokeTarget.id, reason: revokeReason })
      }
      setRevokeDialogOpen(false)
    } finally {
      setRevoking(false)
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const profileKPIs = {
    active:  profiles.filter(p => p.is_active && !p.revoked_at).length,
    revoked: profiles.filter(p => !!p.revoked_at).length,
  }

  const consentKPIs = {
    active:  consents.filter(c => !c.revoked_at).length,
    revoked: consents.filter(c => !!c.revoked_at).length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Voice Profiles & Consent" description="Manage officer voice twin profiles and biometric consent records">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-violet-600" />
          <span className="font-semibold text-lg">Voice Profiles & Consent</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { refetchProfiles(); refetchConsents() }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="profiles">
            Voice Profiles
            {profileKPIs.active > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{profileKPIs.active}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="consents">
            Consent Records
            {consentKPIs.active > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">{consentKPIs.active}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Voice Profiles tab ──────────────────────────────────────────────── */}
        <TabsContent value="profiles">
          {/* Profile KPIs */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {[
              { label: 'Active Profiles', value: profileKPIs.active,  icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
              { label: 'Revoked',         value: profileKPIs.revoked, icon: <XCircle className="h-4 w-4" />,      color: 'text-red-600' },
            ].map(k => (
              <Card key={k.label}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    {k.icon}{k.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {!profilesLoading && profiles.length === 0 && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>No voice profiles found. Profiles are created during officer voice enrolment.</span>
            </div>
          )}

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer ID</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model Ref</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revoked At</TableHead>
                  {isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {profilesLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                    </TableCell>
                  </TableRow>
                )}
                {profiles.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.officer_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-sm">{p.provider}</TableCell>
                    <TableCell className="font-mono text-xs max-w-36 truncate">{p.model_ref}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(p.enrolled_at)}</TableCell>
                    <TableCell>
                      {p.revoked_at
                        ? <Badge variant="destructive" className="text-xs">Revoked</Badge>
                        : p.is_active
                          ? <Badge variant="secondary" className="text-xs text-green-700">Active</Badge>
                          : <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(p.revoked_at)}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        {!p.revoked_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 h-7 text-xs"
                            onClick={() => openRevoke('profile', p.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {!profilesLoading && profiles.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 text-right">{profiles.length} profile{profiles.length !== 1 ? 's' : ''}</p>
          )}
        </TabsContent>

        {/* ── Consent Records tab ─────────────────────────────────────────────── */}
        <TabsContent value="consents">
          {/* Consent KPIs */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {[
              { label: 'Active Consents', value: consentKPIs.active,  icon: <ShieldCheck className="h-4 w-4" />, color: 'text-green-600' },
              { label: 'Revoked',         value: consentKPIs.revoked, icon: <XCircle className="h-4 w-4" />,     color: 'text-red-600' },
            ].map(k => (
              <Card key={k.label}>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    {k.icon}{k.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {!consentsLoading && consents.length === 0 && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>No consent records found for this organisation.</span>
            </div>
          )}

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer ID</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Retention (days)</TableHead>
                  <TableHead>Consented At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revoked At</TableHead>
                  <TableHead>Revocation Reason</TableHead>
                  {isAdmin && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {consentsLoading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                    </TableCell>
                  </TableRow>
                )}
                {consents.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.officer_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-sm max-w-40 truncate">{c.purpose}</TableCell>
                    <TableCell className="text-sm">{c.provider}</TableCell>
                    <TableCell className="text-sm text-center">{c.retention_days}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.consented_at)}</TableCell>
                    <TableCell>
                      {c.revoked_at
                        ? <Badge variant="destructive" className="text-xs">Revoked</Badge>
                        : <Badge variant="secondary" className="text-xs text-green-700">Active</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(c.revoked_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-36 truncate">{c.revocation_reason ?? '—'}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        {!c.revoked_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 h-7 text-xs"
                            onClick={() => openRevoke('consent', c.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {!consentsLoading && consents.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 text-right">{consents.length} consent record{consents.length !== 1 ? 's' : ''}</p>
          )}
        </TabsContent>
      </Tabs>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Revoke {revokeTarget?.type === 'profile' ? 'Voice Profile' : 'Consent'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This action will set the <code className="text-xs bg-muted px-1 py-0.5 rounded">revoked_at</code> timestamp immediately. It cannot be undone.
            </p>
            {revokeTarget?.type === 'consent' && (
              <div>
                <Label htmlFor="revoke-reason">Revocation Reason (optional)</Label>
                <Textarea
                  id="revoke-reason"
                  rows={2}
                  placeholder="Reason for revoking this consent…"
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirm Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
