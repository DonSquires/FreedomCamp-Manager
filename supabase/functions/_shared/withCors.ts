/**
 * Reusable CORS Helper for Supabase Edge Functions (Deno)
 * 
 * Provides consistent CORS handling across all functions with:
 * - Strict origin allowlist (production domains)
 * - Preview subdomain pattern matching (ephemeral Onspace builds)
 * - Dev mode toggle via DEV_CORS env var (allows wildcard *)
 * - Automatic preflight handling
 * - Error response wrapping with CORS headers
 * 
 * Usage:
 * ```typescript
 * import { withCors } from '../_shared/withCors.ts';
 * 
 * serve(withCors(async (req) => {
 *   // Your function logic here
 *   return new Response(JSON.stringify({ success: true }));
 * }));
 * ```
 */

type OriginMatcher = (origin: string | null) => string | null;

// Exact production domains (strict allowlist)
const ALLOWED_ORIGINS_EXACT = new Set<string>([
  'https://freedomcampmanager.onspace.build',  // Hosted app build
  'https://fcmanager.co.nz',                   // Production domain
  'https://www.fcmanager.co.nz',               // Production domain (www)
  'https://onspace.ai',                        // Production domain
  'https://www.onspace.ai',                    // Production domain (www)
  'https://app.onspace.ai',                    // App subdomain
  'https://react-9b4t5o.onspace.build',        // Static build
  'http://localhost:5173',                      // Local dev
  'http://localhost:3000',                      // Local dev (alternate port)
]);

/**
 * Check if origin matches ephemeral preview subdomain pattern
 * Preview builds generate: preview-react-9b4t5o-<random>.onspace.build
 */
function isAllowedPreview(origin: string): boolean {
  try {
    const u = new URL(origin);
    const host = u.host;

    // Allow all hosted preview deployments under the controlled onspace.build domain.
    if (host.endsWith('.onspace.build')) {
      return true;
    }

    // Allow hosted production app variants under onspace.ai.
    if (host === 'onspace.ai' || host.endsWith('.onspace.ai')) {
      return true;
    }

    // Allow Vercel preview/prod deployments for this project.
    if (host.endsWith('.vercel.app')) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// Dev mode: allow wildcard * (set DEV_CORS=true in Supabase env vars)
// SECURITY: DEV_CORS is automatically disabled in production environment
const ENVIRONMENT = Deno.env.get('ENVIRONMENT') || 'development';
const IS_PRODUCTION = ENVIRONMENT === 'production' || ENVIRONMENT === 'prod';
const DEV_CORS = !IS_PRODUCTION && Deno.env.get('DEV_CORS') === 'true';

// Log warning if DEV_CORS is attempted in production (will be ignored)
if (IS_PRODUCTION && Deno.env.get('DEV_CORS') === 'true') {
  console.warn('⚠️ SECURITY: DEV_CORS=true is set but ignored in production environment');
}

const matchOrigin: OriginMatcher = (origin) => {
  if (!origin) return null;
  if (ALLOWED_ORIGINS_EXACT.has(origin)) return origin;
  if (isAllowedPreview(origin)) return origin;
  return null;
};

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  
  // Security headers that should be present on all responses
  const securityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  
  // Dev mode: allow wildcard (simplifies preview debugging)
  if (DEV_CORS) {
    return {
      ...securityHeaders,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
      'Access-Control-Max-Age': '3600',
    };
  }
  
  // Production mode: match exact or preview pattern
  const allowed = matchOrigin(origin);
  const base: Record<string, string> = {
    ...securityHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
    'Access-Control-Max-Age': '3600',
  };
  
  if (allowed) {
    return {
      ...base,
      'Access-Control-Allow-Origin': allowed,
      'Vary': 'Origin',
    };
  }
  
  // Block unknown origins: return base without Access-Control-Allow-Origin
  return base;
}

export function corsHeaders(req: Request): Record<string, string> {
  return getCorsHeaders(req);
}

/**
 * Wraps a handler function with automatic CORS handling
 * 
 * - Handles OPTIONS preflight automatically (always returns 200, not 204)
 * - Adds CORS headers to all responses (success and error)
 * - Catches errors and returns JSON with CORS headers
 */
export function withCors(
  handler: (req: Request) => Promise<Response> | Response
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const headers = getCorsHeaders(req);
    
    // Handle preflight requests (must return 200, not 204)
    if (req.method === 'OPTIONS') {
      return new Response('ok', { status: 200, headers });
    }
    
    try {
      // Call the actual handler (support both sync and async)
      const response = await Promise.resolve(handler(req));
      
      // Merge CORS headers into response
      const responseHeaders = new Headers(response.headers);
      for (const [k, v] of Object.entries(headers)) {
        responseHeaders.set(k, v);
      }
      
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      // Ensure errors also include CORS headers
      const errorId = `ERR-${Date.now()}`;
      console.error('Function error:', { error: String(err?.message ?? err), errorId });
      
      const errorHeaders = new Headers({
        ...headers,
        'Content-Type': 'application/json',
      });
      
      return new Response(
        JSON.stringify({
          error: String(err?.message ?? err),
          errorId,
        }),
        {
          status: 500,
          headers: errorHeaders,
        }
      );
    }
  };
}

/**
 * Helper to create JSON response with CORS headers
 */
export function jsonResponse(
  data: any,
  req: Request,
  status = 200
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...getCorsHeaders(req),
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Helper to create error response with CORS headers and correlation ID
 */
export function errorResponse(
  message: string,
  req: Request,
  status = 500,
  details?: any
): Response {
  const errorId = `ERR-${Date.now()}`;
  console.error('Error response:', { message, status, errorId, details });
  
  return new Response(
    JSON.stringify({
      error: message,
      errorId,
      ...(details ? { details } : {}),
    }),
    {
      status,
      headers: {
        ...getCorsHeaders(req),
        'Content-Type': 'application/json',
      },
    }
  );
}
