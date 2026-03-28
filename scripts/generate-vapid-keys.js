#!/usr/bin/env node
/**
 * Generate a VAPID key pair for Web Push notifications.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.js
 *
 * Copy the output into:
 *   .env              → VITE_VAPID_PUBLIC_KEY=<public key>
 *   Supabase secrets  → VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT
 *
 * NEVER commit the private key to source control.
 */

const { webcrypto } = require('crypto')
const { subtle } = webcrypto

async function main() {
  const { privateKey, publicKey } = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )

  const pubRaw  = new Uint8Array(await subtle.exportKey('raw', publicKey))
  const privJwk = await subtle.exportKey('jwk', privateKey)

  const b64url = (buf) =>
    Buffer.from(buf)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

  const publicKeyB64u  = b64url(pubRaw)
  const privateKeyB64u = b64url(Buffer.from(privJwk.d, 'base64'))

  console.log('=== VAPID Key Pair ===')
  console.log('')
  console.log('Add to .env (safe to commit):')
  console.log(`  VITE_VAPID_PUBLIC_KEY=${publicKeyB64u}`)
  console.log('')
  console.log('Add to Supabase Edge Function Secrets (NEVER commit):')
  console.log(`  VAPID_PUBLIC_KEY=${publicKeyB64u}`)
  console.log(`  VAPID_PRIVATE_KEY=${privateKeyB64u}`)
  console.log(`  VAPID_SUBJECT=mailto:admin@fcmanager.co.nz`)
  console.log('')
  console.log('Key length checks:')
  console.log(`  Public key bytes : ${pubRaw.length} (expected 65)`)
}

main().catch(console.error)
