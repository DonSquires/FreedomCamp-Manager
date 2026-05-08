import { Fragment, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { BadgeCheck, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

type OfficerSkillRow = Database['public']['Tables']['officer_skills']['Row']

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try {
    return format(parseISO(ts), 'dd MMM yyyy HH:mm')
  } catch {
    return ts
  }
}

function expiresSoon(ts: string | null) {
  if (!ts) return false
  const diff = new Date(ts).getTime() - Date.now()
  return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 60
}

function expired(ts: string | null) {
  if (!ts) return false
  return new Date(ts).getTime() < Date.now()
}

export default function OfficerSkillsLog() {
  const { user } = useAuthStore()
  const [verificationFilter, setVerificationFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [skillQuery, setSkillQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OfficerSkillRow[]>({
    queryKey: ['officer-skills-log', verificationFilter, categoryFilter, skillQuery, user?.organization_id, user?.role],
    queryFn: async () => {
      const isElevatedRole = user?.role === 'master' || user?.role === 'grand_master'
      if (!isElevatedRole && !user?.organization_id) return []

      let q = supabase
        .from('officer_skills')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (!isElevatedRole && user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (verificationFilter === 'verified') q = q.eq('is_verified', true)
      if (verificationFilter === 'unverified') q = q.eq('is_verified', false)
      if (categoryFilter !== 'all') q = q.eq('skill_category', categoryFilter)
      if (skillQuery.trim()) q = q.ilike('skill_name', `%${skillQuery.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const verifiedCount = rows.filter((row) => row.is_verified).length
  const expiringCount = rows.filter((row) => expiresSoon(row.expires_at)).length
  const expiredCount = rows.filter((row) => expired(row.expires_at)).length

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BadgeCheck className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Skills Log</h1>
              <p className="text-sm text-muted-foreground">Training, licence, and certification audit view for officer_skills</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Skills', value: rows.length, color: 'text-gray-700' },
            { label: 'Verified', value: verifiedCount, color: 'text-green-700' },
            { label: 'Expiring Soon', value: expiringCount, color: 'text-amber-700' },
            { label: 'Expired', value: expiredCount, color: 'text-red-700' },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={verificationFilter} onValueChange={setVerificationFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Verification" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="licence">Licence</SelectItem>
              <SelectItem value="certification">Certification</SelectItem>
              <SelectItem value="training">Training</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
              <SelectItem value="language">Language</SelectItem>
              <SelectItem value="general">General</SelectItem>
            </SelectContent>
          </Select>
          <Input value={skillQuery} onChange={(e) => setSkillQuery(e.target.value)} placeholder="Skill name…" className="w-44" />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2"><AlertCircle className="h-8 w-8" /><p>No officer skills found</p></div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.created_at)}</TableCell>
                      <TableCell className="text-sm font-medium">{row.skill_name ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.skill_category ?? '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{row.officer_id ?? '—'}</TableCell>
                      <TableCell>{row.is_verified ? <Badge className="bg-green-100 text-green-800 text-xs">Verified</Badge> : <Badge variant="outline" className="text-xs">Pending</Badge>}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(row.expires_at)}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={7} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            <div><span className="font-medium">Skill ID:</span> {row.id}</div>
                            <div><span className="font-medium">Org ID:</span> {row.organization_id ?? '—'}</div>
                            <div><span className="font-medium">Certification #:</span> {row.certification_number ?? '—'}</div>
                            <div><span className="font-medium">Issued:</span> {fmtDate(row.issued_at)}</div>
                            <div><span className="font-medium">Verified At:</span> {fmtDate(row.verified_at)}</div>
                            <div><span className="font-medium">Verified By:</span> {row.verified_by ?? '—'}</div>
                          </div>
                          <div><span className="font-medium">Document URL:</span> {row.document_url ?? '—'}</div>
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
