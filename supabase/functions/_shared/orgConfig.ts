/**
 * Organization-specific SMTP Configuration Helper
 * 
 * Allows organizations to use their own SMTP servers for email notifications.
 * Falls back to global Supabase secrets if org-specific config is not set.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

export interface SmtpConfig {
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName: string
  secure: boolean
}

export interface SmsConfig {
  provider: 'twilio' | 'vonage' | 'aws_sns' | 'messagebird'
  accountSid?: string
  authToken: string
  fromNumber: string
}

/**
 * Get SMTP configuration for an organization.
 * Returns org-specific config if enabled, otherwise falls back to global config.
 */
export async function getSmtpConfig(
  supabase: SupabaseClient,
  organizationId?: string
): Promise<SmtpConfig | null> {
  // Try org-specific first
  if (organizationId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('use_custom_smtp, smtp_host, smtp_port, smtp_username, smtp_from_email, smtp_from_name')
      .eq('id', organizationId)
      .single()
    
    if (org?.use_custom_smtp && org.smtp_host) {
      // Get encrypted password from credentials table
      const { data: cred } = await supabase
        .from('organization_credentials')
        .select('encrypted_value')
        .eq('organization_id', organizationId)
        .eq('credential_type', 'smtp_password')
        .single()
      
      if (cred?.encrypted_value) {
        return {
          host: org.smtp_host,
          port: org.smtp_port || 587,
          username: org.smtp_username || '',
          password: cred.encrypted_value, // Note: Should be decrypted if using encryption
          fromEmail: org.smtp_from_email || '',
          fromName: org.smtp_from_name || org.smtp_from_email || '',
          secure: (org.smtp_port || 587) === 465,
        }
      }
    }
  }
  
  // Fall back to global Supabase secrets
  const host = Deno.env.get('SMTP_HOST')
  const port = parseInt(Deno.env.get('SMTP_PORT') ?? '587')
  const username = Deno.env.get('SMTP_USERNAME')
  const password = Deno.env.get('SMTP_PASSWORD')
  const fromEmail = Deno.env.get('SMTP_FROM_EMAIL')
  const fromName = Deno.env.get('SMTP_FROM_NAME') || fromEmail
  
  if (!host || !fromEmail) {
    return null
  }
  
  return {
    host,
    port,
    username: username || '',
    password: password || '',
    fromEmail,
    fromName: fromName || '',
    secure: port === 465,
  }
}

/**
 * Get SMS configuration for an organization.
 * Returns org-specific config if enabled, otherwise falls back to global config.
 */
export async function getSmsConfig(
  supabase: SupabaseClient,
  organizationId?: string
): Promise<SmsConfig | null> {
  // Try org-specific first
  if (organizationId) {
    const { data: org } = await supabase
      .from('organizations')
      .select('use_custom_sms, sms_provider, sms_from_number')
      .eq('id', organizationId)
      .single()
    
    if (org?.use_custom_sms && org.sms_provider) {
      // Get credentials from secure table
      const { data: creds } = await supabase
        .from('organization_credentials')
        .select('credential_type, encrypted_value')
        .eq('organization_id', organizationId)
        .in('credential_type', ['sms_auth_token', 'sms_account_sid'])
      
      const authToken = creds?.find(c => c.credential_type === 'sms_auth_token')?.encrypted_value
      const accountSid = creds?.find(c => c.credential_type === 'sms_account_sid')?.encrypted_value
      
      if (authToken) {
        return {
          provider: org.sms_provider,
          accountSid: accountSid || undefined,
          authToken,
          fromNumber: org.sms_from_number || '',
        }
      }
    }
  }
  
  // Fall back to global config
  const provider = Deno.env.get('SMS_PROVIDER') as SmsConfig['provider'] | undefined
  const authToken = Deno.env.get('SMS_AUTH_TOKEN')
  const accountSid = Deno.env.get('SMS_ACCOUNT_SID')
  const fromNumber = Deno.env.get('SMS_FROM_NUMBER')
  
  if (!provider || !authToken || !fromNumber) {
    return null
  }
  
  return {
    provider,
    accountSid: accountSid || undefined,
    authToken,
    fromNumber,
  }
}

/**
 * Check if SMTP is configured for the given organization
 */
export async function isSmtpConfigured(
  supabase: SupabaseClient,
  organizationId?: string
): Promise<boolean> {
  const config = await getSmtpConfig(supabase, organizationId)
  return config !== null && !!config.host && !!config.fromEmail
}

/**
 * Check if SMS is configured for the given organization
 */
export async function isSmsConfigured(
  supabase: SupabaseClient,
  organizationId?: string
): Promise<boolean> {
  const config = await getSmsConfig(supabase, organizationId)
  return config !== null && !!config.provider && !!config.authToken && !!config.fromNumber
}

/**
 * Get password policy for an organization
 */
export async function getPasswordPolicy(
  supabase: SupabaseClient,
  organizationId?: string
): Promise<{
  minLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumber: boolean
  requireSpecial: boolean
}> {
  const defaults = {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: false,
  }
  
  if (!organizationId) {
    return defaults
  }
  
  const { data: org } = await supabase
    .from('organizations')
    .select('password_min_length, password_require_uppercase, password_require_lowercase, password_require_number, password_require_special')
    .eq('id', organizationId)
    .single()
  
  if (!org) {
    return defaults
  }
  
  return {
    minLength: org.password_min_length ?? defaults.minLength,
    requireUppercase: org.password_require_uppercase ?? defaults.requireUppercase,
    requireLowercase: org.password_require_lowercase ?? defaults.requireLowercase,
    requireNumber: org.password_require_number ?? defaults.requireNumber,
    requireSpecial: org.password_require_special ?? defaults.requireSpecial,
  }
}

/**
 * Validate password against organization policy
 */
export function validatePassword(
  password: string,
  policy: Awaited<ReturnType<typeof getPasswordPolicy>>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`)
  }
  
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }
  
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }
  
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}
