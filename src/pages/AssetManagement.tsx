/**
 * AssetManagement.tsx
 *
 * Tracks equipment and assets assigned to officers within the organisation:
 * uniforms, communication devices, computing, PPE, access cards, vehicles, and tools.
 *
 * DB tables: asset_types, officer_assets
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import AppLayout from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import {
  Package2,
  Plus,
  Search,
  Filter,
  Smartphone,
  Shirt,
  HardHat,
  Laptop,
  Car,
  KeyRound,
  Wrench,
  MoreHorizontal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

type AssetCategory =
  | 'uniform'
  | 'ppe'
  | 'communication'
  | 'computing'
  | 'vehicle'
  | 'tool'
  | 'access'
  | 'other'

type AssetStatus = 'active' | 'returned' | 'lost' | 'damaged' | 'disposed'

interface AssetType {
  id: string
  organization_id: string
  code: string
  name: string
  category: AssetCategory
  requires_serial_number: boolean
  requires_return: boolean
  replacement_cost: number | null
}

interface OfficerAsset {
  id: string
  organization_id: string
  officer_id: string
  asset_type_id: string
  serial_number: string | null
  asset_tag: string | null
  make: string | null
  model: string | null
  condition: string | null
  issued_date: string
  returned_date: string | null
  status: AssetStatus
  acknowledged: boolean
  notes: string | null
  asset_type?: AssetType
  officer?: { full_name: string; email: string } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  uniform: 'Uniform',
  ppe: 'PPE',
  communication: 'Communication',
  computing: 'Computing',
  vehicle: 'Vehicle',
  tool: 'Tool',
  access: 'Access',
  other: 'Other',
}

const CATEGORY_ICONS: Record<AssetCategory, React.FC<{ className?: string }>> = {
  uniform: Shirt,
  ppe: HardHat,
  communication: Smartphone,
  computing: Laptop,
  vehicle: Car,
  tool: Wrench,
  access: KeyRound,
  other: Package2,
}

const STATUS_CONFIG: Record<AssetStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.FC<{ className?: string }> }> = {
  active:   { label: 'Active',    variant: 'default',     icon: CheckCircle2 },
  returned: { label: 'Returned',  variant: 'secondary',   icon: RefreshCw },
  lost:     { label: 'Lost',      variant: 'destructive', icon: XCircle },
  damaged:  { label: 'Damaged',   variant: 'destructive', icon: AlertTriangle },
  disposed: { label: 'Disposed',  variant: 'outline',     icon: XCircle },
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAssetTypes(orgId: string | null) {
  return useQuery({
    queryKey: ['asset-types', orgId],
    queryFn: async () => {
      let q = (supabase as any).from('asset_types').select('*').order('name')
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as AssetType[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

function useOfficerAssets(orgId: string | null, status: string) {
  return useQuery({
    queryKey: ['officer-assets', orgId, status],
    queryFn: async () => {
      let q = (supabase as any)
        .from('officer_assets')
        .select(`
          *,
          asset_type:asset_types(id, code, name, category, replacement_cost),
          officer:profiles(full_name, email)
        `)
        .order('issued_date', { ascending: false })

      if (orgId) q = q.eq('organization_id', orgId)
      if (status !== 'all') q = q.eq('status', status)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OfficerAsset[]
    },
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  })
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ assets }: { assets: OfficerAsset[] }) {
  const active   = assets.filter(a => a.status === 'active').length
  const lost     = assets.filter(a => a.status === 'lost').length
  const damaged  = assets.filter(a => a.status === 'damaged').length
  const returned = assets.filter(a => a.status === 'returned').length

  const replacementValue = assets
    .filter(a => a.status === 'active')
    .reduce((sum, a) => sum + (a.asset_type?.replacement_cost ?? 0), 0)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2">
      {[
        { label: 'Active Issued', value: active, colorClass: 'text-emerald-700 dark:text-emerald-400', bgClass: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' },
        { label: 'Lost', value: lost, colorClass: 'text-red-700 dark:text-red-400', bgClass: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
        { label: 'Damaged', value: damaged, colorClass: 'text-amber-700 dark:text-amber-400', bgClass: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' },
        { label: 'Returned', value: returned, colorClass: 'text-blue-700 dark:text-blue-400', bgClass: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
        { label: 'Replacement Value', value: `$${replacementValue.toLocaleString()}`, colorClass: 'text-gray-700 dark:text-gray-300', bgClass: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700' },
      ].map(({ label, value, colorClass, bgClass }) => (
        <div key={label} className={`rounded-xl border px-3 py-2.5 ${bgClass}`}>
          <p className={`text-xl font-bold leading-tight ${colorClass}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Asset row ────────────────────────────────────────────────────────────────

function AssetRow({ asset }: { asset: OfficerAsset }) {
  const category = asset.asset_type?.category ?? 'other'
  const CategoryIcon = CATEGORY_ICONS[category as AssetCategory] ?? Package2
  const statusCfg = STATUS_CONFIG[asset.status]
  const StatusIcon = statusCfg.icon

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 px-3 py-2.5 hover:bg-white dark:hover:bg-slate-900 transition-colors">
      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
        <CategoryIcon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{asset.asset_type?.name ?? '—'}</p>
        <p className="text-xs text-muted-foreground truncate">
          {asset.officer
            ? (typeof asset.officer === 'object' && !Array.isArray(asset.officer)
                ? (asset.officer as any).full_name ?? (asset.officer as any).email
                : '—')
            : 'Unassigned'}
          {asset.serial_number && <span className="ml-1 text-gray-400">· SN: {asset.serial_number}</span>}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className="hidden sm:block text-xs text-muted-foreground">{format(new Date(asset.issued_date), 'd MMM yy')}</span>
        <Badge variant={statusCfg.variant} className="flex items-center gap-1 text-xs">
          <StatusIcon className="h-3 w-3" />
          {statusCfg.label}
        </Badge>
        {CATEGORY_LABELS[category as AssetCategory] && (
          <Badge variant="outline" className="hidden lg:flex text-[10px]">
            {CATEGORY_LABELS[category as AssetCategory]}
          </Badge>
        )}
      </div>
    </div>
  )
}

// ─── Asset type card ──────────────────────────────────────────────────────────

function AssetTypeCard({ assetType }: { assetType: AssetType }) {
  const Icon = CATEGORY_ICONS[assetType.category] ?? Package2
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 px-3 py-2.5">
      <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
        <Icon className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{assetType.name}</p>
        <p className="text-xs text-muted-foreground">{assetType.code} · {CATEGORY_LABELS[assetType.category]}</p>
      </div>
      <div className="shrink-0 text-right">
        {assetType.replacement_cost != null && (
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">${assetType.replacement_cost.toLocaleString()}</p>
        )}
        <p className="text-[10px] text-muted-foreground">replacement</p>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AssetManagement() {
  const { user } = useAuthStore()
  const orgId = user?.role === 'master' ? null : user?.organization_id ?? null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const { data: assets = [], isLoading: assetsLoading, refetch } = useOfficerAssets(orgId, statusFilter)
  const { data: assetTypes = [], isLoading: typesLoading } = useAssetTypes(orgId)

  const filtered = assets.filter(a => {
    const name  = a.asset_type?.name?.toLowerCase() ?? ''
    const sn    = a.serial_number?.toLowerCase() ?? ''
    const officer = typeof a.officer === 'object' && a.officer
      ? ((a.officer as any).full_name ?? (a.officer as any).email ?? '')
      : ''
    const matchSearch = !search || name.includes(search.toLowerCase()) || sn.includes(search.toLowerCase()) || officer.toLowerCase().includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || a.asset_type?.category === categoryFilter
    return matchSearch && matchCat
  })

  const orgLabel = user?.role === 'master' ? 'All organisations' : user?.full_name ?? user?.email ?? ''

  return (
    <AppLayout title="Asset Management" description={`Equipment & Asset Register · ${orgLabel}`}>
      <div className="space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-gradient-to-br from-slate-50 via-white to-orange-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 p-4 sm:p-5 shadow-sm">
          <div className="absolute -top-16 -right-12 h-40 w-40 rounded-full bg-orange-200/40 blur-2xl dark:bg-orange-500/10 pointer-events-none" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Package2 className="h-5 w-5 text-orange-600" />
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Asset Management</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Track equipment issued to officers — uniforms, devices, PPE, access cards and more.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── Summary ────────────────────────────────────────────────── */}
        <SummaryBar assets={assets} />

        {/* ── Tabs: Issued Assets / Asset Types ──────────────────────── */}
        <Tabs defaultValue="issued">
          <TabsList className="mb-3">
            <TabsTrigger value="issued">
              Issued Assets
              {assets.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{assets.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="types">
              Asset Types
              {assetTypes.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs">{assetTypes.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Issued Assets tab ──────────────────────────────────── */}
          <TabsContent value="issued" className="space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name, serial, officer…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-40 h-9 text-sm">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Results */}
            {assetsLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading assets…</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center">
                <Package2 className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No assets match the current filters.</p>
                {(search || categoryFilter !== 'all') && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setSearch(''); setCategoryFilter('all') }}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{filtered.length} asset{filtered.length > 1 ? 's' : ''} shown</p>
                {filtered.map(a => <AssetRow key={a.id} asset={a} />)}
              </div>
            )}
          </TabsContent>

          {/* ── Asset Types tab ────────────────────────────────────── */}
          <TabsContent value="types" className="space-y-3">
            {typesLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading asset types…</div>
            ) : assetTypes.length === 0 ? (
              <div className="py-12 text-center">
                <Package2 className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No asset types defined for this organisation yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Asset types are configured in the database via <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1 rounded">asset_types</code>.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{assetTypes.length} type{assetTypes.length > 1 ? 's' : ''}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {assetTypes.map(t => <AssetTypeCard key={t.id} assetType={t} />)}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

      </div>
    </AppLayout>
  )
}
