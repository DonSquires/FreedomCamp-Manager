import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.TEST_INFERENCE_PORT || 3901)
const BASE_URL = `http://127.0.0.1:${PORT}`

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`)
  const body = await response.json()
  return { status: response.status, body }
}

async function waitForHealth(timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await fetchJson('/health')
      if (status === 200) return
    } catch {
      // service not up yet
    }
    await wait(1000)
  }
  throw new Error('Timed out waiting for inference-service /health')
}

const child = spawn('node', ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'test',
    BOB_OPERATING_MODE: 'self-contained',
    SELF_CONTAINED_MODE: 'true',
    REQUIRE_SELF_CONTAINED_MODE: 'true',
    OPENAI_API_KEY: 'dummy-openai-key',
    PLATERECOGNIZER_TOKEN: 'dummy-plate-key',
    TABULAR_NLP_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'https://remote-ollama.example.com',
    SUPABASE_URL: '',
    SUPABASE_JWKS_URL: '',
    SUPABASE_JWT_ISSUER: '',
    SUPABASE_JWT_AUDIENCE: '',
    INFERENCE_API_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString()
})

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

try {
  await waitForHealth()
  const health = await fetchJson('/health')

  assert.equal(health.status, 200, 'health endpoint should return 200')
  assert.equal(health.body?.config?.SELF_CONTAINED_MODE, true, 'SELF_CONTAINED_MODE should be true')
  assert.equal(health.body?.config?.OPENAI_API_KEY_SET, false, 'OpenAI should be effectively disabled in self-contained mode')
  assert.equal(health.body?.capabilities?.cloud_alpr_enabled, false, 'Cloud ALPR should be disabled in self-contained mode')
  assert.equal(health.body?.capabilities?.tabular_nlp_ollama_enabled, false, 'Remote Ollama should be disabled in self-contained mode')

  console.log('SELF_CONTAINED_MODE behavior test passed')
} catch (error) {
  console.error('SELF_CONTAINED_MODE behavior test failed')
  console.error(String(error))
  console.error('--- stdout ---')
  console.error(stdout)
  console.error('--- stderr ---')
  console.error(stderr)
  process.exitCode = 1
} finally {
  child.kill('SIGTERM')
}
