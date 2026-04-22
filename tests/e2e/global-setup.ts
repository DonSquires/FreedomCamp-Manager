import type { FullConfig } from '@playwright/test'
import { getRequiredTestUsersFromEnv, validateRoleCredentialPreflight } from './auth'
import { checkBobUiCapability } from './bob-ui-assess'

export default async function globalSetup(_config: FullConfig) {
  validateRoleCredentialPreflight(getRequiredTestUsersFromEnv())
  // Non-blocking: warns if Bob is offline rather than aborting the run
  await checkBobUiCapability()
}
