import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoicingPage from './InvoicingPage'

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
const insertedPayments: any[] = []
const updatedInvoices: any[] = []

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
          limit: async () => ({ data: invoicesFixture, error: null }),
        }
        return builder
      },
      update: (payload: any) => {
        const updateBuilder: any = {
          eq: async (idColumn: string, id: string) => {
            updatedInvoices.push({ payload, filter: 'eq', idColumn, id })
            return { error: null }
          },
          in: async (idColumn: string, ids: string[]) => {
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

  if (table === 'crm_payments') {
    return {
      insert: async (payload: any) => {
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
})