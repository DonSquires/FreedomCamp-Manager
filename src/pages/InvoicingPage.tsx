/**
 * InvoicingPage – Read-only invoicing and contract viewer.
 *
 * Shows contracts and invoices per client, with line items and payment status.
 * Admin-only view — no editing (billing system to be built later).
 *
 * Data sources:
 *   • crm_contracts      — service agreements
 *   • crm_invoices        — billing records
 *   • crm_invoice_lines   — line items per invoice
 *   • crm_payments        — payment records
 *   • organizations       — client names
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Building2,
  Receipt,
  FileText,
  DollarSign,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CreditCard,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(cents / 100)
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—'
  try { return format(parseISO(d), 'd MMM yyyy') } catch { return d }
}

const INVOICE_STATUS_STYLE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  viewed:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  paid:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  overdue:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  voided:    'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
  cancelled: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500',
}

const CONTRACT_STATUS_STYLE: Record<string, string> = {
  draft:      'bg-gray-100 text-gray-600',
  active:     'bg-emerald-100 text-emerald-700',
  expired:    'bg-amber-100 text-amber-700',
  terminated: 'bg-red-100 text-red-700',
  suspended:  'bg-orange-100 text-orange-700',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InvoiceStatusIcon({ status }: { status: string }) {
  if (status === 'paid') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (status === 'overdue') return <AlertCircle className="h-4 w-4 text-red-500" />
  if (status === 'sent' || status === 'viewed') return <Clock className="h-4 w-4 text-blue-500" />
  return <FileText className="h-4 w-4 text-gray-400" />
}

function InvoiceRow({ invoice }: { invoice: any }) {
  const [expanded, setExpanded] = useState(false)
  const lines: any[] = invoice.lines ?? []

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="font-mono text-xs font-semibold">{invoice.invoice_number}</TableCell>
        <TableCell className="text-sm">{invoice.client?.name ?? '—'}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDate(invoice.invoice_date)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDate(invoice.due_date)}</TableCell>
        <TableCell className="text-sm font-semibold">{formatCents(invoice.total_cents)}</TableCell>
        <TableCell>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${INVOICE_STATUS_STYLE[invoice.status] ?? INVOICE_STATUS_STYLE.draft}`}>
            {invoice.status}
          </span>
        </TableCell>
        <TableCell>
          <InvoiceStatusIcon status={invoice.status} />
        </TableCell>
        <TableCell>
          {lines.length > 0 && (
            expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
              : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          )}
        </TableCell>
      </TableRow>

      {expanded && lines.length > 0 && (
        <TableRow className="bg-gray-50/80 dark:bg-gray-800/30">
          <TableCell colSpan={8} className="py-3 px-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Line Items</p>
            <div className="space-y-1">
              {lines.map((line: any) => (
                <div key={line.id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700 dark:text-gray-300">{line.description}</span>
                  <span className="font-medium">{formatCents(line.total_cents)}</span>
                </div>
              ))}
            </div>
            {invoice.billing_period_start && (
              <p className="text-[11px] text-muted-foreground mt-2">
                Billing period: {formatDate(invoice.billing_period_start)} – {formatDate(invoice.billing_period_end)}
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvoicingPage() {
  const { user } = useAuthStore()
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // Load client orgs
  const { data: clients = [] } = useQuery({
    queryKey: ['invoicing-clients'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organizations')
        .select('id, name')
        .eq('organization_type', 'client')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  // Load invoices with line items
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['crm-invoices', clientFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('crm_invoices')
        .select(`
          id, invoice_number, invoice_date, due_date, total_cents, subtotal_cents,
          tax_cents, status, billing_period_start, billing_period_end, currency,
          reference,
          client:organizations!crm_invoices_client_organization_id_fkey(id, name),
          provider:organizations!crm_invoices_provider_organization_id_fkey(name),
          lines:crm_invoice_lines(id, description, quantity, unit_price_cents, total_cents)
        `)
        .order('invoice_date', { ascending: false })
        .limit(200)
      if (clientFilter !== 'all') q = q.eq('client_organization_id', clientFilter)
      const { data, error } = await q
      if (error) {
        // Table may not be populated yet; return empty gracefully
        console.warn('crm_invoices query error:', error.message)
        return []
      }
      return data ?? []
    },
  })

  // Load contracts
  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ['crm-contracts', clientFilter],
    queryFn: async () => {
      let q = (supabase as any)
        .from('crm_contracts')
        .select(`
          id, contract_number, name, status, start_date, end_date,
          total_value_cents, currency, description,
          client:organizations!crm_contracts_client_organization_id_fkey(id, name),
          provider:organizations!crm_contracts_provider_organization_id_fkey(name),
          lines:crm_contract_lines(id, description, billing_type, unit_price_cents, quantity, is_active)
        `)
        .order('created_at', { ascending: false })
        .limit(100)
      if (clientFilter !== 'all') q = q.eq('client_organization_id', clientFilter)
      const { data, error } = await q
      if (error) {
        console.warn('crm_contracts query error:', error.message)
        return []
      }
      return data ?? []
    },
  })

  // Summary metrics
  const totalOutstanding = invoices
    .filter((inv: any) => ['sent', 'viewed', 'overdue'].includes(inv.status))
    .reduce((sum: number, inv: any) => sum + (inv.total_cents ?? 0), 0)

  const totalPaid = invoices
    .filter((inv: any) => inv.status === 'paid')
    .reduce((sum: number, inv: any) => sum + (inv.total_cents ?? 0), 0)

  const overdueCount = invoices.filter((inv: any) => inv.status === 'overdue').length

  // Filtered views
  const filteredInvoices = invoices.filter((inv: any) => {
    const matchSearch = !search || (
      inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      inv.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
      inv.reference?.toLowerCase().includes(search.toLowerCase())
    )
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    return matchSearch && matchStatus
  })

  const filteredContracts = contracts.filter((c: any) => {
    return !search || (
      c.contract_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.name?.toLowerCase().includes(search.toLowerCase())
    )
  })

  return (
    <AppLayout title="Invoicing" description="Read-only — contracts and invoice history">
      <div className="space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40">
              <Receipt className="h-6 w-6 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Invoicing</h1>
              <p className="text-sm text-muted-foreground">
                Contracts and invoice history — read only
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs self-start sm:self-auto">
            Read Only — Billing module coming soon
          </Badge>
        </div>

        {/* ── Summary tiles ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Outstanding',   value: formatCents(totalOutstanding), Icon: Clock,         colour: 'text-amber-600 dark:text-amber-400' },
            { label: 'Paid (all)',     value: formatCents(totalPaid),        Icon: CheckCircle2,  colour: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Overdue',        value: overdueCount,                  Icon: AlertCircle,   colour: overdueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400' },
            { label: 'Contracts',      value: contracts.length,              Icon: FileText,      colour: 'text-blue-600 dark:text-blue-400' },
          ].map(({ label, value, Icon, colour }) => (
            <Card key={label} className="bg-white dark:bg-gray-900 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-5 w-5 shrink-0 ${colour}`} />
                <div>
                  <p className={`text-lg font-bold leading-tight ${colour}`}>{value}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search invoice #, client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="All clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices" className="gap-1.5 text-xs">
              <Receipt className="h-3.5 w-3.5" />
              Invoices
              {invoices.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-[10px] font-semibold px-1.5 py-0.5">
                  {invoices.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="contracts" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />
              Contracts
              {contracts.length > 0 && (
                <span className="ml-1 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 text-[10px] font-semibold px-1.5 py-0.5">
                  {contracts.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Invoices tab */}
          <TabsContent value="invoices" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-amber-600" />
                  Invoice History
                </CardTitle>
                <CardDescription className="text-xs">
                  Click a row to expand line items. Read-only view.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {invoicesLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading invoices…</div>
                ) : filteredInvoices.length === 0 ? (
                  <div className="py-10 text-center">
                    <Receipt className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {invoices.length === 0
                        ? 'No invoices found. Invoices will appear here once contracts are set up in the CRM.'
                        : 'No invoices match your search.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Invoice #</TableHead>
                          <TableHead className="text-xs">Client</TableHead>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Due</TableHead>
                          <TableHead className="text-xs">Total</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="w-8" />
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInvoices.map((inv: any) => (
                          <InvoiceRow key={inv.id} invoice={inv} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contracts tab */}
          <TabsContent value="contracts" className="mt-4">
            <Card className="bg-white dark:bg-gray-900 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-600" />
                  Service Contracts
                </CardTitle>
                <CardDescription className="text-xs">Active and historical service agreements per client.</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {contractsLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading contracts…</div>
                ) : filteredContracts.length === 0 ? (
                  <div className="py-10 text-center">
                    <FileText className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {contracts.length === 0
                        ? 'No contracts found. Create contracts in the CRM to manage service agreements.'
                        : 'No contracts match your search.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredContracts.map((contract: any) => {
                      const lines: any[] = contract.lines ?? []
                      return (
                        <div key={contract.id} className="border rounded-xl p-4 bg-gray-50/50 dark:bg-gray-800/30 dark:border-gray-700">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-sm text-gray-900 dark:text-white">{contract.name}</p>
                                {contract.contract_number && (
                                  <span className="text-xs font-mono text-muted-foreground">#{contract.contract_number}</span>
                                )}
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${CONTRACT_STATUS_STYLE[contract.status] ?? CONTRACT_STATUS_STYLE.draft}`}>
                                  {contract.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {contract.client?.name ?? '—'}
                                </span>
                                {contract.start_date && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatDate(contract.start_date)} → {contract.end_date ? formatDate(contract.end_date) : 'Ongoing'}
                                  </span>
                                )}
                              </div>
                              {contract.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{contract.description}</p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              {contract.total_value_cents && (
                                <p className="font-bold text-sm text-gray-900 dark:text-white">{formatCents(contract.total_value_cents)}</p>
                              )}
                            </div>
                          </div>

                          {/* Contract line items */}
                          {lines.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                Services & Rates
                              </p>
                              <div className="grid gap-1.5 sm:grid-cols-2">
                                {lines.filter((l: any) => l.is_active !== false).map((line: any) => (
                                  <div key={line.id} className="flex items-center justify-between rounded-lg bg-white dark:bg-gray-700/40 px-3 py-2 text-xs">
                                    <span className="text-gray-700 dark:text-gray-300 truncate">{line.description}</span>
                                    <span className="font-semibold ml-2 shrink-0">
                                      {formatCents(line.unit_price_cents)}
                                      <span className="text-muted-foreground font-normal">
                                        {line.billing_type === 'hourly' ? '/hr'
                                          : line.billing_type === 'per_transaction' ? '/job'
                                          : line.billing_type === 'per_seat' ? '/user'
                                          : ''}
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </AppLayout>
  )
}
