/**
 * RadioTranslationLog — B-138
 *
 * Admin log for radio_translation_segments (View, org_id scope).
 * Shows translated radio transcript segments with confidence indicators.
 *
 * Route: /radio-translation-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Languages, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type TransRow = Database['public']['Views']['radio_translation_segments']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function confBar(score: number | null) {
  if (score == null) return null
  const pct = Math.round(score * 100)
  const colour = pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  )
}

export default function RadioTranslationLog() {
  const [langFilter, setLangFilter] = useState('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [lowConfOnly, setLowConfOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')

  const { data: rows = [], isLoading, refetch } = useQuery<TransRow[]>({
    queryKey: ['radio-translation-log', langFilter, providerFilter, lowConfOnly, searchQuery, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('radio_translation_segments')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (langFilter !== 'all') q = q.eq('target_language', langFilter)
      if (providerFilter !== 'all') q = q.eq('provider', providerFilter)
      if (lowConfOnly) q = q.eq('is_low_confidence', true)
      if (searchQuery.trim()) q = q.ilike('text', `%${searchQuery.trim()}%`)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const languages = [...new Set(rows.map(r => r.target_language).filter(Boolean))].sort()
  const providers = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort()
  const lowConfCount = rows.filter(r => r.is_low_confidence).length
  const avgConf = rows.length > 0
    ? (rows.reduce((s, r) => s + (r.confidence ?? 0), 0) / rows.length * 100).toFixed(0)
    : '—'

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Languages className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Radio Translation Log</h1>
              <p className="text-sm text-muted-foreground">Translated radio transcript segments with confidence scores</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Segments', value: rows.length, colour: 'text-gray-700' },
            { label: 'Low Confidence', value: lowConfCount, colour: lowConfCount > 0 ? 'text-red-700' : 'text-muted-foreground' },
            { label: 'Avg Confidence', value: avgConf === '—' ? '—' : `${avgConf}%`, colour: 'text-violet-700' },
            { label: 'Languages', value: languages.length, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search translated text…" className="w-56" />
          <Select value={langFilter} onValueChange={setLangFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map(l => <SelectItem key={l} value={l!}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map(p => <SelectItem key={p} value={p!}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => setLowConfOnly(v => !v)}
            className={`border rounded px-3 py-1 text-sm ${lowConfOnly ? 'bg-red-100 text-red-800 border-red-300' : 'bg-background text-foreground'}`}
          >
            Low confidence only
          </button>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-1 text-sm w-40 bg-background" />
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
                  <TableHead>Language</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Low Conf</TableHead>
                  <TableHead className="min-w-[24rem]">Translated Text</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id} className={row.is_low_confidence ? 'bg-red-50/40' : ''}>
                    <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                    <TableCell>
                      <Badge className="bg-violet-100 text-violet-800">{row.target_language}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.provider ?? '—'}</TableCell>
                    <TableCell>{confBar(row.confidence)}</TableCell>
                    <TableCell>
                      {row.is_low_confidence
                        ? <Badge className="bg-red-100 text-red-800">low</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{row.text}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
