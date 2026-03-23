/**
 * Custom Hook: useOfflineQueue
 * Offline-first observation queue with IndexedDB persistence
 */

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

async function getEdgeFunctionAuthHeaders() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw new Error(error.message || 'Unable to read current session')
  }

  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('No active session found. Please sign in again before syncing queued scans.')
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  }
}

interface QueuedObservation {
  id: string
  plate_number: string
  photo_url: string
  photo_blob?: Blob
  zone_id: string
  organization_id: string
  idempotency_key: string
  gps_latitude: number
  gps_longitude: number
  gps_accuracy: number | null
  vehicle_make?: string
  vehicle_model?: string
  vehicle_color?: string
  officer_notes?: string
  recorded_at: string
  created_at: string
  sync_attempts: number
  last_sync_attempt?: string
  sync_error?: string
  status: 'pending' | 'syncing' | 'failed' | 'synced'
}

interface OfflineStats {
  total_queued: number
  pending: number
  syncing: number
  failed: number
  synced: number
  oldest_pending: string | null
}

// IndexedDB utilities
const DB_NAME = 'FreedomCampOfflineDB'
const STORE_NAME = 'observations_queue'
const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
    }
  })
}

const getFromDB = async (): Promise<QueuedObservation[]> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || [])
  })
}

const addToDB = async (observation: QueuedObservation): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.add(observation)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

const updateInDB = async (id: string, updates: Partial<QueuedObservation>): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const existing = getRequest.result
      if (existing) {
        const updated = { ...existing, ...updates }
        const updateRequest = store.put(updated)
        updateRequest.onerror = () => reject(updateRequest.error)
        updateRequest.onsuccess = () => resolve()
      } else {
        reject(new Error('Record not found'))
      }
    }
  })
}

const deleteFromDB = async (id: string): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

const getByKeyFromDB = async (id: string): Promise<QueuedObservation | undefined> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

const clearSyncedFromDB = async (): Promise<void> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('status')
    const request = index.openCursor(IDBKeyRange.only('synced'))

    request.onerror = () => reject(request.error)
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export function useOfflineQueue() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  // Fetch queued observations
  const query = useQuery({
    queryKey: ['offline-queue'],
    queryFn: async () => {
      const items = await getFromDB()
      return items.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  })

  // Add to queue mutation
  const addToQueue = useMutation({
    mutationFn: async (observation: Omit<QueuedObservation, 'id' | 'created_at' | 'sync_attempts' | 'status' | 'organization_id' | 'idempotency_key'>) => {
      const queuedObs: QueuedObservation = {
        ...observation,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        sync_attempts: 0,
        status: 'pending',
        organization_id: user?.organization_id || '',
        idempotency_key: `observation-${user?.id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      }

      await addToDB(queuedObs)
      return queuedObs
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
      toast.success('Observation queued for upload')
    },
    onError: () => {
      toast.error('Failed to queue observation')
    },
  })

  // Sync single observation mutation
  const syncObservation = useMutation({
    mutationFn: async (id: string) => {
      const observation = await getByKeyFromDB(id)
      if (!observation) throw new Error('Observation not found')

      // Update status to syncing
      await updateInDB(id, { 
        status: 'syncing',
        last_sync_attempt: new Date().toISOString(),
      })
      queryClient.invalidateQueries({ queryKey: ['offline-queue'] })

      try {
        // Convert photo_blob to base64 data URL if available
        let imageDataUrl: string | undefined
        if (observation.photo_blob) {
          imageDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(observation.photo_blob)
          })
        }

        // Call vehicle-ingest Edge Function to sync observation
        const headers = await getEdgeFunctionAuthHeaders()

        const { error: invokeError } = await supabase.functions.invoke('vehicle-ingest', {
          body: {
            plate: observation.plate_number,
            zoneId: observation.zone_id,
            organizationId: observation.organization_id,
            idempotencyKey: observation.idempotency_key,
            gpsLatitude: observation.gps_latitude,
            gpsLongitude: observation.gps_longitude,
            gpsAccuracy: observation.gps_accuracy,
            recordedAt: observation.recorded_at,
            notes: observation.officer_notes,
            ...(imageDataUrl ? { image: imageDataUrl } : {}),
            ...(observation.photo_url && !imageDataUrl ? { photo_url: observation.photo_url } : {}),
            requires_manual_entry: !observation.plate_number,
          },
          headers,
        })
        if (invokeError) throw new Error(invokeError.message)

        // Mark as synced and remove from queue
        await updateInDB(id, { status: 'synced' })
        setTimeout(() => deleteFromDB(id), 2000) // Delete after 2 seconds

        queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
        queryClient.invalidateQueries({ queryKey: ['observations'] })
        
        return { success: true }
      } catch (error: any) {
        // Mark as failed
        await updateInDB(id, {
          status: 'failed',
          sync_attempts: observation.sync_attempts + 1,
          sync_error: error.message,
        })
        queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Observation synced')
    },
    onError: (error: any) => {
      toast.error(`Sync failed: ${error.message}`)
    },
  })

  // Sync all pending observations (concurrency-limited parallel execution)
  const syncAll = useMutation({
    mutationFn: async () => {
      const items = await getFromDB()
      const pending = items.filter(obs => obs.status === 'pending' || obs.status === 'failed')

      const CONCURRENCY = 3
      const results: Array<{ id: string; success: boolean; error?: unknown }> = []

      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const batch = pending.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.allSettled(
          batch.map(obs => syncObservation.mutateAsync(obs.id))
        )
        batchResults.forEach((result, idx) => {
          results.push({
            id: batch[idx].id,
            success: result.status === 'fulfilled',
            ...(result.status === 'rejected' ? { error: result.reason } : {}),
          })
        })
      }

      return results
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length
      toast.success(`Synced ${successCount}/${results.length} observations`)
    },
  })

  // Clear synced items (single IndexedDB transaction)
  const clearSynced = useMutation({
    mutationFn: async () => {
      await clearSyncedFromDB()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
      toast.success('Cleared synced items')
    },
  })

  // Delete from queue
  const removeFromQueue = useMutation({
    mutationFn: async (id: string) => {
      await deleteFromDB(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offline-queue'] })
      toast.success('Observation removed from queue')
    },
  })

  return {
    queue: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    addToQueue,
    syncObservation,
    syncAll,
    clearSynced,
    removeFromQueue,
  }
}

// Hook for queue statistics — derived from the same cache entry as useOfflineQueue
// so no extra IndexedDB reads or separate polling is needed.
export function useOfflineQueueStats() {
  return useQuery({
    queryKey: ['offline-queue'],
    queryFn: async () => {
      const items = await getFromDB()
      return items.sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
    },
    select: (items): OfflineStats => {
      const pendingItems = items.filter(obs => obs.status === 'pending')
      const oldest = pendingItems.length > 0
        ? pendingItems.reduce((a, b) =>
            new Date(a.created_at) < new Date(b.created_at) ? a : b
          ).created_at
        : null

      return {
        total_queued: items.length,
        pending: pendingItems.length,
        syncing: items.filter(obs => obs.status === 'syncing').length,
        failed: items.filter(obs => obs.status === 'failed').length,
        synced: items.filter(obs => obs.status === 'synced').length,
        oldest_pending: oldest,
      }
    },
  })
}

// Hook for checking if online — uses native browser events instead of polling
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { data: isOnline, isLoading: false }
}
