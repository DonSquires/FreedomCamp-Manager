import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeatureFlag } from './useOperationalCases';

const authState = {
  user: {
    id: 'user-123',
    organization_id: 'org-456',
  },
};

const rpcMock = vi.fn();
const fromMock = vi.fn();
const insertMock = vi.fn();
const maybeSingleMock = vi.fn();
const useAuthStoreMock = vi.fn((selector?: (state: typeof authState) => unknown) =>
  selector ? selector(authState) : authState,
);

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (...args: unknown[]) => useAuthStoreMock(...(args as [])),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useFeatureFlag', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    insertMock.mockReset();
    maybeSingleMock.mockReset();
    useAuthStoreMock.mockClear();

    rpcMock.mockResolvedValue({ data: true, error: null });
    maybeSingleMock.mockResolvedValue({ data: { id: 'flag-789' }, error: null });
    insertMock.mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'feature_flags') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: maybeSingleMock,
            }),
          }),
        };
      }

      if (table === 'feature_flag_evaluations') {
        return {
          insert: insertMock,
        };
      }

      throw new Error(`Unexpected table requested: ${table}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs a feature flag evaluation with user and organization context', async () => {
    const { result } = renderHook(() => useFeatureFlag('FF_PHASE_B_PATROL_EVENTS'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('is_feature_enabled', { flag_name: 'FF_PHASE_B_PATROL_EVENTS' });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        flag_id: 'flag-789',
        enabled: true,
        organization_id: 'org-456',
        user_id: 'user-123',
      }),
    );
  });

  it('returns the flag value even when evaluation logging fails', async () => {
    insertMock.mockResolvedValueOnce({ error: new Error('write failed') });

    const { result } = renderHook(() => useFeatureFlag('FF_PHASE_B_DISPATCH_EVENTS'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});