import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useClientAccessPolicy } from '@/hooks/useClientAccessPolicy'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Building2, DollarSign, Layers, Users2, Wallet } from 'lucide-react'

interface OrganizationRow {
  id: string
  name: string
  organization_type: string | null
  is_active: boolean | null
}

interface InvoiceRow {
  id: string
  client_organization_id: string | null
  total_cents: number | null
  amount_paid_cents: number | null
  balance_cents: number | null
  status: string | null
  invoice_date: string | null
}

interface ShiftRow {
  id: string
  organization_id: string
  officer_id: string | null
  shift_date: string
  start_time: string | null
  end_time: string | null
  break_minutes: number | null
  status: string
  guard_cost_rate: number | null
  client_charge_rate: number | null
}

interface UserRow {
  id: string
  organization_id: string | null
  role: string | null
  is_active: boolean | null
  first_name: string | null
  last_name: string | null
  email: string
}

interface ProviderCosts {
  github: number
  railway: number
  runpod: number
  supabase: number
  hpanel: number
  otherOps: number
}

const PROVIDER_COSTS_STORAGE_KEY = 'cost-intel-provider-costs-v1'
const DEFAULT_PROVIDER_COSTS: ProviderCosts = {
  github: 420,
  railway: 680,
  runpod: 520,
  supabase: 760,
  hpanel: 120,
  otherOps: 450,
}

function formatNZD(value: number): string {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(value)
}

function toNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function calcShiftHours(shift: ShiftRow): number {
  if (!shift.start_time || !shift.end_time) return 0
  const start = new Date(`${shift.shift_date}T${shift.start_time}`)
  const end = new Date(`${shift.shift_date}T${shift.end_time}`)
  const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  const breakHours = Math.max(0, (shift.break_minutes ?? 0) / 60)
  return Math.max(0, diffHours - breakHours)
}

function isShiftCountable(status: string): boolean {
  const s = status.toLowerCase()
  return !s.includes('cancel') && s !== 'draft'
}

export default function CostIntelligencePage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ organizationId?: string }>()
  const { isClientRole, financeEnabled } = useClientAccessPolicy()
  const [providerCosts, setProviderCosts] = useState<ProviderCosts>(DEFAULT_PROVIDER_COSTS)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROVIDER_COSTS_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<ProviderCosts>
      setProviderCosts((prev) => ({ ...prev, ...parsed }))
    } catch {
      // Ignore invalid local settings and continue with defaults.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(PROVIDER_COSTS_STORAGE_KEY, JSON.stringify(providerCosts))
  }, [providerCosts])

  const today = useMemo(() => new Date(), [])
  const startOfWindow = useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }, [today])

  const { data: organizations = [] } = useQuery({
    queryKey: ['cost-intel-organizations'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name, organization_type, is_active')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      return (data ?? []) as OrganizationRow[]
    },
  })

  const { data: invoices = [] } = useQuery({
    queryKey: ['cost-intel-invoices', startOfWindow],
    queryFn: async () => {
      let q = (supabase as any)
        .from('crm_invoices')
        .select('id, client_organization_id, total_cents, amount_paid_cents, balance_cents, status, invoice_date')
        .gte('invoice_date', startOfWindow)
        .limit(5000)

      if (isClientRole && user?.organization_id) {
        q = q.eq('client_organization_id', user.organization_id)
      }

      const { data, error } = await q
      if (error) {
        console.warn('cost-intel invoices query error:', error.message)
        return []
      }
      return (data ?? []) as InvoiceRow[]
    },
  })

  const { data: shifts = [] } = useQuery({
    queryKey: ['cost-intel-shifts', startOfWindow],
    queryFn: async () => {
      let q = (supabase as any)
        .from('roster_shifts')
        .select('id, organization_id, officer_id, shift_date, start_time, end_time, break_minutes, status, guard_cost_rate, client_charge_rate')
        .gte('shift_date', startOfWindow)
        .limit(10000)

      if (isClientRole && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      }

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ShiftRow[]
    },
  })

  const { data: users = [] } = useQuery({
    queryKey: ['cost-intel-users'],
    queryFn: async () => {
      let q = (supabase as any)
        .from('user_profiles')
        .select('id, organization_id, role, is_active, first_name, last_name, email')
        .limit(8000)

      if (isClientRole && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      }

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as UserRow[]
    },
  })

  const providerMonthlyCost = useMemo(
    () => Object.values(providerCosts).reduce((sum, v) => sum + v, 0),
    [providerCosts]
  )

  const visibleOrganizations = useMemo(() => {
    if (isClientRole && user?.organization_id) {
      return organizations.filter((o) => o.id === user.organization_id)
    }
    if (user?.role === 'admin' || user?.role === 'admin_officer') {
      return organizations.filter((o) => o.id === user.organization_id)
    }
    return organizations
  }, [organizations, isClientRole, user?.organization_id, user?.role])

  const computedOrgRows = useMemo(() => {
    const orgCount = Math.max(1, visibleOrganizations.length)
    const externalAllocationPerOrg = providerMonthlyCost / orgCount

    return visibleOrganizations.map((org) => {
      const orgShifts = shifts.filter((s) => s.organization_id === org.id && isShiftCountable(s.status))
      const orgInvoices = invoices.filter((inv) => inv.client_organization_id === org.id)
      const orgUsers = users.filter((u) => u.organization_id === org.id && u.is_active !== false)

      const shiftHours = orgShifts.reduce((sum, s) => sum + calcShiftHours(s), 0)
      const labourCost = orgShifts.reduce((sum, s) => sum + calcShiftHours(s) * (s.guard_cost_rate ?? 0), 0)
      const shiftRevenue = orgShifts.reduce((sum, s) => sum + calcShiftHours(s) * (s.client_charge_rate ?? 0), 0)
      const billed = orgInvoices.reduce((sum, inv) => sum + ((inv.total_cents ?? 0) / 100), 0)
      const collected = orgInvoices.reduce((sum, inv) => sum + ((inv.amount_paid_cents ?? 0) / 100), 0)
      const outstanding = orgInvoices.reduce((sum, inv) => sum + ((inv.balance_cents ?? 0) / 100), 0)

      const platformOverhead = Math.max(0, labourCost * 0.08)
      const estimatedMonthlyCost = labourCost + platformOverhead + externalAllocationPerOrg
      const recommendedBillBack = Math.max(estimatedMonthlyCost, billed, shiftRevenue)
      const activeUsers = orgUsers.length
      const perUserCost = activeUsers > 0 ? estimatedMonthlyCost / activeUsers : 0
      const liveDailyExpense = estimatedMonthlyCost / 30

      return {
        organizationId: org.id,
        organizationName: org.name,
        activeUsers,
        shiftHours,
        labourCost,
        platformOverhead,
        externalAllocationPerOrg,
        estimatedMonthlyCost,
        recommendedBillBack,
        liveDailyExpense,
        billed,
        collected,
        outstanding,
        perUserCost,
      }
    })
  }, [visibleOrganizations, shifts, invoices, users, providerMonthlyCost])

  const selectedOrganizationId = useMemo(() => {
    if (params.organizationId) return params.organizationId
    if (isClientRole && user?.organization_id) return user.organization_id
    return computedOrgRows[0]?.organizationId ?? null
  }, [params.organizationId, isClientRole, user?.organization_id, computedOrgRows])

  const selectedOrg = useMemo(
    () => computedOrgRows.find((row) => row.organizationId === selectedOrganizationId) ?? null,
    [computedOrgRows, selectedOrganizationId]
  )

  const selectedOrgUsers = useMemo(() => {
    if (!selectedOrg) return []
    const orgUsers = users.filter((u) => u.organization_id === selectedOrg.organizationId && u.is_active !== false)
    const orgShifts = shifts.filter((s) => s.organization_id === selectedOrg.organizationId && isShiftCountable(s.status))

    const userCount = Math.max(1, orgUsers.length)
    const allocatedOverheadPerUser = (selectedOrg.platformOverhead + selectedOrg.externalAllocationPerOrg) / userCount

    return orgUsers.map((u) => {
      const workerShifts = orgShifts.filter((s) => s.officer_id === u.id)
      const hours = workerShifts.reduce((sum, s) => sum + calcShiftHours(s), 0)
      const directCost = workerShifts.reduce((sum, s) => sum + calcShiftHours(s) * (s.guard_cost_rate ?? 0), 0)
      const directRevenue = workerShifts.reduce((sum, s) => sum + calcShiftHours(s) * (s.client_charge_rate ?? 0), 0)
      const totalCost = directCost + allocatedOverheadPerUser
      const billBackTarget = Math.max(totalCost * 1.15, directRevenue)

      const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email

      return {
        id: u.id,
        displayName,
        role: u.role ?? 'unknown',
        hours,
        directCost,
        allocatedOverheadPerUser,
        totalCost,
        directRevenue,
        billBackTarget,
      }
    }).sort((a, b) => b.totalCost - a.totalCost)
  }, [selectedOrg, users, shifts])

  const unifiedMode = location.pathname.startsWith('/costing-system')

  if (isClientRole && !financeEnabled) {
    return (
      <AppLayout title="Cost Intelligence" description="Finance access is disabled for your portal policy.">
        <Card>
          <CardHeader>
            <CardTitle>Finance module disabled</CardTitle>
            <CardDescription>
              Your organization has disabled client finance visibility. Contact your account manager to enable cost pages.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Cost Intelligence"
      description="Unified provider costs, organization expense telemetry, and per-user bill-back hierarchy."
    >
      <div className="space-y-6">
        {unifiedMode && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Unified Costing System</CardTitle>
              <CardDescription>
                Platform-level monthly run-rate across GitHub, Railway, RunPod, Supabase, hPanel, and operational overhead.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="text-xs text-muted-foreground">GitHub</label>
                  <Input
                    value={providerCosts.github}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, github: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Railway</label>
                  <Input
                    value={providerCosts.railway}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, railway: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">RunPod</label>
                  <Input
                    value={providerCosts.runpod}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, runpod: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Supabase</label>
                  <Input
                    value={providerCosts.supabase}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, supabase: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">hPanel</label>
                  <Input
                    value={providerCosts.hpanel}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, hpanel: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Other Ops</label>
                  <Input
                    value={providerCosts.otherOps}
                    onChange={(e) => setProviderCosts((prev) => ({ ...prev, otherOps: toNumber(e.target.value) }))}
                    type="number"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Badge variant="secondary" className="text-sm">
                  Monthly provider run-rate: {formatNZD(providerMonthlyCost)}
                </Badge>
                <Badge variant="outline" className="text-sm">
                  Daily baseline: {formatNZD(providerMonthlyCost / 30)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization Live Expense Board</CardTitle>
            <CardDescription>
              Daily-updating estimate from the last 30 days of invoices, shifts, rates, and overhead allocation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isClientRole && (
              <div className="max-w-sm">
                <label className="text-xs text-muted-foreground">Open organization</label>
                <Select
                  value={selectedOrganizationId ?? ''}
                  onValueChange={(value) => navigate(`/organization-costs/${value}`)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {computedOrgRows.map((row) => (
                      <SelectItem key={row.organizationId} value={row.organizationId}>{row.organizationName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Live Daily Expense</TableHead>
                    <TableHead>Estimated Monthly Cost</TableHead>
                    <TableHead>Recommended Bill-Back</TableHead>
                    <TableHead>Per-User Cost</TableHead>
                    <TableHead>Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computedOrgRows.map((row) => (
                    <TableRow
                      key={row.organizationId}
                      className={selectedOrganizationId === row.organizationId ? 'bg-muted/40' : ''}
                    >
                      <TableCell>
                        <button
                          className="font-medium hover:underline"
                          onClick={() => navigate(`/organization-costs/${row.organizationId}`)}
                        >
                          {row.organizationName}
                        </button>
                      </TableCell>
                      <TableCell>{formatNZD(row.liveDailyExpense)}</TableCell>
                      <TableCell>{formatNZD(row.estimatedMonthlyCost)}</TableCell>
                      <TableCell>{formatNZD(row.recommendedBillBack)}</TableCell>
                      <TableCell>{formatNZD(row.perUserCost)}</TableCell>
                      <TableCell>{formatNZD(row.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {selectedOrg && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users2 className="h-4 w-4" /> Per-User Cost and Bill-Back Hierarchy</CardTitle>
              <CardDescription>
                {selectedOrg.organizationName}: direct labor cost + allocated overhead + bill-back target.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Active Users</p>
                  <p className="text-lg font-semibold">{selectedOrg.activeUsers}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Shift Hours (30d)</p>
                  <p className="text-lg font-semibold">{selectedOrg.shiftHours.toFixed(1)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Collected (30d)</p>
                  <p className="text-lg font-semibold">{formatNZD(selectedOrg.collected)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Billed (30d)</p>
                  <p className="text-lg font-semibold">{formatNZD(selectedOrg.billed)}</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Direct Cost</TableHead>
                      <TableHead>Allocated Overhead</TableHead>
                      <TableHead>Total Unit Cost</TableHead>
                      <TableHead>Bill-Back Target</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrgUsers.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.displayName}</TableCell>
                        <TableCell>{item.role}</TableCell>
                        <TableCell>{item.hours.toFixed(1)}</TableCell>
                        <TableCell>{formatNZD(item.directCost)}</TableCell>
                        <TableCell>{formatNZD(item.allocatedOverheadPerUser)}</TableCell>
                        <TableCell>{formatNZD(item.totalCost)}</TableCell>
                        <TableCell>{formatNZD(item.billBackTarget)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Wallet className="h-4 w-4" /> Hierarchy: Provider Tools {`->`} Org Overhead {`->`} User Unit Cost {`->`} Client Bill-Back</span>
                <Button variant="outline" size="sm" onClick={() => navigate('/invoicing')}>
                  <DollarSign className="mr-1 h-4 w-4" /> Open Invoicing
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  )
}
