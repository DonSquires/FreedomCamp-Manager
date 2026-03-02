import React from 'react'
import {
  View, Text, FlatList, Image, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-NZ')
}

export default function RecentScansScreen() {
  const { user } = useAuthStore()

  const { data: scans = [], isLoading, refetch } = useQuery({
    queryKey: ['my-scans-mobile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('observations')
        .select('id, plate_number, recorded_at, is_compliant, processing_status, photo_url, zone:zones!zone_id(name)')
        .eq('recorded_by', user!.id)
        .order('recorded_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as any[]
    },
    enabled: !!user?.id,
    refetchInterval: 15000,
  })

  const renderItem = ({ item }: { item: any }) => {
    const pending = item.processing_status === 'pending'
    const inBreach = !item.is_compliant && !pending
    return (
      <View style={[styles.card, inBreach && styles.cardBreach]}>
        {/* Photo thumb */}
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={styles.thumb} />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Ionicons name="car-outline" size={22} color="#9ca3af" />
          </View>
        )}

        {/* Details */}
        <View style={styles.cardBody}>
          <View style={styles.cardRow}>
            <Text style={styles.plate}>
              {pending ? '⏳ Processing...' : (item.plate_number || '—')}
            </Text>
            {!pending && (
              <View style={[styles.badge, inBreach ? styles.badgeBreach : styles.badgeOk]}>
                <Text style={styles.badgeText}>{inBreach ? 'BREACH' : 'OK'}</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta}>
            {item.zone?.name || 'Unknown zone'} · {timeAgo(item.recorded_at)}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Scans</Text>
        <Text style={styles.subtitle}>{scans.length} recent observations</Text>
      </View>
      <FlatList
        data={scans}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#1d4ed8" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="camera-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No scans yet</Text>
            <Text style={styles.emptySubtext}>Tap Scan to capture your first vehicle</Text>
          </View>
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  list: { padding: 16, gap: 8 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardBreach: { borderColor: '#fca5a5', backgroundColor: '#fff5f5' },
  thumb: { width: 72, height: 72, resizeMode: 'cover' },
  thumbPlaceholder: {
    width: 72,
    height: 72,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, padding: 10, justifyContent: 'center' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  plate: { fontFamily: 'Courier', fontSize: 16, fontWeight: '700', color: '#0f172a' },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeOk: { backgroundColor: '#dcfce7' },
  badgeBreach: { backgroundColor: '#fee2e2' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#111' },
  meta: { fontSize: 12, color: '#64748b' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#94a3b8' },
  emptySubtext: { fontSize: 13, color: '#cbd5e1' },
})
