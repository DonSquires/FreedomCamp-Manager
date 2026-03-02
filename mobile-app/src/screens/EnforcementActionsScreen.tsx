import React from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { toast } from 'sonner-native'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  warning:          { icon: 'warning-outline',      label: 'Warning',           color: '#b45309' },
  notice_to_vacate: { icon: 'document-text-outline', label: 'Notice to Vacate',  color: '#dc2626' },
  tow_request:      { icon: 'car-sport-outline',     label: 'Tow Request',       color: '#7c3aed' },
  referral:         { icon: 'share-outline',         label: 'Referral',          color: '#0369a1' },
}

export default function EnforcementActionsScreen() {
  const { user, enforcementWorkflow } = useAuthStore()
  const queryClient = useQueryClient()

  const { data: actions = [], isLoading, refetch } = useQuery({
    queryKey: ['my-enforcement-actions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enforcement_actions')
        .select('id, action_type, status, plate_number, recorded_at, zone:zones!zone_id(name)')
        .eq('organization_id', user!.organization_id)
        .order('recorded_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.organization_id,
  })

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('enforcement_actions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Action marked complete')
      queryClient.invalidateQueries({ queryKey: ['my-enforcement-actions'] })
    },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  })

  const renderItem = ({ item }: { item: any }) => {
    const meta = ACTION_META[item.action_type] || ACTION_META.warning
    const isPending = item.status === 'pending' || item.status === 'assigned'
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.iconCircle, { backgroundColor: meta.color + '18' }]}>
            <Ionicons name={meta.icon as any} size={22} color={meta.color} />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.actionLabel}>{meta.label}</Text>
            <Text style={styles.plate}>{item.plate_number || '—'}</Text>
            <Text style={styles.meta}>
              {item.zone?.name || 'Unknown zone'} · {new Date(item.recorded_at).toLocaleDateString('en-NZ')}
            </Text>
          </View>
          <View style={[styles.statusDot, {
            backgroundColor: isPending ? '#f59e0b' : '#22c55e',
          }]} />
        </View>
        {isPending && (
          <TouchableOpacity
            style={styles.completeBtn}
            onPress={() => completeMutation.mutate(item.id)}
            disabled={completeMutation.isPending}
          >
            <Ionicons name="checkmark-done-outline" size={15} color="#15803d" />
            <Text style={styles.completeBtnText}>Mark Complete</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enforcement Actions</Text>
        <View style={styles.workflowBadge}>
          <Ionicons name="shield-outline" size={13} color="#1d4ed8" />
          <Text style={styles.workflowText}>
            {enforcementWorkflow === 'officer_direct' ? 'Officer Direct' :
             enforcementWorkflow === 'hybrid' ? 'Hybrid' : 'Admin First'}
          </Text>
        </View>
      </View>
      <FlatList
        data={actions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#1d4ed8" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color="#86efac" />
            <Text style={styles.emptyText}>No enforcement actions</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    padding: 20,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  workflowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  workflowText: { fontSize: 11, fontWeight: '600', color: '#1d4ed8' },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1 },
  actionLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  plate: { fontFamily: 'Courier New', fontSize: 15, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f0fdf4',
  },
  completeBtnText: { color: '#15803d', fontWeight: '600', fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#94a3b8' },
})
