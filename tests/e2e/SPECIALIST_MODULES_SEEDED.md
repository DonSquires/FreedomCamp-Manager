# Specialist E2E (Seeded Backend)

This suite is intended to run against a seeded Supabase backend instead of request-level mocking.

## Enable

Set:
- `PLAYWRIGHT_SEEDED_SPECIALIST_E2E=1`

Optional:
- `PLAYWRIGHT_SEEDED_NOISE_JOB_NUMBER=NOI-1001`

## Run

```bash
PLAYWRIGHT_SEEDED_SPECIALIST_E2E=1 \
PLAYWRIGHT_SEEDED_NOISE_JOB_NUMBER=NOI-1001 \
npx playwright test tests/e2e/specialist-modules-ai.spec.ts --project=chromium --reporter=list
```

## Notes

- These tests intentionally avoid edge-function network mocks.
- They validate live route access plus seeded data paths.
- Keep this suite in a dedicated branch until stability is confirmed.
