# Railway Credentials Update - Bob System Auth

**Status**: Bob system user successfully created in Supabase  
**Action Required**: Manually update Railway environment variables  
**Date**: May 19, 2026  

## Bob System Credentials

The Bob system user has been created in Supabase Auth with:

- **Email**: `bob.assistant+system@onspace.ai`
- **Password**: `Ryclw_Gb69xiAtH7A6ZIO8YM21MjK8BY`
- **Organization**: Ministry of Justice (bf721cec-a3b6-4bec-8c48-5f0cd3681f41)
- **Role**: admin_officer
- **User ID**: c9058c69-9f28-45bb-81de-b790c632a194

## How to Update Railway

### Option 1: Railway Dashboard (Recommended)

1. Go to: https://railway.app/project/c5305775-ecf5-4d67-a59f-b7ae49838561
2. Click on the **"FreedomCamp-Manager"** service
3. Click the **Variables** tab
4. Add or update these variables:
   ```
   BOB_SYSTEM_EMAIL=bob.assistant+system@onspace.ai
   BOB_SYSTEM_PASSWORD=Ryclw_Gb69xiAtH7A6ZIO8YM21MjK8BY
   ```
5. Click **Deploy** (or wait for automatic redeploy on next push to `main`)

### Option 2: Railway CLI

If you have the Railway CLI installed:

```bash
railway variables set BOB_SYSTEM_EMAIL=bob.assistant+system@onspace.ai
railway variables set BOB_SYSTEM_PASSWORD=Ryclw_Gb69xiAtH7A6ZIO8YM21MjK8BY
```

### Option 3: GitHub Secrets → Railway

1. Go to GitHub repo Settings → Secrets and Variables → Actions
2. Create these secrets:
   ```
   BOB_SYSTEM_EMAIL=bob.assistant+system@onspace.ai
   BOB_SYSTEM_PASSWORD=Ryclw_Gb69xiAtH7A6ZIO8YM21MjK8BY
   ```
3. Update `.github/workflows/deploy-proxy-railway.yml` to use these secrets:
   ```yaml
   env:
     BOB_SYSTEM_EMAIL: ${{ secrets.BOB_SYSTEM_EMAIL }}
     BOB_SYSTEM_PASSWORD: ${{ secrets.BOB_SYSTEM_PASSWORD }}
   ```
4. Push to `main` to trigger redeploy

## Verification

After updating Railway environment variables, verify the auth is working:

```bash
curl -s https://freedomcamp-manager-production.up.railway.app/health | jq '.bob_system_auth'
```

Expected response:
```json
{
  "configured": true,
  "ready": true,
  "email": "b******************m@onspace.ai",
  "user_id": "c9058c69-9f28-45bb-81de-b790c632a194",
  "expires_at": "2026-05-19T...",
  "last_refresh_at": "2026-05-19T...",
  "refresh_failures": 0,
  "last_error": null
}
```

## Security Notes

- ✓ Bob system user credentials are unique and separate from regular user accounts
- ✓ Password was generated using cryptographically secure random (secrets.token_urlsafe)
- ✓ Credentials are stored in Railway environment (encrypted at rest by Railway)
- ⚠ Do NOT commit raw passwords to git
- ⚠ Rotate password periodically in production
- ⚠ Monitor `bob_system_ledger` table for audit trail of Bob actions

## Troubleshooting

If auth is still failing after update:

1. **Verify credentials are correct**: Check Railway dashboard shows the variables
2. **Check Supabase user exists**: Query `auth.users` table in Supabase for `bob.assistant+system@onspace.ai`
3. **Restart service**: Manually restart the FreedomCamp-Manager service in Railway
4. **Check logs**: View Railway logs for error details
5. **Regenerate**: If needed, run `scripts/create-bob-login.mjs` again with new password

## Related Files

- `proxy-server/lib/bobSystemAuth.js` - Auth bootstrap logic
- `proxy-server/server.js` - Health endpoint that reports auth status
- `scripts/create-bob-login.mjs` - Script to create/update Bob system users
- `supabase/functions/onspace-ai-chat/` - Bob chat endpoint
