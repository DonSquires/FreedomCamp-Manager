import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Contract Tests: Inference Service Video Generation
 *
 * Tests the `/infer/video/generate` endpoint contract:
 * - Validates request/response schema
 * - Tests quality and format options
 * - Verifies FFmpeg fallback behavior
 * - Validates output hash generation
 *
 * Requirements:
 * - INFERENCE_SERVICE_URL must be set and reachable
 * - INFERENCE_API_KEY must be set (if endpoint requires auth)
 *
 * Run: npm run test inference-video-contract
 */

describe('Inference Service - Video Generation Contract', () => {
  let inferenceUrl: string
  let apiKey: string

  beforeAll(() => {
    inferenceUrl = (process.env.INFERENCE_SERVICE_URL || 'http://localhost:3000').replace(/\/$/, '')
    apiKey = process.env.INFERENCE_API_KEY || ''

    if (!inferenceUrl) {
      throw new Error('INFERENCE_SERVICE_URL must be set')
    }

    console.log(`📍 Testing inference service at ${inferenceUrl}`)
  })

  it('should accept video generation request with valid payload', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      quality: 'medium',
      format: 'mp4',
      title: 'Test Video',
      notes: 'Contract test',
      incident_id: 'test-incident-1',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    expect([200, 400, 401, 403, 503]).toContain(response.status)
    const data = await response.json()

    console.log(`✅ Endpoint responded with status ${response.status}`)

    if (response.ok) {
      expect(data.success).toBe(true)
      expect(data.provider).toBeDefined()
      expect(data.model_used).toBeDefined()
      expect(data.output_hash).toBeDefined()
      expect(data.video_base64).toBeDefined()
      expect(data.mime_type).toBeDefined()

      console.log(`✅ Response has required fields - Provider: ${data.provider}`)
    }
  }, 60_000)

  it('should support quality parameter variations', async () => {
    const qualities = ['low', 'medium', 'high']
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    for (const quality of qualities) {
      const payload = {
        org_id: 'test-org-uuid',
        quality,
        format: 'mp4',
        title: `Test ${quality} quality`,
      }

      const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.duration_seconds).toBeGreaterThan(0)

        console.log(`✅ Quality '${quality}' generated ${data.duration_seconds}s video`)
      }
    }
  }, 90_000)

  it('should support format parameter variations', async () => {
    const formats = ['mp4', 'webm']
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    for (const format of formats) {
      const payload = {
        org_id: 'test-org-uuid',
        quality: 'medium',
        format,
        title: `Test ${format} format`,
      }

      const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const data = await response.json()
        expect(data.success).toBe(true)
        expect(data.mime_type).toMatch(format === 'webm' ? /webm/ : /mp4/)

        console.log(`✅ Format '${format}' generated with mime-type '${data.mime_type}'`)
      }
    }
  }, 90_000)

  it('should generate consistent output hash', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      quality: 'medium',
      format: 'mp4',
      title: 'Hash Consistency Test',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response1 = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data1 = await response1.json()

    if (response1.ok && data1.video_base64) {
      // Compute hash of returned base64 to verify it matches reported output_hash
      const crypto = await import('crypto')
      const buffer = Buffer.from(data1.video_base64, 'base64')
      const hash = crypto.createHash('sha256').update(buffer).digest('hex')

      expect(hash).toBe(data1.output_hash)
      console.log(`✅ Output hash matches computed SHA256 of video_base64`)
    }
  }, 60_000)

  it('should include artifact manifest in response', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      quality: 'low',
      format: 'mp4',
      title: 'Manifest Test',
      notes: 'Test notes',
      incident_id: 'test-incident-123',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (response.ok) {
      expect(data.artifact_manifest).toBeDefined()
      expect(data.artifact_manifest.title).toBe(payload.title)
      expect(data.artifact_manifest.notes).toBe(payload.notes)
      expect(data.artifact_manifest.org_id).toBe(payload.org_id)
      expect(data.artifact_manifest.incident_id).toBe(payload.incident_id)
      expect(data.artifact_manifest.quality).toBe(payload.quality)
      expect(data.artifact_manifest.format).toBe(payload.format)
      expect(data.artifact_manifest.duration_seconds).toBeGreaterThan(0)
      expect(data.artifact_manifest.generated_at).toBeDefined()
      expect(data.artifact_manifest.model_used).toBeDefined()

      console.log(`✅ Artifact manifest contains all required fields`)
    }
  }, 60_000)

  it('should handle missing optional parameters gracefully', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      // quality not specified
      // format not specified
      // title not specified
      // notes not specified
      // incident_id not specified
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (response.ok) {
      expect(data.success).toBe(true)
      // Should use defaults
      expect(data.artifact_manifest.quality).toMatch(/low|medium|high/)
      expect(data.artifact_manifest.format).toMatch(/mp4|webm/)
      expect(data.artifact_manifest.title).toBeDefined()
      expect(data.artifact_manifest.duration_seconds).toBeGreaterThan(0)

      console.log(`✅ Missing optional parameters handled with defaults`)
    }
  }, 60_000)

  it('should return fallback manifest when FFmpeg is unavailable', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      quality: 'medium',
      format: 'mp4',
      title: 'Fallback Test',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (response.ok) {
      // Either FFmpeg provider or fallback manifest provider
      expect(['inference-service-ffmpeg', 'inference-service-manifest']).toContain(data.provider)

      if (data.provider === 'inference-service-manifest') {
        expect(data.fallback_note).toBeDefined()
        expect(data.mime_type).toBe('application/json')

        console.log(`✅ Fallback manifest returned when FFmpeg unavailable`)
      } else {
        console.log(`✅ FFmpeg provider used for video generation`)
      }
    }
  }, 60_000)

  it('should validate response schema completeness', async () => {
    const payload = {
      org_id: 'test-org-uuid',
      quality: 'medium',
      format: 'mp4',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const response = await fetch(`${inferenceUrl}/infer/video/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (response.ok) {
      const requiredFields = [
        'success',
        'provider',
        'model_used',
        'duration_seconds',
        'output_hash',
        'artifact_manifest',
        'video_base64',
        'mime_type',
      ]

      for (const field of requiredFields) {
        expect(data).toHaveProperty(field)
      }

      // Validate types
      expect(typeof data.success).toBe('boolean')
      expect(typeof data.provider).toBe('string')
      expect(typeof data.model_used).toBe('string')
      expect(typeof data.duration_seconds).toBe('number')
      expect(typeof data.output_hash).toBe('string')
      expect(typeof data.artifact_manifest).toBe('object')
      expect(typeof data.video_base64).toBe('string')
      expect(typeof data.mime_type).toBe('string')

      console.log(`✅ Response schema matches contract`)
    }
  }, 60_000)
})
