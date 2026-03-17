import React, { useState, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system'
import { Ionicons } from '@expo/vector-icons'
import { toast } from 'sonner-native'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

/** React Native multipart file descriptor accepted by fetch/FormData on iOS + Android */
interface RNFileInfo {
  uri: string
  name: string
  type: string
}

export default function ScanScreen() {
  const { user } = useAuthStore()
  const [permission, requestPermission] = useCameraPermissions()
  const [isProcessing, setIsProcessing] = useState(false)
  const [lastResult, setLastResult] = useState<{ plate: string; compliant: boolean } | null>(null)
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
        supabase.functions.invoke('alpr-process', {
          body: {
            photo_url: photoUrl,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
          },
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

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw new Error(sessionError.message || 'Unable to read current session')

      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('No active session found. Please sign in again.')

      // 6. Create observation via unified ingest pipeline
      toast.loading('Saving...')
      const idempotencyKey = `scan-${user?.id}-${timestamp}`
      const { data: ingestData, error: ingestError } = await supabase.functions.invoke('vehicle-ingest', {
        body: {
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
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (ingestError) throw new Error(`Save failed: ${ingestError.message}`)

      toast.dismiss()
      toast.success('✅ Observation captured and processed')
      setLastResult({ plate: ingestData?.plate || 'MANUAL_REQUIRED', compliant: true })
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
    borderColor: '#60a5fa',
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
})
