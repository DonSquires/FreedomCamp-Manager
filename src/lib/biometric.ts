/**
 * Utility Library: biometric
 * Biometric authentication (fingerprint, face ID) - Future enhancement
 */

interface BiometricCapabilities {
  available: boolean
  types: ('fingerprint' | 'face' | 'iris' | 'voice')[]
  platform: 'web' | 'android' | 'ios' | 'unknown'
}

interface BiometricAuthResult {
  success: boolean
  error?: string
  biometricType?: string
}

/**
 * Check if biometric authentication is available
 */
export async function isBiometricAvailable(): Promise<BiometricCapabilities> {
  const capabilities: BiometricCapabilities = {
    available: false,
    types: [],
    platform: 'unknown',
  }

  // Check Web Authentication API (WebAuthn)
  if (window.PublicKeyCredential) {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      
      if (available) {
        capabilities.available = true
        capabilities.platform = 'web'
        
        // Detect platform
        if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
          capabilities.platform = 'ios'
          capabilities.types.push('face') // Face ID
        } else if (/Android/.test(navigator.userAgent)) {
          capabilities.platform = 'android'
          capabilities.types.push('fingerprint')
        } else {
          capabilities.types.push('fingerprint')
        }
      }
    } catch (error) {
      console.error('Error checking biometric availability:', error)
    }
  }

  return capabilities
}

/**
 * Register biometric credential
 */
export async function registerBiometric(
  userId: string,
  userName: string
): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    if (!window.PublicKeyCredential) {
      return { success: false, error: 'Biometric authentication not supported' }
    }

    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)

    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'FieldOps Manager',
        id: window.location.hostname,
      },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
      attestation: 'none',
    }

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    }) as PublicKeyCredential

    if (!credential) {
      return { success: false, error: 'Failed to create credential' }
    }

    // Store credential ID for future authentication
    const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))

    return { success: true, credentialId }
  } catch (error: any) {
    console.error('Biometric registration failed:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Authenticate with biometric
 */
export async function authenticateBiometric(
  credentialId?: string
): Promise<BiometricAuthResult> {
  try {
    if (!window.PublicKeyCredential) {
      return { success: false, error: 'Biometric authentication not supported' }
    }

    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)

    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      rpId: window.location.hostname,
    }

    // If credential ID provided, only allow that credential
    if (credentialId) {
      publicKeyCredentialRequestOptions.allowCredentials = [
        {
          id: Uint8Array.from(atob(credentialId), c => c.charCodeAt(0)),
          type: 'public-key',
        },
      ]
    }

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    }) as PublicKeyCredential

    if (!assertion) {
      return { success: false, error: 'Authentication failed' }
    }

    return { success: true, biometricType: 'platform' }
  } catch (error: any) {
    console.error('Biometric authentication failed:', error)
    
    // Handle specific errors
    if (error.name === 'NotAllowedError') {
      return { success: false, error: 'Authentication cancelled' }
    } else if (error.name === 'InvalidStateError') {
      return { success: false, error: 'Device locked or biometric not available' }
    }
    
    return { success: false, error: error.message }
  }
}

/**
 * Remove biometric credential
 */
export async function removeBiometric(): Promise<boolean> {
  // Note: WebAuthn API doesn't provide direct credential deletion
  // Credential management is typically done server-side
  // This is a placeholder for future implementation
  console.warn('Biometric credential removal must be done server-side')
  return true
}

/**
 * Check if user has registered biometric
 */
export function hasBiometricRegistered(): boolean {
  // Check if credential ID is stored locally
  return localStorage.getItem('biometric_credential_id') !== null
}

/**
 * Store biometric credential ID locally
 */
export function storeBiometricCredentialId(credentialId: string): void {
  localStorage.setItem('biometric_credential_id', credentialId)
}

/**
 * Get stored biometric credential ID
 */
export function getBiometricCredentialId(): string | null {
  return localStorage.getItem('biometric_credential_id')
}

/**
 * Clear stored biometric credential ID
 */
export function clearBiometricCredentialId(): void {
  localStorage.removeItem('biometric_credential_id')
}

/**
 * Simple biometric prompt (UI helper)
 */
export async function promptBiometricAuth(): Promise<BiometricAuthResult> {
  const credentialId = getBiometricCredentialId()
  
  if (!credentialId) {
    return { success: false, error: 'No biometric registered' }
  }

  return authenticateBiometric(credentialId)
}

/**
 * Setup biometric for first time
 */
export async function setupBiometric(
  userId: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  const capabilities = await isBiometricAvailable()
  
  if (!capabilities.available) {
    return { success: false, error: 'Biometric authentication not available on this device' }
  }

  const result = await registerBiometric(userId, userName)
  
  if (result.success && result.credentialId) {
    storeBiometricCredentialId(result.credentialId)
    return { success: true }
  }

  return { success: false, error: result.error }
}

/**
 * Disable biometric authentication
 */
export async function disableBiometric(): Promise<void> {
  clearBiometricCredentialId()
  // Note: Server-side credential deletion would happen here
}

/**
 * Get platform-specific biometric name
 */
export function getBiometricName(): string {
  const userAgent = navigator.userAgent

  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'Face ID / Touch ID'
  } else if (/Android/.test(userAgent)) {
    return 'Fingerprint'
  }

  return 'Biometric Authentication'
}

/**
 * Check if running in secure context (required for WebAuthn)
 */
export function isSecureContext(): boolean {
  return window.isSecureContext
}

/**
 * Fallback: Simple PIN-based biometric simulation (for testing/demo)
 */
export async function simulateBiometricWithPIN(pin: string): Promise<BiometricAuthResult> {
  // This is a simple fallback for devices without biometric support
  // In production, this should be replaced with proper PIN storage and validation
  
  const storedPIN = localStorage.getItem('biometric_pin')
  
  if (!storedPIN) {
    return { success: false, error: 'No PIN set up' }
  }

  if (pin === storedPIN) {
    return { success: true, biometricType: 'pin' }
  }

  return { success: false, error: 'Incorrect PIN' }
}

/**
 * Setup PIN as biometric fallback
 */
export function setupBiometricPIN(pin: string): void {
  localStorage.setItem('biometric_pin', pin)
}

/**
 * Clear biometric PIN
 */
export function clearBiometricPIN(): void {
  localStorage.removeItem('biometric_pin')
}
