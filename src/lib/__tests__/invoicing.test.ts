import { describe, expect, it } from 'vitest'
import {
  buildInvoiceDraftFromContractLines,
  deriveInvoicePaymentUpdate,
  deriveInvoicePaymentUpdateFromPaidTotal,
  getEffectiveCompletedPaymentCents,
  getRemainingBalancePreviewCents,
  getInvoiceDueDate,
  getOverdueCandidateIds,
  getOutstandingInvoiceCents,
  getSuggestedPaymentAmountsCents,
  isInvoicePastDue,
  validatePaymentAmountInput,
} from '../invoicing'

describe('buildInvoiceDraftFromContractLines', () => {
  it('builds invoice totals from active contract lines', () => {
    const result = buildInvoiceDraftFromContractLines([
      { id: 'line-1', description: 'Patrol service', unit_price_cents: 10000, quantity: 2, is_active: true },
      { id: 'line-2', description: 'Inactive line', unit_price_cents: 5000, quantity: 1, is_active: false },
      { id: 'line-3', description: 'Support retainer', unit_price_cents: 2500, quantity: 1, is_active: true },
    ])

    expect(result.lines).toHaveLength(2)
    expect(result.subtotal_cents).toBe(22500)
    expect(result.tax_cents).toBe(3375)
    expect(result.total_cents).toBe(25875)
  })
})

describe('getInvoiceDueDate', () => {
  it('returns a YYYY-MM-DD date offset by 14 days by default', () => {
    expect(getInvoiceDueDate(new Date('2026-04-01T10:00:00Z'))).toBe('2026-04-15')
  })
})

describe('getOutstandingInvoiceCents', () => {
  it('prefers balance_cents when present', () => {
    expect(getOutstandingInvoiceCents({ total_cents: 10000, balance_cents: 2500 })).toBe(2500)
  })

  it('falls back to total_cents when balance is unavailable', () => {
    expect(getOutstandingInvoiceCents({ total_cents: 10000 })).toBe(10000)
  })
})

describe('isInvoicePastDue', () => {
  it('returns true for unpaid invoices past due date', () => {
    const result = isInvoicePastDue(
      { status: 'sent', due_date: '2026-04-01', balance_cents: 5000 },
      new Date('2026-04-10T00:00:00Z')
    )
    expect(result).toBe(true)
  })

  it('returns false for paid invoices', () => {
    const result = isInvoicePastDue(
      { status: 'paid', due_date: '2026-04-01', balance_cents: 0 },
      new Date('2026-04-10T00:00:00Z')
    )
    expect(result).toBe(false)
  })
})

describe('getOverdueCandidateIds', () => {
  it('returns ids for invoices that are past due and not already overdue', () => {
    const ids = getOverdueCandidateIds(
      [
        { id: 'a', status: 'sent', due_date: '2026-04-01', balance_cents: 2000 },
        { id: 'b', status: 'overdue', due_date: '2026-04-01', balance_cents: 2000 },
        { id: 'c', status: 'paid', due_date: '2026-04-01', balance_cents: 0 },
        { id: 'd', status: 'sent', due_date: '2026-05-30', balance_cents: 2000 },
      ],
      new Date('2026-04-10T00:00:00Z')
    )

    expect(ids).toEqual(['a'])
  })
})

describe('getSuggestedPaymentAmountsCents', () => {
  it('returns 25%, 50%, and full balance for normal balances', () => {
    expect(getSuggestedPaymentAmountsCents(10000)).toEqual([2500, 5000, 10000])
  })

  it('deduplicates tiny-balance suggestions', () => {
    expect(getSuggestedPaymentAmountsCents(1)).toEqual([1])
  })

  it('returns empty list for non-positive balances', () => {
    expect(getSuggestedPaymentAmountsCents(0)).toEqual([])
    expect(getSuggestedPaymentAmountsCents(-100)).toEqual([])
  })
})

describe('validatePaymentAmountInput', () => {
  it('rejects invalid input', () => {
    expect(validatePaymentAmountInput('abc', 5000)).toEqual({
      amountCents: null,
      error: 'Enter a valid payment amount.',
    })
  })

  it('rejects zero and negative amounts', () => {
    expect(validatePaymentAmountInput('0', 5000)).toEqual({
      amountCents: null,
      error: 'Payment amount must be greater than zero.',
    })
    expect(validatePaymentAmountInput('-1', 5000)).toEqual({
      amountCents: null,
      error: 'Payment amount must be greater than zero.',
    })
  })

  it('rejects amounts above outstanding balance', () => {
    expect(validatePaymentAmountInput('50.01', 5000)).toEqual({
      amountCents: null,
      error: 'Payment amount cannot exceed the outstanding balance.',
    })
  })

  it('returns rounded cents for valid amounts', () => {
    expect(validatePaymentAmountInput('12.345', 50000)).toEqual({
      amountCents: 1235,
      error: null,
    })
  })
})

describe('getRemainingBalancePreviewCents', () => {
  it('returns outstanding balance when amount input is invalid', () => {
    expect(getRemainingBalancePreviewCents('abc', 5000)).toBe(5000)
  })

  it('returns outstanding balance when amount is over balance', () => {
    expect(getRemainingBalancePreviewCents('100.00', 5000)).toBe(5000)
  })

  it('returns projected remaining balance for valid amount', () => {
    expect(getRemainingBalancePreviewCents('12.34', 5000)).toBe(3766)
  })
})

describe('deriveInvoicePaymentUpdate', () => {
  it('marks invoice partially paid when balance remains', () => {
    expect(
      deriveInvoicePaymentUpdate(
        { total_cents: 10000, amount_paid_cents: 0, balance_cents: 10000 },
        2500
      )
    ).toEqual({
      amount_paid_cents: 2500,
      balance_cents: 7500,
      status: 'partially_paid',
    })
  })

  it('marks invoice paid when payment clears balance', () => {
    expect(
      deriveInvoicePaymentUpdate(
        { total_cents: 10000, amount_paid_cents: 2500, balance_cents: 7500 },
        7500
      )
    ).toEqual({
      amount_paid_cents: 10000,
      balance_cents: 0,
      status: 'paid',
    })
  })

  it('clamps overpayment to outstanding balance', () => {
    expect(
      deriveInvoicePaymentUpdate(
        { total_cents: 10000, amount_paid_cents: 9000, balance_cents: 1000 },
        5000
      )
    ).toEqual({
      amount_paid_cents: 10000,
      balance_cents: 0,
      status: 'paid',
    })
  })

  it('derives prior paid from total minus outstanding when amount_paid is missing', () => {
    expect(
      deriveInvoicePaymentUpdate(
        { total_cents: 10000, balance_cents: 2500 },
        1000
      )
    ).toEqual({
      amount_paid_cents: 8500,
      balance_cents: 1500,
      status: 'partially_paid',
    })
  })
})

describe('deriveInvoicePaymentUpdateFromPaidTotal', () => {
  it('derives partially paid state from persisted paid total', () => {
    expect(
      deriveInvoicePaymentUpdateFromPaidTotal(
        { total_cents: 10000 },
        4500
      )
    ).toEqual({
      amount_paid_cents: 4500,
      balance_cents: 5500,
      status: 'partially_paid',
    })
  })

  it('clamps persisted paid total to invoice total', () => {
    expect(
      deriveInvoicePaymentUpdateFromPaidTotal(
        { total_cents: 10000 },
        25000
      )
    ).toEqual({
      amount_paid_cents: 10000,
      balance_cents: 0,
      status: 'paid',
    })
  })
})

describe('getEffectiveCompletedPaymentCents', () => {
  it('sums completed and unknown statuses while excluding failed/voided/refunded', () => {
    expect(
      getEffectiveCompletedPaymentCents([
        { amount_cents: 2000, status: 'completed' },
        { amount_cents: 500, status: 'failed' },
        { amount_cents: 700, status: 'voided' },
        { amount_cents: 300, status: 'refunded' },
        { amount_cents: 1200, status: null },
      ])
    ).toBe(3200)
  })

  it('never subtracts from malformed negative amounts', () => {
    expect(
      getEffectiveCompletedPaymentCents([
        { amount_cents: -1000, status: 'completed' },
        { amount_cents: 600, status: 'completed' },
      ])
    ).toBe(600)
  })
})