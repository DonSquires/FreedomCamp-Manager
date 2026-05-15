import http from 'node:http'

const port = Number(process.env.MOCK_ELEVENLABS_PORT || 8089)
const synthesisHistory = []

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'POST' && /^\/v1\/text-to-speech\/[^/]+$/.test(url.pathname)) {
    const voiceId = url.pathname.split('/').pop()
    let body = ''

    req.on('data', (chunk) => {
      body += chunk.toString('utf8')
    })

    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {}
      const text = typeof payload.text === 'string' ? payload.text : ''
      const modelId = typeof payload.model_id === 'string' ? payload.model_id : 'default'

      console.log(`[Mock ElevenLabs] voice=${voiceId} model=${modelId}`)
      console.log(`[Mock ElevenLabs] text=${text}`)

      synthesisHistory.push({
        voiceId,
        modelId,
        text,
        timestamp: Date.now(),
      })

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Transfer-Encoding': 'chunked',
      })
      res.write(Buffer.from([0x25, 0x4d, 0x50, 0x33, 0x00, 0x00, 0x00, 0x00]))
      res.end()
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/test/verify-voice-history') {
    sendJson(res, 200, {
      totalRequestsReceived: synthesisHistory.length,
      history: synthesisHistory,
    })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(port, () => {
  console.log(`ElevenLabs mock listening on port ${port}`)
})