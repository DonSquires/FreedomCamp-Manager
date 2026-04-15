/**
 * ClientMasterList — WILSAR-style Master List of Clients
 *
 * Mirrors the WILSAR "Master List of Clients" screen:
 *  • Searchable table: Client ID, Site Name, Bureau ID, Has Keys,
 *    Suburb/City, Last Response, Last Contact, Contact Name, Contact Phone
 *  • Filters: active only, client code, suburb, region, bureau ID
 *  • Search modes: Client / Bureau
 *  • Actions: Add Client → ClientSites, Delete, Full Details Report
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Building2, Key, Search, Plus, Trash2, FileText, RefreshCw,
  CheckCircle, Clock, Phone, Mail, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientSiteRow {
  id: string
  organization_id: string
  name: string
  client_code: string | null
  bureau_id: string | null
  has_keys: boolean
  city: string | null
  address: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  last_response_at: string | null
  last_contact_at: string | null
  is_active: boolean
  site_type: string
  zone: { name: string } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(ts: string | null) {
  if (!ts) return '—'
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return '—' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClientMasterList() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const orgId = user?.organization_id

  const [searchMode, setSearchMode] = useState<'client' | 'bureau'>('client')
  const [activeFilter, setActiveFilter] = useState<'yes' | 'no' | 'all'>('yes')
  const [search, setSearch] = useState('')
  const [suburbFilter, setSuburbFilter] = useState('')
  const [bureauFilter, setBureauFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ClientSiteRow | null>(null)

  // ── Data ───────────────────────────────────────────────────────────────────

  const { data: sites = [], isLoading, refetch } = useQuery<ClientSiteRow[]>({
    queryKey: ['client-master-list', orgId, activeFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('client_sites')
        .select('id, organization_id, name, client_code, bureau_id, has_keys, city, address, contact_name, contact_phone, contact_email, last_response_at, last_contact_at, is_active, site_type, zone:zones!zone_id(name)')
        .order('name')

      if (user?.role !== 'master') q = q.eq('organization_id', orgId ?? '')
      if (activeFilter === 'yes') q = q.eq('is_active', true)
      if (activeFilter === 'no') q = q.eq('is_active', false)

      const { data, error } = await q
      if (error) throw error
      return data as ClientSiteRow[]
    },
    enabled: !!orgId,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('client_sites').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Client site deleted')
      qc.invalidateQueries({ queryKey: ['client-master-list'] })
      setDeleteTarget(null)
    },
    onError: (e: any) => toast.error(e.message ?? 'Delete failed'),
  })

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = sites.filter(s => {
    const q = search.toLowerCase()
    const matchesSearch = !q || (
      searchMode === 'client'
        ? (s.name.toLowerCase().includes(q) || (s.client_code ?? '').toLowerCase().includes(q))
        : ((s.bureau_id ?? '').toLowerCase().includes(q))
    )
    const matchesSuburb = !suburbFilter || (s.city ?? '').toLowerCase().includes(suburbFilter.toLowerCase())
    const matchesBureau = !bureauFilter || (s.bureau_id ?? '').toLowerCase().includes(bureauFilter.toLowerCase())
    return matchesSearch && matchesSuburb && matchesBureau
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Master List of Clients" description="WILSAR-style searchable client registry">
      <div className="space-y-4">

        {/* ── Search / Filter bar ─────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-4 space-y-3">
            {/* Row 1 */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Show Active Only:</span>
                {(['yes','no','all'] as const).map(v => (
                  <label key={v} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="activeOnly"
                      checked={activeFilter === v}
                      onChange={() => setActiveFilter(v)}
                      className="accent-blue-600"
                    />
                    <span className="capitalize">{v}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm font-medium text-muted-foreground">Search Mode:</span>
                {(['client','bureau'] as const).map(m => (
                  <label key={m} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="searchMode"
                      checked={searchMode === m}
                      onChange={() => setSearchMode(m)}
                      className="accent-blue-600"
                    />
                    <span className="capitalize">{m}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Site / Client ID</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={searchMode === 'client' ? 'Site name or Client ID…' : 'Bureau ID…'}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Suburb / City</Label>
                <Input placeholder="Enter % for all" value={suburbFilter} onChange={e => setSuburbFilter(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bureau ID</Label>
                <Input placeholder="e.g. NZ-STD" value={bureauFilter} onChange={e => setBureauFilter(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => { setSearch(''); setSuburbFilter(''); setBureauFilter('') }}>
                Clear Criteria
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Results table ───────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-700 hover:bg-blue-700">
                  <TableHead className="text-white font-semibold">Client ID</TableHead>
                  <TableHead className="text-white font-semibold">Site Name</TableHead>
                  <TableHead className="text-white font-semibold">Bureau ID</TableHead>
                  <TableHead className="text-white font-semibold">Has Keys</TableHead>
                  <TableHead className="text-white font-semibold">Suburb / City</TableHead>
                  <TableHead className="text-white font-semibold">Last Response</TableHead>
                  <TableHead className="text-white font-semibold">Last Contact</TableHead>
                  <TableHead className="text-white font-semibold">Contact Name</TableHead>
                  <TableHead className="text-white font-semibold">Contact Phone</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                      No clients found. Adjust your search criteria.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((site, i) => (
                  <TableRow
                    key={site.id}
                    className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 ${i % 2 === 0 ? '' : 'bg-muted/30'}`}
                    onClick={() => navigate(`/client-sites`)}
                  >
                    <TableCell className="font-mono text-xs font-semibold text-blue-700">
                      {site.client_code ?? '—'}
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {!site.is_active && (
                        <span className="text-red-500 font-bold mr-1">## INACTIVE ##</span>
                      )}
                      {site.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{site.bureau_id ?? '—'}</TableCell>
                    <TableCell>
                      {site.has_keys
                        ? <CheckCircle className="h-4 w-4 text-green-600" />
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{site.city ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {site.last_response_at
                        ? <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatRelative(site.last_response_at)}</span>
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {site.last_contact_at
                        ? <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatRelative(site.last_contact_at)}</span>
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{site.contact_name ?? '—'}</TableCell>
                    <TableCell className="text-sm font-mono">
                      {site.contact_phone
                        ? <a href={`tel:${site.contact_phone}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline flex items-center gap-1"><Phone className="h-3 w-3" />{site.contact_phone}</a>
                        : '—'}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget(site)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Footer stats ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
          <span>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
          <span className="flex items-center gap-1">
            <Key className="h-3.5 w-3.5 text-amber-500" />
            {sites.filter(s => s.has_keys).length} sites with keys held
          </span>
        </div>

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="flex gap-2 pt-2">
          <Button variant="default" className="bg-blue-700 hover:bg-blue-800 gap-2" onClick={() => navigate('/client-sites')}>
            <Plus className="h-4 w-4" /> Add Client
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-red-600 border-red-300 hover:bg-red-50"
            disabled={!deleteTarget}
            onClick={() => { /* deleteTarget already set from table row — AlertDialog opens automatically */ }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate('/reports-hub')}>
            <FileText className="h-4 w-4" /> Full Details Report
          </Button>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client Site?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>
              {deleteTarget?.client_code && ` (${deleteTarget.client_code})`} and all associated data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  )
}
