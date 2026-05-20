import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
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

interface CostIntelligencePanelProps {
  isClientBillingUser: boolean
  financeEnabled: boolean
}

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

interface OrgCostRow {
  organizationId: string
  organizationName: string
  activeUsers: number
  shiftHours: number
  labourCost: number
  platformOverhead: number
  externalAllocationPerOrg: number
  estimatedMonthlyCost: number
  recommendedBillBack: number
  liveDailyExpense: number
  billed: number
  collected: number
  outstanding: number
  perUserCost: number
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
  const normalized = status.toLowerCase()
  return !normalized.includes('cancel') && normalized !== 'draft'
}

export function CostIntelligencePanel({ isClientBillingUser, financeEnabled }: CostIntelligencePanelProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [providerCosts, setProviderCosts] = useState<ProviderCosts>(DEFAULT_PROVIDER_COSTS)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROVIDER_COSTS_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<ProviderCosts>
      setProviderCosts((prev) => ({ ...prev, ...parsed }))
    } catch {
      // Keep defaults when local settings are unavailable or invalid.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(PROVIDER_COSTS_STORAGE_KEY, JSON.stringify(providerCosts))
  }, [providerCosts])

  const windowStart = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  }, [])

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
    queryKey: ['cost-intel-invoices', windowStart, user?.organization_id ?? null],
    queryFn: async () => {
      let q = (supabase as any)
        .from('crm_invoices')
        .select('id, client_organization_id, total_cents, amount_paid_cents, balance_cents, status, invoice_date')
        .gte('invoice_date', windowStart)
        .limit(5000)

      if (isClientBillingUser && user?.organization_id) {
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
    queryKey: ['cost-intel-shifts', windowStart, user?.organization_id ?? null],
    queryFn: async () => {
      let q = (supabase as any)
        .from('roster_shifts')
        .select('id, organization_id, officer_id, shift_date, start_time, end_time, break_minutes, status, guard_cost_rate, client_charge_rate')
        .gte('shift_date', windowStart)
        .limit(10000)

      if (isClientBillingUser && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      }

      const { data, error } = await q
      if (error) {
        console.warn('cost-intel roster_shifts query error:', error.message)
        return []
      }
      return (data ?? []) as ShiftRow[]
    },
  })

  const { data: users = [] } = useQuery({
    queryKey: ['cost-intel-users', user?.organization_id ?? null],
    queryFn: async () => {
      let q = (supabase as any)
        .from('user_profiles')
        .select('id, organization_id, role, is_active, first_name, last_name, email')
        .limit(8000)

      if (isClientBillingUser && user?.organization_id) {
        q = q.eq('organization_id', user.organization_id)
      }

      const { data, error } = await q
      if (error) {
        console.warn('cost-intel user_profiles query error:', error.message)
        return []
      }
      return (data ?? []) as UserRow[]
    },
  })

  const providerMonthlyCost = useMemo(
    () => Object.values(providerCosts).reduce((sum, value) => sum + value, 0),
    [providerCosts]
  )

  const visibleOrganizations = useMemo(() => {
    if (isClientBillingUser && user?.organization_id) {
      return organizations.filter((org) => org.id === user.organization_id)
    }
    return organizations
  }, [organizations, isClientBillingUser, user?.organization_id])

  const organizationRows = useMemo<OrgCostRow[]>(() => {
    const orgCount = Math.max(1, visibleOrganizations.length)
    const externalAllocationPerOrg = providerMonthlyCost / orgCount

    return visibleOrganizations.map((org) => {
      const orgShifts = shifts.filter((shift) => shift.organization_id === org.id && isShiftCountable(shift.status))
      const orgInvoices = invoices.filter((invoice) => invoice.client_organization_id === org.id)
      const orgUsers = users.filter((entry) => entry.organization_id === org.id && entry.is_active !== false)

      const shiftHours = orgShifts.reduce((sum, shift) => sum + calcShiftHours(shift), 0)
      const labourCost = orgShifts.reduce((sum, shift) => sum + calcShiftHours(shift) * (shift.guard_cost_rate ?? 0), 0)
      const shiftRevenue = orgShifts.reduce((sum, shift) => sum + calcShiftHours(shift) * (shift.client_charge_rate ?? 0), 0)
      const billed = orgInvoices.reduce((sum, invoice) => sum + ((invoice.total_cents ?? 0) / 100), 0)
      const collected = orgInvoices.reduce((sum, invoice) => sum + ((invoice.amount_paid_cents ?? 0) / 100), 0)
      const outstanding = orgInvoices.reduce((sum, invoice) => sum + ((invoice.balance_cents ?? 0) / 100), 0)
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
  }, [visibleOrganizations, providerMonthlyCost, shifts, invoices, users])

  useEffect(() => {
    if (isClientBillingUser && user?.organization_id) {
      setSelectedOrganizationId(user.organization_id)
      return
    }

    if (selectedOrganizationId && organizationRows.some((row) => row.organizationId === selectedOrganizationId)) {
      return
    }

    setSelectedOrganizationId(organizationRows[0]?.organizationId ?? null)
  }, [isClientBillingUser, organizationRows, selectedOrganizationId, user?.organization_id])

  const selectedOrg = useMemo(() => {
    if (selectedOrganizationId) {
      return organizationRows.find((row) => row.organizationId === selectedOrganizationId) ?? null
    }
    return null
  }, [organizationRows, selectedOrganizationId])

  const selectedOrgUsers = useMemo(() => {
    if (!selectedOrg) return []

    const orgUsers = users.filter((entry) => entry.organization_id === selectedOrg.organizationId && entry.is_active !== false)
    const orgShifts = shifts.filter((shift) => shift.organization_id === selectedOrg.organizationId && isShiftCountable(shift.status))
    const userCount = Math.max(1, orgUsers.length)
    const allocatedOverheadPerUser = (selectedOrg.platformOverhead + selectedOrg.externalAllocationPerOrg) / userCount

    return orgUsers
      .map((entry) => {
        const workerShifts = orgShifts.filter((shift) => shift.officer_id === entry.id)
        const hours = workerShifts.reduce((sum, shift) => sum + calcShiftHours(shift), 0)
        const directCost = workerShifts.reduce((sum, shift) => sum + calcShiftHours(shift) * (shift.guard_cost_rate ?? 0), 0)
        const directRevenue = workerShifts.reduce((sum, shift) => sum + calcShiftHours(shift) * (shift.client_charge_rate ?? 0), 0)
        const totalCost = directCost + allocatedOverheadPerUser
        const billBackTarget = Math.max(totalCost * 1.15, directRevenue)
        const displayName = [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim() || entry.email

        return {
          id: entry.id,
          displayName,
          role: entry.role ?? 'unknown',
          hours,
          directCost,
          allocatedOverheadPerUser,
          totalCost,
          directRevenue,
          billBackTarget,
        }
      })
      .sort((a, b) => b.totalCost - a.totalCost)
  }, [selectedOrg, shifts, users])

  if (!financeEnabled) return null

  return (
    <div className="space-y-4">
      <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-sky-600" />
            Cost Intelligence
          </CardTitle>
          <CardDescription className="text-xs">
            Unified provider run-rate, organization live expense, and per-user bill-back hierarchy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {!isClientBillingUser && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">GitHub</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.github}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, github: toNumber(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Railway</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.railway}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, railway: toNumber(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">RunPod</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.runpod}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, runpod: toNumber(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Supabase</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.supabase}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, supabase: toNumber(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">hPanel</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.hpanel}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, hpanel: toNumber(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Other Ops</label>
                <Input
                  type="number"
                  min="0"
                  value={providerCosts.otherOps}
                  onChange={(e) => setProviderCosts((prev) => ({ ...prev, otherOps: toNumber(e.target.value) }))}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Monthly provider run-rate: {formatNZD(providerMonthlyCost)}</Badge>
            <Badge variant="outline">Daily baseline: {formatNZD(providerMonthlyCost / 30)}</Badge>
            {selectedOrg && <Badge variant="outline">Selected org: {selectedOrg.organizationName}</Badge>}
          </div>

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
                {organizationRows.map((row) => (
                  <TableRow
                    key={row.organizationId}
                    className={selectedOrg?.organizationId === row.organizationId ? 'bg-muted/40' : ''}
                  >
                    <TableCell className="font-medium">
                      {!isClientBillingUser ? (
                        <button
                          className="hover:underline"
                          onClick={() => setSelectedOrganizationId(row.organizationId)}
                        >
                          {row.organizationName}
                        </button>
                      ) : (
                        row.organizationName
                      )}
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
        <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users2 className="h-4 w-4 text-emerald-600" />
              Per-User Cost and Bill-Back Hierarchy
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedOrg.organizationName}: direct labour cost + allocated overhead + bill-back target.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">Active Users</p>
                <p className="text-lg font-semibold">{selectedOrg.activeUsers}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">Shift Hours (30d)</p>
                <p className="text-lg font-semibold">{selectedOrg.shiftHours.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">Collected (30d)</p>
                <p className="text-lg font-semibold">{formatNZD(selectedOrg.collected)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[11px] text-muted-foreground">Billed (30d)</p>
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
                  {selectedOrgUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No active users with billable shifts in the current window.
                      </TableCell>
                    </TableRow>
                  ) : selectedOrgUsers.map((item) => (
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

            {!isClientBillingUser && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Wallet className="h-4 w-4" />
                  Provider tools to org overhead to user unit cost to client bill-back
                </span>
                <Button variant="outline" size="sm" onClick={() => navigate('/pricing')}>
                  <DollarSign className="mr-1 h-4 w-4" /> Open Service Pricing
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
