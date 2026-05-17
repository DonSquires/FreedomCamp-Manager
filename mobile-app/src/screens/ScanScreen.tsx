import React, { useState, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform,
  Vibration,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system'
import { Ionicons } from '@expo/vector-icons'
import { toast } from 'sonner-native'
import { edgeFunctions } from '../lib/edgeFunctions'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'
import AiDomainAssistCard from '../components/AiDomainAssistCard'

/** React Native multipart file descriptor accepted by fetch/FormData on iOS + Android */
interface RNFileInfo {
  uri: string
  name: string
  type: string
}

export default function ScanScreen({ navigation }: any) {
  const { user } = useAuthStore()
  const [permission, requestPermission] = useCameraPermissions()
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastResult, setLastResult] = useState<{ plate: string; compliant: boolean } | null>(null)
  const [quickResult, setQuickResult] = useState<{
    plate: string
    status: 'compliant' | 'unknown'
    lastCheckedLabel: string
  } | null>(null)
  const cameraRef = useRef<CameraView>(null)

  if (!permission) return <View style={styles.container} />

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permContainer}>
        <Ionicons name="camera-outline" size={64} color="#93c5fd" />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permSubtitle}>
          The camera is used to photograph vehicle plates as evidence.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  const handleCapture = async () => {
    if (!cameraRef.current || isProcessing) return
    setIsProcessing(true)
    setLastResult(null)

    try {
      // 1. Take photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        exif: false,
      })
      if (!photo?.uri) throw new Error('Camera capture failed')

      // 2. GPS
      toast.loading('Getting GPS...')
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') throw new Error('Location permission denied')
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })

      // 3. Get or create zone
      const { data: zoneId } = await supabase.rpc('ensure_other_location_zone', {
        p_organization_id: user?.organization_id,
      })

      if (!zoneId) throw new Error('Could not resolve zone for observation')

      // Convert to base64 data URL for vehicle-ingest
      const imageBase64 = await FileSystem.readAsStringAsync(photo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const imageDataUrl = `data:image/jpeg;base64,${imageBase64}`

      // 4. Upload photo
      toast.loading('Uploading photo...')
      const timestamp = Date.now()
      const uniqueId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const photoHash = `sha256-${timestamp}-${uniqueId}`
      const filePath = `${user?.id}/${timestamp}-${uniqueId}.jpg`

      const formData = new FormData()
      const fileInfo: RNFileInfo = { uri: photo.uri, name: 'scan.jpg', type: 'image/jpeg' }
      formData.append('file', fileInfo as unknown as Blob)

      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(filePath, formData, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
      const photoUrl = urlData.publicUrl

      // 5. Detect plate via ALPR
      toast.loading('Running plate detection...')
      const alprTimeoutMs = 5000
      const alprResult = await Promise.race([
        edgeFunctions.processALPR({
          photo_url: photoUrl,
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
        }),
        new Promise<{ data: null; error: { message: string } }>((resolve) => {
          setTimeout(() => resolve({ data: null, error: { message: 'ALPR pre-detect timed out' } }), alprTimeoutMs)
        }),
      ])

      const alprData = (alprResult as any)?.data
      const alprError = (alprResult as any)?.error

      if (alprError) {
        console.warn('ALPR failed; continuing with manual-required flow:', alprError.message)
      }

      const detectedPlate = alprData?.plate || alprData?.plate_number || null
      const detectedConfidence = alprData?.confidence || null

      // 6. Create observation via unified ingest pipeline
      toast.loading('Saving...')
      const idempotencyKey = `scan-${user?.id}-${timestamp}`
      const { data: ingestData, error: ingestError } = await edgeFunctions.ingestVehicleObservation({
        image: imageDataUrl,
        gpsLatitude: loc.coords.latitude,
        gpsLongitude: loc.coords.longitude,
        gpsAccuracy: loc.coords.accuracy,
        recordedAt: new Date().toISOString(),
        officerId: user?.id,
        organizationId: user?.organization_id,
        zoneId,
        idempotencyKey,
        plate: detectedPlate,
        confidence: detectedConfidence,
        requires_manual_entry: !detectedPlate,
      })

      if (ingestError) throw new Error(`Save failed: ${ingestError}`)

      Vibration.vibrate(40)

      const isCompliant = ingestData?.is_compliant === true
      setQuickResult({
        plate: ingestData?.plate || detectedPlate || 'UNKNOWN',
        status: isCompliant ? 'compliant' : 'unknown',
        lastCheckedLabel: 'Last checked: just now',
      })

      toast.dismiss()
      toast.success('✅ Observation captured and processed')
      setLastResult({ plate: ingestData?.plate || 'MANUAL_REQUIRED', compliant: isCompliant })
    } catch (err: any) {
      toast.dismiss()
      toast.error(err.message || 'Scan failed')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.cameraWrapper}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          {/* Plate-framing overlay */}
          <View style={styles.overlay}>
            <View style={styles.topBar}>
              <Text style={styles.overlayTitle}>Align plate in frame</Text>
            </View>
            <View style={styles.frameBorder} />
            <View style={styles.bottomControls}>
              {quickResult && (
                <View style={styles.quickCard}>
                  <Text style={styles.quickPlate}>{quickResult.plate}</Text>
                  <View style={[
                    styles.quickBadge,
                    { backgroundColor: quickResult.status === 'compliant' ? '#14532d' : '#7f1d1d' },
                  ]}>
                    <Text style={styles.quickBadgeText}>
                      {quickResult.status === 'compliant' ? 'CERTIFIED SELF-CONTAINED' : 'UNKNOWN / EXPIRED'}
                    </Text>
                  </View>
                  <Text style={styles.quickHistory}>{quickResult.lastCheckedLabel}</Text>
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: '#16a34a' }]}
                    onPress={() => {
                      setQuickResult(null)
                      navigation.navigate('Scans')
                    }}
                  >
                    <Text style={styles.quickActionText}>Log Compliant</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.quickAction, { backgroundColor: '#dc2626' }]}
                    onPress={() => {
                      setQuickResult(null)
                      navigation.navigate('Fines')
                    }}
                  >
                    <Text style={styles.quickActionText}>Issue Infringement</Text>
                  </TouchableOpacity>
                </View>
              )}

              {lastResult && (
                <View style={[
                  styles.resultPill,
                  { backgroundColor: lastResult.compliant ? '#16a34a' : '#dc2626' },
                ]}>
                  <Text style={styles.resultText}>
                    {lastResult.plate} · {lastResult.compliant ? 'Compliant' : 'BREACH'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.captureButton, isProcessing && styles.captureButtonDisabled]}
                onPress={handleCapture}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#1d4ed8" size="large" />
                ) : (
                  <Ionicons name="camera" size={36} color="#1d4ed8" />
                )}
              </TouchableOpacity>
              <Text style={styles.captureHint}>
                {isProcessing ? 'Processing...' : 'Tap to capture'}
              </Text>

              {(quickResult || lastResult) && (
                <View style={styles.assistWrap}>
                  <AiDomainAssistCard
                    organizationId={user?.organization_id}
                    title="AI Capture Assist"
                    subtitle="Domain-focused next steps after plate capture"
                    contextSummary={[
                      `Latest plate: ${quickResult?.plate || lastResult?.plate || 'UNKNOWN'}`,
                      `Capture status: ${quickResult?.status || (lastResult?.compliant ? 'compliant' : 'unknown') || 'unknown'}`,
                      `Officer: ${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
                      'Screen: scan capture workflow',
                    ].join(' | ')}
                  />
                </View>
              )}
            </View>
          </View>
        </CameraView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#eff6ff',
    gap: 16,
  },
  permTitle: { fontSize: 20, fontWeight: '700', color: '#1e3a8a', textAlign: 'center' },
  permSubtitle: { fontSize: 14, color: '#64748b', textAlign: 'center' },
  permBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  permBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cameraWrapper: { flex: 1 },
  camera: { flex: 1 },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  topBar: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 16,
    alignItems: 'center',
  },
  overlayTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  frameBorder: {
    alignSelf: 'center',
    width: '85%',
    height: 140,
    borderWidth: 3,
    borderColor: '#facc15',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  bottomControls: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  resultPill: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  resultText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  captureButtonDisabled: { backgroundColor: '#e2e8f0' },
  captureHint: { color: '#cbd5e1', fontSize: 12 },
  quickCard: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: 'rgba(2,6,23,0.92)',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    gap: 8,
  },
  quickPlate: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  quickBadge: {
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  quickBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  quickHistory: { color: '#cbd5e1', fontSize: 12, textAlign: 'center' },
  quickAction: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  quickActionText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  assistWrap: {
    width: '100%',
    marginTop: 4,
  },
})
