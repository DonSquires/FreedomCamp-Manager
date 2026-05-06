import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MessageSquare, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, PenLine,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Database } from '@/types/database'

type CaseCommentRow = Database['public']['Tables']['case_comments']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function CaseCommentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [dateFrom, setDateFrom] = useState('')
  const [caseIdQuery, setCaseIdQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CaseCommentRow[]>({
    queryKey: ['case-comments-log', orgId, dateFrom, caseIdQuery],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('case_comments')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (caseIdQuery.trim()) q = q.ilike('case_id', `%${caseIdQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const editedCount = rows.filter(r => !!r.edited_by).length
  const uniqueCases = new Set(rows.map(r => r.case_id)).size

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Case Comment Log</h1>
              <p className="text-sm text-muted-foreground">All comments added to operational cases, including edit history</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Comments', value: rows.length, colour: 'text-gray-700' },
            { label: 'Edited', value: editedCount, colour: 'text-orange-700' },
            { label: 'Unique Cases', value: uniqueCases, colour: 'text-blue-700' },
            { label: 'Date Range', value: dateFrom || 'All time', colour: 'text-violet-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={caseIdQuery}
            onChange={e => setCaseIdQuery(e.target.value)}
            placeholder="Filter by case ID…"
            className="w-52"
          />
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No case comments found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Case ID</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Edited</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Preview</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  const isEdited = !!row.edited_by
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.case_id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.author_id.slice(0, 8)}…</TableCell>
                        <TableCell>
                          {isEdited
                            ? <Badge className="bg-orange-100 text-orange-800 gap-1"><PenLine className="h-3 w-3" />Edited</Badge>
                            : <span className="text-muted-foreground text-xs">No</span>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.updated_at)}</TableCell>
                        <TableCell className="text-sm max-w-52 truncate text-muted-foreground">{row.comment_text}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="space-y-3 text-sm">
                              <div>
                                <p className="font-medium mb-1">Comment Text:</p>
                                <p className="text-muted-foreground whitespace-pre-wrap bg-muted rounded p-3">{row.comment_text}</p>
                              </div>
                              {isEdited && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div><span className="font-medium">Edited By:</span> <span className="font-mono text-xs">{row.edited_by}</span></div>
                                </div>
                              )}
                              <div><span className="font-medium">Comment ID:</span> <span className="font-mono text-xs">{row.id}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
