# Test Credential Issues

## 2025-01-15 — Officer login failure: littlemissno5@gmail.com

**Symptom**: E2E test `Don/Bex workflow — notifications` fails with:
```
Error: Login failed for littlemissno5@gmail.com. Current URL: http://localhost:5173/login
```

**Root cause**: The account `littlemissno5@gmail.com` either does not exist in the
Supabase Auth database for the test project, or the password in `.env.playwright.local`
(`Run2thesun??`) does not match the stored hash.

**Fix options** (in order of preference):
1. Go to Supabase dashboard → Authentication → Users → invite/create `littlemissno5@gmail.com`
   with password `Wilson01!!`, then ensure a `user_profiles` row exists with `role = 'officer'`
   and the correct `organization_id`
2. Use the `synthOrg` fixture (`tests/e2e/fixtures/synth-org.ts`) to seed a fresh officer
   per-test programmatically via the service role key
3. If neither is possible, skip the test with `test.skip(!!process.env.CI, 'Bex creds not in CI env')`

**Verification**: After fix → run `bunx playwright test tests/e2e/deep-functional.spec.ts --grep "Don/Bex"`
Expected: test passes, notification banner visible within 10s

**Status**: RESOLVED — password updated to `Wilson01!!`, test passes (11.8s)
