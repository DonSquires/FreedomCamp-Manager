/**
 * URL Utilities for Edge Functions
 * 
 * Provides helpers for validating and normalizing service URLs
 * to prevent errors from malformed environment variables.
 */

/**
 * Validates a URL string and returns a normalized version.
 * Handles common misconfigurations like:
 * - Missing protocol (adds https://)
 * - Trailing slashes (removes them)
 * - Whitespace (trims it)
 * - Empty or invalid URLs (returns null)
 * 
 * @param url - The URL string to validate
 * @returns Normalized URL string or null if invalid
 */
export function normalizeServiceUrl(url: string | undefined | null): string | null {
  if (!url) return null;

  // Trim whitespace
  let cleaned = String(url).trim();
  
  if (!cleaned) return null;

  // Add https:// if no protocol specified
  if (!/^https?:\/\//i.test(cleaned)) {
    // Check if it looks like a hostname (contains dots)
    if (cleaned.includes('.') && !cleaned.includes(' ')) {
      cleaned = `https://${cleaned}`;
    } else {
      // Doesn't look like a valid URL
      return null;
    }
  }

  // Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');

  // Validate it's a proper URL
  try {
    const parsed = new URL(cleaned);
    // Must have a valid protocol and hostname
    if (!parsed.hostname || !['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return cleaned;
  } catch {
    return null;
  }
}

/**
 * Validates a URL and provides detailed error information.
 * Useful for diagnostics and health checks.
 * 
 * @param url - The URL string to validate
 * @param name - Optional name for error messages (e.g., "INFERENCE_SERVICE_URL")
 * @returns Object with normalized URL and/or error message
 */
export function validateServiceUrl(
  url: string | undefined | null,
  name = 'URL'
): { url: string | null; error: string | null; warning: string | null } {
  if (!url) {
    return { url: null, error: `${name} not configured`, warning: null };
  }

  const rawTrimmed = String(url).trim();
  
  if (!rawTrimmed) {
    return { url: null, error: `${name} is empty`, warning: null };
  }

  // Check for common issues
  let warning: string | null = null;

  // Check if protocol is missing
  if (!/^https?:\/\//i.test(rawTrimmed)) {
    warning = `${name} missing protocol (https://) - auto-corrected`;
  }

  // Check for trailing slash
  if (rawTrimmed.endsWith('/')) {
    warning = warning 
      ? `${warning}; trailing slash removed`
      : `${name} had trailing slash - removed`;
  }

  const normalized = normalizeServiceUrl(url);
  
  if (!normalized) {
    return { 
      url: null, 
      error: `${name} is malformed: "${rawTrimmed.substring(0, 50)}${rawTrimmed.length > 50 ? '...' : ''}"`,
      warning: null 
    };
  }

  return { url: normalized, error: null, warning };
}

/**
 * Builds a full endpoint URL from a base URL and path.
 * Handles edge cases with slashes between base and path.
 * 
 * @param baseUrl - The base service URL (e.g., "https://api.example.com")
 * @param path - The API path (e.g., "/health" or "health")
 * @returns Full URL string
 */
export function buildEndpointUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
