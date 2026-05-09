const profile = process.env.EAS_BUILD_PROFILE || ''
const allowDirectProduction = process.env.ALLOW_DIRECT_EAS_PRODUCTION === 'true'
const ciApproved = process.env.CI_RELEASE_APPROVED === 'true'

if (!profile) {
  process.exit(0)
}

if (profile === 'production' && !allowDirectProduction) {
  console.error('\n[release-policy] Direct EAS production builds are blocked for this repository.')
  console.error('[release-policy] Use the GitHub workflow ".github/workflows/deploy-mobile.yml" with profile "production_ci".')
  console.error('[release-policy] Override only for emergency with ALLOW_DIRECT_EAS_PRODUCTION=true.\n')
  process.exit(1)
}

if (profile === 'production_ci' && !ciApproved) {
  console.error('\n[release-policy] production_ci requires CI_RELEASE_APPROVED=true.')
  console.error('[release-policy] Run via the GitHub mobile deploy workflow so signing credentials and env are injected.\n')
  process.exit(1)
}

process.exit(0)
