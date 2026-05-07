/**
 * CaseCommentLog — B-107
 *
 * Log viewer for case_comments — comments on operational cases.
 *
 * Features:
 *  - KPI cards: Total / Edited / Unique Cases / Unique Authors
 *  - Filters: date from, case_id search, author search
 *  - Table: created_at, case_id (short), author_id (short), edited badge, comment preview
 *  - Expandable row: full comment_text, edited_by, updated_at
 *
 * Route: /case-comments-log — admin/admin_officer/master
 */

import { useState, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MessageSquare, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type CaseComment = Database['public']['Tables']['case_comments']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CaseCommentLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [dateFrom,    setDateFrom]    = useState('')
  const [caseSearch,  setCaseSearch]  = useState('')
  const [authorSearch, setAuthorSearch] = useState('')
  const [expandedId,  setExpandedId]  = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<CaseComment[]>({
    queryKey: ['case-comments-log', orgId, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('case_comments')
        .select('*')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
        .limit(500)

      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // Client-side filters for case_id / author_id (UUID-based searches)
  const filtered = rows.filter(r => {
    if (caseSearch   && !r.case_id.toLowerCase().includes(caseSearch.toLowerCase()))   return false
    if (authorSearch && !r.author_id.toLowerCase().includes(authorSearch.toLowerCase())) return false
    return true
  })

  const editedCount  = filtered.filter(r => !!r.edited_by).length
  const uniqueCases  = new Set(filtered.map(r => r.case_id).filter(Boolean)).size
  const uniqueAuthors = new Set(filtered.map(r => r.author_id).filter(Boolean)).size

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Case Comment Log</h1>
              <p className="text-sm text-muted-foreground">Comments and notes on operational cases</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Comments',  value: filtered.length, colour: 'text-gray-700' },
            { label: 'Edited',          value: editedCount,     colour: 'text-orange-700' },
            { label: 'Unique Cases',    value: uniqueCases,     colour: 'text-teal-700' },
            { label: 'Unique Authors',  value: uniqueAuthors,   colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Search case ID…"
            value={caseSearch}
            onChange={e => setCaseSearch(e.target.value)}
            className="w-48"
          />
          <Input
            placeholder="Search author ID…"
            value={authorSearch}
            onChange={e => setAuthorSearch(e.target.value)}
            className="w-48"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No case comments found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Created</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead>Edited</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        <TableCell>
                          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.case_id.slice(0, 8)}…
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.author_id.slice(0, 8)}…
                        </TableCell>
                        <TableCell>
                          {row.edited_by ? (
                            <Badge className="bg-orange-100 text-orange-800 text-xs">Edited</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[320px] truncate">
                          {row.comment_text}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
                              <span>Full case: {row.case_id}</span>
                              <span>Full author: {row.author_id}</span>
                              {row.edited_by && <span>Edited by: {row.edited_by.slice(0, 8)}…</span>}
                              {row.updated_at && <span>Updated: {fmtDate(row.updated_at)}</span>}
                            </div>
                            <div>
                              <p className="font-medium text-sm mb-1">Full Comment</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{row.comment_text}</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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
