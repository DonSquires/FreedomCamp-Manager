/**
 * Shared JWT authentication helper for Supabase Edge Functions.
 *
 * Usage:
 *   import { requireAuth } from '../_shared/requireAuth.ts';
 *   import { errorResponse } from '../_shared/withCors.ts';
 *
 *   const authResult = await requireAuth(req);
 *   if (!authResult.user) return errorResponse(authResult.error!, req, 401);
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3';

export interface AuthResult {
  user: { id: string; email?: string | null; role?: string } | null;
  error?: string;
}

/**
 * Validates the `Authorization: Bearer <token>` header against Supabase Auth.
 * Returns the authenticated user on success, or an error message on failure.
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader) {
    return { user: null, error: 'Missing authorization header' };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) {
    return { user: null, error: 'Malformed authorization header (expected Bearer <token>)' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    req.headers.get('apikey') ??
    '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return { user: null, error: 'Unauthorized' };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: 'Unauthorized' };
  }

  return { user: { id: user.id, email: user.email, role: (user as any).role } };
}
