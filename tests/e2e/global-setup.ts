import type { FullConfig } from '@playwright/test'
import { getRequiredTestUsersFromEnv, validateRoleCredentialPreflight } from './auth'
import { checkBobUiCapability } from './bob-ui-assess'

function shouldValidateRoleCredentials(): boolean {
  if (String(process.env.PLAYWRIGHT_VALIDATE_ROLE_CREDENTIALS || '').trim() === '1') return true
  if (String(process.env.PLAYWRIGHT_ALLOW_SHARED_CREDENTIAL_FALLBACK || '').trim() === '1') return true
  return !!String(process.env.PLAYWRIGHT_REQUIRED_TEST_USERS || '').trim()
}

export default async function globalSetup(_config: FullConfig) {
  if (shouldValidateRoleCredentials()) {
    validateRoleCredentialPreflight(getRequiredTestUsersFromEnv())
  }
  // Non-blocking: warns if Bob is offline rather than aborting the run
  await checkBobUiCapability()
}
