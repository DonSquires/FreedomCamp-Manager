import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addMonths, eachDayOfInterval, endOfMonth, format, isSameDay, parseISO, startOfMonth, subMonths } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Route, Search } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useKeyAuditEnabled } from '@/hooks/useKeyAuditEnabled'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'

interface AuditEntry {
  id: string
  performed_at: string
  action: string
  details: Record<string, unknown>
}

interface PatrolRouteSummary {
  id: string
  route_name: string
  route_code: string | null
  is_active: boolean | null
}

interface PatrolChainSummary {
  id: string
  name: string
  status: string
  is_active: boolean
  patrol_route_id: string | null
  custom_data: Record<string, unknown> | null
}

function formatAuditLabel(details: Record<string, unknown>) {
  const route = String(details.patrol_route_code ?? details.patrol_route_name ?? 'unknown route')
  const phase = String(details.audit_kind ?? 'audit').replace(/_/g, ' ')
  return `${phase} · ${route}`
}

export default function PatrolChainAudits() {
  const user = useAuthStore((state) => state.user)
  const orgId = user?.organization_id ?? ''
  const auditEnabledQuery = useKeyAuditEnabled(orgId)
  const [monthAnchor, setMonthAnchor] = useState(() => new Date())
  const [search, setSearch] = useState('')
  const [savingAuditToggle, setSavingAuditToggle] = useState(false)

  const monthStart = startOfMonth(monthAnchor)
  const monthEnd = endOfMonth(monthAnchor)

  const { data: routes = [] } = useQuery<PatrolRouteSummary[]>({
    queryKey: ['patrol-chain-audit-routes', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('patrol_routes')
        .select('id, route_name, route_code, is_active')
        .eq('organization_id', orgId)
        .order('route_name')
      if (error) throw error
      return ((data ?? []) as unknown) as PatrolRouteSummary[]
    },
    enabled: !!orgId,
  })

  const { data: chains = [] } = useQuery<PatrolChainSummary[]>({
    queryKey: ['patrol-chain-audit-chains', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('key_sets')
        .select('id, name, status, is_active, patrol_route_id, custom_data')
        .eq('organization_id', orgId)
        .order('name')
      if (error) throw error
      return ((data ?? []) as unknown) as PatrolChainSummary[]
    },
    enabled: !!orgId,
  })

  const { data: audits = [] } = useQuery<AuditEntry[]>({
    queryKey: ['patrol-chain-audit-log', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await (supabase as any)
        .from('key_audit_log')
        .select('id, performed_at, action, details')
        .eq('organization_id', orgId)
        .eq('action', 'inventory_check')
        .order('performed_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return ((data ?? []) as unknown) as AuditEntry[]
    },
    enabled: !!orgId,
  })

  const filteredAudits = useMemo(() => {
    const query = search.trim().toLowerCase()
    return audits.filter((entry) => {
      if (!query) return true
      const haystack = [
        formatAuditLabel(entry.details),
        String(entry.details.patrol_route_name ?? ''),
        String(entry.details.patrol_route_code ?? ''),
        String(entry.details.key_set_name ?? ''),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [audits, search])

  const monthDays = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd])

  const auditsByDay = useMemo(() => {
    const map = new Map<string, AuditEntry[]>()
    for (const entry of filteredAudits) {
      const dayKey = format(parseISO(entry.performed_at), 'yyyy-MM-dd')
      const current = map.get(dayKey) ?? []
      current.push(entry)
      map.set(dayKey, current)
    }
    return map
  }, [filteredAudits])

  const routeChains = useMemo(() => {
    return routes.map((route) => ({
      ...route,
      chains: chains.filter((chain) => chain.patrol_route_id === route.id),
    }))
  }, [routes, chains])

  const canManageAuditToggle = ['grand_master', 'master', 'admin', 'admin_officer'].includes(user?.role ?? '')

  async function handleToggleAudit(enabled: boolean) {
    if (!orgId) return
    setSavingAuditToggle(true)
    const { error } = await (supabase as any)
      .from('key_audit_settings')
      .upsert({
        organization_id: orgId,
        is_enabled: enabled,
        updated_by: user?.id ?? null,
      }, { onConflict: 'organization_id' })
    setSavingAuditToggle(false)

    if (error) return
    auditEnabledQuery.refetch()
  }

  const upcomingReminderDates = useMemo(() => {
    const firstHalf = new Date(monthStart)
    firstHalf.setDate(1)
    const secondHalf = new Date(monthStart)
    secondHalf.setDate(15)
    return [firstHalf, secondHalf].filter((date) => date >= monthStart && date <= monthEnd)
  }, [monthStart, monthEnd])

  return (
    <AppLayout title="Patrol Chain Audits" description="Twice-monthly patrol chain checks and handover history">
      <div className="space-y-4 p-4 md:p-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2"><ClipboardList className="h-4 w-4" />Audit Calendar</CardTitle>
                <CardDescription>Use this screen to review the twice-monthly chain audit schedule and recent patrol chain checks.</CardDescription>
              </div>
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  {canManageAuditToggle && (
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium">Key audit {auditEnabledQuery.data === false ? 'disabled' : 'enabled'}</p>
                        <p className="text-[10px] text-muted-foreground">Masters can pause patrol chain audits here.</p>
                      </div>
                      <Switch
                        checked={auditEnabledQuery.data !== false}
                        onCheckedChange={(checked) => void handleToggleAudit(checked)}
                        disabled={savingAuditToggle}
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMonthAnchor((value) => subMonths(value, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-36 text-center text-sm font-medium">{format(monthAnchor, 'MMMM yyyy')}</div>
                <Button variant="outline" size="sm" onClick={() => setMonthAnchor((value) => addMonths(value, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Reminder cadence</p>
              <p className="mt-1 text-sm font-medium">Twice monthly on the 1st and 15th</p>
              <p className="text-xs text-muted-foreground mt-1">These are the preferred planning points for full chain and key audits.</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">This month</p>
              <p className="mt-1 text-sm font-medium">{audits.filter((entry) => {
                const performed = parseISO(entry.performed_at)
                return performed >= monthStart && performed <= monthEnd
              }).length} recorded audits</p>
              <p className="text-xs text-muted-foreground mt-1">Chain checks logged in the current calendar month.</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active routes</p>
              <p className="mt-1 text-sm font-medium">{routeChains.filter((route) => route.is_active).length} active patrol routes</p>
              <p className="text-xs text-muted-foreground mt-1">Chains now follow route assignment, not client site assignment.</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><CalendarDays className="h-4 w-4" />Monthly Calendar</CardTitle>
              <CardDescription>Recorded chain audits and planned reminder dates.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2 text-xs font-medium text-muted-foreground mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="px-1">{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: monthDays[0]?.getDay() ?? 0 }).map((_, index) => <div key={`blank-${index}`} />)}
                {monthDays.map((day) => {
                  const dayKey = format(day, 'yyyy-MM-dd')
                  const dayAudits = auditsByDay.get(dayKey) ?? []
                  const reminderDate = upcomingReminderDates.some((reminder) => isSameDay(reminder, day))
                  return (
                    <div key={dayKey} className={`min-h-28 rounded-md border p-2 ${reminderDate ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
                      <div className="flex items-center justify-between gap-2 text-sm font-medium">
                        <span>{format(day, 'd')}</span>
                        {dayAudits.length > 0 && <Badge variant="secondary" className="text-[10px]">{dayAudits.length}</Badge>}
                      </div>
                      {reminderDate && <p className="mt-1 text-[10px] uppercase tracking-wide text-amber-700">Audit reminder</p>}
                      <div className="mt-1 space-y-1">
                        {dayAudits.slice(0, 3).map((entry) => (
                          <div key={entry.id} className="rounded bg-muted/60 px-2 py-1 text-[11px] leading-tight">
                            {formatAuditLabel(entry.details)}
                          </div>
                        ))}
                        {dayAudits.length > 3 && <p className="text-[10px] text-muted-foreground">+{dayAudits.length - 3} more</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><Route className="h-4 w-4" />Route Assignment</CardTitle>
                <CardDescription>Chains are assigned to patrol routes such as 587, 586, and the day patrol route 585.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search route, chain, or barcode…" />
                </div>
                <ScrollArea className="h-[26rem] rounded-md border">
                  <div className="space-y-3 p-3">
                    {routeChains.map((route) => (
                      <div key={route.id} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{route.route_code ?? route.route_name}</p>
                            <p className="text-xs text-muted-foreground">{route.route_name}</p>
                          </div>
                          <Badge variant={route.is_active ? 'default' : 'outline'} className="text-[10px] uppercase tracking-wide">
                            {route.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                          {route.chains.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No chains assigned.</p>
                          ) : (
                            route.chains.map((chain) => (
                              <div key={chain.id} className="flex items-center justify-between gap-3 rounded bg-muted/40 px-2 py-1.5 text-xs">
                                <div>
                                  <p className="font-medium">{chain.name}</p>
                                  <p className="text-muted-foreground">{String(chain.custom_data?.chain_barcode ?? chain.custom_data?.barcode ?? '—')}</p>
                                </div>
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{chain.status}</Badge>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Recent Audit Entries</CardTitle>
                <CardDescription>Latest patrol chain audits recorded this month.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {filteredAudits.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{formatAuditLabel(entry.details)}</span>
                      <span className="text-xs text-muted-foreground">{format(parseISO(entry.performed_at), 'dd MMM HH:mm')}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {String(entry.details.key_set_name ?? 'Patrol chain')} · {String(entry.details.officer_name ?? 'Unknown officer')}
                    </p>
                  </div>
                ))}
                {filteredAudits.length === 0 && <p className="text-sm text-muted-foreground">No patrol chain audits recorded yet.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
