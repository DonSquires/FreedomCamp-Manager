/**
 * Custom Hook: useOfflineQueue
 * Offline-first observation queue with IndexedDB persistence
 */

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
      const items = await getFromDB()
      const observation = items.find(obs => obs.id === id)
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

  // Sync all pending observations
  const syncAll = useMutation({
    mutationFn: async () => {
      const items = await getFromDB()
      const pending = items.filter(obs => obs.status === 'pending' || obs.status === 'failed')

      const results = []
      for (const obs of pending) {
        try {
          await syncObservation.mutateAsync(obs.id)
          results.push({ id: obs.id, success: true })
        } catch (error) {
          results.push({ id: obs.id, success: false, error })
        }
      }

      return results
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length
      toast.success(`Synced ${successCount}/${results.length} observations`)
    },
  })

  // Clear synced items
  const clearSynced = useMutation({
    mutationFn: async () => {
      const items = await getFromDB()
      const synced = items.filter(obs => obs.status === 'synced')

      for (const obs of synced) {
        await deleteFromDB(obs.id)
      }
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

// Hook for queue statistics
export function useOfflineQueueStats() {
  return useQuery({
    queryKey: ['offline-queue-stats'],
    queryFn: async () => {
      const items = await getFromDB()

      const stats: OfflineStats = {
        total_queued: items.length,
        pending: items.filter(obs => obs.status === 'pending').length,
        syncing: items.filter(obs => obs.status === 'syncing').length,
        failed: items.filter(obs => obs.status === 'failed').length,
        synced: items.filter(obs => obs.status === 'synced').length,
        oldest_pending: null,
      }

      const pendingItems = items.filter(obs => obs.status === 'pending')
      if (pendingItems.length > 0) {
        const oldest = pendingItems.reduce((oldest, current) => 
          new Date(current.created_at) < new Date(oldest.created_at) ? current : oldest
        )
        stats.oldest_pending = oldest.created_at
      }

      return stats
    },
    refetchInterval: 5000,
  })
}

// Hook for checking if online
export function useOnlineStatus() {
  return useQuery({
    queryKey: ['online-status'],
    queryFn: () => navigator.onLine,
    refetchInterval: 3000,
  })
}
