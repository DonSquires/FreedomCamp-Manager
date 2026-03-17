import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import { highVis } from '../lib/highVisTheme'

const WORKFLOW_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  admin_first: { label: 'Admin First', color: '#1d4ed8', bg: '#eff6ff' },
  officer_direct: { label: 'Officer Direct', color: '#15803d', bg: '#f0fdf4' },
  hybrid: { label: 'Hybrid', color: '#b45309', bg: '#fffbeb' },
}

export default function HomeScreen({ navigation }: any) {
  const { user, logout, enforcementWorkflow } = useAuthStore()
  const [zoneStatus, setZoneStatus] = useState<string>('Locating...')
  const [stats, setStats] = useState({ todayScans: 0, activeBreaches: 0, compliantToday: 0 })

  useEffect(() => {
    fetchStats()
    detectZone()
  }, [])

  const fetchStats = async () => {
    if (!user?.id) return
    const today = new Date().toISOString().split('T')[0]

    const [scansRes, breachesRes, compliantRes] = await Promise.all([
      supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .eq('recorded_by', user.id)
        .gte('recorded_at', today),
      supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', user.organization_id)
        .in('status', ['pending', 'acknowledged']),
      supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .eq('recorded_by', user.id)
        .eq('is_compliant', true)
        .gte('recorded_at', today),
    ])

    setStats({
      todayScans: scansRes.count || 0,
      activeBreaches: breachesRes.count || 0,
      compliantToday: compliantRes.count || 0,
    })
  }

  const detectZone = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setZoneStatus('Location denied')
        return
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const { data } = await supabase.rpc('check_location_in_org', {
        p_organization_id: user?.organization_id,
        p_latitude: loc.coords.latitude,
        p_longitude: loc.coords.longitude,
      })
      setZoneStatus(data?.zone_name || 'Other Location')
    } catch {
      setZoneStatus('Zone unknown')
    }
  }

  const wf = WORKFLOW_LABEL[enforcementWorkflow] || WORKFLOW_LABEL.admin_first
  const unknownCount = Math.max(0, stats.todayScans - stats.compliantToday - stats.activeBreaches)

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={fetchStats} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Patrol</Text>
            <Text style={styles.name}>{user?.first_name} {user?.last_name}</Text>
          </View>
          <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
            <Ionicons name="log-out-outline" size={22} color="#6b7280" />
          </TouchableOpacity>
        </View>

        <View style={[styles.statusStrip, { backgroundColor: wf.bg }]}> 
          <Ionicons name="shield-checkmark-outline" size={16} color={wf.color} />
          <Text style={[styles.statusText, { color: wf.color }]}> 
            {wf.label} enforcement mode
          </Text>
          <View style={styles.zonePill}>
            <Ionicons name="location-outline" size={13} color="#64748b" />
            <Text style={styles.zonePillText}>{zoneStatus}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatTile label="Checks Today" value={stats.todayScans} color="#1d4ed8" />
          <StatTile label="Compliant" value={stats.compliantToday} color={highVis.colors.compliantGreen} />
          <StatTile label="Breaches" value={stats.activeBreaches} color={highVis.colors.infringementRed} />
        </View>

        <View style={styles.patrolCard}>
          <Text style={styles.patrolTitle}>Patrol Snapshot</Text>
          <Text style={styles.patrolSubtext}>Unchecked vehicles in current patrol context: {unknownCount}</Text>
          <View style={styles.patrolLegendRow}>
            <LegendPill label="Compliant" color={highVis.colors.compliantGreen} count={stats.compliantToday} />
            <LegendPill label="Infringements" color={highVis.colors.infringementRed} count={stats.activeBreaches} />
            <LegendPill label="Unchecked" color="#6b7280" count={unknownCount} />
          </View>
          <Text style={styles.patrolHint}>Tap + to log check, long press + for quick scan</Text>
        </View>

        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.grid}>
          <ActionCard
            icon="scan"
            label="Quick Scan"
            color="#1d4ed8"
            bg="#eff6ff"
            onPress={() => navigation.navigate('Scan')}
          />
          <ActionCard
            icon="list"
            label="My Scans"
            color="#0f766e"
            bg="#ecfeff"
            onPress={() => navigation.navigate('Scans')}
          />
          <ActionCard
            icon="warning-outline"
            label="Breaches"
            color="#dc2626"
            bg="#fef2f2"
            badge={stats.activeBreaches}
            onPress={() => navigation.navigate('Breaches')}
          />
          <ActionCard
            icon="shield-checkmark-outline"
            label="Actions"
            color="#15803d"
            bg="#f0fdf4"
            onPress={() => navigation.navigate('Enforce')}
          />
          <ActionCard
            icon="document-text-outline"
            label="Fines"
            color="#7c3aed"
            bg="#f5f3ff"
            onPress={() => navigation.navigate('Fines')}
          />
        </View>

        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('Scans')}
          onLongPress={() => navigation.navigate('Scan')}
        >
          <Ionicons name="add" size={34} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statTile, { borderColor: color + '66' }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  )
}

function LegendPill({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <View style={styles.legendPill}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
      <Text style={styles.legendCount}>{count}</Text>
    </View>
  )
}

function ActionCard({
  icon, label, color, bg, onPress, badge,
}: {
  icon: string; label: string; color: string; bg: string
  onPress: () => void; badge?: number
}) {
  return (
    <TouchableOpacity style={[styles.actionCard, { backgroundColor: bg }]} onPress={onPress}>
      <View style={[styles.iconCircle, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon as any} size={26} color={color} />
      </View>
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
      {!!badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 20, paddingBottom: 96 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  greeting: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  logoutBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  statusText: { fontSize: 13, fontWeight: '600', flex: 1 },
  zonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  zonePillText: { fontSize: 11, color: '#64748b' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '800' },
  statTileLabel: { fontSize: 11, color: '#64748b', marginTop: 1 },
  patrolCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  patrolTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  patrolSubtext: { fontSize: 12, color: '#475569' },
  patrolLegendRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  legendPill: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#334155', fontWeight: '600', flex: 1 },
  legendCount: { fontSize: 11, color: '#0f172a', fontWeight: '700' },
  patrolHint: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: {
    width: '47%',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    position: 'relative',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionLabel: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: highVis.colors.actionBlue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
})
