import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { captureVoiceprintSignature, compareVoiceprintSignatures } from '@/lib/voiceprintAssist'
import { useBobAssistantStore, type EmergencyCancelVerificationMode } from '@/stores/bobAssistantStore'
import { supabase } from '@/lib/supabase'

export type { EmergencyCancelVerificationMode } from '@/stores/bobAssistantStore'

export function useBobIdentitySettings(userId?: string | null, organizationId?: string | null) {
  const secureCancelVerificationEnabled = useBobAssistantStore((state) => state.secureCancelVerificationEnabled)
  const setSecureCancelVerificationEnabled = useBobAssistantStore((state) => state.setSecureCancelVerificationEnabled)
  const cancelVerificationMode = useBobAssistantStore((state) => state.cancelVerificationMode)
  const setCancelVerificationMode = useBobAssistantStore((state) => state.setCancelVerificationMode)
  const [cancelVerificationInProgress, setCancelVerificationInProgress] = useState(false)
  const [orgPolicyMutationInProgress, setOrgPolicyMutationInProgress] = useState(false)
  const [orgPolicyLoading, setOrgPolicyLoading] = useState(false)
  const [orgVoiceprintEnrollmentAllowed, setOrgVoiceprintEnrollmentAllowed] = useState(true)
  const [enrolledVoiceprint, setEnrolledVoiceprint] = useState<number[] | null>(null)
  const [lastVoiceprintScore, setLastVoiceprintScore] = useState<number | null>(null)

  const voiceprintStorageKey = useMemo(
    () => (userId ? `bob-emergency-voiceprint:${userId}` : null),
    [userId],
  )

  useEffect(() => {
    if (!organizationId) {
      setOrgVoiceprintEnrollmentAllowed(true)
      return
    }

    let cancelled = false
    const loadOrgPolicy = async () => {
      setOrgPolicyLoading(true)
      try {
        const { data, error } = await (supabase.from('organizations') as any)
          .select('bob_voiceprint_enrollment_allowed')
          .eq('id', organizationId)
          .single()

        if (cancelled) return
        if (error) {
          setOrgVoiceprintEnrollmentAllowed(true)
          return
        }

        const allowed = data?.bob_voiceprint_enrollment_allowed
        setOrgVoiceprintEnrollmentAllowed(typeof allowed === 'boolean' ? allowed : true)
      } catch {
        if (!cancelled) setOrgVoiceprintEnrollmentAllowed(true)
      } finally {
        if (!cancelled) setOrgPolicyLoading(false)
      }
    }

    void loadOrgPolicy()

    return () => {
      cancelled = true
    }
  }, [organizationId])


  useEffect(() => {
    if (!voiceprintStorageKey || typeof window === 'undefined') {
      setEnrolledVoiceprint(null)
      return
    }

    try {
      const raw = window.localStorage.getItem(voiceprintStorageKey)
      if (!raw) {
        setEnrolledVoiceprint(null)
        return
      }
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'number')) {
        setEnrolledVoiceprint(parsed as number[])
      } else {
        setEnrolledVoiceprint(null)
      }
    } catch {
      setEnrolledVoiceprint(null)
    }
  }, [voiceprintStorageKey])

  useEffect(() => {
    if (orgVoiceprintEnrollmentAllowed) return
    if (cancelVerificationMode === 'voiceprint') {
      setCancelVerificationMode('platform_biometric')
    }
    if (voiceprintStorageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(voiceprintStorageKey)
    }
    setEnrolledVoiceprint(null)
    setLastVoiceprintScore(null)
  }, [cancelVerificationMode, orgVoiceprintEnrollmentAllowed, setCancelVerificationMode, voiceprintStorageKey])

  const setCancelVerificationModeWithPolicy = useCallback((mode: EmergencyCancelVerificationMode) => {
    if (mode === 'voiceprint' && !orgVoiceprintEnrollmentAllowed) {
      toast.error('Voiceprint verification is disabled by your organization policy')
      setCancelVerificationMode('platform_biometric')
      return
    }
    setCancelVerificationMode(mode)
  }, [orgVoiceprintEnrollmentAllowed, setCancelVerificationMode])

  const enrollCurrentVoiceprint = useCallback(async () => {
    if (!orgVoiceprintEnrollmentAllowed) {
      toast.error('Voiceprint enrollment is disabled by your organization policy')
      return
    }

    if (!voiceprintStorageKey || typeof window === 'undefined') {
      toast.error('Sign in first to enroll a voiceprint')
      return
    }

    setCancelVerificationInProgress(true)
    try {
      toast.message('Speak naturally for two seconds to enroll emergency cancel voiceprint')
      const signature = await captureVoiceprintSignature({ sampleDurationMs: 2000, bucketCount: 64 })
      window.localStorage.setItem(voiceprintStorageKey, JSON.stringify(signature))
      setEnrolledVoiceprint(signature)
      setLastVoiceprintScore(null)
      toast.success('Voiceprint enrolled for emergency cancel verification')
    } catch (error: any) {
      toast.error(error?.message || 'Voiceprint enrollment failed')
    } finally {
      setCancelVerificationInProgress(false)
    }
  }, [orgVoiceprintEnrollmentAllowed, voiceprintStorageKey])

  const clearEnrolledVoiceprint = useCallback(() => {
    if (!voiceprintStorageKey || typeof window === 'undefined') return
    window.localStorage.removeItem(voiceprintStorageKey)
    setEnrolledVoiceprint(null)
    setLastVoiceprintScore(null)
    toast.message('Voiceprint enrollment removed')
  }, [voiceprintStorageKey])

  const verifyPlatformBiometricCancel = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.credentials || typeof PublicKeyCredential === 'undefined') {
      toast.error('Platform biometric verification is not available on this device')
      return false
    }

    setCancelVerificationInProgress(true)
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 12000,
          userVerification: 'required',
          rpId: window.location.hostname,
        },
      })
      return true
    } catch {
      toast.error('Biometric verification failed or was cancelled. Emergency countdown continues.')
      return false
    } finally {
      setCancelVerificationInProgress(false)
    }
  }, [])

  const verifyVoiceprintCancel = useCallback(async (): Promise<boolean> => {
    if (!enrolledVoiceprint?.length) {
      toast.error('No voiceprint enrolled. Enroll first or use platform biometric verification.')
      return false
    }

    setCancelVerificationInProgress(true)
    try {
      toast.message('Speak for two seconds to verify emergency cancel identity')
      const sample = await captureVoiceprintSignature({ sampleDurationMs: 2000, bucketCount: 64 })
      const score = compareVoiceprintSignatures(enrolledVoiceprint, sample)
      setLastVoiceprintScore(score)
      return score >= 0.84
    } catch {
      toast.error('Voiceprint verification failed. Emergency countdown continues.')
      return false
    } finally {
      setCancelVerificationInProgress(false)
    }
  }, [enrolledVoiceprint])

  const updateOrgVoiceprintEnrollmentAllowed = useCallback(async (allowed: boolean): Promise<boolean> => {
    if (!organizationId) {
      toast.error('No organization context found for policy update')
      return false
    }

    setOrgPolicyMutationInProgress(true)
    try {
      const { error } = await (supabase.from('organizations') as any)
        .update({ bob_voiceprint_enrollment_allowed: allowed })
        .eq('id', organizationId)

      if (error) throw error

      setOrgVoiceprintEnrollmentAllowed(allowed)
      if (!allowed) {
        setCancelVerificationMode('platform_biometric')
      }
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update organization voiceprint policy')
      return false
    } finally {
      setOrgPolicyMutationInProgress(false)
    }
  }, [organizationId, setCancelVerificationMode])

  return {
    secureCancelVerificationEnabled,
    setSecureCancelVerificationEnabled,
    cancelVerificationMode,
    setCancelVerificationMode: setCancelVerificationModeWithPolicy,
    cancelVerificationInProgress,
    orgPolicyLoading,
    orgPolicyMutationInProgress,
    orgVoiceprintEnrollmentAllowed,
    updateOrgVoiceprintEnrollmentAllowed,
    enrolledVoiceprint,
    lastVoiceprintScore,
    enrollCurrentVoiceprint,
    clearEnrolledVoiceprint,
    verifyPlatformBiometricCancel,
    verifyVoiceprintCancel,
  }
}