/**
 * ContractorDocumentLog — B-143
 *
 * Admin log and viewer for contractor_documents.
 * Displays contractor document uploads, current/expired state,
 * file metadata, and uploader audit information.
 *
 * Route: /contractor-document-log — admin/admin_officer/master
 */
import { Fragment, useState } from 'react'
import { format, isAfter, parseISO } from 'date-fns'
import { FileText, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import type { Database } from '@/types/database'

type DocumentRow = Database['public']['Tables']['contractor_documents']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtBytes(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function isExpired(expiryDate: string | null) {
  if (!expiryDate) return false
  try {
    return !isAfter(parseISO(expiryDate), new Date())
  } catch {
    return false
  }
}

export default function ContractorDocumentLog() {
  const [nameQuery, setNameQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<DocumentRow[]>({
    queryKey: ['contractor-document-log', nameQuery, typeFilter, stateFilter],
    queryFn: async () => {
      let q = supabase
        .from('contractor_documents')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (nameQuery.trim()) q = q.or(`document_name.ilike.%${nameQuery.trim()}%,uploaded_by.ilike.%${nameQuery.trim()}%`)
      if (typeFilter !== 'all') q = q.eq('document_type', typeFilter)
      if (stateFilter === 'current') q = q.eq('is_current', true)
      if (stateFilter === 'archived') q = q.eq('is_current', false)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const types = [...new Set(rows.map(row => row.document_type).filter(Boolean))].sort()
  const currentCount = rows.filter(row => row.is_current).length
  const expiredCount = rows.filter(row => isExpired(row.expiry_date)).length
  const withExpiry = rows.filter(row => row.expiry_date).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Contractor Document Log</h1>
              <p className="text-sm text-muted-foreground">Contractor document uploads with expiry state, file metadata, and uploader audit detail</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Documents', value: rows.length, colour: 'text-gray-700' },
            { label: 'Current', value: currentCount, colour: 'text-emerald-700' },
            { label: 'Expired', value: expiredCount, colour: 'text-rose-700' },
            { label: 'With Expiry Date', value: withExpiry, colour: 'text-cyan-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={nameQuery} onChange={e => setNameQuery(e.target.value)} placeholder="Search name or uploader…" className="w-60" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Document type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Current state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="current">Current</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No records found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="font-medium text-sm max-w-[14rem] truncate">{row.document_name}</TableCell>
                      <TableCell className="text-sm">{row.document_type}</TableCell>
                      <TableCell>
                        <Badge className={row.is_current ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                          {row.is_current ? 'Current' : 'Archived'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.expiry_date ? (
                          <Badge className={isExpired(row.expiry_date) ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'}>
                            {fmtDate(row.expiry_date)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtBytes(row.file_size_bytes)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Organization:</span> {row.organization_id}</div>
                          <div><span className="font-medium">Uploaded by:</span> {row.uploaded_by ?? '—'}</div>
                          <div><span className="font-medium">MIME type:</span> {row.mime_type ?? '—'}</div>
                          <div><span className="font-medium">Document URL:</span> <span className="break-all">{row.document_url}</span></div>
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
