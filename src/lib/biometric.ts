/**
 * Biometric Authentication using Web Authentication API (WebAuthn)
 * Supports fingerprint, Face ID, Windows Hello, etc.
 */

export interface BiometricCredential {
  id: string;
  publicKey: string;
  email: string;
  userName: string;
  createdAt: string;
}

const STORAGE_KEY = 'biometric_credentials';

/**
 * Check if biometric authentication is available in the browser
 */
export function isBiometricAvailable(): boolean {
  return (
    window.PublicKeyCredential !== undefined &&
    navigator.credentials !== undefined &&
    typeof navigator.credentials.create === 'function'
  );
}

/**
 * Convert ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate a random challenge for authentication
 */
function generateChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Register biometric credential for a user
 */
export async function registerBiometric(
  email: string,
  userName: string
): Promise<BiometricCredential | null> {
  if (!isBiometricAvailable()) {
    throw new Error('Biometric authentication is not available in this browser');
  }

  try {
    const challenge = generateChallenge();

    // Create credential options
    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: 'FreedomCamp Manager',
        id: window.location.hostname,
      },
      user: {
        id: new TextEncoder().encode(email),
        name: email,
        displayName: userName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Prefer platform authenticators (Touch ID, Face ID, Windows Hello)
        requireResidentKey: false,
        userVerification: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    };

    // Create the credential
    const credential = (await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    })) as PublicKeyCredential;

    if (!credential) {
      return null;
    }

    // Extract and store credential data
    const response = credential.response as AuthenticatorAttestationResponse;
    const biometricCredential: BiometricCredential = {
      id: credential.id,
      publicKey: arrayBufferToBase64(response.getPublicKey()!),
      email,
      userName,
      createdAt: new Date().toISOString(),
    };

    // Store in localStorage
    const stored = getStoredCredentials();
    stored.push(biometricCredential);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    return biometricCredential;
  } catch (error) {
    console.error('Biometric registration failed:', error);
    return null;
  }
}

/**
 * Authenticate using biometric credential
 */
export async function authenticateBiometric(
  email: string
): Promise<{ success: boolean; credentialId?: string }> {
  if (!isBiometricAvailable()) {
    throw new Error('Biometric authentication is not available');
  }

  const credentials = getStoredCredentials();
  const userCredential = credentials.find((c) => c.email === email);

  if (!userCredential) {
    throw new Error('No biometric credential found for this user');
  }

  try {
    const challenge = generateChallenge();

    // Create authentication options
    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      allowCredentials: [
        {
          id: base64ToArrayBuffer(userCredential.id),
          type: 'public-key',
        },
      ],
      timeout: 60000,
      userVerification: 'preferred',
    };

    // Request authentication
    const assertion = (await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    })) as PublicKeyCredential;

    if (!assertion) {
      return { success: false };
    }

    return {
      success: true,
      credentialId: userCredential.id,
    };
  } catch (error) {
    console.error('Biometric authentication failed:', error);
    return { success: false };
  }
}

/**
 * Get all stored biometric credentials
 */
export function getStoredCredentials(): BiometricCredential[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Get credential for specific email
 */
export function getCredentialForEmail(email: string): BiometricCredential | null {
  const credentials = getStoredCredentials();
  return credentials.find((c) => c.email === email) || null;
}

/**
 * Remove biometric credential
 */
export function removeBiometricCredential(email: string): void {
  const credentials = getStoredCredentials();
  const filtered = credentials.filter((c) => c.email !== email);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Check if user has biometric credential
 */
export function hasBiometricCredential(email: string): boolean {
  return getCredentialForEmail(email) !== null;
}
