/**
 * ContractorManager — B-74
 *
 * Admin manager for contractor_profiles and contractor_documents.
 *
 * Features:
 *  - Tabbed: Contractor Profile | Documents
 *  - Profile tab: rate cards (guard/standby/short_notice/travel), compliance flags
 *    (insurance_verified, hs_policy_verified, service_agreement_signed), expiry dates
 *  - Documents tab: document list with type, name, expiry, current flag; mark-current toggle
 *  - KPI row: insurance verified / H&S policy / service agreement / docs expiring
 *
 * Route: /contractor-manager — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, isPast, differenceInDays } from 'date-fns'
import {
  Briefcase, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, XCircle, FileText, Clock, DollarSign,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

type ContractorProfile  = Database['public']['Tables']['contractor_profiles']['Row']
type ContractorDocument = Database['public']['Tables']['contractor_documents']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtRate(rate: number | null | undefined) {
  if (rate == null) return '—'
  return `$${rate.toFixed(2)}/hr`
}

function expiryClass(ts: string | null | undefined) {
  if (!ts) return 'text-muted-foreground'
  const d = parseISO(ts)
  if (isPast(d)) return 'text-red-600 font-semibold'
  if (differenceInDays(d, new Date()) <= 30) return 'text-amber-600 font-semibold'
  return 'text-muted-foreground'
}

function VerifiedBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle2 className="h-3 w-3 mr-1" />Verified
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
      <XCircle className="h-3 w-3 mr-1" />Not Verified
    </Badge>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ContractorManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [docSearch, setDocSearch] = useState('')
  const [tab, setTab] = useState('profile')

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: profiles = [], isLoading: profileLoading, error: profileError, refetch: refetchProfile } = useQuery<ContractorProfile[]>({
    queryKey: ['contractor-profiles', orgId],
    queryFn: async () => {
      let q = supabase.from('contractor_profiles').select('*')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const { data: documents = [], isLoading: docLoading, error: docError, refetch: refetchDocs } = useQuery<ContractorDocument[]>({
    queryKey: ['contractor-documents', orgId],
    queryFn: async () => {
      let q = supabase.from('contractor_documents').select('*').order('created_at', { ascending: false })
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const profile = profiles[0] ?? null  // isOneToOne: one profile per org

  const filteredDocs = documents.filter(d => {
    if (!docSearch) return true
    const s = docSearch.toLowerCase()
    return d.document_name?.toLowerCase().includes(s) || d.document_type?.toLowerCase().includes(s)
  })

  const docsExpiring = documents.filter(d => {
    if (!d.expiry_date) return false
    const diff = differenceInDays(parseISO(d.expiry_date), new Date())
    return diff >= 0 && diff <= 30
  }).length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const toggleCurrent = useMutation({
    mutationFn: async ({ id, is_current }: { id: string; is_current: boolean }) => {
      const { error } = await supabase.from('contractor_documents').update({ is_current }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contractor-documents'] }); toast.success('Document updated') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  const isLoading = profileLoading || docLoading
  const error = profileError || docError

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-indigo-500" />
            <div>
              <h1 className="text-2xl font-bold">Contractor Manager</h1>
              <p className="text-sm text-muted-foreground">Organisation contractor profile, rates, compliance, and documents</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { refetchProfile(); refetchDocs() }} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI row */}
        {profile && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Insurance',         ok: profile.insurance_verified,          expiry: profile.insurance_expiry },
              { label: 'H&S Policy',         ok: profile.hs_policy_verified,          expiry: profile.hs_policy_expiry },
              { label: 'Service Agreement',  ok: profile.service_agreement_signed,    expiry: profile.service_agreement_expiry },
              { label: 'Docs Expiring ≤30d', ok: docsExpiring === 0,                  expiry: null, value: docsExpiring },
            ].map(({ label, ok, expiry, value }) => (
              <Card key={label}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <VerifiedBadge ok={ok} />
                  {expiry && (
                    <p className={`text-xs mt-0.5 ${expiryClass(expiry)}`}>
                      Expires {fmtDate(expiry)}
                    </p>
                  )}
                  {value !== undefined && value > 0 && (
                    <p className="text-xs text-amber-600 font-semibold">{value} document(s)</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

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
              <TabsTrigger value="profile">Contractor Profile</TabsTrigger>
              <TabsTrigger value="documents">
                Documents
                {docsExpiring > 0 && (
                  <Badge className="ml-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs px-1.5">
                    {docsExpiring}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Profile tab */}
            <TabsContent value="profile" className="mt-4">
              {!profile ? (
                <div className="text-center py-12 text-muted-foreground text-sm">No contractor profile found for this organisation.</div>
              ) : (
                <div className="space-y-6">
                  {/* Contact */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Contact Details</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      {[
                        { label: 'Contact Name',  value: profile.contact_name  },
                        { label: 'Role',          value: profile.contact_role  },
                        { label: 'Email',         value: profile.contact_email },
                        { label: 'Phone',         value: profile.contact_phone },
                        { label: 'Accounts Name', value: profile.accounts_name },
                        { label: 'Accounts Email',value: profile.accounts_email},
                        { label: 'Accounts Phone',value: profile.accounts_phone},
                      ].map(({ label, value }) => value ? (
                        <div key={label}>
                          <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
                          <p>{value}</p>
                        </div>
                      ) : null)}
                    </CardContent>
                  </Card>

                  {/* Rates */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-green-600" />
                        Rate Card
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      {[
                        { label: 'Guard Rate',        value: fmtRate(profile.guard_rate_per_hour) },
                        { label: 'Standby Rate',      value: fmtRate(profile.standby_rate_per_hour) },
                        { label: 'Short Notice Rate', value: fmtRate(profile.short_notice_rate_per_hour) },
                        { label: 'Long Term Rate',    value: fmtRate(profile.long_term_rate_per_hour) },
                        { label: 'Travel Rate',       value: profile.travel_rate_per_km != null ? `$${profile.travel_rate_per_km.toFixed(2)}/km` : '—' },
                        { label: 'Long Term Min Days',value: profile.long_term_min_days != null ? `${profile.long_term_min_days} days` : '—' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
                          <p className="font-medium">{value}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {profile.notes && (
                    <Card>
                      <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
                      <CardContent className="text-sm">{profile.notes}</CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Documents tab */}
            <TabsContent value="documents" className="mt-4 space-y-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search documents…"
                  value={docSearch}
                  onChange={e => setDocSearch(e.target.value)}
                  className="pl-8 max-w-xs"
                />
              </div>

              <Card>
                <CardContent className="p-0">
                  {filteredDocs.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">No documents found.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Document Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Expiry</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead>Current</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDocs.map(d => (
                          <TableRow key={d.id}>
                            <TableCell>
                              <a
                                href={d.document_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-blue-600 hover:underline"
                              >
                                <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                                {d.document_name}
                              </a>
                            </TableCell>
                            <TableCell className="text-sm capitalize">{d.document_type?.replace(/_/g, ' ')}</TableCell>
                            <TableCell className={`text-sm ${expiryClass(d.expiry_date)}`}>
                              {fmtDate(d.expiry_date)}
                              {d.expiry_date && isPast(parseISO(d.expiry_date)) && (
                                <span className="ml-1 text-xs">(Expired)</span>
                              )}
                              {d.expiry_date && !isPast(parseISO(d.expiry_date)) && differenceInDays(parseISO(d.expiry_date), new Date()) <= 30 && (
                                <span className="ml-1 text-xs flex items-center gap-1">
                                  <Clock className="h-3 w-3" />Expiring soon
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {d.file_size_bytes != null ? `${(d.file_size_bytes / 1024).toFixed(0)} KB` : '—'}
                            </TableCell>
                            <TableCell>
                              {d.is_current ? (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Current</Badge>
                              ) : (
                                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Archived</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={toggleCurrent.isPending}
                                onClick={() => toggleCurrent.mutate({ id: d.id, is_current: !d.is_current })}
                              >
                                {d.is_current ? 'Archive' : 'Set Current'}
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
          </Tabs>
        )}
      </div>
    </AppLayout>
  )
}
