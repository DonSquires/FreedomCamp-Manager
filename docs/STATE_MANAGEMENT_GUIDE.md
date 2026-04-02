# State Management Guide

This guide documents the state management patterns used in FieldOps Manager.

## Overview

The application uses a layered state management approach:

| Layer | Technology | Use Case |
|-------|------------|----------|
| Global App State | Zustand | Authentication, theme, device settings, offline status |
| Server State | React Query (TanStack Query) | Data fetching, caching, synchronization |
| Feature State | React Context | Scoped feature logic (forms, wizards) |
| Component State | useState/useReducer | Local UI state |

---

## When to Use Each Pattern

### 1. Zustand Stores (`/src/stores/`)

**Use for:**
- Authentication state (`authStore.ts`)
- Device/hardware integration (`deviceStore.ts`)
- Push-to-talk state (`pttStore.ts`)
- App-wide settings (theme, notifications)
- Offline queue management

**Characteristics:**
- Synchronous, client-only state
- Persists across navigation
- Not tied to server data

**Example:**
```typescript
// stores/authStore.ts
import { create } from 'zustand'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  login: (user) => set({ user, isAuthenticated: true }),
  logout: () => set({ user: null, isAuthenticated: false }),
}))
```

### 2. React Query (`@tanstack/react-query`)

**Use for:**
- Fetching data from Supabase
- Caching server responses
- Background refetching
- Optimistic updates
- Pagination/infinite scroll

**Characteristics:**
- Automatic caching and deduplication
- Background refetching
- Stale-while-revalidate pattern
- DevTools for debugging

**Example:**
```typescript
// hooks/useVehicles.ts
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export function useVehicles(organizationId: string) {
  return useQuery({
    queryKey: ['vehicles', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('organization_id', organizationId)
      if (error) throw error
      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
```

### 3. React Context

**Use for:**
- Feature-scoped state (e.g., form wizard steps)
- Prop drilling prevention within a feature
- Compound component patterns

**Characteristics:**
- Scoped to component tree
- Triggers re-renders on change
- Good for 2-3 levels of nesting

**Example:**
```typescript
// components/features/AccessControl/AccessControlContext.tsx
import { createContext, useContext, useState } from 'react'

interface AccessControlState {
  selectedPerson: Person | null
  verificationStep: 'idle' | 'scanning' | 'verifying' | 'complete'
  setSelectedPerson: (person: Person | null) => void
}

const AccessControlContext = createContext<AccessControlState | null>(null)

export function AccessControlProvider({ children }: { children: React.ReactNode }) {
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null)
  const [verificationStep, setVerificationStep] = useState<'idle' | 'scanning' | 'verifying' | 'complete'>('idle')
  
  return (
    <AccessControlContext.Provider value={{ selectedPerson, verificationStep, setSelectedPerson }}>
      {children}
    </AccessControlContext.Provider>
  )
}

export function useAccessControl() {
  const context = useContext(AccessControlContext)
  if (!context) throw new Error('useAccessControl must be used within AccessControlProvider')
  return context
}
```

### 4. Local Component State

**Use for:**
- Form inputs
- UI toggles (dropdowns, modals)
- Temporary calculations
- Animation state

**Example:**
```typescript
function SearchInput({ onSearch }: { onSearch: (term: string) => void }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  
  return (
    <div>
      <input 
        value={searchTerm} 
        onChange={(e) => setSearchTerm(e.target.value)} 
      />
      <button onClick={() => onSearch(searchTerm)}>Search</button>
    </div>
  )
}
```

---

## Query Key Conventions

Use consistent query key patterns for React Query:

```typescript
// lib/queryKeys.ts
export const queryKeys = {
  // Entities
  vehicles: {
    all: () => ['vehicles'] as const,
    list: (orgId: string) => ['vehicles', 'list', orgId] as const,
    detail: (id: string) => ['vehicles', 'detail', id] as const,
    observations: (vehicleId: string) => ['vehicles', vehicleId, 'observations'] as const,
  },
  
  breaches: {
    all: () => ['breaches'] as const,
    list: (filters: BreachFilters) => ['breaches', 'list', filters] as const,
    detail: (id: string) => ['breaches', 'detail', id] as const,
  },
  
  zones: {
    all: () => ['zones'] as const,
    list: (orgId: string) => ['zones', 'list', orgId] as const,
    detail: (id: string) => ['zones', 'detail', id] as const,
  },
  
  // Features
  accessControl: {
    permissions: (personId: string, zoneId: string) => ['accessControl', 'permissions', personId, zoneId] as const,
    auditLog: (zoneId: string) => ['accessControl', 'audit', zoneId] as const,
  },
}
```

---

## Existing Stores Reference

### `authStore.ts` (308 lines)
- User authentication state
- Session management
- Organization context
- Permission checking helpers

### `deviceStore.ts`
- BLE panic button state
- Fall detection status
- Shake detection settings
- Heart rate monitoring

### `pttStore.ts` (290 lines)
- Push-to-talk channel state
- Audio streaming state
- PTT permissions

### `globalFiltersStore.ts`
- Date range filters
- Zone selection
- Organization filters

---

## Migration Guidelines

### Moving from Zustand to React Query

If you have data fetching in a Zustand store, migrate to React Query:

**Before (Zustand):**
```typescript
// ❌ Don't do this
const useVehicleStore = create((set) => ({
  vehicles: [],
  isLoading: false,
  fetchVehicles: async () => {
    set({ isLoading: true })
    const { data } = await supabase.from('vehicles').select()
    set({ vehicles: data, isLoading: false })
  }
}))
```

**After (React Query):**
```typescript
// ✅ Do this
function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => supabase.from('vehicles').select().then(r => r.data)
  })
}
```

---

## Performance Best Practices

### 1. Selector Pattern for Zustand
```typescript
// Only re-render when `user` changes, not the entire store
const user = useAuthStore((state) => state.user)
```

### 2. Query Deduplication
React Query automatically deduplicates identical queries. Multiple components using `useVehicles('org-123')` will share the same cache entry.

### 3. Memoization for Derived State
```typescript
const processedData = useMemo(() => {
  return vehicles.filter(v => v.status === 'active')
}, [vehicles])
```

### 4. Context Splitting
If a context causes too many re-renders, split it:
```typescript
// Split high-frequency updates from stable state
<AccessControlStateProvider>
  <AccessControlActionsProvider>
    {children}
  </AccessControlActionsProvider>
</AccessControlStateProvider>
```

---

## Anti-Patterns to Avoid

### ❌ Prop Drilling Through Many Levels
```typescript
// Bad: Passing props through 5+ components
<GrandParent data={data}>
  <Parent data={data}>
    <Child data={data}>
      <GrandChild data={data} />
    </Child>
  </Parent>
</GrandParent>
```

### ❌ Putting Server State in Zustand
```typescript
// Bad: Managing server data in Zustand
const useStore = create((set) => ({
  vehicles: [],
  fetchVehicles: async () => {...}
}))
```

### ❌ Over-using Global State
```typescript
// Bad: Putting local UI state in global store
const useStore = create((set) => ({
  isDropdownOpen: false, // This should be useState
}))
```

### ❌ Missing Query Keys
```typescript
// Bad: Inconsistent or missing query keys
useQuery(['vehicles']) // Different from ['vehicles', orgId]
```
