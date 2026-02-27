/**
 * File Upload Utilities for Supabase Storage
 */

import { supabase } from './supabase'
import { toast } from 'sonner'

export interface UploadOptions {
  bucket: 'evidence' | 'incident-evidence' | 'credentials'
  path: string
  file: File
  onProgress?: (progress: number) => void
}

export interface UploadResult {
  url: string
  path: string
  error: string | null
}

/**
 * Upload file to Supabase Storage with progress tracking
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { bucket, path, file, onProgress } = options

  try {
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size must be less than 10MB')
    }

    // Upload file
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) throw error

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path)

    onProgress?.(100)

    return {
      url: publicUrl,
      path: data.path,
      error: null
    }
  } catch (error: any) {
    console.error('Upload error:', error)
    return {
      url: '',
      path: '',
      error: error.message || 'Upload failed'
    }
  }
}

/**
 * Upload multiple files
 */
export async function uploadMultipleFiles(
  files: File[],
  bucket: 'evidence' | 'incident-evidence' | 'credentials',
  pathPrefix: string,
  onProgress?: (progress: number) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = []
  let completed = 0

  for (const file of files) {
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const path = `${pathPrefix}/${timestamp}_${sanitizedName}`
    
    const result = await uploadFile({
      bucket,
      path,
      file,
      onProgress: (fileProgress) => {
        const totalProgress = ((completed + fileProgress / 100) / files.length) * 100
        onProgress?.(totalProgress)
      }
    })
    
    results.push(result)
    completed++
  }

  return results
}

/**
 * Delete file from storage
 */
export async function deleteFile(bucket: string, path: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([path])

    if (error) throw error
    return true
  } catch (error: any) {
    console.error('Delete error:', error)
    toast.error('Failed to delete file')
    return false
  }
}

/**
 * Generate unique file path with user ID and timestamp
 */
export function generateFilePath(
  userId: string,
  fileName: string,
  folder?: string
): string {
  const timestamp = Date.now()
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const basePath = folder ? `${userId}/${folder}` : userId
  return `${basePath}/${timestamp}_${sanitizedName}`
}

/**
 * Validate image file
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  
  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload JPEG, PNG, or WebP images only.'
    }
  }

  if (file.size > 10 * 1024 * 1024) {
    return {
      valid: false,
      error: 'File size must be less than 10MB'
    }
  }

  return { valid: true }
}

/**
 * Compress image file before upload
 */
export async function compressImage(file: File, maxWidth = 1920): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            } else {
              reject(new Error('Compression failed'))
            }
          },
          'image/jpeg',
          0.85
        )
      }
      img.onerror = reject
    }
    reader.onerror = reject
  })
}

/**
 * Calculate SHA-256 hash of file
 */
export async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * Upload evidence photo with hash and compression
 */
export async function uploadEvidencePhoto(
  file: File,
  userId: string,
  onProgress?: (progress: number) => void
): Promise<{ url: string; hash: string; path: string; error: string | null }> {
  try {
    // Validate
    const validation = validateImageFile(file)
    if (!validation.valid) {
      throw new Error(validation.error)
    }

    onProgress?.(10)

    // Compress if needed
    const compressedFile = file.size > 2 * 1024 * 1024 
      ? await compressImage(file) 
      : file

    onProgress?.(30)

    // Calculate hash
    const hash = await calculateFileHash(compressedFile)

    onProgress?.(50)

    // Upload
    const path = generateFilePath(userId, compressedFile.name, 'evidence')
    const result = await uploadFile({
      bucket: 'evidence',
      path,
      file: compressedFile,
      onProgress: (uploadProgress) => {
        onProgress?.(50 + uploadProgress / 2)
      }
    })

    if (result.error) throw new Error(result.error)

    return {
      url: result.url,
      hash,
      path: result.path,
      error: null
    }
  } catch (error: any) {
    return {
      url: '',
      hash: '',
      path: '',
      error: error.message || 'Upload failed'
    }
  }
}
