/**
 * VoiceProfilesConsent — Sprint 13 / B-49
 *
 * Admin-gated management of radio_voice_profiles and radio_voice_consents.
 * Two tabs: "Voice Profiles" (enrollment/revocation) and "Consent Records" (audit trail).
 * Revocation opens a confirmation dialog requiring a reason.
 *
 * Route: /voice-profiles
 * Roles: admin, admin_officer, master, grand_master
 *
 * Note: radio_* tables are not yet in the generated database.ts snapshot;
 * all Supabase calls use (supabase as any) until types are regenerated.
 */

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { formatInTimeZone } from 'date-fns-tz'
import { AlertTriangle, ArrowLeft, CheckCircle2, Mic, Shield, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ─── Constants ─────────────────────────────────────────────────────────────────

const NZ_TZ = 'Pacific/Auckland'
const ADMIN_ROLES = ['admin', 'admin_officer', 'master', 'grand_master']

// ─── Types ──────────────────────────────────────────────────────────────────────

interface VoiceProfile {
  id: string
  org_id: string
  officer_id: string
  officer_name?: string | null
  provider: string
  model_ref: string
  enrolled_at: string
  revoked_at: string | null
  is_active: boolean
  created_at: string
}

interface ConsentRecord {
  id: string
  org_id: string
  officer_id: string
  officer_name?: string | null
  voice_profile_id: string | null
  purpose: string
  retention_days: number
  provider: string
  consented_at: string
  revoked_at: string | null
  revocation_reason: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null) {
  if (!iso) return '—'
  try {
    return formatInTimeZone(new Date(iso), NZ_TZ, 'dd MMM yyyy HH:mm')
  } catch {
    return iso
  }
}

function statusBadge(isActive: boolean) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium">
      <CheckCircle2 className="h-3 w-3" /> Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400 px-2 py-0.5 text-xs font-medium">
      <XCircle className="h-3 w-3" /> Revoked
    </span>
  )
}

// ─── Revoke Profile Dialog ───────────────────────────────────────────────────────

interface RevokeProfileDialogProps {
  profile: VoiceProfile | null
  onClose: () => void
  onRevoked: () => void
  orgId: string
}

function RevokeProfileDialog({ profile, onClose, onRevoked, orgId }: RevokeProfileDialogProps) {
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('No profile selected')
      if (!reason.trim()) throw new Error('Revocation reason is required')

      const now = new Date().toISOString()

      // Revoke the voice profile
      const { error: profileErr } = await (supabase as any)
        .from('radio_voice_profiles')
        .update({ revoked_at: now })
        .eq('id', profile.id)
        .eq('org_id', orgId)

      if (profileErr) throw profileErr

      // Update any active consents tied to this profile
      const { error: consentErr } = await (supabase as any)
        .from('radio_voice_consents')
        .update({ revoked_at: now, revocation_reason: reason.trim() })
        .eq('voice_profile_id', profile.id)
        .eq('org_id', orgId)
        .is('revoked_at', null)

      if (consentErr) throw consentErr
    },
    onSuccess: () => {
      toast.success('Voice profile revoked', {
        description: 'Synthesis is blocked immediately. Consent records updated.',
      })
      queryClient.invalidateQueries({ queryKey: ['voice-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['voice-consents'] })
      setReason('')
      onRevoked()
      onClose()
    },
    onError: (err: any) => {
      toast.error('Revocation failed', {
        description: err?.message ?? 'Unknown error. Try again.',
      })
    },
  })

  return (
    <Dialog open={!!profile} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Revoke Voice Profile
          </DialogTitle>
          <DialogDescription>
            Revoking this profile immediately blocks voice-twin synthesis for{' '}
            <strong>{profile?.officer_name ?? profile?.officer_id}</strong>.{' '}
            This action cannot be undone — re-enrollment requires a new consent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="revoke-reason" className="text-sm">
              Revocation reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Officer request, contract end, data deletion requirement…"
              className="mt-1.5 text-sm"
              rows={3}
            />
          </div>
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <strong>Note:</strong> Any active consents linked to this profile will also be revoked.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={revokeMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void revokeMutation.mutateAsync()}
            disabled={!reason.trim() || revokeMutation.isPending}
          >
            {revokeMutation.isPending ? 'Revoking…' : 'Revoke Profile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Revoke Consent Dialog ───────────────────────────────────────────────────────

interface RevokeConsentDialogProps {
  consent: ConsentRecord | null
  onClose: () => void
  orgId: string
}

function RevokeConsentDialog({ consent, onClose, orgId }: RevokeConsentDialogProps) {
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!consent) throw new Error('No consent selected')
      if (!reason.trim()) throw new Error('Revocation reason is required')
      const { error } = await (supabase as any)
        .from('radio_voice_consents')
        .update({ revoked_at: new Date().toISOString(), revocation_reason: reason.trim() })
        .eq('id', consent.id)
        .eq('org_id', orgId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Consent revoked')
      queryClient.invalidateQueries({ queryKey: ['voice-consents'] })
      setReason('')
      onClose()
    },
    onError: (err: any) => {
      toast.error('Revocation failed', { description: err?.message ?? 'Unknown error' })
    },
  })

  return (
    <Dialog open={!!consent} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Revoke Consent Record
          </DialogTitle>
          <DialogDescription>
            Revoking this consent record for{' '}
            <strong>{consent?.officer_name ?? consent?.officer_id}</strong> will mark
            it as revoked in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="revoke-consent-reason" className="text-sm">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="revoke-consent-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Officer withdrew consent, GDPR request, policy change…"
              className="mt-1.5 text-sm"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={revokeMutation.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => void revokeMutation.mutateAsync()}
            disabled={!reason.trim() || revokeMutation.isPending}
          >
            {revokeMutation.isPending ? 'Revoking…' : 'Revoke Consent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function VoiceProfilesConsent() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const isAdmin = ADMIN_ROLES.includes(user?.role ?? '')

  const [activeTab, setActiveTab] = useState('profiles')
  const [profileSearch, setProfileSearch] = useState('')
  const [consentSearch, setConsentSearch] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<VoiceProfile | null>(null)
  const [revokeConsentTarget, setRevokeConsentTarget] = useState<ConsentRecord | null>(null)

  // ── Voice Profiles query ────────────────────────────────────────────────────
  const { data: profiles = [], isLoading: profilesLoading, refetch: refetchProfiles } = useQuery<VoiceProfile[]>({
    queryKey: ['voice-profiles', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('radio_voice_profiles')
        .select('id, org_id, officer_id, provider, model_ref, enrolled_at, revoked_at, is_active, created_at')
        .eq('org_id', orgId)
        .order('enrolled_at', { ascending: false })
        .limit(200)
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return (data ?? []) as VoiceProfile[]
    },
    enabled: !!orgId && isAdmin,
    staleTime: 30_000,
    retry: false,
  })

  // ── Consents query ─────────────────────────────────────────────────────────
  const { data: consents = [], isLoading: consentsLoading, refetch: refetchConsents } = useQuery<ConsentRecord[]>({
    queryKey: ['voice-consents', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('radio_voice_consents')
        .select('id, org_id, officer_id, voice_profile_id, purpose, retention_days, provider, consented_at, revoked_at, revocation_reason')
        .eq('org_id', orgId)
        .order('consented_at', { ascending: false })
        .limit(200)
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01') return []
        throw error
      }
      return (data ?? []) as ConsentRecord[]
    },
    enabled: !!orgId && isAdmin,
    staleTime: 30_000,
    retry: false,
  })

  // ── Derived / filtered ─────────────────────────────────────────────────────
  const filteredProfiles = useMemo(() => {
    if (!profileSearch.trim()) return profiles
    const q = profileSearch.toLowerCase()
    return profiles.filter(
      (p) =>
        p.officer_id.toLowerCase().includes(q) ||
        (p.officer_name ?? '').toLowerCase().includes(q) ||
        p.provider.toLowerCase().includes(q)
    )
  }, [profiles, profileSearch])

  const filteredConsents = useMemo(() => {
    if (!consentSearch.trim()) return consents
    const q = consentSearch.toLowerCase()
    return consents.filter(
      (c) =>
        c.officer_id.toLowerCase().includes(q) ||
        (c.officer_name ?? '').toLowerCase().includes(q) ||
        c.purpose.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q)
    )
  }, [consents, consentSearch])

  const profileKpis = useMemo(() => ({
    total:   profiles.length,
    active:  profiles.filter((p) => p.is_active).length,
    revoked: profiles.filter((p) => !p.is_active).length,
  }), [profiles])

  const consentKpis = useMemo(() => ({
    total:   consents.length,
    active:  consents.filter((c) => !c.revoked_at).length,
    revoked: consents.filter((c) => !!c.revoked_at).length,
  }), [consents])

  const handleProfileRevoked = useCallback(() => {
    void refetchProfiles()
    void refetchConsents()
  }, [refetchProfiles, refetchConsents])

  if (!isAdmin) {
    return (
      <AppLayout title="Voice Profiles & Consent" description="Access restricted">
        <Card className="mt-8 max-w-md mx-auto border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <Shield className="h-5 w-5" /> Access Restricted
            </CardTitle>
            <CardDescription>
              This page is only accessible to admin and master roles.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Voice Profiles & Consent"
      description="Manage consented voice-twin profiles and the auditable consent trail"
    >
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/radio')} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Radio
        </Button>
      </div>

      {/* ADR 006 notice */}
      <div className="mb-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
        <strong>ADR 006 — Voice-Twin Governance:</strong> No voice-twin synthesis is permitted without an active
        consent record and an active voice profile. Revocation blocks synthesis within 60 seconds.
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="profiles" className="gap-2">
            <Mic className="h-3.5 w-3.5" />
            Voice Profiles
            {profileKpis.active > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{profileKpis.active} active</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="consents" className="gap-2">
            <Shield className="h-3.5 w-3.5" />
            Consent Records
            {consentKpis.active > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{consentKpis.active} active</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Voice Profiles Tab ────────────────────────────────────────── */}
        <TabsContent value="profiles">
          {/* Profile KPIs */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Total Profiles', value: profileKpis.total, color: 'text-blue-600' },
              { label: 'Active', value: profileKpis.active, color: 'text-emerald-600' },
              { label: 'Revoked', value: profileKpis.revoked, color: 'text-gray-500' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="border shadow-sm">
                <CardContent className="pt-4 pb-3">
                  <p className={`text-2xl font-bold ${color}`}>{profilesLoading ? '—' : value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Profile filter + table */}
          <div className="flex gap-3 mb-3">
            <Input
              value={profileSearch}
              onChange={(e) => setProfileSearch(e.target.value)}
              placeholder="Search officer / provider…"
              className="w-56 h-8 text-xs"
            />
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void refetchProfiles()}>
              Refresh
            </Button>
          </div>

          <Card>
            <div className="rounded-xl overflow-hidden border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Officer ID</TableHead>
                    <TableHead className="text-xs">Provider</TableHead>
                    <TableHead className="text-xs">Model Ref</TableHead>
                    <TableHead className="text-xs">Enrolled (NZ)</TableHead>
                    <TableHead className="text-xs">Revoked (NZ)</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profilesLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredProfiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                        No voice profiles found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProfiles.map((p) => (
                      <TableRow key={p.id} className={!p.is_active ? 'opacity-60' : ''}>
                        <TableCell className="text-xs font-mono truncate max-w-[140px]">{p.officer_name ?? p.officer_id.slice(0, 8) + '…'}</TableCell>
                        <TableCell className="text-xs">{p.provider}</TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[100px] text-muted-foreground">{p.model_ref}</TableCell>
                        <TableCell className="text-xs">{fmtTs(p.enrolled_at)}</TableCell>
                        <TableCell className="text-xs">{fmtTs(p.revoked_at)}</TableCell>
                        <TableCell>{statusBadge(p.is_active)}</TableCell>
                        <TableCell className="text-right">
                          {p.is_active && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                              onClick={() => setRevokeTarget(p)}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {!profilesLoading && filteredProfiles.length > 0 && (
              <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                {filteredProfiles.length} profile{filteredProfiles.length !== 1 ? 's' : ''}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ─── Consent Records Tab ──────────────────────────────────────────── */}
        <TabsContent value="consents">
          {/* Consent KPIs */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Total Consents', value: consentKpis.total, color: 'text-blue-600' },
              { label: 'Active', value: consentKpis.active, color: 'text-emerald-600' },
              { label: 'Revoked', value: consentKpis.revoked, color: 'text-gray-500' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="border shadow-sm">
                <CardContent className="pt-4 pb-3">
                  <p className={`text-2xl font-bold ${color}`}>{consentsLoading ? '—' : value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Consent filter + table */}
          <div className="flex gap-3 mb-3">
            <Input
              value={consentSearch}
              onChange={(e) => setConsentSearch(e.target.value)}
              placeholder="Search officer / purpose…"
              className="w-56 h-8 text-xs"
            />
            <Button size="sm" variant="ghost" className="h-8" onClick={() => void refetchConsents()}>
              Refresh
            </Button>
          </div>

          <Card>
            <div className="rounded-xl overflow-hidden border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs">Officer</TableHead>
                    <TableHead className="text-xs">Purpose</TableHead>
                    <TableHead className="text-xs">Provider</TableHead>
                    <TableHead className="text-xs">Retention</TableHead>
                    <TableHead className="text-xs">Consented (NZ)</TableHead>
                    <TableHead className="text-xs">Revoked (NZ)</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consentsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredConsents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                        No consent records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredConsents.map((c) => {
                      const isActive = !c.revoked_at
                      return (
                        <TableRow key={c.id} className={!isActive ? 'opacity-60' : ''}>
                          <TableCell className="text-xs font-mono truncate max-w-[130px]">{c.officer_name ?? c.officer_id.slice(0, 8) + '…'}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate">{c.purpose}</TableCell>
                          <TableCell className="text-xs">{c.provider}</TableCell>
                          <TableCell className="text-xs">{c.retention_days}d</TableCell>
                          <TableCell className="text-xs">{fmtTs(c.consented_at)}</TableCell>
                          <TableCell className="text-xs">
                            {c.revoked_at ? (
                              <span title={c.revocation_reason ?? undefined}>{fmtTs(c.revoked_at)}</span>
                            ) : '—'}
                          </TableCell>
                          <TableCell>{statusBadge(isActive)}</TableCell>
                          <TableCell className="text-right">
                            {isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                                onClick={() => setRevokeConsentTarget(c)}
                              >
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {!consentsLoading && filteredConsents.length > 0 && (
              <div className="px-4 py-2 text-xs text-muted-foreground border-t">
                {filteredConsents.length} consent record{filteredConsents.length !== 1 ? 's' : ''}
                {consents.length >= 200 && ' (capped at 200)'}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Revoke dialogs */}
      <RevokeProfileDialog
        profile={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onRevoked={handleProfileRevoked}
        orgId={orgId}
      />
      <RevokeConsentDialog
        consent={revokeConsentTarget}
        onClose={() => setRevokeConsentTarget(null)}
        orgId={orgId}
      />
    </AppLayout>
  )
}
