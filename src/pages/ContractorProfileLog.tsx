import { Fragment, useState } from 'react'
import { format, parseISO, isPast } from 'date-fns'
import { Briefcase, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type ContractorProfileRow = Database['public']['Tables']['contractor_profiles']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy')
  } catch {
    return ts
  }
}

function atRisk(row: ContractorProfileRow) {
  return !row.insurance_verified || !row.hs_policy_verified || !row.service_agreement_signed || isPast(new Date(row.insurance_expiry ?? '2999-12-31')) || isPast(new Date(row.hs_policy_expiry ?? '2999-12-31')) || isPast(new Date(row.service_agreement_expiry ?? '2999-12-31'))
}

function fmtRate(value: number | null) {
  return value == null ? '—' : `$${value.toFixed(2)}`
}

export default function ContractorProfileLog() {
  const { user } = useAuthStore()
  const [complianceFilter, setComplianceFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<ContractorProfileRow[]>({
    queryKey: ['contractor-profiles-log', complianceFilter, searchQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('contractor_profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (searchQuery.trim()) q = q.or(`contact_name.ilike.%${searchQuery.trim()}%,accounts_name.ilike.%${searchQuery.trim()}%,contact_email.ilike.%${searchQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error

      const next = data ?? []
      if (complianceFilter === 'verified') return next.filter((row) => row.insurance_verified && row.hs_policy_verified && row.service_agreement_signed)
      if (complianceFilter === 'at_risk') return next.filter(atRisk)
      return next
    },
  })

  const insuranceVerifiedCount = rows.filter((row) => row.insurance_verified).length
  const hsVerifiedCount = rows.filter((row) => row.hs_policy_verified).length
  const agreementCount = rows.filter((row) => row.service_agreement_signed).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Briefcase className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Contractor Profile Log</h1>
              <p className="text-sm text-muted-foreground">Commercial and compliance audit view for contractor_profiles</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Profiles', value: rows.length, color: 'text-gray-700' },
            { label: 'Insurance OK', value: insuranceVerifiedCount, color: 'text-green-700' },
            { label: 'H&S OK', value: hsVerifiedCount, color: 'text-sky-700' },
            { label: 'Agreement Signed', value: agreementCount, color: 'text-amber-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={complianceFilter} onValueChange={setComplianceFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Compliance" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All profiles</SelectItem>
              <SelectItem value="verified">Fully verified</SelectItem>
              <SelectItem value="at_risk">At risk</SelectItem>
            </SelectContent>
          </Select>
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Contact or accounts…" className="w-52" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No contractor profiles found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Accounts</TableHead>
                  <TableHead>Insurance</TableHead>
                  <TableHead>H&S</TableHead>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.contact_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.accounts_name ?? '—'}</TableCell>
                      <TableCell>{row.insurance_verified ? <Badge className="bg-green-100 text-green-800 text-xs">Verified</Badge> : <Badge variant="outline" className="text-xs">Pending</Badge>}</TableCell>
                      <TableCell>{row.hs_policy_verified ? <Badge className="bg-sky-100 text-sky-800 text-xs">Verified</Badge> : <Badge variant="outline" className="text-xs">Pending</Badge>}</TableCell>
                      <TableCell>{row.service_agreement_signed ? <Badge className="bg-amber-100 text-amber-800 text-xs">Signed</Badge> : <Badge variant="outline" className="text-xs">Unsigned</Badge>}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Profile ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Contact Email:</span> {row.contact_email ?? '—'}</div>
                            <div><span className="font-medium">Insurance Expiry:</span> {fmtDate(row.insurance_expiry)}</div>
                            <div><span className="font-medium">H&S Expiry:</span> {fmtDate(row.hs_policy_expiry)}</div>
                            <div><span className="font-medium">Agreement Expiry:</span> {fmtDate(row.service_agreement_expiry)}</div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Guard Rate:</span> {fmtRate(row.guard_rate_per_hour)}</div>
                            <div><span className="font-medium">Short Notice:</span> {fmtRate(row.short_notice_rate_per_hour)}</div>
                            <div><span className="font-medium">Standby:</span> {fmtRate(row.standby_rate_per_hour)}</div>
                            <div><span className="font-medium">Travel / km:</span> {fmtRate(row.travel_rate_per_km)}</div>
                            <div><span className="font-medium">Long-term Rate:</span> {fmtRate(row.long_term_rate_per_hour)}</div>
                            <div><span className="font-medium">Long-term Days:</span> {row.long_term_min_days ?? '—'}</div>
                          </div>
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
