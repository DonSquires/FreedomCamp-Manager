/**
 * InvoicingPage – Billing operations workspace for contracts and invoices.
 *
 * Supports contract-backed draft generation, status transitions, and
 * manual payment recording for invoice balances.
 *
 * Data sources:
 *   • crm_contracts       — service agreements
 *   • crm_invoices        — billing records
 *   • crm_invoice_lines   — line items per invoice
 *   • crm_payments        — payment records
 *   • organizations       — client names
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Building2,
  DollarSign,
  Receipt,
  FileText,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  Send,
  XCircle,
  CreditCard,
  ArrowDownWideNarrow,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import {
  buildInvoiceDraftFromContractLines,
  deriveInvoicePaymentUpdateFromPaidTotal,
  getEffectiveCompletedPaymentCents,
  getRemainingBalancePreviewCents,
  getInvoiceDueDate,
  getOverdueCandidateIds,
  getOutstandingInvoiceCents,
  getSuggestedPaymentAmountsCents,
  isInvoicePastDue,
  validatePaymentAmountInput,
} from '@/lib/invoicing'
import { useClientAccessPolicy } from '@/hooks/useClientAccessPolicy'
import { CostIntelligencePanel } from '@/components/features/CostIntelligencePanel'

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
  draft:     'bg-gray-100 text-gray-600 dark:bg-[#1E1E1E] dark:text-gray-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  viewed:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  partially_paid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  paid:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  overdue:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  voided:    'bg-gray-100 text-gray-600 dark:bg-[#1E1E1E] dark:text-gray-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-[#1E1E1E] dark:text-gray-300',
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
  if (status === 'partially_paid') return <CreditCard className="h-4 w-4 text-amber-500" />
  if (status === 'overdue') return <AlertCircle className="h-4 w-4 text-red-500" />
  if (status === 'sent' || status === 'viewed') return <Clock className="h-4 w-4 text-blue-500" />
  return <FileText className="h-4 w-4 text-gray-400" />
}

function InvoiceRow({
  invoice,
  onUpdateStatus,
  onRecordPayment,
  onMarkOverdue,
  readOnly,
  isUpdating,
}: {
  invoice: any
  onUpdateStatus: (invoice: any, status: 'sent' | 'cancelled') => void
  onRecordPayment: (invoice: any) => void
  onMarkOverdue: (invoice: any) => void
  readOnly?: boolean
  isUpdating: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const lines: any[] = invoice.lines ?? []

  const actionButtons = useMemo(() => {
    if (readOnly) {
      return <span className="text-[11px] text-muted-foreground">View only</span>
    }

    if (invoice.status === 'draft') {
      return (
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={isUpdating}
            onClick={(e) => {
              e.stopPropagation()
              onUpdateStatus(invoice, 'cancelled')
            }}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={isUpdating}
            onClick={(e) => {
              e.stopPropagation()
              onUpdateStatus(invoice, 'sent')
            }}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            Send
          </Button>
        </div>
      )
    }

    const canRecordPayment = getOutstandingInvoiceCents(invoice) > 0 && !['draft', 'cancelled', 'paid'].includes(invoice.status)
    const canMarkOverdue = invoice.status !== 'overdue' && isInvoicePastDue(invoice)

    if (canMarkOverdue || canRecordPayment) {
      return (
        <div className="flex items-center gap-1 justify-end">
          {canMarkOverdue && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={isUpdating}
              onClick={(e) => {
                e.stopPropagation()
                onMarkOverdue(invoice)
              }}
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              Mark overdue
            </Button>
          )}

          {canRecordPayment && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={isUpdating}
              onClick={(e) => {
                e.stopPropagation()
                onRecordPayment(invoice)
              }}
            >
              <CreditCard className="h-3.5 w-3.5 mr-1" />
              Record payment
            </Button>
          )}
        </div>
      )
    }

    return <span className="text-[11px] text-muted-foreground">No actions</span>
  }, [invoice, isUpdating, onMarkOverdue, onRecordPayment, onUpdateStatus, readOnly])

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-[#2A2A2A]/50"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="font-mono text-xs font-semibold">{invoice.invoice_number}</TableCell>
        <TableCell className="text-sm">{invoice.client?.name ?? '—'}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDate(invoice.invoice_date)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatDate(invoice.due_date)}</TableCell>
        <TableCell className="text-sm font-semibold">{formatCents(invoice.total_cents)}</TableCell>
        <TableCell className="text-xs text-muted-foreground">{formatCents(invoice.amount_paid_cents)}</TableCell>
        <TableCell className="text-xs font-medium">{formatCents(invoice.balance_cents ?? invoice.total_cents)}</TableCell>
        <TableCell>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${INVOICE_STATUS_STYLE[invoice.status] ?? INVOICE_STATUS_STYLE.draft}`}>
            {invoice.status}
          </span>
        </TableCell>
        <TableCell>
          <InvoiceStatusIcon status={invoice.status} />
        </TableCell>
        <TableCell className="text-right">
          {actionButtons}
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
        <TableRow className="bg-gray-50/80 dark:bg-[#1E1E1E]/30">
          <TableCell colSpan={11} className="py-3 px-6">
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
  const qc = useQueryClient()
  const { isClientRole: isClientBillingUser, isLoading: policyLoading, financeEnabled } = useClientAccessPolicy()
  const scopedClientOrgId = isClientBillingUser ? user?.organization_id ?? null : null
  const [search, setSearch] = useState('')
  const [clientFilter, setClientFilter] = useState(scopedClientOrgId ?? 'all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentStateFilter, setPaymentStateFilter] = useState('all')
  const [invoiceSort, setInvoiceSort] = useState('date_desc')
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [paymentInvoice, setPaymentInvoice] = useState<any | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [paymentReference, setPaymentReference] = useState('')

  // Load client orgs
  const { data: clients = [] } = useQuery({
    queryKey: ['invoicing-clients', scopedClientOrgId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('organizations')
        .select('id, name')
        .eq('organization_type', 'client')
        .eq('is_active', true)
        .order('name')
      if (scopedClientOrgId) q = q.eq('id', scopedClientOrgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  // Load invoices with line items
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['crm-invoices', clientFilter, scopedClientOrgId],
    queryFn: async () => {
      let q = (supabase as any)
        .from('crm_invoices')
        .select(`
          id, invoice_number, invoice_date, due_date, total_cents, subtotal_cents,
          tax_cents, amount_paid_cents, balance_cents, status, billing_period_start, billing_period_end, currency,
          reference,
          client:organizations!crm_invoices_client_organization_id_fkey(id, name),
          provider:organizations!crm_invoices_provider_organization_id_fkey(name),
          lines:crm_invoice_lines(id, description, quantity, unit_price_cents, total_cents)
        `)
        .order('invoice_date', { ascending: false })
        .limit(200)
      if (scopedClientOrgId) {
        q = q.eq('client_organization_id', scopedClientOrgId)
      } else if (clientFilter !== 'all') {
        q = q.eq('client_organization_id', clientFilter)
      }
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
    queryKey: ['crm-contracts', clientFilter, scopedClientOrgId],
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
      if (scopedClientOrgId) {
        q = q.eq('client_organization_id', scopedClientOrgId)
      } else if (clientFilter !== 'all') {
        q = q.eq('client_organization_id', clientFilter)
      }
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
    .filter((inv: any) => ['sent', 'viewed', 'overdue', 'partially_paid'].includes(inv.status))
    .reduce((sum: number, inv: any) => sum + getOutstandingInvoiceCents(inv), 0)

  const totalPaid = invoices
    .filter((inv: any) => inv.status === 'paid')
    .reduce((sum: number, inv: any) => sum + (inv.amount_paid_cents ?? inv.total_cents ?? 0), 0)

  const overdueCount = invoices.filter((inv: any) => inv.status === 'overdue').length

  // Filtered views
  const filteredInvoices = invoices.filter((inv: any) => {
    const matchSearch = !search || (
      inv.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      inv.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
      inv.reference?.toLowerCase().includes(search.toLowerCase())
    )
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    const outstanding = getOutstandingInvoiceCents(inv)
    const matchPaymentState =
      paymentStateFilter === 'all' ||
      (paymentStateFilter === 'outstanding' && outstanding > 0 && inv.status !== 'draft' && inv.status !== 'cancelled') ||
      (paymentStateFilter === 'paid' && inv.status === 'paid') ||
      (paymentStateFilter === 'overdue' && (inv.status === 'overdue' || isInvoicePastDue(inv)))

    return matchSearch && matchStatus && matchPaymentState
  })

  const sortedInvoices = [...filteredInvoices].sort((a: any, b: any) => {
    if (invoiceSort === 'date_asc') {
      return String(a.invoice_date ?? '').localeCompare(String(b.invoice_date ?? ''))
    }
    if (invoiceSort === 'balance_desc') {
      return getOutstandingInvoiceCents(b) - getOutstandingInvoiceCents(a)
    }
    return String(b.invoice_date ?? '').localeCompare(String(a.invoice_date ?? ''))
  })

  const overdueCandidateIds = useMemo(
    () => getOverdueCandidateIds(sortedInvoices),
    [sortedInvoices]
  )

  const filteredContracts = contracts.filter((c: any) => {
    return !search || (
      c.contract_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.name?.toLowerCase().includes(search.toLowerCase())
    )
  })

  const refreshBillingData = () => {
    qc.invalidateQueries({ queryKey: ['crm-invoices'] })
    qc.invalidateQueries({ queryKey: ['crm-contracts'] })
  }

  const createInvoiceMutation = useMutation({
    mutationFn: async (contract: any) => {
      const draft = buildInvoiceDraftFromContractLines(contract.lines ?? [])
      if (draft.lines.length === 0) {
        throw new Error('This contract has no active billable lines to invoice.')
      }

      const { data: existingDraft, error: existingDraftError } = await (supabase as any)
        .from('crm_invoices')
        .select('id, invoice_number')
        .eq('contract_id', contract.id)
        .eq('status', 'draft')
        .limit(1)
        .maybeSingle()

      if (existingDraftError) throw existingDraftError
      if (existingDraft?.id) {
        throw new Error(`Draft invoice ${existingDraft.invoice_number ?? ''} already exists for this contract.`)
      }

      const invoiceDate = new Date()
      const insertPayload = {
        contract_id: contract.id,
        provider_organization_id: user?.organization_id,
        client_organization_id: contract.client?.id,
        invoice_date: invoiceDate.toISOString().slice(0, 10),
        due_date: getInvoiceDueDate(invoiceDate),
        billing_period_start: contract.start_date ?? null,
        billing_period_end: contract.end_date ?? null,
        subtotal_cents: draft.subtotal_cents,
        tax_cents: draft.tax_cents,
        total_cents: draft.total_cents,
        currency: contract.currency ?? 'NZD',
        status: 'draft',
        notes: `Generated from contract ${contract.contract_number ?? contract.name}`,
        created_by: user?.id,
        updated_by: user?.id,
      }

      const { data: invoice, error: invoiceError } = await (supabase as any)
        .from('crm_invoices')
        .insert(insertPayload)
        .select('id, invoice_number')
        .single()

      if (invoiceError) throw invoiceError

      const { error: lineError } = await (supabase as any)
        .from('crm_invoice_lines')
        .insert(
          draft.lines.map((line) => ({
            invoice_id: invoice.id,
            contract_line_id: line.contract_line_id,
            description: line.description,
            quantity: line.quantity,
            unit_price_cents: line.unit_price_cents,
            discount_percent: line.discount_percent,
            tax_rate: line.tax_rate,
            line_subtotal_cents: line.line_subtotal_cents,
            line_tax_cents: line.line_tax_cents,
            line_total_cents: line.line_total_cents,
            sort_order: line.sort_order,
          }))
        )

      if (lineError) throw lineError

      return invoice
    },
    onSuccess: (invoice: any) => {
      refreshBillingData()
      toast.success(`Draft invoice ${invoice.invoice_number ?? 'created'}`)
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to generate draft invoice')
    },
  })

  const updateInvoiceStatusMutation = useMutation({
    mutationFn: async ({ invoiceId, status }: { invoiceId: string; status: 'sent' | 'cancelled' }) => {
      const patch: Record<string, string> = {
        status,
        updated_at: new Date().toISOString(),
      }
      if (status === 'sent') {
        patch.sent_at = new Date().toISOString()
      }

      const { error } = await (supabase as any)
        .from('crm_invoices')
        .update({ ...patch, updated_by: user?.id })
        .eq('id', invoiceId)

      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      refreshBillingData()
      toast.success(variables.status === 'sent' ? 'Invoice sent' : 'Invoice cancelled')
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to update invoice status')
    },
  })

  const markOverdueMutation = useMutation({
    mutationFn: async (invoice: any) => {
      const { error } = await (supabase as any)
        .from('crm_invoices')
        .update({ status: 'overdue', updated_at: new Date().toISOString(), updated_by: user?.id })
        .eq('id', invoice.id)

      if (error) throw error
      return invoice
    },
    onSuccess: (invoice: any) => {
      refreshBillingData()
      toast.success(`Invoice ${invoice.invoice_number} marked overdue`)
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to mark invoice overdue')
    },
  })

  const markAllOverdueMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      if (!invoiceIds.length) return 0

      const { error } = await (supabase as any)
        .from('crm_invoices')
        .update({ status: 'overdue', updated_at: new Date().toISOString(), updated_by: user?.id })
        .in('id', invoiceIds)

      if (error) throw error
      return invoiceIds.length
    },
    onSuccess: (count: number) => {
      if (!count) return
      refreshBillingData()
      toast.success(`Marked ${count} invoice${count === 1 ? '' : 's'} overdue`)
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to mark invoices overdue')
    },
  })

  const recordPaymentMutation = useMutation({
    mutationFn: async ({
      invoice,
      amountCents,
      method,
      reference,
    }: {
      invoice: any
      amountCents: number
      method: string
      reference: string
    }) => {
      const balanceCents = Number(invoice.balance_cents ?? invoice.total_cents ?? 0)
      if (balanceCents <= 0) {
        throw new Error('Invoice has no outstanding balance.')
      }

      if (!amountCents || amountCents <= 0) {
        throw new Error('Payment amount must be greater than zero.')
      }

      if (amountCents > balanceCents) {
        throw new Error('Payment amount cannot exceed outstanding balance.')
      }

      const { error } = await (supabase as any)
        .from('crm_payments')
        .insert({
          invoice_id: invoice.id,
          organization_id: invoice.client?.id,
          amount_cents: amountCents,
          currency: invoice.currency ?? 'NZD',
          payment_method: method,
          payment_reference: reference || `manual-${invoice.invoice_number}`,
          status: 'completed',
          notes: 'Manual payment recorded from Invoicing page',
          processed_by: user?.id,
        })

      if (error) throw error

      const { data: payments, error: paymentsError } = await (supabase as any)
        .from('crm_payments')
        .select('amount_cents, status')
        .eq('invoice_id', invoice.id)

      if (paymentsError) throw paymentsError

      const completedPaidCents = getEffectiveCompletedPaymentCents(payments ?? [])

      const invoicePaymentUpdate = deriveInvoicePaymentUpdateFromPaidTotal(invoice, completedPaidCents)
      const { error: invoiceUpdateError } = await (supabase as any)
        .from('crm_invoices')
        .update({
          ...invoicePaymentUpdate,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        })
        .eq('id', invoice.id)

      if (invoiceUpdateError) throw invoiceUpdateError

      return invoice
    },
    onSuccess: (invoice) => {
      refreshBillingData()
      toast.success(`Payment recorded for ${invoice.invoice_number}`)
      setPaymentDialogOpen(false)
      setPaymentInvoice(null)
      setPaymentAmount('')
      setPaymentMethod('bank_transfer')
      setPaymentReference('')
    },
    onError: (error: any) => {
      toast.error(error?.message ?? 'Failed to record payment')
    },
  })

  const openPaymentDialog = (invoice: any) => {
    const balanceCents = Number(invoice.balance_cents ?? invoice.total_cents ?? 0)
    if (balanceCents <= 0) {
      toast.error('Invoice has no outstanding balance.')
      return
    }

    setPaymentInvoice(invoice)
    setPaymentAmount((balanceCents / 100).toFixed(2))
    setPaymentMethod('bank_transfer')
    setPaymentReference(`manual-${invoice.invoice_number}`)
    setPaymentDialogOpen(true)
  }

  const submitPayment = () => {
    if (!paymentInvoice) return

    const balanceCents = Math.max(0, Number(paymentInvoice.balance_cents ?? paymentInvoice.total_cents ?? 0))
    const validation = validatePaymentAmountInput(paymentAmount, balanceCents)
    if (validation.error || validation.amountCents == null) {
      toast.error(validation.error ?? 'Enter a valid payment amount.')
      return
    }

    recordPaymentMutation.mutate({
      invoice: paymentInvoice,
      amountCents: validation.amountCents,
      method: paymentMethod,
      reference: paymentReference.trim(),
    })
  }

  const paymentBalanceCents = Math.max(0, Number(paymentInvoice?.balance_cents ?? paymentInvoice?.total_cents ?? 0))
  const quickPaymentAmounts = useMemo(
    () => getSuggestedPaymentAmountsCents(paymentBalanceCents),
    [paymentBalanceCents]
  )
  const paymentValidation = useMemo(
    () => validatePaymentAmountInput(paymentAmount, paymentBalanceCents),
    [paymentAmount, paymentBalanceCents]
  )
  const remainingBalancePreviewCents = useMemo(
    () => getRemainingBalancePreviewCents(paymentAmount, paymentBalanceCents),
    [paymentAmount, paymentBalanceCents]
  )

  if (isClientBillingUser && !policyLoading && !financeEnabled) {
    return (
      <AppLayout title="Invoicing" description="Billing visibility is disabled for your organisation" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Finance Access Disabled</CardTitle>
            <CardDescription>
              Your organisation currently has client finance visibility disabled. Contact your service provider admin to enable invoice access.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Invoicing" description="Draft invoice generation and status management">
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
                {isClientBillingUser
                  ? 'Invoice history and payment status for your organisation'
                  : 'Contracts, draft invoice generation, and invoice status management'}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs self-start sm:self-auto">
            {isClientBillingUser ? 'Client billing view' : 'Billing operations enabled'}
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
            <Card key={label} className="bg-white dark:bg-[#1A1A1A] shadow-sm">
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
          {!isClientBillingUser && (
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
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="partially_paid">Partially Paid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="voided">Voided</SelectItem>
            </SelectContent>
          </Select>
          <Select value={paymentStateFilter} onValueChange={setPaymentStateFilter}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="All payment states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payment states</SelectItem>
              <SelectItem value="outstanding">Outstanding</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
          <Select value={invoiceSort} onValueChange={setInvoiceSort}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Sort invoices" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date_desc">Newest first</SelectItem>
              <SelectItem value="date_asc">Oldest first</SelectItem>
              <SelectItem value="balance_desc">Highest balance</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="h-9 px-2 flex items-center gap-1 text-xs">
            <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            {sortedInvoices.length} results
          </Badge>
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
            {financeEnabled && (
              <TabsTrigger value="costing" className="gap-1.5 text-xs">
                <DollarSign className="h-3.5 w-3.5" />
                Costing
              </TabsTrigger>
            )}
            {!isClientBillingUser && (
              <TabsTrigger value="contracts" className="gap-1.5 text-xs">
                <FileText className="h-3.5 w-3.5" />
                Contracts
                {contracts.length > 0 && (
                  <span className="ml-1 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 text-[10px] font-semibold px-1.5 py-0.5">
                    {contracts.length}
                  </span>
                )}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Invoices tab */}
          <TabsContent value="invoices" className="mt-4">
            <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-amber-600" />
                      Invoice History
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {isClientBillingUser
                        ? 'Click a row to expand line items and review balances for your organisation.'
                        : 'Click a row to expand line items. Draft invoices can be sent or cancelled.'}
                    </CardDescription>
                  </div>
                  {!isClientBillingUser && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={overdueCandidateIds.length === 0 || markAllOverdueMutation.isPending}
                      onClick={() => markAllOverdueMutation.mutate(overdueCandidateIds)}
                    >
                      <AlertCircle className="h-3.5 w-3.5 mr-1" />
                      Mark Due Invoices Overdue
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {invoicesLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading invoices…</div>
                ) : sortedInvoices.length === 0 ? (
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
                          <TableHead className="text-xs">Paid</TableHead>
                          <TableHead className="text-xs">Balance</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="w-8" />
                          <TableHead className="text-xs text-right">Actions</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedInvoices.map((inv: any) => (
                          <InvoiceRow
                            key={inv.id}
                            invoice={inv}
                            onUpdateStatus={(invoice, status) => updateInvoiceStatusMutation.mutate({ invoiceId: invoice.id, status })}
                            onRecordPayment={openPaymentDialog}
                            onMarkOverdue={(invoice) => markOverdueMutation.mutate(invoice)}
                            readOnly={isClientBillingUser}
                            isUpdating={
                              updateInvoiceStatusMutation.isPending ||
                              recordPaymentMutation.isPending ||
                              markOverdueMutation.isPending
                            }
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Costing tab */}
          <TabsContent value="costing" className="mt-4">
            {financeEnabled ? (
              <CostIntelligencePanel
                isClientBillingUser={isClientBillingUser}
                financeEnabled={financeEnabled}
              />
            ) : (
              <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-blue-600" />
                    Costing
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Cost intelligence is not available for your current access or organization settings.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </TabsContent>

          {/* Contracts tab */}
          {!isClientBillingUser && <TabsContent value="contracts" className="mt-4">
            <Card className="bg-white dark:bg-[#1A1A1A] shadow-sm">
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
                        <div key={contract.id} className="border rounded-xl p-4 bg-gray-50/50 dark:bg-[#1E1E1E]/30 dark:border-[#9E9E9E]/20">
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
                              <Button
                                size="sm"
                                className="mt-2 h-8 text-xs"
                                disabled={createInvoiceMutation.isPending || contract.status !== 'active'}
                                onClick={() => createInvoiceMutation.mutate(contract)}
                              >
                                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                                Generate Draft
                              </Button>
                            </div>
                          </div>

                          {/* Contract line items */}
                          {lines.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-[#9E9E9E]/20">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                                Services & Rates
                              </p>
                              <div className="grid gap-1.5 sm:grid-cols-2">
                                {lines.filter((l: any) => l.is_active !== false).map((line: any) => (
                                  <div key={line.id} className="flex items-center justify-between rounded-lg bg-white dark:bg-[#2A2A2A]/40 px-3 py-2 text-xs">
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
          </TabsContent>}
        </Tabs>

        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Manual Payment</DialogTitle>
              <DialogDescription>
                {paymentInvoice
                  ? `Invoice ${paymentInvoice.invoice_number} • Balance ${formatCents(paymentInvoice.balance_cents ?? paymentInvoice.total_cents)}`
                  : 'Record a completed payment against this invoice.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Amount (NZD)</p>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
                {paymentAmount.trim().length > 0 && paymentValidation.error && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{paymentValidation.error}</p>
                )}
                {quickPaymentAmounts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickPaymentAmounts.map((amountCents) => (
                      <Button
                        key={amountCents}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        disabled={recordPaymentMutation.isPending}
                        onClick={() => setPaymentAmount((amountCents / 100).toFixed(2))}
                      >
                        {formatCents(amountCents)}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Outstanding</p>
                    <p className="text-xs font-semibold">{formatCents(paymentBalanceCents)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Remaining After Payment</p>
                    <p className="text-xs font-semibold">{formatCents(remainingBalancePreviewCents)}</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="direct_debit">Direct Debit</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Reference</p>
                <Input
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="Bank or provider reference"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPaymentDialogOpen(false)}
                disabled={recordPaymentMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={submitPayment}
                disabled={
                  recordPaymentMutation.isPending ||
                  !paymentInvoice ||
                  paymentValidation.amountCents == null
                }
              >
                Record Payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </AppLayout>
  )
}
