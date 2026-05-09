/**
 * OfficerSkillsLog — B-176
 *
 * Admin viewer for officer_skills.
 * Displays officer skill records including certification numbers, categories,
 * issue/expiry dates, verification status, and supporting documents.
 *
 * Route: /officer-skills-log — admin/admin_officer/master
 */
import { useState } from 'react'
import { format, parseISO, isBefore, addDays } from 'date-fns'
import { GraduationCap, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
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

function isExpired(expires_at: string | null): boolean {
  if (!expires_at) return false
  try { return isBefore(parseISO(expires_at), new Date()) } catch { return false }
}

function isExpiringSoon(expires_at: string | null): boolean {
  if (!expires_at) return false
  try {
    const exp = parseISO(expires_at)
    const now = new Date()
    return !isBefore(exp, now) && isBefore(exp, addDays(now, 30))
  } catch { return false }
}

export default function OfficerSkillsLog() {
  const { user } = useAuthStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [verifiedFilter, setVerifiedFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rows = [], isLoading, refetch } = useQuery<OfficerSkillRow[]>({
    queryKey: ['officer-skills-log', user?.organization_id, searchQuery, categoryFilter, verifiedFilter, dateFrom],
    queryFn: async () => {
      let q = supabase
        .from('officer_skills')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

      if (user?.organization_id) q = q.eq('organization_id', user.organization_id)
      if (searchQuery.trim()) q = q.ilike('skill_name', `%${searchQuery.trim()}%`)
      if (categoryFilter !== 'all') q = q.eq('skill_category', categoryFilter)
      if (verifiedFilter === 'verified') q = q.eq('is_verified', true)
      if (verifiedFilter === 'unverified') q = q.eq('is_verified', false)
      if (dateFrom) q = q.gte('created_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const verifiedCount = rows.filter(r => r.is_verified).length
  const expiringSoonCount = rows.filter(r => isExpiringSoon(r.expires_at)).length
  const expiredCount = rows.filter(r => isExpired(r.expires_at)).length

  const categories = Array.from(new Set(rows.map(r => r.skill_category).filter(Boolean)))

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-indigo-600" />
            <div>
              <h1 className="text-2xl font-bold">Officer Skills Log</h1>
              <p className="text-sm text-muted-foreground">Officer skill records including certifications, categories, expiry dates, and verification status</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: rows.length, colour: 'text-gray-700' },
            { label: 'Verified', value: verifiedCount, colour: 'text-emerald-700' },
            { label: 'Expiring Soon', value: expiringSoonCount, colour: 'text-amber-700' },
            { label: 'Expired', value: expiredCount, colour: 'text-red-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search skill name…" className="w-52" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={verifiedFilter} onValueChange={setVerifiedFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Verified" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
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
                  <TableHead>Officer ID</TableHead>
                  <TableHead>Skill Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Certification #</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Verified</TableHead>
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
                      <TableCell className="font-mono text-xs">{row.officer_id}</TableCell>
                      <TableCell className="font-medium text-sm">{row.skill_name}</TableCell>
                      <TableCell className="text-sm">{row.skill_category}</TableCell>
                      <TableCell className="font-mono text-xs">{row.certification_number ?? '—'}</TableCell>
                      <TableCell className="text-sm">{fmtDateShort(row.issued_at)}</TableCell>
                      <TableCell className="text-sm">
                        {row.expires_at ? (
                          <span className={isExpired(row.expires_at) ? 'text-red-600 font-medium' : isExpiringSoon(row.expires_at) ? 'text-amber-600 font-medium' : ''}>
                            {fmtDateShort(row.expires_at)}
                          </span>
                        ) : '—'}
                      </TableCell>
                      <TableCell>{boolBadge(row.is_verified, 'Verified', 'Unverified')}</TableCell>
                      <TableCell className="text-xs text-sky-600">{expanded === row.id ? '▲ hide' : '▼ show'}</TableCell>
                    </TableRow>
                    {expanded === row.id && (
                      <TableRow key={`${row.id}-exp`} className="bg-muted/20">
                        <TableCell colSpan={8} className="text-xs text-muted-foreground space-y-1 py-3">
                          <div><span className="font-medium">ID:</span> {row.id}</div>
                          {row.certification_number && <div><span className="font-medium">Certification #:</span> {row.certification_number}</div>}
                          {row.document_url && <div><span className="font-medium">Document URL:</span> <span className="break-all">{row.document_url}</span></div>}
                          {row.verified_by && <div><span className="font-medium">Verified by:</span> {row.verified_by}</div>}
                          {row.verified_at && <div><span className="font-medium">Verified at:</span> {fmtDate(row.verified_at)}</div>}
                          {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                          <div>
                            <span className="font-medium">Created:</span> {fmtDate(row.created_at)} &nbsp;
                            <span className="font-medium">Updated:</span> {fmtDate(row.updated_at)}
                          </div>
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
            {verifiedCount} verified &nbsp;·&nbsp; {expiredCount} expired &nbsp;·&nbsp; {rows.length} total skills
          </p>
        )}
      </div>
    </AppLayout>
  )
}
