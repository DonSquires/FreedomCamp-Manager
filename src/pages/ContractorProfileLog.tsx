/**
 * ContractorProfileLog — B-178
 *
 * Admin viewer for contractor_profiles.
 * Displays contractor health & safety policy status, insurance verification,
 * guard rates, and contact details.
 *
 * Route: /contractor-profiles-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Briefcase, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ContractorProfileRow = Database['public']['Tables']['contractor_profiles']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function boolBadge(val: boolean | null, trueLabel = 'Yes', falseLabel = 'No') {
  if (val == null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge className={val ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-600'}>
      {val ? trueLabel : falseLabel}
    </Badge>
  )
}

export default function ContractorProfileLog() {
  const [search, setSearch] = useState('')
  const [hsFilter, setHsFilter] = useState('all')
  const [insuranceFilter, setInsuranceFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ContractorProfileRow[]>({
    queryKey: ['contractor-profiles-log', search, hsFilter, insuranceFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('contractor_profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (search.trim()) q = q.ilike('contact_name', `%${search.trim()}%`)
      if (hsFilter === 'verified') q = q.eq('hs_policy_verified', true)
      if (hsFilter === 'unverified') q = q.eq('hs_policy_verified', false)
      if (insuranceFilter === 'verified') q = q.eq('insurance_verified', true)
      if (insuranceFilter === 'unverified') q = q.eq('insurance_verified', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const hsVerified = rows.filter(r => r.hs_policy_verified).length
  const insuranceVerified = rows.filter(r => r.insurance_verified).length
  const bothVerified = rows.filter(r => r.hs_policy_verified && r.insurance_verified).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="h-6 w-6 text-amber-600" />
            <div>
              <h1 className="text-2xl font-bold">Contractor Profiles</h1>
              <p className="text-sm text-muted-foreground">Contractor health & safety, insurance verification, and rate records</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'HS Policy Verified', value: hsVerified, colour: 'text-emerald-700' },
            { label: 'Insurance Verified', value: insuranceVerified, colour: 'text-sky-700' },
            { label: 'Both Verified', value: bothVerified, colour: 'text-purple-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contact name…" className="w-52" />
          <Select value={hsFilter} onValueChange={setHsFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="HS Policy" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All HS status</SelectItem>
              <SelectItem value="verified">HS Verified</SelectItem>
              <SelectItem value="unverified">HS Unverified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={insuranceFilter} onValueChange={setInsuranceFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Insurance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All insurance status</SelectItem>
              <SelectItem value="verified">Insurance Verified</SelectItem>
              <SelectItem value="unverified">Insurance Unverified</SelectItem>
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
                  <TableHead>Contact Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Guard Rate (NZD/hr)</TableHead>
                  <TableHead>HS Policy</TableHead>
                  <TableHead>Insurance</TableHead>
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
                      <TableCell className="font-medium">{row.contact_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.contact_role ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.contact_email ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right">{row.guard_rate_per_hour != null ? `$${row.guard_rate_per_hour}` : '—'}</TableCell>
                      <TableCell>{boolBadge(row.hs_policy_verified, 'Verified', 'Unverified')}</TableCell>
                      <TableCell>{boolBadge(row.insurance_verified, 'Verified', 'Unverified')}</TableCell>
                      <TableCell className="text-sm">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          <div><span className="font-medium">Phone:</span> {row.contact_phone ?? '—'}</div>
                          <div>
                            <span className="font-medium">Accounts Name:</span> {row.accounts_name ?? '—'} &nbsp;
                            <span className="font-medium">Email:</span> {row.accounts_email ?? '—'} &nbsp;
                            <span className="font-medium">Phone:</span> {row.accounts_phone ?? '—'}
                          </div>
                          <div>
                            <span className="font-medium">HS Policy Expiry:</span> {fmtDate(row.hs_policy_expiry)} &nbsp;
                            <span className="font-medium">Insurance Expiry:</span> {fmtDate(row.insurance_expiry)}
                          </div>
                          {row.long_term_definition && (
                            <div><span className="font-medium">Long-term Definition:</span> {row.long_term_definition}</div>
                          )}
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
            {bothVerified} fully verified &nbsp;·&nbsp; {rows.length} total contractors
          </p>
        )}
      </div>
    </AppLayout>
  )
}
