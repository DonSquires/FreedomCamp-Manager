/**
 * CAPTCHA Verification Helper for Supabase Edge Functions
 * 
 * Supports Cloudflare Turnstile for privacy-focused CAPTCHA verification.
 * Cloudflare Turnstile is free, privacy-preserving, and doesn't require user interaction.
 * 
 * Usage:
 * ```typescript
 * import { verifyCaptcha } from '../_shared/captcha.ts'
 * 
 * const captchaResult = await verifyCaptcha(captchaToken, clientIP)
 * if (!captchaResult.success) {
 *   return errorResponse('CAPTCHA verification failed', req, 400)
 * }
 * ```
 */

interface TurnstileResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  action?: string;
  cdata?: string;
}

interface CaptchaResult {
  success: boolean;
  error?: string;
  details?: TurnstileResponse;
}

/**
 * Verify a Cloudflare Turnstile CAPTCHA token
 * 
 * @param token - The CAPTCHA response token from the client
 * @param remoteIP - Optional client IP address for additional verification
 * @returns Promise<CaptchaResult> - Verification result
 */
export async function verifyCaptcha(
  token: string | null | undefined,
  remoteIP?: string | null
): Promise<CaptchaResult> {
  const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY');
  
  // If no secret key is configured, bypass CAPTCHA (for development)
  if (!secretKey) {
    const isDev = Deno.env.get('ENVIRONMENT') !== 'production' && Deno.env.get('ENVIRONMENT') !== 'prod';
    if (isDev) {
      console.warn('⚠️ CAPTCHA bypassed: TURNSTILE_SECRET_KEY not configured (dev mode)');
      return { success: true };
    }
    // In production, missing secret key is an error
    console.error('❌ CAPTCHA config error: TURNSTILE_SECRET_KEY not set in production');
    return { success: false, error: 'CAPTCHA not configured' };
  }
  
  // Token is required when CAPTCHA is configured
  if (!token) {
    return { success: false, error: 'CAPTCHA token required' };
  }
  
  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteIP) {
      formData.append('remoteip', remoteIP);
    }
    
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body: formData,
      }
    );
    
    if (!response.ok) {
      console.error('CAPTCHA API error:', response.status, response.statusText);
      return { success: false, error: 'CAPTCHA verification service unavailable' };
    }
    
    const result: TurnstileResponse = await response.json();
    
    if (result.success) {
      return { success: true, details: result };
    }
    
    // Log verification failures for monitoring
    console.warn('CAPTCHA verification failed:', {
      errorCodes: result['error-codes'],
      hostname: result.hostname,
    });
    
    return {
      success: false,
      error: 'CAPTCHA verification failed',
      details: result,
    };
  } catch (err) {
    console.error('CAPTCHA verification exception:', err);
    return { success: false, error: 'CAPTCHA verification error' };
  }
}

/**
 * Get client IP from request headers
 * Handles common proxy headers (CF-Connecting-IP, X-Forwarded-For, etc.)
 */
export function getClientIP(req: Request): string | null {
  // Cloudflare
  const cfIP = req.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;
  
  // Standard proxy header
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs; first is the client
    return forwarded.split(',')[0].trim();
  }
  
  // Real IP header (nginx)
  const realIP = req.headers.get('x-real-ip');
  if (realIP) return realIP;
  
  return null;
}
