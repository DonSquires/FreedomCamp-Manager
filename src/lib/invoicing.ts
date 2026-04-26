export interface ContractLineForInvoice {
  id: string
  description: string
  unit_price_cents: number | null
  quantity?: number | null
  is_active?: boolean | null
}

export interface InvoiceDraftLine {
  contract_line_id: string
  description: string
  quantity: number
  unit_price_cents: number
  discount_percent: number
  tax_rate: number
  line_subtotal_cents: number
  line_tax_cents: number
  line_total_cents: number
  sort_order: number
}

export interface InvoiceDraftTotals {
  lines: InvoiceDraftLine[]
  subtotal_cents: number
  tax_cents: number
  total_cents: number
}

export interface InvoiceLike {
  status?: string | null
  due_date?: string | null
  total_cents?: number | null
  balance_cents?: number | null
}

const DEFAULT_TAX_RATE = 0.15

export function buildInvoiceDraftFromContractLines(lines: ContractLineForInvoice[]): InvoiceDraftTotals {
  const activeLines = lines.filter((line) => line.is_active !== false && (line.unit_price_cents ?? 0) > 0)

  const draftLines = activeLines.map((line, index) => {
    const quantity = Number(line.quantity ?? 1) || 1
    const unitPrice = Number(line.unit_price_cents ?? 0)
    const lineSubtotal = unitPrice * quantity
    const lineTax = Math.round(lineSubtotal * DEFAULT_TAX_RATE)

    return {
      contract_line_id: line.id,
      description: line.description,
      quantity,
      unit_price_cents: unitPrice,
      discount_percent: 0,
      tax_rate: DEFAULT_TAX_RATE,
      line_subtotal_cents: lineSubtotal,
      line_tax_cents: lineTax,
      line_total_cents: lineSubtotal + lineTax,
      sort_order: index,
    }
  })

  return {
    lines: draftLines,
    subtotal_cents: draftLines.reduce((sum, line) => sum + line.line_subtotal_cents, 0),
    tax_cents: draftLines.reduce((sum, line) => sum + line.line_tax_cents, 0),
    total_cents: draftLines.reduce((sum, line) => sum + line.line_total_cents, 0),
  }
}

export function getInvoiceDueDate(invoiceDate = new Date(), dueDays = 14): string {
  const result = new Date(invoiceDate)
  result.setDate(result.getDate() + dueDays)
  return result.toISOString().slice(0, 10)
}

export function getOutstandingInvoiceCents(invoice: InvoiceLike): number {
  const balance = Number(invoice.balance_cents ?? NaN)
  if (Number.isFinite(balance)) return Math.max(0, balance)
  return Math.max(0, Number(invoice.total_cents ?? 0))
}

export function isInvoicePastDue(invoice: InvoiceLike, now = new Date()): boolean {
  const due = String(invoice.due_date || '').trim()
  if (!due) return false

  const status = String(invoice.status || '').toLowerCase()
  if (['paid', 'cancelled', 'voided', 'draft'].includes(status)) return false
  if (getOutstandingInvoiceCents(invoice) <= 0) return false

  const dueAt = new Date(`${due}T23:59:59.999Z`)
  if (Number.isNaN(dueAt.getTime())) return false
  return dueAt.getTime() < now.getTime()
}

export function getOverdueCandidateIds<T extends InvoiceLike & { id?: string | null }>(
  invoices: T[],
  now = new Date()
): string[] {
  return invoices
    .filter((invoice) => Boolean(invoice.id) && String(invoice.status || '').toLowerCase() !== 'overdue' && isInvoicePastDue(invoice, now))
    .map((invoice) => String(invoice.id))
}

export function getSuggestedPaymentAmountsCents(balanceCents: number): number[] {
  const normalizedBalance = Math.max(0, Math.round(Number(balanceCents) || 0))
  if (normalizedBalance <= 0) return []

  const candidates = [
    Math.round(normalizedBalance * 0.25),
    Math.round(normalizedBalance * 0.5),
    normalizedBalance,
  ]

  const deduped: number[] = []
  for (const amount of candidates) {
    const safeAmount = Math.min(normalizedBalance, Math.max(1, amount))
    if (!deduped.includes(safeAmount)) deduped.push(safeAmount)
  }

  return deduped
}

export interface PaymentAmountValidationResult {
  amountCents: number | null
  error: string | null
}

export function validatePaymentAmountInput(
  amountInput: string,
  outstandingBalanceCents: number
): PaymentAmountValidationResult {
  const amountNumber = Number(amountInput)
  if (!Number.isFinite(amountNumber)) {
    return { amountCents: null, error: 'Enter a valid payment amount.' }
  }

  const amountCents = Math.round(amountNumber * 100)
  const safeOutstanding = Math.max(0, Math.round(Number(outstandingBalanceCents) || 0))

  if (amountCents <= 0) {
    return { amountCents: null, error: 'Payment amount must be greater than zero.' }
  }

  if (amountCents > safeOutstanding) {
    return { amountCents: null, error: 'Payment amount cannot exceed the outstanding balance.' }
  }

  return { amountCents, error: null }
}

export function getRemainingBalancePreviewCents(
  amountInput: string,
  outstandingBalanceCents: number
): number {
  const safeOutstanding = Math.max(0, Math.round(Number(outstandingBalanceCents) || 0))
  const validation = validatePaymentAmountInput(amountInput, safeOutstanding)

  if (validation.amountCents == null) {
    return safeOutstanding
  }

  return Math.max(0, safeOutstanding - validation.amountCents)
}