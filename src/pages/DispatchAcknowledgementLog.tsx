/**
 * DispatchAcknowledgementLog — B-90
 * Log of dispatch_acknowledgement_log — dispatch job lifecycle tracking.
 * Route: /dispatch-ack-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Radio, Search, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Database } from '@/types/database'

type DispatchAckRow = Database['public']['Tables']['dispatch_acknowledgement_log']['Row']

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtETA(seconds: number | null | undefined) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

const LIFECYCLE_COLOURS: Record<string, string> = {
  assigned:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  acknowledged: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  en_route:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  on_scene:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  completed:    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

const LIFECYCLE_STAGES = ['assigned', 'acknowledged', 'en_route', 'on_scene', 'completed', 'cancelled'] as const

export default function DispatchAcknowledgementLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')

  const { data: records = [], isLoading, error, refetch } = useQuery<DispatchAckRow[]>({
    queryKey: ['dispatch-ack-log', orgId],
    queryFn: async () => {
      let q = supabase.from('dispatch_acknowledgement_log').select('*').order('acknowledged_at', { ascending: false }).limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const filtered = records.filter(e => {
    if (filterStage !== 'all' && e.lifecycle_stage !== filterStage) return false
    if (filterMonth !== 'all' && e.acknowledged_at?.substring(0,7) !== filterMonth) return false
    if (search) { const s = search.toLowerCase(); return e.callsign?.toLowerCase().includes(s) || e.case_id?.toLowerCase().includes(s) }
    return true
  })

  const total    = records.length
  const enRoute  = records.filter(e => e.lifecycle_stage === 'en_route').length
  const onScene  = records.filter(e => e.lifecycle_stage === 'on_scene').length
  const etaVals  = records.map(e => e.eta_seconds).filter(v => v != null) as number[]
  const avgETA   = etaVals.length > 0 ? fmtETA(Math.round(etaVals.reduce((a,b)=>a+b,0)/etaVals.length)) : '—'

  const months = Array.from(new Set(records.map(e => e.acknowledged_at?.substring(0,7)).filter(Boolean))).sort().reverse()

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Radio className="h-7 w-7 text-cyan-600" />
            <div><h1 className="text-2xl font-bold">Dispatch Acknowledgement Log</h1><p className="text-sm text-muted-foreground">Dispatch job lifecycle tracking</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}><RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading?'animate-spin':''}`} />Refresh</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[{label:'Total',value:total,colour:'text-slate-600'},{label:'En Route',value:enRoute,colour:enRoute>0?'text-yellow-600':'text-muted-foreground'},{label:'On Scene',value:onScene,colour:onScene>0?'text-orange-600':'text-muted-foreground'},{label:'Avg ETA',value:avgETA,colour:'text-blue-600'}].map(({label,value,colour})=>(
            <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><span className={`text-2xl font-bold ${colour}`}>{value}</span></CardContent></Card>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input placeholder="Callsign, case ID…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={filterStage} onValueChange={setFilterStage}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Stage" /></SelectTrigger><SelectContent><SelectItem value="all">All Stages</SelectItem>{LIFECYCLE_STAGES.map(s=>(<SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g,' ')}</SelectItem>))}</SelectContent></Select>
          {months.length>0&&(<Select value={filterMonth} onValueChange={setFilterMonth}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Month" /></SelectTrigger><SelectContent><SelectItem value="all">All Months</SelectItem>{months.map(m=>(<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent></Select>)}
        </div>
        {error&&(<div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="h-4 w-4" />{(error as Error).message}</div>)}
        <Card><CardContent className="p-0">
          {isLoading?(<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>)
          :filtered.length===0?(<div className="text-center py-12 text-muted-foreground text-sm">No dispatch records match your filters.</div>)
          :(<Table><TableHeader><TableRow><TableHead>Acknowledged</TableHead><TableHead>Dispatch Job</TableHead><TableHead>Case</TableHead><TableHead>Callsign</TableHead><TableHead>Officer</TableHead><TableHead>Stage</TableHead><TableHead>ETA</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map(e=>(
              <TableRow key={e.id} className="hover:bg-muted/40">
                <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.acknowledged_at)}</TableCell>
                <TableCell className="font-mono text-xs">{e.dispatch_job_id?e.dispatch_job_id.substring(0,8)+'…':'—'}</TableCell>
                <TableCell className="font-mono text-xs">{e.case_id?e.case_id.substring(0,8)+'…':'—'}</TableCell>
                <TableCell className="font-semibold text-sm">{e.callsign??'—'}</TableCell>
                <TableCell className="font-mono text-xs">{e.officer_id?e.officer_id.substring(0,8)+'…':'—'}</TableCell>
                <TableCell><Badge className={`capitalize ${LIFECYCLE_COLOURS[e.lifecycle_stage??'']??'bg-gray-100 text-gray-700'}`}>{e.lifecycle_stage?.replace(/_/g,' ')??'—'}</Badge></TableCell>
                <TableCell className="text-sm">{fmtETA(e.eta_seconds)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{e.notes??'—'}</TableCell>
              </TableRow>
            ))}</TableBody></Table>)}
        </CardContent></Card>
      </div>
    </AppLayout>
  )
}
