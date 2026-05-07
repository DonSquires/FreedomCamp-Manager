/**
 * PhotoMetadataLog — B-105
 *
 * Log viewer for photo_metadata — uploaded photo evidence records.
 *
 * Features:
 *  - KPI cards: Total / With Hash / Unique Users / Total Size (MB)
 *  - Filters: mime_type (dynamic), date from, file_name search
 *  - Table: file_name, mime_type badge, file_size, created_at, sha256_hash (short)
 *  - Expandable row: storage_path, user_id, observation_id, full sha256_hash
 *
 * Route: /photo-metadata-log — admin/master
 */

import { useState, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Image, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type PhotoMeta = Database['public']['Tables']['photo_metadata']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtSize(bytes: number | null) {
  if (bytes == null) return '—'
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function mimeColour(mime: string | null) {
  if (!mime) return 'bg-gray-100 text-gray-600'
  if (mime.startsWith('image/')) return 'bg-blue-100 text-blue-800'
  if (mime.startsWith('video/')) return 'bg-purple-100 text-purple-800'
  if (mime === 'application/pdf') return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PhotoMetadataLog() {
  const [mimeFilter,    setMimeFilter]   = useState('all')
  const [dateFrom,      setDateFrom]     = useState('')
  const [fileSearch,    setFileSearch]   = useState('')
  const [expandedId,    setExpandedId]   = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<PhotoMeta[]>({
    queryKey: ['photo-metadata-log', mimeFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('photo_metadata')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (mimeFilter !== 'all') q = q.eq('mime_type', mimeFilter)
      if (dateFrom)             q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const filtered      = fileSearch
    ? rows.filter(r => r.file_name?.toLowerCase().includes(fileSearch.toLowerCase()))
    : rows

  const withHash      = filtered.filter(r => !!r.sha256_hash).length
  const uniqueUsers   = new Set(filtered.map(r => r.user_id).filter(Boolean)).size
  const totalBytes    = filtered.reduce((sum, r) => sum + (r.file_size ?? 0), 0)
  const totalMB       = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(2) : '0.00'
  const mimeTypes     = [...new Set(rows.map(r => r.mime_type).filter(Boolean))].sort()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Photo Metadata Log</h1>
              <p className="text-sm text-muted-foreground">Uploaded photo evidence records and integrity hashes</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Photos',   value: filtered.length,  colour: 'text-gray-700' },
            { label: 'With Hash',      value: withHash,          colour: 'text-green-700' },
            { label: 'Unique Users',   value: uniqueUsers,       colour: 'text-blue-700' },
            { label: 'Total Size (MB)', value: totalMB,          colour: 'text-purple-700' },
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
          <Select value={mimeFilter} onValueChange={setMimeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="MIME type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {mimeTypes.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <Input
            placeholder="Search file name…"
            value={fileSearch}
            onChange={e => setFileSearch(e.target.value)}
            className="w-44"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No photo metadata records found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>File Name</TableHead>
                  <TableHead>MIME Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>SHA-256 (short)</TableHead>
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
                        <TableCell className="font-mono text-sm max-w-[200px] truncate">
                          {row.file_name ?? '—'}
                        </TableCell>
                        <TableCell>
                          {row.mime_type ? (
                            <Badge className={`text-xs ${mimeColour(row.mime_type)}`}>{row.mime_type}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{fmtSize(row.file_size)}</TableCell>
                        <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.sha256_hash ? row.sha256_hash.slice(0, 12) + '…' : '—'}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                              {row.user_id && <span>Uploaded by: {row.user_id.slice(0, 8)}…</span>}
                              {row.observation_id && <span>Observation: {row.observation_id.slice(0, 8)}…</span>}
                              {row.storage_path && (
                                <span className="break-all">Path: {row.storage_path}</span>
                              )}
                            </div>
                            {row.sha256_hash && (
                              <div>
                                <p className="font-medium text-sm mb-1">SHA-256 Hash</p>
                                <p className="font-mono text-xs text-muted-foreground break-all bg-muted rounded p-2">
                                  {row.sha256_hash}
                                </p>
                              </div>
                            )}
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
