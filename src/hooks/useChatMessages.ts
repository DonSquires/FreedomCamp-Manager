import { useCallback, useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface ChatAttachment {
  url: string
  type: string
  storage_path: string
  hash?: string
  thumbnail_url?: string
  bob_analysis?: string
  file_name?: string
  size_bytes?: number
}

export interface PersistedMessage {
  id: string
  thread_id: string
  organization_id: string
  sender_id: string | null
  sender_name: string
  sender_role: string
  body: string
  original_body: string | null
  original_language: string | null
  attachments: ChatAttachment[]
  is_bob_message: boolean
  bob_spoken: boolean
  translation_map: Record<string, string>
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface InsertMessageInput {
  thread_id: string
  organization_id: string
  sender_id: string | null
  sender_name: string
  sender_role: string
  body: string
  original_body?: string
  original_language?: string
  attachments?: ChatAttachment[]
  is_bob_message?: boolean
  bob_spoken?: boolean
}

const PAGE_SIZE = 50

export function useChatMessages(threadId: string | null) {
  const queryClient = useQueryClient()
  const channelRef = useRef<any>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['chat-messages', threadId],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      if (!threadId) return { messages: [] as PersistedMessage[], nextCursor: null as string | null }

      let query = (supabase as any)
        .from('chat_messages')
        .select('*')
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (pageParam) {
        query = query.lt('created_at', pageParam)
      }

      const { data: rows, error } = await query
      if (error) throw error

      const messages = ((rows || []) as PersistedMessage[]).reverse()
      const nextCursor: string | null =
        rows?.length === PAGE_SIZE ? (rows[rows.length - 1]?.created_at ?? null) : null

      return { messages, nextCursor }
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!threadId,
    staleTime: 60_000,
  })

  // Flatten pages: older pages first, then newer
  const messages: PersistedMessage[] = (data?.pages ?? []).flatMap((p) => p.messages)

  const { mutateAsync: insertMessage } = useMutation({
    mutationFn: async (input: InsertMessageInput): Promise<PersistedMessage> => {
      const { data: row, error } = await (supabase as any)
        .from('chat_messages')
        .insert({
          thread_id: input.thread_id,
          organization_id: input.organization_id,
          sender_id: input.sender_id ?? null,
          sender_name: input.sender_name,
          sender_role: input.sender_role,
          body: input.body,
          original_body: input.original_body ?? null,
          original_language: input.original_language ?? null,
          attachments: input.attachments ?? [],
          is_bob_message: input.is_bob_message ?? false,
          bob_spoken: input.bob_spoken ?? false,
        })
        .select()
        .single()

      if (error) throw error
      return row as PersistedMessage
    },
    onSuccess: (msg: PersistedMessage) => {
      // Append to the last page (most recent) in the cache
      queryClient.setQueryData(['chat-messages', threadId], (old: any) => {
        if (!old) return old
        const pages = old.pages as typeof data.pages
        const lastPageIndex = pages.length - 1
        const updatedLastPage = {
          ...pages[lastPageIndex],
          messages: [...pages[lastPageIndex].messages, msg],
        }
        return {
          ...old,
          pages: pages.map((p, i) => (i === lastPageIndex ? updatedLastPage : p)),
        }
      })
    },
  })

  const markThreadRead = useCallback(async (userId: string, tid: string) => {
    if (!userId || !tid) return
    await (supabase as any)
      .from('chat_read_receipts')
      .upsert({ user_id: userId, thread_id: tid, last_read_at: new Date().toISOString() })
  }, [])

  /** Update translation_map on a persisted message (soft update, no re-fetch required) */
  const cacheTranslation = useCallback(
    (messageId: string, language: string, translated: string) => {
      queryClient.setQueryData(['chat-messages', threadId], (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: (old.pages as typeof data.pages).map((page) => ({
            ...page,
            messages: page.messages.map((m: PersistedMessage) =>
              m.id === messageId
                ? { ...m, translation_map: { ...m.translation_map, [language]: translated } }
                : m,
            ),
          })),
        }
      })
    },
    [queryClient, threadId, data],
  )

  // Realtime subscription — append new rows as they arrive
  useEffect(() => {
    if (!threadId) return

    const channel = (supabase as any)
      .channel(`chat-messages-rt-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload: any) => {
          const newMsg = payload.new as PersistedMessage
          if (!newMsg?.id) return

          queryClient.setQueryData(['chat-messages', threadId], (old: any) => {
            if (!old) return old
            const pages = old.pages as typeof data.pages
            // Deduplicate
            const allIds = new Set(pages.flatMap((p) => p.messages.map((m: PersistedMessage) => m.id)))
            if (allIds.has(newMsg.id)) return old

            const lastPageIndex = pages.length - 1
            const updatedLastPage = {
              ...pages[lastPageIndex],
              messages: [...pages[lastPageIndex].messages, newMsg],
            }
            return {
              ...old,
              pages: pages.map((p, i) => (i === lastPageIndex ? updatedLastPage : p)),
            }
          })
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [threadId, queryClient])

  return {
    messages,
    isLoading,
    insertMessage,
    markThreadRead,
    cacheTranslation,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  }
}
