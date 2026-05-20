import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoicingPage from './InvoicingPage'
import { CostIntelligencePanel } from '@/components/features/CostIntelligencePanel'

const authState = {
  user: {
    id: 'user-1',
    role: 'admin' as const,
    organization_id: 'org-1',
  },
}

const clientsFixture = [
  { id: 'client-1', name: 'Nelson City Council' },
]

const invoicesFixture = [
  {
    id: 'inv-1',
    invoice_number: 'INV-1001',
    client_organization_id: 'client-1',
    invoice_date: '2026-04-10',
    due_date: '2020-04-20',
    total_cents: 10000,
    subtotal_cents: 8696,
    tax_cents: 1304,
    amount_paid_cents: 0,
    balance_cents: 10000,
    status: 'sent',
    billing_period_start: null,
    billing_period_end: null,
    currency: 'NZD',
    reference: 'Ops-Apr',
    client: { id: 'client-1', name: 'Nelson City Council' },
    provider: { name: 'First Security' },
    lines: [],
  },
]

const contractsFixture: any[] = []
const shiftsFixture = [
  {
    id: 'shift-1',
    organization_id: 'client-1',
    officer_id: 'user-1',
    shift_date: '2026-04-10',
    start_time: '08:00:00',
    end_time: '12:00:00',
    break_minutes: 30,
    status: 'completed',
    guard_cost_rate: 35,
    client_charge_rate: 55,
  },
]
const usersFixture = [
  {
    id: 'user-1',
    organization_id: 'client-1',
    role: 'officer',
    is_active: true,
    first_name: 'Alex',
    last_name: 'Taylor',
    email: 'alex@example.com',
  },
]
const insertedPayments: any[] = []
const updatedInvoices: any[] = []
const existingPaymentsFixture: any[] = []
const toastSuccess = vi.fn()
const toastError = vi.fn()
const mockFailures = {
  crmInvoiceEqError: null as string | null,
  crmInvoiceInError: null as string | null,
  crmPaymentsInsertError: null as string | null,
}

const fromMock = vi.fn((table: string) => {
  if (table === 'organizations') {
    return {
      select: () => {
        const builder: any = {
          eq: () => builder,
          order: async () => ({ data: clientsFixture, error: null }),
        }
        return builder
      },
    }
  }

  if (table === 'crm_invoices') {
    return {
      select: () => {
        const builder: any = {
          order: () => builder,
          eq: () => builder,
          gte: () => builder,
          limit: async () => ({ data: invoicesFixture, error: null }),
        }
        return builder
      },
      update: (payload: any) => {
        const updateBuilder: any = {
          eq: async (idColumn: string, id: string) => {
            if (mockFailures.crmInvoiceEqError) {
              return { error: { message: mockFailures.crmInvoiceEqError } }
            }
            updatedInvoices.push({ payload, filter: 'eq', idColumn, id })
            return { error: null }
          },
          in: async (idColumn: string, ids: string[]) => {
            if (mockFailures.crmInvoiceInError) {
              return { error: { message: mockFailures.crmInvoiceInError } }
            }
            updatedInvoices.push({ payload, filter: 'in', idColumn, ids })
            return { error: null }
          },
        }
        return updateBuilder
      },
    }
  }

  if (table === 'crm_contracts') {
    return {
      select: () => {
        const builder: any = {
          order: () => builder,
          eq: () => builder,
          limit: async () => ({ data: contractsFixture, error: null }),
        }
        return builder
      },
    }
  }

  if (table === 'roster_shifts') {
    return {
      select: () => {
        const builder: any = {
          eq: () => builder,
          gte: () => builder,
          limit: async () => ({ data: shiftsFixture, error: null }),
        }
        return builder
      },
    }
  }

  if (table === 'user_profiles') {
    return {
      select: () => {
        const builder: any = {
          eq: () => builder,
          limit: async () => ({ data: usersFixture, error: null }),
        }
        return builder
      },
    }
  }

  if (table === 'crm_payments') {
    const selectBuilder: any = {
      eq: async (_column: string, invoiceId: string) => {
        const allPayments = [...existingPaymentsFixture, ...insertedPayments]
        const filtered = allPayments.filter((payment) => payment.invoice_id === invoiceId)
        return { data: filtered, error: null }
      },
    }

    return {
      select: () => selectBuilder,
      insert: async (payload: any) => {
        if (mockFailures.crmPaymentsInsertError) {
          return { error: { message: mockFailures.crmPaymentsInsertError } }
        }
        insertedPayments.push(payload)
        return { error: null }
      },
    }
  }

  return {
    select: () => ({
      order: async () => ({ data: [], error: null }),
      eq: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }),
  }
})

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}))

vi.mock('@/components/features/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useClientAccessPolicy', () => ({
  useClientAccessPolicy: () => ({
    isClientRole: false,
    isLoading: false,
    financeEnabled: true,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: (...args: any[]) => toastError(...args),
  },
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InvoicingPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderCostingPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CostIntelligencePanel
          isClientBillingUser={false}
          financeEnabled
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('InvoicingPage payment dialog', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: vi.fn(),
        writable: true,
      })
    }

    insertedPayments.length = 0
    updatedInvoices.length = 0
    existingPaymentsFixture.length = 0
    toastSuccess.mockClear()
    toastError.mockClear()
    mockFailures.crmInvoiceEqError = null
    mockFailures.crmInvoiceInError = null
    mockFailures.crmPaymentsInsertError = null
    window.localStorage.clear()
    fromMock.mockClear()
  })

  it('shows validation feedback and remaining-balance preview while editing payment amount', async () => {
    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    expect(await screen.findByText('Record Manual Payment')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')

    const amountInput = screen.getByRole('spinbutton')
    const submitButton = within(dialog).getByRole('button', { name: /record payment/i })

    fireEvent.change(amountInput, { target: { value: '150.00' } })

    expect(await screen.findByText('Payment amount cannot exceed the outstanding balance.')).toBeInTheDocument()
    expect(submitButton).toBeDisabled()

    const previewCard = screen.getByText('Remaining After Payment').closest('div')
    expect(previewCard).not.toBeNull()
    expect(within(previewCard as HTMLElement).getByText(/100\.00/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /50\.00/ }))

    await waitFor(() => {
      expect(screen.queryByText('Payment amount cannot exceed the outstanding balance.')).not.toBeInTheDocument()
      expect(submitButton).toBeEnabled()
    })

    expect(within(previewCard as HTMLElement).getByText(/50\.00/)).toBeInTheDocument()
  })

  it('submits quick-payment amount with expected payload fields', async () => {
    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /25\.00/ }))

    const referenceInput = within(dialog).getByPlaceholderText('Bank or provider reference')
    fireEvent.change(referenceInput, { target: { value: 'bank-ref-42' } })

    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(insertedPayments).toHaveLength(1)
    })

    expect(insertedPayments[0]).toMatchObject({
      invoice_id: 'inv-1',
      organization_id: 'client-1',
      amount_cents: 2500,
      payment_method: 'bank_transfer',
      payment_reference: 'bank-ref-42',
      status: 'completed',
      processed_by: 'user-1',
    })

    expect(updatedInvoices).toHaveLength(1)
    expect(updatedInvoices[0]).toMatchObject({
      idColumn: 'id',
      id: 'inv-1',
      payload: {
        amount_paid_cents: 2500,
        balance_cents: 7500,
        status: 'partially_paid',
        updated_by: 'user-1',
      },
    })
    expect(toastSuccess).toHaveBeenCalledWith('Payment recorded for INV-1001')
  })

  it('reconciles invoice amount paid from persisted payment history', async () => {
    existingPaymentsFixture.push({
      invoice_id: 'inv-1',
      amount_cents: 2000,
      status: 'completed',
    })
    existingPaymentsFixture.push({
      invoice_id: 'inv-1',
      amount_cents: 900,
      status: 'failed',
    })

    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /25\.00/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(updatedInvoices).toHaveLength(1)
    })

    expect(updatedInvoices[0]).toMatchObject({
      payload: {
        amount_paid_cents: 4500,
        balance_cents: 5500,
        status: 'partially_paid',
      },
    })
  })

  it('uses full-balance quick action to preview zero remaining and submit full amount', async () => {
    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /100\.00/ }))

    const previewCard = screen.getByText('Remaining After Payment').closest('div')
    expect(previewCard).not.toBeNull()
    expect(within(previewCard as HTMLElement).getByText(/0\.00/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(insertedPayments).toHaveLength(1)
    })

    expect(insertedPayments[0]).toMatchObject({
      amount_cents: 10000,
      payment_reference: 'manual-INV-1001',
      payment_method: 'bank_transfer',
    })

    expect(updatedInvoices).toHaveLength(1)
    expect(updatedInvoices[0]).toMatchObject({
      payload: {
        amount_paid_cents: 10000,
        balance_cents: 0,
        status: 'paid',
      },
    })
  })

  it('submits selected payment method and falls back reference when blank', async () => {
    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Credit Card' }))

    const referenceInput = within(dialog).getByPlaceholderText('Bank or provider reference')
    fireEvent.change(referenceInput, { target: { value: '   ' } })

    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(insertedPayments).toHaveLength(1)
    })

    expect(insertedPayments[0]).toMatchObject({
      amount_cents: 10000,
      payment_method: 'credit_card',
      payment_reference: 'manual-INV-1001',
    })

    expect(updatedInvoices).toHaveLength(1)
    expect(updatedInvoices[0]).toMatchObject({
      payload: {
        amount_paid_cents: 10000,
        balance_cents: 0,
        status: 'paid',
      },
    })
  })

  it('marks due invoices overdue in batch with expected ID filter payload', async () => {
    renderPage()

    const markDueButton = await screen.findByRole('button', { name: /mark due invoices overdue/i })
    await waitFor(() => {
      expect(markDueButton).toBeEnabled()
    })

    fireEvent.click(markDueButton)

    await waitFor(() => {
      expect(updatedInvoices).toHaveLength(1)
    })

    expect(updatedInvoices[0]).toMatchObject({
      filter: 'in',
      idColumn: 'id',
      ids: ['inv-1'],
      payload: {
        status: 'overdue',
        updated_by: 'user-1',
      },
    })
    expect(toastSuccess).toHaveBeenCalledWith('Marked 1 invoice overdue')
  })

  it('marks a single invoice overdue from row action with expected eq payload', async () => {
    renderPage()

    const markOverdueButtons = await screen.findAllByRole('button', { name: /mark overdue/i })
    expect(markOverdueButtons.length).toBeGreaterThan(0)

    fireEvent.click(markOverdueButtons[0])

    await waitFor(() => {
      expect(updatedInvoices).toHaveLength(1)
    })

    expect(updatedInvoices[0]).toMatchObject({
      filter: 'eq',
      idColumn: 'id',
      id: 'inv-1',
      payload: {
        status: 'overdue',
        updated_by: 'user-1',
      },
    })
    expect(toastSuccess).toHaveBeenCalledWith('Invoice INV-1001 marked overdue')
  })

  it('keeps batch overdue action disabled when there are no due candidates', async () => {
    const originalDueDate = invoicesFixture[0].due_date
    invoicesFixture[0].due_date = '2099-12-31'

    renderPage()

    const markDueButton = await screen.findByRole('button', { name: /mark due invoices overdue/i })
    await waitFor(() => {
      expect(markDueButton).toBeDisabled()
    })

    fireEvent.click(markDueButton)
    expect(updatedInvoices).toHaveLength(0)

    invoicesFixture[0].due_date = originalDueDate
  })

  it('sends a draft invoice from row action with expected status payload', async () => {
    const originalStatus = invoicesFixture[0].status
    invoicesFixture[0].status = 'draft'

    renderPage()

    const sendButton = await screen.findByRole('button', { name: /^send$/i })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(updatedInvoices).toHaveLength(1)
    })

    expect(updatedInvoices[0]).toMatchObject({
      filter: 'eq',
      idColumn: 'id',
      id: 'inv-1',
      payload: {
        status: 'sent',
        updated_by: 'user-1',
      },
    })
    expect(typeof updatedInvoices[0].payload.updated_at).toBe('string')
    expect(typeof updatedInvoices[0].payload.sent_at).toBe('string')
    expect(toastSuccess).toHaveBeenCalledWith('Invoice sent')

    invoicesFixture[0].status = originalStatus
  })

  it('cancels a draft invoice from row action with expected status payload', async () => {
    const originalStatus = invoicesFixture[0].status
    invoicesFixture[0].status = 'draft'

    renderPage()

    const cancelButton = await screen.findByRole('button', { name: /^cancel$/i })
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(updatedInvoices).toHaveLength(1)
    })

    expect(updatedInvoices[0]).toMatchObject({
      filter: 'eq',
      idColumn: 'id',
      id: 'inv-1',
      payload: {
        status: 'cancelled',
        updated_by: 'user-1',
      },
    })
    expect(typeof updatedInvoices[0].payload.updated_at).toBe('string')
    expect(updatedInvoices[0].payload.sent_at).toBeUndefined()
    expect(toastSuccess).toHaveBeenCalledWith('Invoice cancelled')

    invoicesFixture[0].status = originalStatus
  })

  it('shows error toast and skips invoice update when payment insert fails', async () => {
    mockFailures.crmPaymentsInsertError = 'payment insert failed'

    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('payment insert failed')
    })

    expect(insertedPayments).toHaveLength(0)
    expect(updatedInvoices).toHaveLength(0)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows error toast when sending draft invoice fails', async () => {
    const originalStatus = invoicesFixture[0].status
    invoicesFixture[0].status = 'draft'
    mockFailures.crmInvoiceEqError = 'status update failed'

    renderPage()

    const sendButton = await screen.findByRole('button', { name: /^send$/i })
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('status update failed')
    })

    expect(updatedInvoices).toHaveLength(0)
    expect(toastSuccess).not.toHaveBeenCalled()

    invoicesFixture[0].status = originalStatus
  })

  it('shows error toast when batch overdue update fails', async () => {
    mockFailures.crmInvoiceInError = 'batch overdue failed'

    renderPage()

    const markDueButton = await screen.findByRole('button', { name: /mark due invoices overdue/i })
    await waitFor(() => {
      expect(markDueButton).toBeEnabled()
    })

    fireEvent.click(markDueButton)

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('batch overdue failed')
    })

    expect(updatedInvoices).toHaveLength(0)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows error toast when payment succeeds but invoice balance update fails', async () => {
    mockFailures.crmInvoiceEqError = 'invoice accounting update failed'

    renderPage()

    const recordPaymentButton = await screen.findByRole('button', { name: /record payment/i })
    fireEvent.click(recordPaymentButton)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /record payment/i }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('invoice accounting update failed')
    })

    expect(insertedPayments).toHaveLength(1)
    expect(updatedInvoices).toHaveLength(0)
    expect(screen.getByText('Record Manual Payment')).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows error toast when single-row overdue action fails', async () => {
    mockFailures.crmInvoiceEqError = 'single overdue failed'

    renderPage()

    const markOverdueButtons = await screen.findAllByRole('button', { name: /mark overdue/i })
    fireEvent.click(markOverdueButtons[0])

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('single overdue failed')
    })

    expect(updatedInvoices).toHaveLength(0)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the costing tab in invoicing navigation', async () => {
    renderPage()

    expect(await screen.findByRole('tab', { name: /costing/i })).toBeInTheDocument()
  })

  it('renders cost intelligence metrics for the selected client organization', async () => {
    renderCostingPanel()

    expect(await screen.findByText('Cost Intelligence')).toBeInTheDocument()
    expect(screen.getByText(/Monthly provider run-rate:/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Nelson City Council' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /open service pricing/i })).toBeInTheDocument()
  })
})
