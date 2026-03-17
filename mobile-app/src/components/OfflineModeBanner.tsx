import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { highVis } from '../lib/highVisTheme'

interface OfflineModeBannerProps {
  offline: boolean
}

export default function OfflineModeBanner({ offline }: OfflineModeBannerProps) {
  if (!offline) return null

  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={16} color="#111827" />
      <Text style={styles.text}>OFFLINE MODE - Saving locally</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    backgroundColor: highVis.colors.warningAmber,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#d97706',
  },
  text: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#111827',
  },
})
