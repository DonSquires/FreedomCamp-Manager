# Iron Eagle Security Email Templates

Professional HTML email templates for FreedomCamp Manager with Iron Eagle Security branding.

## Templates Included

1. **invite-email.html** - User invitation email
2. **password-reset.html** - Password reset email
3. **welcome-email.html** - Welcome email sent after first login

## How to Apply Templates to Supabase

### Step 1: Access Supabase Email Templates

1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Email Templates** (left sidebar)
3. You'll see several template types:
   - Confirm signup
   - Invite user
   - Magic Link
   - Change Email Address
   - Reset Password

### Step 2: Update Invite User Template

1. Click on **"Invite user"** template
2. Copy the entire content from `invite-email.html`
3. Paste into the template editor
4. **Important**: Supabase uses Go templates, so make sure these variables are present:
   - `{{ .Email }}` - User's email address
   - `{{ .ConfirmationURL }}` - Invitation acceptance link
   - `{{ .SiteURL }}` - Your site URL (https://fcmanager.co.nz)
5. Click **Save**

### Step 3: Update Reset Password Template

1. Click on **"Reset Password"** template
2. Copy the entire content from `password-reset.html`
3. Paste into the template editor
4. Verify these variables are present:
   - `{{ .Email }}` - User's email address
   - `{{ .ConfirmationURL }}` - Password reset link
5. Click **Save**

### Step 4: Create Custom Welcome Email (Optional)

Supabase doesn't have a built-in "welcome after first login" template, but you can implement this using Edge Functions:

1. Create an Edge Function trigger that fires on first user login
2. Use the `welcome-email.html` template content
3. Send via your email service provider (SendGrid, Mailgun, etc.)
4. Replace variables:
   - `{{ .UserName }}` - User's full name (from profile)
   - `{{ .Email }}` - User's email address

### Step 5: Update Site URL Configuration

Make sure your Supabase Authentication settings are configured correctly:

1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL** to: `https://fcmanager.co.nz`
3. Add **Redirect URLs**:
   - `https://fcmanager.co.nz/**`
   - `https://fcmanager.co.nz/auth/callback`

### Step 6: Test the Templates

1. Go to **User Management** in your app
2. Create a new user invitation
3. Check the email received - it should use the new Iron Eagle Security branding
4. Verify:
   - Logo displays correctly (https://fcmanager.co.nz/iron-eagle-security-logo.jpg)
   - All links work properly
   - Branding is consistent
   - Disclaimer text is visible

## Template Features

### Iron Eagle Security Branding
- Official IES logo prominently displayed
- Professional gradient headers (blue for invitations, purple for password reset, green for welcome)
- Company badge and footer with IES information

### Security & Compliance
- NZ Privacy Act 2020 disclaimer on invitation emails
- Security best practices for password reset emails
- Clear expiration warnings
- Professional security alerts

### Responsive Design
- Mobile-friendly layout
- Maximum width 600px for email clients
- Graceful fallbacks for older email clients
- Button and link alternatives

### User Experience
- Clear call-to-action buttons
- Informative content with helpful context
- Link fallback sections for accessibility
- Professional color scheme matching app branding

## Customization

### Changing Colors

**Invitation Email (Blue Theme)**
- Primary: `#1e40af` → `#3b82f6`
- Adjust gradient in `.header` and `.cta-button`

**Password Reset (Purple Theme)**
- Primary: `#7c3aed` → `#a78bfa`
- Adjust gradient in `.header` and `.cta-button`

**Welcome Email (Green Theme)**
- Primary: `#059669` → `#10b981`
- Adjust gradient in `.header` and `.cta-button`

### Updating Logo

The logo URL is currently set to:
```html
https://fcmanager.co.nz/iron-eagle-security-logo.jpg
```

If you move the logo to a different location (e.g., CDN), update all instances in the templates.

### Adding New Content

You can add additional sections while maintaining the style:

```html
<div class="info-box">
  <p><strong>Your custom heading</strong></p>
  <p>Your custom content here</p>
</div>
```

## Troubleshooting

### Logo Not Displaying
- Ensure `iron-eagle-security-logo.jpg` is accessible at `https://fcmanager.co.nz/iron-eagle-security-logo.jpg`
- Check image permissions (should be publicly accessible)
- Verify HTTPS is working correctly on your domain

### Links Not Working
- Verify Site URL is set correctly in Supabase
- Check Redirect URLs include all necessary paths
- Ensure `{{ .ConfirmationURL }}` variable is not modified

### Styles Not Rendering
- Some email clients strip `<style>` tags - templates use inline styles as fallback
- Test in multiple email clients (Gmail, Outlook, Apple Mail)
- Avoid CSS features not supported in emails (flexbox, grid, etc.)

## Support

For template issues or customization help:
1. Check Supabase email template documentation
2. Contact your organization administrator
3. Visit https://fcmanager.co.nz for app support

---

**Iron Eagle Security (IES)**  
Professional Security Solutions for New Zealand
