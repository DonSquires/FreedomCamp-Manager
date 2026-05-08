/**
 * CanonicalPersonsLog — B-180
 *
 * Admin viewer for canonical_persons.
 * Displays de-duplicated person records including identity status,
 * physical descriptors, and minor flags.
 *
 * Route: /canonical-persons-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { PersonStanding, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
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

type CanonicalPersonRow = Database['public']['Tables']['canonical_persons']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDateShort(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

function identityBadge(status: string | null) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const styles: Record<string, string> = {
    identified: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-amber-100 text-amber-800',
    unknown: 'bg-gray-100 text-gray-600',
  }
  return (
    <Badge className={styles[status] ?? 'bg-gray-100 text-gray-600'}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

export default function CanonicalPersonsLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch] = useState('')
  const [identityFilter, setIdentityFilter] = useState('all')
  const [minorFilter, setMinorFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<CanonicalPersonRow[]>({
    queryKey: ['canonical-persons-log', orgId, search, identityFilter, minorFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('canonical_persons')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (orgId) q = q.eq('organization_id', orgId)
      if (search.trim()) q = q.ilike('full_name', `%${search.trim()}%`)
      if (identityFilter !== 'all') q = q.eq('identity_status', identityFilter)
      if (minorFilter === 'minor') q = q.eq('is_minor', true)
      if (minorFilter === 'adult') q = q.eq('is_minor', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const identified = rows.filter(r => r.identity_status === 'identified').length
  const partial = rows.filter(r => r.identity_status === 'partial').length
  const minors = rows.filter(r => r.is_minor).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PersonStanding className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Canonical Persons</h1>
              <p className="text-sm text-muted-foreground">De-duplicated person records including identity status, physical descriptors, and minor flags</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Identified', value: identified, colour: 'text-emerald-700' },
            { label: 'Partial', value: partial, colour: 'text-amber-700' },
            { label: 'Minor', value: minors, colour: 'text-sky-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search full name…" className="w-52" />
          <Select value={identityFilter} onValueChange={setIdentityFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Identity status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="identified">Identified</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minorFilter} onValueChange={setMinorFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Minor / adult" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All persons</SelectItem>
              <SelectItem value="minor">Minor only</SelectItem>
              <SelectItem value="adult">Adult only</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-44"
            title="Created from date"
          />
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
                  <TableHead>Full Name</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Ethnicity</TableHead>
                  <TableHead>Identity Status</TableHead>
                  <TableHead>Minor</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="font-medium">{row.full_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDateShort(row.date_of_birth)}</TableCell>
                      <TableCell className="text-sm">{row.gender ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.ethnicity ?? '—'}</TableCell>
                      <TableCell>{identityBadge(row.identity_status)}</TableCell>
                      <TableCell>{boolBadge(row.is_minor, 'Minor', 'Adult')}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id} &nbsp; <span className="font-medium">Org:</span> {row.organization_id ?? '—'}</div>
                          <div>
                            <span className="font-medium">Nationality:</span> {row.nationality ?? '—'} &nbsp;
                            <span className="font-medium">Height:</span> {row.height_cm != null ? `${row.height_cm} cm` : '—'} &nbsp;
                            <span className="font-medium">Weight:</span> {row.weight_kg != null ? `${row.weight_kg} kg` : '—'}
                          </div>
                          {row.distinguishing_features && (
                            <div><span className="font-medium">Distinguishing Features:</span> {row.distinguishing_features}</div>
                          )}
                          {row.description && (
                            <div><span className="font-medium">Description:</span> {row.description}</div>
                          )}
                          <div><span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}</div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-right">
            {identified} identified &nbsp;·&nbsp; {minors} minors &nbsp;·&nbsp; {rows.length} total persons
          </p>
        )}
      </div>
    </AppLayout>
  )
}
