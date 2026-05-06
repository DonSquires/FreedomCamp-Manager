/**
 * OfficerActivityLog — B-88
 * Log of officer_activity_log — GPS-stamped officer activity records.
 * Route: /officer-activity-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Activity, Search, RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Database } from '@/types/database'

type OfficerActivityRow = Database['public']['Tables']['officer_activity_log']['Row']

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function OfficerActivityLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: events = [], isLoading, error, refetch } = useQuery<OfficerActivityRow[]>({
    queryKey: ['officer-activity', orgId],
    queryFn: async () => {
      let q = supabase.from('officer_activity_log').select('*').order('recorded_at', { ascending: false }).limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const filtered = events.filter(e => {
    if (filterType  !== 'all' && e.activity_type !== filterType) return false
    if (filterMonth !== 'all' && e.recorded_at?.substring(0, 7) !== filterMonth) return false
    if (search) { const s = search.toLowerCase(); return e.user_id?.toLowerCase().includes(s) || e.activity_type?.toLowerCase().includes(s) }
    return true
  })

  const total          = events.length
  const withGPS        = events.filter(e => e.gps_latitude != null && e.gps_longitude != null).length
  const accVals        = events.map(e => e.gps_accuracy).filter(v => v != null) as number[]
  const avgAcc         = accVals.length > 0 ? (accVals.reduce((a,b)=>a+b,0)/accVals.length).toFixed(1)+' m' : '—'
  const uniqueOfficers = new Set(events.map(e => e.user_id)).size

  const activityTypes = Array.from(new Set(events.map(e => e.activity_type).filter(Boolean)))
  const months        = Array.from(new Set(events.map(e => e.recorded_at?.substring(0,7)).filter(Boolean))).sort().reverse()

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-blue-600" />
            <div><h1 className="text-2xl font-bold">Officer Activity Log</h1><p className="text-sm text-muted-foreground">GPS-stamped officer activity records</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}><RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading?'animate-spin':''}`} />Refresh</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[{label:'Total',value:total,colour:'text-slate-600'},{label:'With GPS',value:withGPS,colour:'text-green-600'},{label:'GPS Acc Avg',value:avgAcc,colour:'text-blue-600'},{label:'Unique Officers',value:uniqueOfficers,colour:'text-violet-600'}].map(({label,value,colour})=>(
            <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><span className={`text-2xl font-bold ${colour}`}>{value}</span></CardContent></Card>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input placeholder="User ID, activity…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-8" />
          </div>
          {activityTypes.length > 0 && (<Select value={filterType} onValueChange={setFilterType}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Activity Type" /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem>{activityTypes.map(t=>(<SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g,' ')}</SelectItem>))}</SelectContent></Select>)}
          {months.length > 0 && (<Select value={filterMonth} onValueChange={setFilterMonth}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Month" /></SelectTrigger><SelectContent><SelectItem value="all">All Months</SelectItem>{months.map(m=>(<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent></Select>)}
        </div>
        {error && (<div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="h-4 w-4" />{(error as Error).message}</div>)}
        <Card><CardContent className="p-0">
          {isLoading ? (<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>)
          : filtered.length === 0 ? (<div className="text-center py-12 text-muted-foreground text-sm">No activity records match your filters.</div>)
          : (<Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>Recorded At</TableHead><TableHead>Officer</TableHead><TableHead>Activity Type</TableHead><TableHead>Latitude</TableHead><TableHead>Longitude</TableHead><TableHead>GPS Accuracy</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map(e=>{const isExpanded=expandedId===e.id; return(<>
              <TableRow key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={()=>setExpandedId(isExpanded?null:e.id)}>
                <TableCell>{isExpanded?<ChevronDown className="h-4 w-4 text-muted-foreground"/>:<ChevronRight className="h-4 w-4 text-muted-foreground"/>}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.recorded_at)}</TableCell>
                <TableCell className="font-mono text-xs">{e.user_id?e.user_id.substring(0,8)+'…':'—'}</TableCell>
                <TableCell className="text-sm capitalize">{e.activity_type?.replace(/_/g,' ')??'—'}</TableCell>
                <TableCell className="text-sm font-mono">{e.gps_latitude!=null?e.gps_latitude.toFixed(4):'—'}</TableCell>
                <TableCell className="text-sm font-mono">{e.gps_longitude!=null?e.gps_longitude.toFixed(4):'—'}</TableCell>
                <TableCell className="text-sm">{e.gps_accuracy!=null?`${e.gps_accuracy} m`:'—'}</TableCell>
              </TableRow>
              {isExpanded&&(<TableRow key={`${e.id}-detail`} className="bg-muted/20"><TableCell colSpan={7} className="py-3 px-6">
                {e.metadata&&(<div><p className="font-semibold text-muted-foreground mb-1 text-sm">Metadata</p><pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">{JSON.stringify(e.metadata,null,2)}</pre></div>)}
              </TableCell></TableRow>)}
            </>)})}
            </TableBody></Table>)}
        </CardContent></Card>
      </div>
    </AppLayout>
  )
}
