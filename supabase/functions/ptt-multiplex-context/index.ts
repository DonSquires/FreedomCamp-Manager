import { withCors, jsonResponse, errorResponse } from '../_shared/withCors.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

type MultiplexRequest = {
  provider_org_id?: string
  client_org_id?: string | null
  branch_id?: string | null
}

Deno.serve(withCors(async (req: Request) => {
  const authResult = await requireAuth(req)
  if (!authResult.user) {
    return errorResponse(authResult.error ?? 'Unauthorized', req, 401)
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', req, 405)
  }

  const proxyServerUrl = String(Deno.env.get('PROXY_SERVER_URL') || '').trim().replace(/\/$/, '')
  const proxySecret = String(Deno.env.get('PROXY_SECRET') || '').trim()

  if (!proxyServerUrl || !proxySecret) {
    return jsonResponse({
      success: true,
      stream: 'tactical',
      tactical_channel: null,
      diplomatic_channel: null,
      handshake_active: false,
      reason: 'proxy_not_configured',
    }, req)
  }

  const body = await req.json().catch(() => ({})) as MultiplexRequest
  const providerOrgId = String(body.provider_org_id || '').trim()

  if (!providerOrgId) {
    return errorResponse('provider_org_id is required', req, 400)
  }

  try {
    const response = await fetch(`${proxyServerUrl}/api/ptt/multiplex-context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-secret': proxySecret,
      },
      body: JSON.stringify({
        provider_org_id: providerOrgId,
        client_org_id: body.client_org_id || null,
        branch_id: body.branch_id || null,
      }),
    })

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>

    if (!response.ok) {
      return errorResponse(
        String(payload?.message || payload?.error || `Proxy error ${response.status}`),
        req,
        response.status,
        payload,
      )
    }

    return jsonResponse(payload, req)
  } catch (err: any) {
    return errorResponse(err?.message || 'Failed to resolve multiplex context', req, 502)
  }
}))
