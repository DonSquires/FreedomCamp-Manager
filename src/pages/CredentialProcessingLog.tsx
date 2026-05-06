/**
 * CredentialProcessingLog — B-89
 * Log of credential_processing_log — AI-processed officer credential documents.
 * Route: /credential-processing-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { FileCheck, Search, RefreshCw, AlertCircle, Loader2, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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

type CredentialProcessingRow = Database['public']['Tables']['credential_processing_log']['Row']

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function ConfidenceBar({ score }: { score: number | null }) {
  const pct = (score ?? 0) * 100
  const colour = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

export default function CredentialProcessingLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterDocType, setFilterDocType] = useState('all')
  const [filterVerified, setFilterVerified] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: records = [], isLoading, error, refetch } = useQuery<CredentialProcessingRow[]>({
    queryKey: ['credential-processing', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('credential_processing_log').select('*').order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  const filtered = records.filter(e => {
    if (filterDocType !== 'all' && e.document_type !== filterDocType) return false
    if (filterVerified === 'true'  && !e.manually_verified) return false
    if (filterVerified === 'false' && e.manually_verified)  return false
    if (filterMonth    !== 'all'   && e.created_at?.substring(0,7) !== filterMonth) return false
    if (search) { const s = search.toLowerCase(); return e.license_number?.toLowerCase().includes(s) || e.user_id?.toLowerCase().includes(s) }
    return true
  })

  const total       = records.length
  const verified    = records.filter(e => e.manually_verified === true).length
  const pending     = records.filter(e => !e.manually_verified).length
  const confVals    = records.map(e => e.confidence_score).filter(v => v != null) as number[]
  const avgConf     = confVals.length > 0 ? ((confVals.reduce((a,b)=>a+b,0)/confVals.length)*100).toFixed(0)+'%' : '—'

  const docTypes = Array.from(new Set(records.map(e => e.document_type).filter(Boolean)))
  const months   = Array.from(new Set(records.map(e => e.created_at?.substring(0,7)).filter(Boolean))).sort().reverse()

  const markVerified = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('credential_processing_log').update({ manually_verified: true, verified_by: user?.id, verified_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credential-processing'] }); toast.success('Credential marked verified') },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileCheck className="h-7 w-7 text-teal-600" />
            <div><h1 className="text-2xl font-bold">Credential Processing Log</h1><p className="text-sm text-muted-foreground">AI-processed officer credential documents</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}><RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading?'animate-spin':''}`} />Refresh</Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[{label:'Total',value:total,colour:'text-slate-600'},{label:'Verified',value:verified,colour:'text-green-600'},{label:'Pending',value:pending,colour:pending>0?'text-yellow-600':'text-muted-foreground'},{label:'Avg Confidence',value:avgConf,colour:'text-blue-600'}].map(({label,value,colour})=>(
            <Card key={label}><CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><span className={`text-2xl font-bold ${colour}`}>{value}</span></CardContent></Card>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input placeholder="License #, User ID…" value={search} onChange={e=>setSearch(e.target.value)} className="pl-8" />
          </div>
          {docTypes.length>0&&(<Select value={filterDocType} onValueChange={setFilterDocType}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Doc Type" /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem>{docTypes.map(t=>(<SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g,' ')}</SelectItem>))}</SelectContent></Select>)}
          <Select value={filterVerified} onValueChange={setFilterVerified}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Verified" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="true">Verified</SelectItem><SelectItem value="false">Pending</SelectItem></SelectContent></Select>
          {months.length>0&&(<Select value={filterMonth} onValueChange={setFilterMonth}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Month" /></SelectTrigger><SelectContent><SelectItem value="all">All Months</SelectItem>{months.map(m=>(<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent></Select>)}
        </div>
        {error&&(<div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="h-4 w-4" />{(error as Error).message}</div>)}
        <Card><CardContent className="p-0">
          {isLoading?(<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>)
          :filtered.length===0?(<div className="text-center py-12 text-muted-foreground text-sm">No credential records match your filters.</div>)
          :(<Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>Created</TableHead><TableHead>Officer</TableHead><TableHead>Doc Type</TableHead><TableHead>License #</TableHead><TableHead>Expiry</TableHead><TableHead>Confidence</TableHead><TableHead>Verified</TableHead><TableHead>Verified At</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map(e=>{const isExpanded=expandedId===e.id; return(<>
              <TableRow key={e.id} className="cursor-pointer hover:bg-muted/40" onClick={()=>setExpandedId(isExpanded?null:e.id)}>
                <TableCell>{isExpanded?<ChevronDown className="h-4 w-4 text-muted-foreground"/>:<ChevronRight className="h-4 w-4 text-muted-foreground"/>}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.created_at)}</TableCell>
                <TableCell className="font-mono text-xs">{e.user_id?e.user_id.substring(0,8)+'…':'—'}</TableCell>
                <TableCell className="text-sm capitalize">{e.document_type?.replace(/_/g,' ')??'—'}</TableCell>
                <TableCell className="font-mono text-xs">{e.license_number??'—'}</TableCell>
                <TableCell className="text-sm">{e.expiry_date??'—'}</TableCell>
                <TableCell><ConfidenceBar score={e.confidence_score} /></TableCell>
                <TableCell>{e.manually_verified?<Badge className="bg-green-100 text-green-800">Verified</Badge>:<Badge className="bg-yellow-100 text-yellow-800">Pending</Badge>}</TableCell>
                <TableCell className="text-xs">{fmtDate(e.verified_at)}</TableCell>
                <TableCell onClick={ev=>ev.stopPropagation()}>{!e.manually_verified&&(<Button size="sm" variant="outline" className="h-6 text-xs px-2" disabled={markVerified.isPending} onClick={()=>markVerified.mutate(e.id)}><CheckCircle2 className="h-3 w-3 mr-1"/>Verify</Button>)}</TableCell>
              </TableRow>
              {isExpanded&&(<TableRow key={`${e.id}-detail`} className="bg-muted/20"><TableCell colSpan={10} className="py-3 px-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {e.authorized_activities&&(<div><p className="font-semibold text-muted-foreground mb-1">Authorized Activities</p><pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">{JSON.stringify(e.authorized_activities,null,2)}</pre></div>)}
                  {e.extracted_text&&(<div><p className="font-semibold text-muted-foreground mb-1">Extracted Text</p><p className="text-xs">{e.extracted_text.substring(0,200)}{e.extracted_text.length>200?'…':''}</p></div>)}
                  {e.error_message&&(<div><p className="font-semibold text-muted-foreground mb-1 text-red-600">Error</p><p className="text-xs text-red-600">{e.error_message}</p></div>)}
                </div>
              </TableCell></TableRow>)}
            </>)})}
            </TableBody></Table>)}
        </CardContent></Card>
      </div>
    </AppLayout>
  )
}
