import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Building2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type OrganizationRow = Database['public']['Tables']['organizations']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

export default function OrganizationLog() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OrganizationRow[]>({
    queryKey: ['organizations-log', activeFilter, typeFilter, searchQuery],
    queryFn: async () => {
      let q = supabase
        .from('organizations')
        .select('*')
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(500)

      if (activeFilter === 'active') q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)
      if (typeFilter !== 'all') q = q.eq('organization_type', typeFilter)
      if (searchQuery.trim()) q = q.or(`name.ilike.%${searchQuery.trim()}%,contact_email.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const activeCount = rows.filter((r) => r.is_active !== false).length
  const inactiveCount = rows.filter((r) => r.is_active === false).length
  const withParentCount = rows.filter((r) => !!r.parent_organization_id).length
  const orgTypes = ['all', ...Array.from(new Set(rows.map((r) => r.organization_type).filter(Boolean)))]

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold">Organization Log</h1>
              <p className="text-sm text-muted-foreground">Organization records, hierarchy links, and policy toggles</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Organizations', value: rows.length, color: 'text-gray-700' },
            { label: 'Active', value: activeCount, color: 'text-green-700' },
            { label: 'Inactive', value: inactiveCount, color: 'text-slate-700' },
            { label: 'With Parent', value: withParentCount, color: 'text-indigo-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name or email…"
            className="w-56"
          />
          <Select value={activeFilter} onValueChange={setActiveFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="State" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {orgTypes.map((type) => (
                <SelectItem key={type} value={type}>{type === 'all' ? 'All types' : type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" />
            <p>No organizations found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      <TableCell className="text-sm font-medium">{row.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.organization_type ?? '—'}</Badge></TableCell>
                      <TableCell>
                        <Badge className={row.is_active === false ? 'bg-slate-100 text-slate-700' : 'bg-green-100 text-green-800'}>
                          {row.is_active === false ? 'Inactive' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.organization_level ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.contact_email ?? row.contact_phone ?? '—'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.updated_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">ID:</span> {row.id}</div>
                            <div><span className="font-medium">Parent:</span> {row.parent_organization_id ?? '—'}</div>
                            <div><span className="font-medium">Created:</span> {fmtDate(row.created_at)}</div>
                            <div><span className="font-medium">Workflow:</span> {row.enforcement_workflow ?? '—'}</div>
                            <div><span className="font-medium">COA required:</span> {row.requires_coa ? 'Yes' : 'No'}</div>
                            <div><span className="font-medium">Warrant required:</span> {row.requires_warrant_for_enforcement ? 'Yes' : 'No'}</div>
                          </div>
                          {row.address && <div><span className="font-medium">Address:</span> {row.address}</div>}
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
