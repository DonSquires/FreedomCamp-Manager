import { spawn } from 'node:child_process'

const port = Number(process.env.MOCK_ELEVENLABS_PORT || 8089)

function waitForServer(url, timeoutMs = 10_000) {
  const start = Date.now()

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url)
        if (response.ok) {
          resolve(true)
          return
        }
      } catch {
        // keep waiting until timeout
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }

      setTimeout(tick, 250)
    }

    tick()
  })
}

async function main() {
  const mock = spawn('node', ['scripts/mock-elevenlabs.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MOCK_ELEVENLABS_PORT: String(port),
    },
  })

  try {
    await waitForServer(`http://127.0.0.1:${port}/test/verify-voice-history`)

    const response = await fetch(`http://127.0.0.1:${port}/v1/text-to-speech/test-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Missed patrol at Richmond Mall perimeter. Supervisor action required.',
        model_id: 'eleven_multilingual_v2',
      }),
    })

    if (!response.ok) {
      throw new Error(`Mock ElevenLabs returned HTTP ${response.status}`)
    }

    const historyResponse = await fetch(`http://127.0.0.1:${port}/test/verify-voice-history`)
    const history = await historyResponse.json()

    if (!history.totalRequestsReceived) {
      throw new Error('Voice history did not record any synthesis requests')
    }

    const payload = history.history?.[0]
    if (!payload?.text || !/missed patrol/i.test(payload.text)) {
      throw new Error('Recorded voice payload did not include the expected escalation text')
    }

    console.log('PASS Voice escalation mock captured the expected payload')
  } finally {
    mock.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(`FAIL ${error?.message || String(error)}`)
  process.exit(1)
})