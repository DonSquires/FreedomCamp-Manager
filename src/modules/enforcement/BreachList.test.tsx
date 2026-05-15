import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BreachList from './BreachList'

const useBreachesMock = vi.fn()

vi.mock('@/hooks/useBreaches', () => ({
  useBreaches: (...args: unknown[]) => useBreachesMock(...(args as [])),
}))

type BreachRow = {
  id: string
  plate_number?: string | null
  status?: string | null
  breach_type?: string | null
  zone?: { name?: string | null } | null
}

const breachRows: BreachRow[] = [
  {
    id: 'breach-1',
    plate_number: 'ABC123',
    status: 'pending',
    breach_type: 'consecutive_nights',
    zone: { name: 'Waterfront' },
  },
  {
    id: 'breach-2',
    plate_number: 'XYZ789',
    status: 'acknowledged',
    breach_type: 'monthly_limit',
    zone: { name: 'Lakeside' },
  },
]

describe('BreachList selection behavior', () => {
  beforeEach(() => {
    useBreachesMock.mockReset()
  })

  it('auto-selects the first breach when list data is available and nothing is selected', async () => {
    const onSelectBreach = vi.fn()

    useBreachesMock.mockReturnValue({
      data: breachRows,
      isLoading: false,
    })

    render(<BreachList selectedBreachId={null} onSelectBreach={onSelectBreach} />)

    await waitFor(() => {
      expect(onSelectBreach).toHaveBeenCalledWith('breach-1')
    })
  })

  it('clears an existing selection when the filtered list is empty', async () => {
    const onSelectBreach = vi.fn()

    useBreachesMock.mockReturnValue({
      data: [],
      isLoading: false,
    })

    render(<BreachList selectedBreachId="breach-1" onSelectBreach={onSelectBreach} />)

    await waitFor(() => {
      expect(onSelectBreach).toHaveBeenCalledWith(null)
    })
  })

  it('re-selects the first visible breach when selected breach is not in filtered results', async () => {
    const onSelectBreach = vi.fn()

    useBreachesMock.mockReturnValue({
      data: [breachRows[1]],
      isLoading: false,
    })

    render(<BreachList selectedBreachId="breach-1" onSelectBreach={onSelectBreach} />)

    await waitFor(() => {
      expect(onSelectBreach).toHaveBeenCalledWith('breach-2')
    })
  })

  it('does not trigger selection updates while list data is loading', async () => {
    const onSelectBreach = vi.fn()

    useBreachesMock.mockReturnValue({
      data: breachRows,
      isLoading: true,
    })

    render(<BreachList selectedBreachId={null} onSelectBreach={onSelectBreach} />)

    await waitFor(() => {
      expect(onSelectBreach).not.toHaveBeenCalled()
    })
  })
})
