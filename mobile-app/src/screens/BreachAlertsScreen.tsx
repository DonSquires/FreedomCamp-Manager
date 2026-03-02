import React, { useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { toast } from 'sonner-native'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

const BREACH_LABELS: Record<string, string> = {
  consecutive_nights:   'Consecutive Nights',
  monthly_limit:        'Monthly Limit Exceeded',
  self_contained:       'Not Self-Contained',
  after_hours:          'After Hours',
  day_visit_violation:  'Day Visit Violation',
  allowed_days_violation:'Wrong Day of Week',
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  pending:              { color: '#f59e0b', label: 'Pending' },
  acknowledged:         { color: '#3b82f6', label: 'Acknowledged' },
  enforcement_started:  { color: '#ef4444', label: 'Enforcement Started' },
  resolved:             { color: '#22c55e', label: 'Resolved' },
  dismissed:            { color: '#6b7280', label: 'Dismissed' },
}

export default function BreachAlertsScreen() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'active' | 'all'>('active')

  const { data: breaches = [], isLoading, refetch } = useQuery({
    queryKey: ['breach-alerts-mobile', user?.organization_id, filter],
    queryFn: async () => {
      let q = supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, status, created_at, zone:zones!zone_id(name)')
        .eq('organization_id', user!.organization_id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (filter === 'active') {
        q = q.in('status', ['pending', 'acknowledged', 'enforcement_started'])
      }
      const { data, error } = await q
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.organization_id,
    refetchInterval: 30000,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('breach_alerts')
        .update({ status: 'acknowledged' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Breach acknowledged')
      queryClient.invalidateQueries({ queryKey: ['breach-alerts-mobile'] })
    },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  })

  const renderItem = ({ item }: { item: any }) => {
    const statusMeta = STATUS_META[item.status] || STATUS_META.pending
    const isActionable = item.status === 'pending'
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.plate}>{item.plate_number || 'Unknown'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusMeta.color + '22' }]}>
            <Text style={[styles.statusText, { color: statusMeta.color }]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>
        <Text style={styles.breachType}>
          {BREACH_LABELS[item.breach_type] || item.breach_type}
        </Text>
        <Text style={styles.meta}>
          {item.zone?.name || 'Unknown zone'} · {new Date(item.created_at).toLocaleDateString('en-NZ')}
        </Text>
        {isActionable && (
          <TouchableOpacity
            style={styles.ackBtn}
            onPress={() => acknowledgeMutation.mutate(item.id)}
            disabled={acknowledgeMutation.isPending}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color="#1d4ed8" />
            <Text style={styles.ackText}>Acknowledge</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Breach Alerts</Text>
        {/* Filter toggle */}
        <View style={styles.filterRow}>
          {(['active', 'all'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'active' ? 'Active' : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={breaches}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#1d4ed8" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#86efac" />
            <Text style={styles.emptyText}>No active breaches</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  filterBtnActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  filterText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  filterTextActive: { color: '#fff' },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fee2e2',
    gap: 6,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plate: { fontFamily: 'Courier', fontSize: 18, fontWeight: '800', color: '#0f172a' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  breachType: { fontSize: 14, fontWeight: '600', color: '#dc2626' },
  meta: { fontSize: 12, color: '#94a3b8' },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#eff6ff',
  },
  ackText: { color: '#1d4ed8', fontWeight: '600', fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#94a3b8' },
})
