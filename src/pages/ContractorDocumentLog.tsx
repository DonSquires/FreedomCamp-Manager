/**
 * ContractorDocumentLog — B-143
 *
 * Admin audit log for contractor_documents.
 * Shows uploaded compliance documents (licences, insurance, certs) per contractor
 * with expiry tracking and currency status.
 *
 * Route: /contractor-documents-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
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

type DocRow = Database['public']['Tables']['contractor_documents']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isExpiringSoon(expiry: string | null): boolean {
  if (!expiry) return false
  try {
    const days = (parseISO(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return days >= 0 && days <= 30
  } catch { return false }
}

function isExpired(expiry: string | null): boolean {
  if (!expiry) return false
  try { return parseISO(expiry).getTime() < Date.now() } catch { return false }
}

export default function ContractorDocumentLog() {
  const [typeFilter, setTypeFilter]   = useState<string>('all')
  const [currentFilter, setCurrentFilter] = useState<string>('all')
  const [nameQuery, setNameQuery]     = useState('')
  const [dateFrom, setDateFrom]       = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<DocRow[]>({
    queryKey: ['contractor-documents-log', typeFilter, currentFilter, nameQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('contractor_documents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all')    q = q.eq('document_type', typeFilter)
      if (currentFilter === 'current')   q = q.eq('is_current', true)
      if (currentFilter === 'superseded') q = q.eq('is_current', false)
      if (nameQuery.trim())        q = q.ilike('document_name', `%${nameQuery.trim()}%`)
      if (dateFrom)                q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const current      = rows.filter(r => r.is_current).length
  const expiringSoon = rows.filter(r => isExpiringSoon(r.expiry_date)).length
  const expired      = rows.filter(r => isExpired(r.expiry_date)).length

  const docTypes = ['all', ...Array.from(new Set(rows.map(r => r.document_type)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Contractor Document Log</h1>
              <p className="text-sm text-muted-foreground">Compliance documents uploaded per contractor — licences, insurance, certifications, and more</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Documents',   value: rows.length,   colour: 'text-gray-700' },
            { label: 'Current',           value: current,       colour: 'text-green-700' },
            { label: 'Expiring (30 days)', value: expiringSoon, colour: 'text-amber-700' },
            { label: 'Expired',           value: expired,       colour: 'text-rose-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="Search document name…"
            className="w-56"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Document type" /></SelectTrigger>
            <SelectContent>{docTypes.map(t => <SelectItem key={t} value={t}>{t === 'all' ? 'All types' : t}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={currentFilter} onValueChange={setCurrentFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Currency" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="current">Current only</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
            </SelectContent>
          </Select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1 text-sm w-40 bg-background"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No documents found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Uploaded At</TableHead>
                  <TableHead>Document Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const exp = isExpired(row.expiry_date)
                  const soon = isExpiringSoon(row.expiry_date)
                  return (
                    <TableRow key={row.id} className="hover:bg-muted/40">
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="max-w-[16rem] truncate font-medium text-sm" title={row.document_name}>
                        <a href={row.document_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline" onClick={e => e.stopPropagation()}>
                          {row.document_name}
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{row.document_type}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${row.is_current ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                          {row.is_current ? 'Current' : 'Superseded'}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-sm ${exp ? 'text-rose-700 font-semibold' : soon ? 'text-amber-700 font-semibold' : ''}`}>
                        {row.expiry_date ? (
                          <>
                            {fmtDate(row.expiry_date)}
                            {exp && <span className="ml-1 text-xs">(expired)</span>}
                            {soon && !exp && <span className="ml-1 text-xs">(soon)</span>}
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtBytes(row.file_size_bytes)}</TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground" title={row.notes ?? ''}>
                        {row.notes ?? '—'}
                      </TableCell>
                    </TableRow>
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
