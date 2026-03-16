import React from 'react'
import {
  View, Text, FlatList, Image, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { fetchAllObservations } from '../lib/observations'

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString('en-NZ')
}

export default function RecentScansScreen() {
  const { user } = useAuthStore()
  const [datePreset, setDatePreset] = React.useState<'today' | '7d' | '30d' | '90d'>('30d')
  const [zoneId, setZoneId] = React.useState<string | null>(null)

  const { data: zones = [] } = useQuery({
    queryKey: ['zones-mobile-filter', user?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', user!.organization_id)
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return (data || []) as Array<{ id: string; name: string }>
    },
    enabled: !!user?.organization_id,
  })

  const getDateRange = React.useCallback(() => {
    const now = new Date()
    const to = now.toISOString().split('T')[0]
    const fromDate = new Date(now)

    if (datePreset === 'today') {
      return { from: to, to }
    }
    if (datePreset === '7d') {
      fromDate.setDate(now.getDate() - 6)
    } else if (datePreset === '30d') {
      fromDate.setDate(now.getDate() - 29)
    } else {
      fromDate.setDate(now.getDate() - 89)
    }

    return {
      from: fromDate.toISOString().split('T')[0],
      to,
    }
  }, [datePreset])

  const { data: scans = [], isLoading, refetch } = useQuery({
    queryKey: ['my-scans-mobile', user?.id, user?.organization_id, datePreset, zoneId],
    queryFn: async () => {
      const { from, to } = getDateRange()
      return await fetchAllObservations({
        dateFrom: from,
        dateTo: to,
        organizationId: user!.organization_id,
        zoneId,
        recordedBy: user!.id,
        pageSize: 500,
      })
    },
    enabled: !!user?.id,
    refetchInterval: 15000,
  })

  const renderItem = ({ item }: { item: any }) => {
    const pending = item.plate_number === 'PROCESSING...'
    const inBreach = !item.is_compliant && !pending
    const thumbUrl = item.photo || item.photo_url
    return (
      <View style={[styles.card, inBreach && styles.cardBreach]}>
        {/* Photo thumb */}
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={styles.thumb} />
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
            {item.zone_name || 'Unknown zone'} · {timeAgo(item.recorded_at)}
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

      <View style={styles.filtersWrap}>
        <View style={styles.filterRow}>
          {(['today', '7d', '30d', '90d'] as const).map((preset) => (
            <TouchableOpacity
              key={preset}
              style={[styles.filterChip, datePreset === preset && styles.filterChipActive]}
              onPress={() => setDatePreset(preset)}
            >
              <Text style={[styles.filterChipText, datePreset === preset && styles.filterChipTextActive]}>
                {preset === 'today' ? 'Today' : preset.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.zoneRow}>
          <TouchableOpacity
            style={[styles.zoneChip, zoneId === null && styles.zoneChipActive]}
            onPress={() => setZoneId(null)}
          >
            <Text style={[styles.zoneChipText, zoneId === null && styles.zoneChipTextActive]}>All Zones</Text>
          </TouchableOpacity>
          {zones.map((zone) => (
            <TouchableOpacity
              key={zone.id}
              style={[styles.zoneChip, zoneId === zone.id && styles.zoneChipActive]}
              onPress={() => setZoneId(zone.id)}
            >
              <Text style={[styles.zoneChipText, zoneId === zone.id && styles.zoneChipTextActive]}>{zone.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
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
  filtersWrap: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#fff',
  },
  filterChipActive: {
    backgroundColor: '#dbeafe',
    borderColor: '#60a5fa',
  },
  filterChipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#1d4ed8' },
  zoneRow: { gap: 8, paddingRight: 16 },
  zoneChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  zoneChipActive: {
    backgroundColor: '#ecfeff',
    borderColor: '#22d3ee',
  },
  zoneChipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  zoneChipTextActive: { color: '#0e7490' },
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
  plate: { fontFamily: 'Courier New', fontSize: 16, fontWeight: '700', color: '#0f172a' },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeOk: { backgroundColor: '#dcfce7' },
  badgeBreach: { backgroundColor: '#fee2e2' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#111' },
  meta: { fontSize: 12, color: '#64748b' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#94a3b8' },
  emptySubtext: { fontSize: 13, color: '#cbd5e1' },
})
