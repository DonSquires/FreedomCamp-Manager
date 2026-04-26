import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ModuleRoute } from './ModuleRoute'

const useEnabledModulesMock = vi.fn()

vi.mock('@/hooks/useEnabledModules', () => ({
  useEnabledModules: () => useEnabledModulesMock(),
}))

describe('ModuleRoute', () => {
  it('shows a loading state for non-core modules while entitlements are loading', () => {
    useEnabledModulesMock.mockReturnValue({
      modules: [],
      enabledModuleIds: ['core'],
      isModuleEnabled: () => false,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <ModuleRoute moduleId="parking">
          <div>Parking Content</div>
        </ModuleRoute>
      </MemoryRouter>
    )

    expect(screen.getByText('Checking module access...')).toBeInTheDocument()
    expect(screen.queryByText('Parking Content')).not.toBeInTheDocument()
  })
})