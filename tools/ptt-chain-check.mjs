import fs from 'node:fs'
import dotenv from 'dotenv'

function loadEnv(path) {
  if (!fs.existsSync(path)) return {}
  return dotenv.parse(fs.readFileSync(path))
}

const env = {
  ...loadEnv('.env'),
  ...loadEnv('.env.local'),
  ...loadEnv('.env.playwright.local'),
  ...loadEnv('.runtime/bob.env'),
}

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
const EMAIL = env.PLAYWRIGHT_OFFICER_EMAIL || env.PLAYWRIGHT_ADMIN_EMAIL || env.API_TEST_EMAIL
const PASSWORD = env.PLAYWRIGHT_OFFICER_PASSWORD || env.PLAYWRIGHT_ADMIN_PASSWORD || env.API_TEST_PASSWORD

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('PTT_CHAIN=fail missing env')
  process.exit(1)
}

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))

async function main() {
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!authRes.ok) throw new Error(`auth ${authRes.status}`)
  const auth = await authRes.json()

  const accessToken = auth.access_token
  const userId = auth.user?.id

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=organization_id&id=eq.${userId}&limit=1`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) throw new Error(`profile ${profileRes.status}`)
  const profile = await profileRes.json()
  const orgId = profile?.[0]?.organization_id
  if (!orgId) throw new Error('organization_id missing')

  const tokenRes = await fetch(`${SUPABASE_URL}/functions/v1/ptt-signaling-token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ channelScope: `org:${orgId}` }),
  })
  if (!tokenRes.ok) throw new Error(`ptt-signaling-token ${tokenRes.status}: ${await tokenRes.text()}`)
  const tokenData = await tokenRes.json()

  if (!tokenData?.token || !tokenData?.wsUrl) {
    throw new Error('token payload missing token/wsUrl')
  }

  const wsUrl = String(tokenData.wsUrl)
  const socket = new WebSocket(wsUrl, ['ptt.v2', `auth.${tokenData.token}`])

  let sawServerHello = false
  let sawHelloAck = false
  let sawPong = false

  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'hello' }))
        socket.send(JSON.stringify({ type: 'ping' }))
      })

      socket.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data))
        if (msg.type === 'server_hello') sawServerHello = true
        if (msg.type === 'hello_ack') sawHelloAck = true
        if (msg.type === 'pong') sawPong = true

        if (sawServerHello && sawHelloAck && sawPong) {
          socket.close(1000, 'done')
          resolve(true)
        }
      })

      socket.addEventListener('error', () => {
        reject(new Error('websocket error'))
      })

      socket.addEventListener('close', (event) => {
        if (!(sawServerHello && sawHelloAck && sawPong) && event.code !== 1000) {
          reject(new Error(`websocket close ${event.code} ${event.reason || ''}`.trim()))
        }
      })
    }),
    timeout(15000),
  ])

  console.log('PTT_CHAIN=pass')
}

main().catch((err) => {
  console.error(`PTT_CHAIN=fail ${String(err?.message || err)}`)
  process.exit(1)
})
