import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BobAssistantStudio from './BobAssistantStudio'

const showDialogMock = vi.fn()
const navigateMock = vi.fn()
const aiChatMock = vi.fn()
const fromMock = vi.fn()
const storageListMock = vi.fn()
const storageDownloadMock = vi.fn()
const approvalExecuteMock = vi.fn()
let approvalError: string | null = null

const dbOperationLog: Array<{ table: string; operation: string; args: any[] }> = []
type MockSelectRule = {
  table: string
  operation: 'single' | 'maybeSingle' | 'limit'
  matches: (filters: Record<string, any>) => boolean
  result: { data: any; error: any }
}
const mockSelectRules: MockSelectRule[] = []

const storeState = vi.hoisted(() => ({
  auth: {
    user: {
      id: 'user-1',
      role: 'master' as const,
      organization_id: 'org-1',
      job_title: 'Training Manager',
      full_name: 'Test User',
    },
  },
  globalFilters: {
    organizationId: 'org-1',
  },
  assistant: {
    displayName: 'Bob',
    tone: 'friendly' as const,
    voiceGender: 'male' as const,
    accent: 'en-NZ' as const,
    speechStyle: 'default' as const,
    speechRate: 1,
    speechEnabled: false,
    autoSpeakReplies: false,
    voiceActivatedConversation: false,
    expressUserDataPermission: false,
    permittedUserIdentity: '',
    voicePatternLearningConsent: false,
    faceClarificationConsent: false,
    secureCancelVerificationEnabled: true,
    cancelVerificationMode: 'platform_biometric' as const,
    setDisplayName: vi.fn(),
    setTone: vi.fn(),
    setVoiceGender: vi.fn(),
    setAccent: vi.fn(),
    setSpeechStyle: vi.fn(),
    setSpeechRate: vi.fn(),
    setSpeechEnabled: vi.fn(),
    setAutoSpeakReplies: vi.fn(),
    setVoiceActivatedConversation: vi.fn(),
    setExpressUserDataPermission: vi.fn(),
    setPermittedUserIdentity: vi.fn(),
    setVoicePatternLearningConsent: vi.fn(),
    setFaceClarificationConsent: vi.fn(),
  },
  ptt: {
    connectionStatus: 'disconnected' as const,
    channelId: null,
    isSpeaking: false,
  },
  bobExecutionPolicy: {
    mode: 'master_balanced' as const,
    enforceSchemaCheck: true,
    enforceHardSections: true,
    showActionChecklist: true,
  },
}))

function resolveSelectResult(
  table: string,
  operation: 'single' | 'maybeSingle' | 'limit',
  filters: Record<string, any>,
  fallback: { data: any; error: any },
) {
  for (const rule of mockSelectRules) {
    if (rule.table === table && rule.operation === operation && rule.matches(filters)) {
      return rule.result
    }
  }

  if (operation === 'limit') {
    return {
      data: Array.isArray(fallback.data) ? fallback.data : (fallback.data ? [fallback.data] : []),
      error: fallback.error,
    }
  }

  return {
    data: Array.isArray(fallback.data) ? fallback.data[0] ?? null : fallback.data ?? null,
    error: fallback.error,
  }
}

function createQueryBuilder(table: string, result: { data: any; error: any }) {
  const fallbackResult = {
    data: result.data ?? null,
    error: result.error ?? null,
  }

  const builder: any = {}
  let lastMutation: 'insert' | 'upsert' | 'update' | null = null
  const filters: Record<string, any> = {}
  const proxy: any = new Proxy(builder, {
    get(_target, property) {
      if (property === 'insert' || property === 'upsert' || property === 'update') {
        return (...args: any[]) => {
          lastMutation = property as 'insert' | 'upsert' | 'update'
          dbOperationLog.push({ table, operation: String(property), args })
          return proxy
        }
      }

      if (property === 'eq' || property === 'ilike' || property === 'in') {
        return (key: string, value: any) => {
          filters[key] = value
          return proxy
        }
      }

      if (property === 'delete') {
        return (...args: any[]) => {
          dbOperationLog.push({ table, operation: 'delete', args })
          return proxy
        }
      }

      if (property === 'single' || property === 'maybeSingle') {
        return async () => {
          if (lastMutation) {
            return {
              data: { id: `${table}-record-${Math.random().toString(36).slice(2, 8)}` },
              error: null,
            }
          }
          return resolveSelectResult(table, property as 'single' | 'maybeSingle', filters, fallbackResult)
        }
      }

      if (property === 'limit') {
        return async () => resolveSelectResult(table, 'limit', filters, fallbackResult)
      }

      return () => proxy
    },
  })

  return proxy
}

function makeStoreHook<T extends object>(state: T) {
  const hook = (selector?: (value: T) => unknown) => (typeof selector === 'function' ? selector(state) : state)
  return Object.assign(hook, {
    getState: () => state,
  })
}

vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: { children: React.ReactNode }) => children,
  useNavigate: () => navigateMock,
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: makeStoreHook(storeState.auth),
}))

vi.mock('@/stores/globalFiltersStore', () => ({
  useGlobalFiltersStore: makeStoreHook(storeState.globalFilters),
}))

vi.mock('@/stores/bobAssistantStore', () => ({
  useBobAssistantStore: makeStoreHook(storeState.assistant),
}))

vi.mock('@/stores/bobExecutionPolicyStore', () => ({
  useBobExecutionPolicyStore: makeStoreHook(storeState.bobExecutionPolicy),
  getEffectiveBobExecutionPolicy: () => ({
    mode: 'master_balanced',
    role: 'master',
    title: 'Training Manager',
    enforceSchemaCheck: true,
    enforceHardSections: true,
    showActionChecklist: true,
    canRunAutomation: false,
    requiresGuardrails: true,
  }),
}))

vi.mock('@/stores/pttStore', () => ({
  usePTTStore: makeStoreHook(storeState.ptt),
}))

vi.mock('@/hooks/useBobActionApproval', () => ({
  useBobActionApproval: () => {
    const [state, setState] = useState({
      isOpen: false,
      recommendation: null as any,
      isLoading: false,
    })

    return {
      isOpen: state.isOpen,
      recommendation: state.recommendation,
      isLoading: state.isLoading,
      showDialog: (recommendation: any) => {
        showDialogMock(recommendation)
        setState({ isOpen: true, recommendation, isLoading: false })
      },
      closeDialog: vi.fn(() => setState({ isOpen: false, recommendation: null, isLoading: false })),
      approve: vi.fn(async (_recommendation: any, _notes: string, executeFn?: () => Promise<any>) => {
        setState((prev) => ({ ...prev, isLoading: true }))
        try {
          if (executeFn) {
            approvalExecuteMock()
            await executeFn()
          }
          setState({ isOpen: false, recommendation: null, isLoading: false })
        } catch (error: any) {
          approvalError = String(error?.message || error || 'unknown approval error')
          setState((prev) => ({ ...prev, isLoading: false }))
        }
      }),
      reject: vi.fn(async () => {
        setState({ isOpen: false, recommendation: null, isLoading: false })
      }),
    }
  },
}))

vi.mock('@/hooks/useBobIdentitySettings', () => ({
  useBobIdentitySettings: () => ({
    secureCancelVerificationEnabled: true,
    setSecureCancelVerificationEnabled: vi.fn(),
    cancelVerificationMode: 'platform_biometric' as const,
    setCancelVerificationMode: vi.fn(),
    cancelVerificationInProgress: false,
    orgVoiceprintEnrollmentAllowed: false,
    enrolledVoiceprint: null,
    lastVoiceprintScore: null,
    enrollCurrentVoiceprint: vi.fn(),
    clearEnrolledVoiceprint: vi.fn(),
    verifyPlatformBiometricCancel: vi.fn(),
    verifyVoiceprintCancel: vi.fn(),
  }),
}))

vi.mock('@/hooks/useBobApprovalD1', () => ({
  listPendingBobActionProposals: vi.fn(async () => []),
  approveBobActionProposalRecord: vi.fn(async () => ({})),
  rejectBobActionProposalRecord: vi.fn(async () => ({})),
  markBobActionProposalExecutionRecord: vi.fn(async () => ({})),
  createBobActionProposalRecord: vi.fn(async () => ({ id: 'proposal-1', approval_due_at: null })),
  mapRiskLevelToImpactLevel: (risk: string) => risk,
}))

vi.mock('@/lib/bob-brain', () => ({
  buildBobUserMemoryNote: vi.fn(() => ''),
  executeAdministrativeActuation: vi.fn(async () => null),
  extractBobVoiceStateFromAssistant: vi.fn(() => null),
  loadBobUserMemory: vi.fn(async () => []),
  publishBobVoiceState: vi.fn(),
}))

vi.mock('@/lib/edgeFunctions', () => ({
  edgeFunctions: new Proxy({}, {
    get(_target, property) {
      if (property === 'aiChat') return aiChatMock
      return vi.fn(async () => ({ data: null, error: null }))
    },
  }),
}))

vi.mock('@/lib/geocoding', () => ({
  forwardGeocode: vi.fn(async (name: string, organizationName?: string) => ({
    latitude: -41.516,
    longitude: 173.956,
    formatted_address: `${name}${organizationName ? `, ${organizationName}` : ''}`,
    city: 'Nelson',
  })),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (_bucket: string) => ({
        list: storageListMock,
        download: storageDownloadMock,
      }),
    },
    channel: () => ({
      on: () => ({
        subscribe: vi.fn(),
      }),
      subscribe: vi.fn(),
    }),
    removeChannel: vi.fn(),
    from: (table: string) => {
      fromMock(table)
      return createQueryBuilder(table, { data: table === 'organizations' ? [] : [], error: null })
    },
  },
}))

vi.mock('@/lib/bobCollaboration', () => ({
  consumeLatestBobCollaborationPacket: vi.fn(() => null),
  publishBobResponse: vi.fn(),
}))

vi.mock('@/components/features/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/features/GlobalFilterRibbon', () => ({
  GlobalFilterRibbon: () => <div />,
}))

vi.mock('@/components/features/BobActionApprovalDialog', () => ({
  BobActionApprovalDialog: ({ open, recommendation, onApprove }: { open: boolean; recommendation: any; onApprove?: (recommendation: any, notes: string) => void }) => {
    if (!open || !recommendation) return null

    return (
      <div data-testid="bob-approval">
        <div>{recommendation.title}</div>
        <button type="button" onClick={() => onApprove?.(recommendation, '')}>Approve &amp; Execute</button>
      </div>
    )
  },
}))

vi.mock('@/components/features/BobOrb', () => ({
  BobOrb: () => <div />,
}))

vi.mock('@/components/features/FieldSafetyBar', () => ({
  FieldSafetyBar: () => <div />,
}))

vi.mock('@/components/features/VOILookup', () => ({
  VOILookup: () => <div />,
}))

vi.mock('@/components/features/ParkingPhotoCapture', () => ({
  ParkingPhotoCapture: () => <div />,
}))

vi.mock('@/components/features/GeofenceWarningBanner', () => ({
  GeofenceWarningBanner: () => <div />,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
        <BobAssistantStudio />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function createTextBlob(text: string) {
  return new Blob([text], { type: 'text/plain' })
}

describe('BobAssistantStudio organization setup flow', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: vi.fn(),
        writable: true,
      })
    }

    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        getVoices: () => [],
        speak: vi.fn(),
        cancel: vi.fn(),
        speaking: false,
      },
      writable: true,
    })

    aiChatMock.mockReset()
    fromMock.mockClear()
    dbOperationLog.length = 0
    mockSelectRules.length = 0
    storageListMock.mockReset()
    storageDownloadMock.mockReset()
    showDialogMock.mockClear()
    approvalExecuteMock.mockClear()
    approvalError = null
    navigateMock.mockClear()

    storageListMock.mockResolvedValue({ data: [], error: null })
    storageDownloadMock.mockResolvedValue({ data: null, error: null })

    aiChatMock.mockResolvedValue({
      data: {
        response: JSON.stringify({
          organizationName: 'Marlborough Roads Parking Operations',
          organizationType: 'client',
          organizationLevel: 3,
          parentOrganizationName: 'First Security - Blenheim',
          address: 'Blenheim, Marlborough, New Zealand',
          contactEmail: 'parking@marlboroughroads.govt.nz',
          contactPhone: '03 123 4567',
          isActive: true,
          notes: 'Create parking client, zones, and geofences',
          childSiteNames: ['Kinross Street car park'],
          childZoneNames: ['Blenheim CBD Time Restricted Parking'],
          childGeofenceNames: ['Blenheim CBD geofence'],
          missingFields: [],
          followUpQuestions: [],
        }),
      },
      error: null,
    })
  })

  it('routes a Blenheim parking setup prompt into the organization creation approval flow', async () => {
    renderPage()

    const input = await screen.findByPlaceholderText('Ask Bob anything operational…')
    const message = 'Create organization Marlborough Roads Parking Operations for First Security Blenheim and set up the client sites, zones, and geofences.'

    fireEvent.change(input, {
      target: { value: message },
    })

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(message)
    })

    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      keyCode: 13,
      shiftKey: false,
    })

    await waitFor(() => {
      expect(aiChatMock).toHaveBeenCalled()
      expect(fromMock).toHaveBeenCalledWith('organizations')
      expect(showDialogMock).toHaveBeenCalled()
    })

    const recommendation = showDialogMock.mock.calls[0]?.[0]
    expect(recommendation).toMatchObject({
      actionType: 'create_organization_structure',
      title: 'Approve creation of Marlborough Roads Parking Operations',
      entityType: 'organization',
    })
  })

  it('routes a Deputy-style patrol brief into the patrol setup approval flow', async () => {
    aiChatMock.mockResolvedValueOnce({
      data: {
        response: JSON.stringify({
          title: 'Nelson CBD Patrol Setup',
          organizationName: 'First Security - Blenheim',
          summary: 'Deputy brief covering parking details, zones, staff, and patrol routes for Nelson CBD operations.',
          services: ['security patrols', 'lock and unlock gates'],
          facilities: [
            {
              name: 'Nelson CBD Retail Precinct',
              extent: ['Main street parking bays', 'Rear loading bay access'],
              serviceCoverage: ['parking checks', 'security patrols'],
              frequencies: ['Nightly patrol every 60 minutes'],
              setupActions: ['Create linked zones and patrol route'],
              notes: ['Deputy roster includes lead officer and deputy officer.'],
            },
          ],
          siteSops: [
            {
              siteName: 'Nelson CBD Retail Precinct',
              jobType: 'Patrol',
              steps: ['Check parking lines', 'Complete patrol route', 'Report incidents'],
            },
          ],
          patrolShifts: [
            {
              code: '587',
              name: 'Night Patrol',
              startTime: '18:00',
              endTime: '06:00',
              breaks: ['30 minute paid break'],
              allBreaksPaid: true,
              timingPolicy: 'specific',
              coverageAreas: ['Nelson CBD'],
              serviceCoverage: ['parking checks', 'security patrols'],
              notes: ['Deputy shift data supplied by the client.'],
            },
          ],
          blockers: [],
          nextActions: ['Confirm the route order with staff'],
          rosterRequirements: ['Lead officer and deputy officer'],
          geofenceRequirements: ['Nelson CBD parking geofence'],
          patrolRouteRequirements: ['Create patrol route with the provided parking stops'],
        }),
      },
      error: null,
    })

    renderPage()

    const input = await screen.findByPlaceholderText('Ask Bob anything operational…')
    const message = 'Deputy roster brief: services for Nelson CBD facilities, security patrols, lock and unlock gates, response to alarm, patrol summary, despatch zone based patrols, on-site date/time, off-site date/time, parking details, staff roster, and patrol route notes.'

    fireEvent.change(input, {
      target: { value: message },
    })

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(message)
    })

    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      keyCode: 13,
      shiftKey: false,
    })

    await waitFor(() => {
      expect(aiChatMock).toHaveBeenCalled()
      expect(fromMock).toHaveBeenCalledWith('patrols')
      expect(fromMock).toHaveBeenCalledWith('zones')
      expect(showDialogMock).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('button', { name: /approve & execute/i }))

    await waitFor(() => {
      expect(approvalExecuteMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(approvalExecuteMock).toHaveBeenCalled()
    })

    const recommendation = showDialogMock.mock.calls[0]?.[0]
    expect(recommendation).toMatchObject({
      actionType: 'create_patrol_setup_draft',
      title: 'Approve Bob patrol setup draft creation',
      entityType: 'patrol_setup_blueprint',
    })
  })

  it('logs outage responses as warnings instead of console errors', async () => {
    aiChatMock.mockRejectedValueOnce(new Error('Failed to fetch'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderPage()

    const input = await screen.findByPlaceholderText('Ask Bob anything operational…')
    const message = 'Status check'

    fireEvent.change(input, {
      target: { value: message },
    })

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(message)
    })

    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      keyCode: 13,
    })

    await screen.findByText('Bob/Ollama is temporarily unavailable right now. Please retry in a moment.')

    expect(errorSpy).not.toHaveBeenCalledWith('Bob assistant invoke failed:', expect.anything())
    expect(warnSpy).toHaveBeenCalledWith('Bob assistant temporary outage detected:', expect.anything())

    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('shows ranked Nelson City Council contract sources and visible conflict warnings', async () => {
    storageListMock.mockImplementation(async (prefix: string) => {
      if (!prefix) {
        return {
          data: [
            { name: 'Nelson City Council' },
          ],
          error: null,
        }
      }

      if (prefix === 'Nelson City Council') {
        return {
          data: [
            {
              id: 'file-1',
              name: 'final-signed-parking-instructions.txt',
              updated_at: '2026-05-10T00:00:00Z',
              metadata: { size: 512 },
            },
            {
              id: 'file-2',
              name: 'archive-old-parking-instructions.txt',
              updated_at: '2025-01-01T00:00:00Z',
              metadata: { size: 256 },
            },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
    })

    storageDownloadMock.mockImplementation(async (path: string) => {
      if (path === 'Nelson City Council/final-signed-parking-instructions.txt') {
        return {
          data: createTextBlob([
            'Nelson City Council parking contract final signed current.',
            'Service scope includes loading zone and mobility bay patrol coverage.',
            'Officers must inspect the loading zone every 30 minutes and record each visit.',
            'Monthly fee is NZD 3,000 for this scope.',
            'This increases current service coverage for after-hours checks.',
            'Mobility permit bays must be checked during every patrol.',
          ].join('\n')),
          error: null,
        }
      }

      if (path === 'Nelson City Council/archive-old-parking-instructions.txt') {
        return {
          data: createTextBlob([
            'Nelson City Council parking archive instructions.',
            'Service scope is limited to loading zone checks only.',
            'Officers must inspect the loading zone hourly and notify admin only if there is a breach.',
            'Monthly fee is NZD 2,200 under the older schedule.',
            'Current service remains unchanged in this older contract.',
            'Mobility permit bays are checked once daily.',
          ].join('\n')),
          error: null,
        }
      }

      return { data: null, error: null }
    })

    renderPage()

    expect(await screen.findByText('Service Contract Intelligence')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('Nelson City Council/final-signed-parking-instructions.txt').length).toBeGreaterThan(0)
      expect(screen.getByText(/Potential conflict in loading zone rules/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/Bob should prefer the higher-ranked signed\/current source/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Nelson City Council\/archive-old-parking-instructions.txt/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Comparison snapshot \(service, times, cost, impact\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Cost profile:/i)).toBeInTheDocument()
  })

  it('avoids duplicate React key warnings when ranked contract sources repeat', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      storageListMock.mockImplementation(async (prefix: string) => {
        if (!prefix) {
          return {
            data: [{ name: 'Nelson City Council' }],
            error: null,
          }
        }

        if (prefix === 'Nelson City Council') {
          return {
            data: [
              {
                id: 'file-1',
                name: 'final-signed-parking-instructions.txt',
                updated_at: '2026-05-10T00:00:00Z',
                metadata: { size: 512 },
              },
              {
                id: 'file-1b',
                name: 'final-signed-parking-instructions.txt',
                updated_at: '2026-05-09T00:00:00Z',
                metadata: { size: 510 },
              },
              {
                id: 'file-2',
                name: 'archive-old-parking-instructions.txt',
                updated_at: '2025-01-01T00:00:00Z',
                metadata: { size: 256 },
              },
            ],
            error: null,
          }
        }

        return { data: [], error: null }
      })

      storageDownloadMock.mockImplementation(async (path: string) => {
        if (path === 'Nelson City Council/final-signed-parking-instructions.txt') {
          return {
            data: createTextBlob([
              'Nelson City Council parking contract final signed current.',
              'Service scope includes loading zone and mobility bay patrol coverage.',
              'Officers must inspect the loading zone every 30 minutes and record each visit.',
              'Monthly fee is NZD 3,000 for this scope.',
            ].join('\n')),
            error: null,
          }
        }

        if (path === 'Nelson City Council/archive-old-parking-instructions.txt') {
          return {
            data: createTextBlob([
              'Nelson City Council parking archive instructions.',
              'Service scope is limited to loading zone checks only.',
              'Officers must inspect the loading zone hourly and notify admin only if there is a breach.',
              'Monthly fee is NZD 2,200 under the older schedule.',
            ].join('\n')),
            error: null,
          }
        }

        return { data: null, error: null }
      })

      renderPage()

      expect(await screen.findByText('Service Contract Intelligence')).toBeInTheDocument()

      await waitFor(() => {
        expect(screen.getAllByText('Nelson City Council/final-signed-parking-instructions.txt').length).toBeGreaterThan(1)
      })

      const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((arg) => String(arg).includes('Encountered two children with the same key')),
      )
      expect(duplicateKeyWarnings).toHaveLength(0)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('lets approvers adopt the highest-ranked source and stage a conflict review', async () => {
    storageListMock.mockImplementation(async (prefix: string) => {
      if (!prefix) {
        return {
          data: [{ name: 'Nelson City Council' }],
          error: null,
        }
      }

      if (prefix === 'Nelson City Council') {
        return {
          data: [
            {
              id: 'file-1',
              name: 'final-signed-parking-instructions.txt',
              updated_at: '2026-05-10T00:00:00Z',
              metadata: { size: 512 },
            },
            {
              id: 'file-2',
              name: 'archive-old-parking-instructions.txt',
              updated_at: '2025-01-01T00:00:00Z',
              metadata: { size: 256 },
            },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
    })

    storageDownloadMock.mockImplementation(async (path: string) => {
      if (path === 'Nelson City Council/final-signed-parking-instructions.txt') {
        return {
          data: createTextBlob([
            'Nelson City Council parking contract final signed current.',
            'Service scope includes loading zone and mobility bay patrol coverage.',
            'Officers must inspect the loading zone every 30 minutes and record each visit.',
            'Monthly fee is NZD 3,000 for this scope.',
            'This increases current service coverage for after-hours checks.',
            'Mobility permit bays must be checked during every patrol.',
          ].join('\n')),
          error: null,
        }
      }

      if (path === 'Nelson City Council/archive-old-parking-instructions.txt') {
        return {
          data: createTextBlob([
            'Nelson City Council parking archive instructions.',
            'Service scope is limited to loading zone checks only.',
            'Officers must inspect the loading zone hourly and notify admin only if there is a breach.',
            'Monthly fee is NZD 2,200 under the older schedule.',
            'Current service remains unchanged in this older contract.',
            'Mobility permit bays are checked once daily.',
          ].join('\n')),
          error: null,
        }
      }

      return { data: null, error: null }
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /use highest-ranked source/i })).toBeEnabled()
      expect(screen.getByRole('button', { name: /review conflict/i })).toBeEnabled()
    })

    fireEvent.click(screen.getAllByRole('button', { name: /manual override/i })[0])

    fireEvent.click(screen.getByRole('button', { name: /use highest-ranked source/i }))

    expect(await screen.findByText('Approve highest-ranked contract source')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /approve & execute/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue(/## Approved Contract Source Priority/i)).toBeInTheDocument()
      expect(screen.getByDisplayValue(/Primary source: Nelson City Council\/final-signed-parking-instructions.txt/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /review conflict/i }))

    expect(await screen.findByText('Approve service-contract conflict review')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /approve & execute/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue(/## Service Contract Conflict Review/i)).toBeInTheDocument()
      expect(screen.getByDisplayValue(/Potential conflict in loading zone rules/i)).toBeInTheDocument()
      expect(screen.getByDisplayValue(/## Comparison \(Service, Time, Cost, Impact\)/i)).toBeInTheDocument()
      expect(screen.getByDisplayValue(/Cost profile:/i)).toBeInTheDocument()
      expect(screen.getByDisplayValue(/Resolution: Manual override required/i)).toBeInTheDocument()
    })
  })

  it('processes mixed contract, historical patrol, and alarm response data into non-duplicated setup writes', async () => {
    aiChatMock.mockResolvedValueOnce({
      data: {
        response: JSON.stringify({
          title: 'Nelson Mixed Services Setup',
          organizationName: 'Nelson City Council',
          summary: 'Merged setup from service contracts, historical patrol, and alarm response data.',
          services: ['static security guards', 'parking patrols', 'alarm response'],
          facilities: [
            {
              name: 'Nelson Static Guard Post',
              extent: ['Main entrance', 'Control room'],
              serviceCoverage: ['static security guards', 'alarm response'],
              frequencies: ['24/7 static post'],
              setupActions: ['Maintain existing geofence and site records'],
              notes: ['Existing static site in production.'],
            },
            {
              name: 'Nelson CBD Patrol Route',
              extent: ['Hardy Street', 'Trafalgar Street', 'Wakatu Square'],
              serviceCoverage: ['parking patrols', 'freedom camping checks'],
              frequencies: ['Night patrol every 60 minutes'],
              setupActions: ['Create linked zone geofence and patrol route records'],
              notes: ['Route sourced from historical patrol and alarm response data.'],
            },
          ],
          siteSops: [
            {
              siteName: 'Nelson CBD Patrol Route',
              jobType: 'Patrol',
              steps: ['Check all route points', 'Record patrol completion status', 'Escalate alarm breaches'],
            },
          ],
          patrolShifts: [
            {
              code: '587',
              name: 'Nelson Night Patrol',
              startTime: '18:00',
              endTime: '06:00',
              breaks: ['30 minute paid break'],
              allBreaksPaid: true,
              timingPolicy: 'recommended',
              coverageAreas: ['Nelson CBD'],
              serviceCoverage: ['parking patrols', 'alarm response'],
              notes: ['Derived from historical completion rows and route windows.'],
            },
          ],
          blockers: [],
          nextActions: ['Apply setup without duplicating existing static site records'],
          rosterRequirements: ['1 static guard', '1 patrol officer'],
          geofenceRequirements: ['Nelson CBD route geofence'],
          patrolRouteRequirements: ['Nelson CBD route order from contract annex'],
        }),
      },
      error: null,
    })

    mockSelectRules.push(
      {
        table: 'zones',
        operation: 'maybeSingle',
        matches: (filters) => filters.name === 'Nelson Static Guard Post Geofence',
        result: { data: { id: 'zone-static-existing' }, error: null },
      },
      {
        table: 'client_sites',
        operation: 'maybeSingle',
        matches: (filters) => String(filters.name || '').toLowerCase().includes('static guard post'),
        result: { data: { id: 'site-static-existing' }, error: null },
      },
      {
        table: 'patrols',
        operation: 'maybeSingle',
        matches: () => true,
        result: { data: { id: 'patrol-active-1' }, error: null },
      },
    )

    storageListMock.mockImplementation(async (prefix: string) => {
      if (!prefix) return { data: [{ name: 'Nelson City Council' }], error: null }
      if (prefix === 'Nelson City Council') {
        return {
          data: [
            { id: 'file-1', name: 'service-contract-final.txt', updated_at: '2026-05-10T00:00:00Z', metadata: { size: 512 } },
            { id: 'file-2', name: 'historical-patrol-summary.txt', updated_at: '2026-05-08T00:00:00Z', metadata: { size: 512 } },
            { id: 'file-3', name: 'alarm-response-protocol.txt', updated_at: '2026-05-07T00:00:00Z', metadata: { size: 512 } },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    storageDownloadMock.mockImplementation(async (path: string) => {
      if (path === 'Nelson City Council/service-contract-final.txt') {
        return {
          data: createTextBlob('Nelson City Council contract final signed. Service includes static security guards and parking patrol coverage with route points.'),
          error: null,
        }
      }
      if (path === 'Nelson City Council/historical-patrol-summary.txt') {
        return {
          data: createTextBlob('Historical patrol rows show route completion times for Nelson CBD and despatch zone 587.'),
          error: null,
        }
      }
      if (path === 'Nelson City Council/alarm-response-protocol.txt') {
        return {
          data: createTextBlob('Alarm response escalation and static-post handover requirements are included.'),
          error: null,
        }
      }
      return { data: null, error: null }
    })

    renderPage()

    const input = await screen.findByPlaceholderText('Ask Bob anything operational…')
    const message = 'Deputy merged brief: services for Nelson CBD facilities, security patrols, static security guards, lock and unlock gates, response to alarm, patrol summary, despatch zone based patrols, on-site date/time, off-site date/time, historical patrol rows, and patrol route details from service contracts.'

    fireEvent.change(input, { target: { value: message } })
    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      keyCode: 13,
      shiftKey: false,
    })

    await waitFor(() => {
      expect(screen.getByText('Approve Bob patrol setup draft creation')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /approve & execute/i }))

    await waitFor(() => {
      expect(approvalExecuteMock).toHaveBeenCalled()
    })

    const staticWrites = dbOperationLog.filter((entry) =>
      entry.table === 'client_sites'
      && (entry.operation === 'update' || entry.operation === 'insert')
      && String(entry.args[0]?.name || '').toLowerCase().includes('static guard post'),
    )
    expect(staticWrites.length).toBe(1)
    expect(staticWrites[0].operation).toBe('update')
    expect(staticWrites[0].args[0]?.site_type).toBe('guarding')

    const clientSiteWrites = dbOperationLog.filter((entry) =>
      entry.table === 'client_sites'
      && (entry.operation === 'insert' || entry.operation === 'update'),
    )
    expect(clientSiteWrites.length).toBeGreaterThan(0)

    const duplicateStaticInsert = dbOperationLog.find((entry) =>
      entry.table === 'client_sites'
      && entry.operation === 'insert'
      && entry.args[0]?.site_type === 'guarding',
    )
    expect(duplicateStaticInsert).toBeFalsy()

    const zoneWrites = dbOperationLog.filter((entry) =>
      entry.table === 'zones'
      && (entry.operation === 'insert' || entry.operation === 'update'),
    )
    expect(zoneWrites.length).toBeGreaterThan(0)
  })

  it('persists historical site assortment overrides when staging intake rows', async () => {
    renderPage()

    const input = await screen.findByPlaceholderText('Ask Bob anything operational…')
    const historical = [
      'Bureau ID\tClient Name\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSGS-NSN-NCO\tNELSON NOISE CONTROL\tWILSAR RAPID NOISE CALL\tFALSE\tCompleted\t0\t587\t1/04/2026 22:00\t800001',
      'FSGS-NSN-AR-DB\tSCHOOL ALARM\tALARM ACTIVATION\tFALSE\tCompleted\t0\t584\t1/04/2026 23:00\t800002',
    ].join('\n')

    fireEvent.change(input, { target: { value: historical } })
    fireEvent.keyDown(input, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
      keyCode: 13,
      shiftKey: false,
    })

    expect(await screen.findByText('Approve Bob historical patrol import staging')).toBeInTheDocument()
    expect(await screen.findByText('Historical Assortment Review')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /route to alarm response/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /approve & execute/i }))

    await waitFor(() => {
      expect(approvalExecuteMock).toHaveBeenCalled()
    })

    const historicalInsert = dbOperationLog.find((entry) =>
      entry.table === 'ai_import_intakes'
      && entry.operation === 'insert',
    )

    expect(historicalInsert).toBeTruthy()
    expect(historicalInsert?.args[0]?.recommendations?.assortment_overrides?.['NELSON NOISE CONTROL']).toBe('alarm_response')
    expect(historicalInsert?.args[0]?.recommendations?.assortment_rule).toContain('noise_control rows')

    const routingCoverage = historicalInsert?.args[0]?.recommendations?.routing_coverage as Array<{ module: string; count: number }> | undefined
    expect(routingCoverage).toBeTruthy()
    const alarmCoverage = routingCoverage?.find((entry) => entry.module === 'alarm_response')
    const noiseCoverage = routingCoverage?.find((entry) => entry.module === 'noise_control')
    expect(alarmCoverage?.count).toBe(2)
    expect(noiseCoverage).toBeUndefined()

    const siteCoverage = historicalInsert?.args[0]?.recommendations?.site_coverage as Array<{
      siteName: string
      rowCount: number
      modules: Array<{ module: string; count: number }>
    }> | undefined
    expect(siteCoverage).toBeTruthy()

    const nelsonNoiseSite = siteCoverage?.find((entry) => entry.siteName === 'NELSON NOISE CONTROL')
    expect(nelsonNoiseSite?.rowCount).toBe(1)
    expect(nelsonNoiseSite?.modules.find((entry) => entry.module === 'alarm_response')?.count).toBe(1)
    expect(nelsonNoiseSite?.modules.find((entry) => entry.module === 'noise_control')).toBeUndefined()
  })
})