import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSiteRiskAssessments } from './useSiteRiskAssessment'

const authState = {
  user: {
    id: 'user-1',
    organization_id: 'org-1',
  },
}

const fromMock = vi.fn()
const insertMock = vi.fn()
const updateMock = vi.fn()
const updateEqIdMock = vi.fn()
const updateEqOrgMock = vi.fn()
const toastSuccessMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useSiteRiskAssessments C2 org-scoped writes', () => {
  beforeEach(() => {
    fromMock.mockReset()
    insertMock.mockReset()
    updateMock.mockReset()
    updateEqIdMock.mockReset()
    updateEqOrgMock.mockReset()
    toastSuccessMock.mockReset()
    toastErrorMock.mockReset()

    insertMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'assessment-1' }, error: null }),
      }),
    })

    updateEqOrgMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'assessment-1' }, error: null }),
      }),
    })

    updateEqIdMock.mockReturnValue({ eq: updateEqOrgMock })

    updateMock.mockReturnValue({ eq: updateEqIdMock })

    fromMock.mockImplementation((table: string) => {
      if (table !== 'site_risk_assessments') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const queryChain: any = {
        eq: vi.fn(() => queryChain),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }

      return {
        select: vi.fn().mockReturnValue(queryChain),
        insert: insertMock,
        update: updateMock,
      }
    })
  })

  it('persists organization/assessor context and case linkage on create', async () => {
    const { result } = renderHook(() => useSiteRiskAssessments(), {
      wrapper: createWrapper(),
    })

    await result.current.createAssessment.mutateAsync({
      case_id: 'case-1',
      site_name: 'Camp Alpha',
      request_type: 'adhoc',
      assessment_date: '2026-05-15',
      overall_risk_level: 'medium',
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        assessed_by: 'user-1',
        case_id: 'case-1',
      }),
    )
  })

  it('applies organization_id constraint to update, submit, and review writes', async () => {
    const { result } = renderHook(() => useSiteRiskAssessments(), {
      wrapper: createWrapper(),
    })

    await result.current.updateAssessment.mutateAsync({ id: 'assessment-1', notes: 'Updated notes' })
    await result.current.submitAssessment.mutateAsync('assessment-1')
    await result.current.reviewAssessment.mutateAsync('assessment-1')

    expect(updateEqIdMock).toHaveBeenCalledWith('id', 'assessment-1')
    expect(updateEqOrgMock).toHaveBeenCalledWith('organization_id', 'org-1')
    expect(updateEqOrgMock).toHaveBeenCalledTimes(3)
  })
})
