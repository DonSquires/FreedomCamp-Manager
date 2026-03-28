#!/usr/bin/env node

const { generateKeyPairSync } = require('node:crypto')

function b64urlToBuffer(input) {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=')
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' },
  })

  if (!publicKey.x || !publicKey.y || !privateKey.d) {
    throw new Error('Failed to generate VAPID key material')
  }

  const x = b64urlToBuffer(publicKey.x)
  const y = b64urlToBuffer(publicKey.y)
  const d = b64urlToBuffer(privateKey.d)

  const uncompressedPublicKey = Buffer.concat([Buffer.from([0x04]), x, y])

  return {
    publicKey: toBase64Url(uncompressedPublicKey),
    privateKey: toBase64Url(d),
  }
}

const { publicKey, privateKey } = generateVapidKeys()

console.log('VITE_VAPID_PUBLIC_KEY=' + publicKey)
console.log('VAPID_PUBLIC_KEY=' + publicKey)
console.log('VAPID_PRIVATE_KEY=' + privateKey)
console.log('VAPID_SUBJECT=mailto:security@yourdomain.com')
