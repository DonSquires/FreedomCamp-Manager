import http from 'node:http'

const port = Number(process.env.MOCK_RUNPOD_PORT || 8085)
let lastReceivedScaleConfig = null

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'POST' && url.pathname === '/graphql') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString('utf8')
    })
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      const query = String(parsed.query || '')
      const variables = parsed.variables || {}

      if (query.includes('SaveTemplate') || query.includes('minWorkers')) {
        lastReceivedScaleConfig = variables.input || variables
        sendJson(res, 200, {
          data: {
            saveServerlessTemplate: {
              id: variables.templateId || 'tpl-ironeagle-v2',
              minWorkers: variables.minWorkers || 5,
              maxWorkers: 20,
            },
          },
        })
        return
      }

      if (query.includes('GPU_Workers') || query.includes('myself')) {
        sendJson(res, 200, {
          data: {
            myself: {
              serverlessEndpoints: [
                {
                  id: 'endpoint-ironeagle-compliance',
                  workerCount: 2,
                  status: 'ACTIVE',
                },
              ],
            },
          },
        })
        return
      }

      sendJson(res, 400, { errors: [{ message: 'Unrecognized operational testing schema query' }] })
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/test/verify-scaling-assert') {
    if (lastReceivedScaleConfig) {
      sendJson(res, 200, { passed: true, data: lastReceivedScaleConfig })
    } else {
      sendJson(res, 404, { passed: false, error: 'Bob never executed scale mutations during stress simulation' })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

server.listen(port, () => {
  console.log(`RunPod GraphQL mock listening on port ${port}`)
})