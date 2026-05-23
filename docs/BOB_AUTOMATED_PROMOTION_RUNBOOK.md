# Bob Automated Promotion Runbook

This runbook covers go-live for the Playwright-gated auto-promotion pipeline.

## Scope

The backend supports this flow:

1. `patch/ai-self-heal-*` branch is pushed.
2. Webhook runner reports Playwright result to `POST /api/automation/playwright-result`.
3. On failed test runs:
   - status is `ORCHESTRATOR_CRASHED`
   - a Gitea issue is created with raw output
4. On 100% green runs:
   - branch is auto-promoted toward `main`
   - status is set to `RESOLVED_AND_DEPLOYED`
   - audit tag is appended:
     `Automated Production Promotion: PASSED via 100% Green Playwright Sweep`

## Required Merge

PR to merge:
- `#766` `feat(orchestrator): deploy playwright gate + auto promotion pipeline`

Until this PR is merged/deployed, production can return:
- `404 Cannot POST /api/automation/playwright-result`

## Deployment Verification

After merge to `main`, verify endpoint availability:

```bash
curl -i -X POST "https://fieldops-backend-production.up.railway.app/api/automation/playwright-result" \
  -H "Content-Type: application/json" \
  -d '{"status":"PASSED"}'
```

Expected:
- `401` when automation token is required but missing (route exists)
- `200` for valid token + valid payload
- not `404`

## Green Promotion Simulation Payload

```json
{
  "status": "PASSED",
  "verificationTag": "Playwright Browser Verification: PASSED",
  "eventName": "push",
  "repository": "DonSquires/FreedomCamp-Manager",
  "ref": "refs/heads/patch/ai-self-heal-simulator",
  "branch": "patch/ai-self-heal-simulator",
  "commitSha": "simulator-commit-sha",
  "command": "MOCK_MODE=true npx playwright test --config playwright.config.ts",
  "output": "simulator green run",
  "passRate": 100,
  "testsPassed": 42,
  "testsTotal": 42
}
```

## Env Controls

Backend env flags used by auto-promotion:

- `AUTO_PROMOTE_GREEN_PLAYWRIGHT` (default `true`)
- `AUTO_PROMOTE_BASE_BRANCH` (default `main`)
- `AUTOMATION_WEBHOOK_TOKEN` or `GITEA_WEBHOOK_SECRET`
- `GITEA_BASE_URL` or `GITEA_URL`
- `GITEA_TOKEN` or `GITEA_API_TOKEN`
- `GITEA_OWNER`
- `GITEA_REPO`

## Operational Checklist

1. Merge PR `#766`.
2. Confirm Railway deploy finished for backend.
3. Verify route exists (not 404).
4. Send failed payload and confirm `ORCHESTRATOR_CRASHED` log + issue creation.
5. Send 100% green payload on `patch/ai-self-heal-*` and confirm `RESOLVED_AND_DEPLOYED`.
6. Confirm promotion metadata in `self_healing_logs.error_payload.autoPromotion`.
