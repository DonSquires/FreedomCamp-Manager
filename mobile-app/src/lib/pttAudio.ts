/**
 * pttAudio.ts
 * Helpers for recording a PTT clip, uploading it to Supabase Storage,
 * and generating a signed playback URL.
 *
 * Storage bucket: "ptt-clips"
 *   Path format:  {orgId}/{date}/{userId}_{timestamp}.m4a
 *
 * The bucket must be created in Supabase with:
 *   - public: false  (presigned URLs only)
 *   - allowed mime types: audio/mp4, audio/m4a, audio/mpeg
 */

import { supabase } from './supabase'
import * as FileSystem from 'expo-file-system'

const BUCKET = 'ptt-clips'
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 // 24 hours

export interface UploadResult {
  clipUrl: string   // signed URL valid for SIGNED_URL_EXPIRES_IN seconds
  storagePath: string
}

/**
 * Upload a recorded audio file to Supabase Storage.
 * Returns a short-lived signed URL suitable for `stop_speaking.clipUrl`.
 */
export async function uploadPTTClip(params: {
  localUri: string
  userId: string
  orgId: string
}): Promise<UploadResult> {
  const { localUri, userId, orgId } = params

  const date = new Date().toISOString().split('T')[0]
  const timestamp = Date.now()
  const storagePath = `${orgId}/${date}/${userId}_${timestamp}.m4a`

  // Use blob upload from file URI for better Expo/Hermes compatibility.
  const response = await fetch(localUri)
  if (!response.ok) {
    throw new Error(`PTT read failed: ${response.status} ${response.statusText}`)
  }
  const clipBlob = await response.blob()

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, clipBlob, {
      contentType: 'audio/mp4',
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`PTT upload failed: ${uploadError.message}`)
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN)

  if (signError || !signedData?.signedUrl) {
    throw new Error(`PTT sign URL failed: ${signError?.message ?? 'no URL returned'}`)
  }

  return { clipUrl: signedData.signedUrl, storagePath }
}

/**
 * Write a WAV blob returned by synthesize-speech to a temporary cache file
 * and return a local file:// URI that expo-av can play directly.
 *
 * Returns null when FileSystem is unavailable or the blob is empty.
 */
export async function writeSynthesizedSpeechToCache(blob: Blob): Promise<string | null> {
  try {
    if (!blob || blob.size === 0) return null

    const cacheDir = FileSystem.cacheDirectory
    if (!cacheDir) return null

    const filename = `tts_${Date.now()}.wav`
    const localUri = `${cacheDir}${filename}`

    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    const chunks: string[] = []
    for (let i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
    }
    const base64 = btoa(chunks.join(''))

    await FileSystem.writeAsStringAsync(localUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    })

    return localUri
  } catch {
    return null
  }
}

/**
 * Delete a temporary TTS cache file after playback completes.
 * No-op if the file has already been removed.
 */
export async function deleteTTSCacheFile(localUri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(localUri, { idempotent: true })
  } catch {
    // Ignore — cache eviction is best-effort
  }
}
