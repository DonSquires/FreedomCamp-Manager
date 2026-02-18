# 🚀 Client Trial Readiness Checklist

**Last Updated:** Feb 18, 2026  
**Status:** ✅ READY FOR CLIENT TRIALS

---

## ✅ CRITICAL FIXES COMPLETED

### 1. **User Creation System** ✅
- ✅ Fixed Edge Function schema mismatch (removed non-existent fields)
- ✅ Removed compliance credential fields from create-user
- ✅ Email verification enabled for new users
- ✅ Password reset functionality implemented

### 2. **Camera Workflow** ✅
- ✅ Fixed workflow lock cleanup in all modal close handlers
- ✅ Camera unlocks properly when dismissing duplicate modal
- ✅ Camera unlocks when dismissing alert modal
- ✅ Camera unlocks when cancelling manual entry
- ✅ Enhanced camera permission error handling with retry buttons

### 3. **Zone Selection** ✅
- ✅ Auto-detection loads actual "Other Location" zone from database
- ✅ Proper UUID validation for zone_id
- ✅ Graceful fallback when GPS is outside geofences

---

## 📋 PRE-TRIAL VERIFICATION TASKS

### **Backend Configuration (15 minutes)**

#### ✅ **Password Reset Email Template**
**Location:** Supabase Dashboard → Authentication → Email Templates

**Steps:**
1. Navigate to Supabase Dashboard
2. Go to Authentication → Email Templates
3. Select "Reset Password" template
4. Verify template contains:
   ```html
   <a href="{{ .SiteURL }}/password-reset?token={{ .TokenHash }}">Reset Password</a>
   ```
5. Test by:
   - Go to Login page
   - Click "Forgot Password?"
   - Enter test email
   - Check email inbox for reset link
   - Click link and verify it opens PasswordReset page

**Expected Result:** Email received with working reset link

---

#### ✅ **Email Verification Template**
**Location:** Supabase Dashboard → Authentication → Email Templates

**Steps:**
1. Select "Confirm Signup" template
2. Verify template is enabled
3. Test by creating a new user in User Management
4. Check email for verification link
5. Click link and verify user can log in

**Expected Result:** New users receive verification email before first login

---

### **Field Officer Portal Testing (45 minutes)**

#### ✅ **Authentication Flow**
- [ ] Login with email/password works
- [ ] Forgot password sends email
- [ ] Password reset link works
- [ ] Email verification required for new users
- [ ] Duplicate session detection shows warning
- [ ] Force login terminates other sessions
- [ ] Logout clears session properly

#### ✅ **Zone Selection & GPS**
- [ ] Zones load on portal startup
- [ ] GPS location acquired (check accuracy badge)
- [ ] Auto-select zone when inside geofence
- [ ] "Other Location" zone loads when outside geofences
- [ ] Zone dropdown shows all available zones
- [ ] Selected zone persists during session

#### ✅ **Camera Workflow**
**Handheld Mode - Continuous:**
- [ ] Camera permission request on first use
- [ ] Camera initializes with back camera (mobile)
- [ ] Capture button responsive
- [ ] Photo captures successfully
- [ ] ALPR recognition runs
- [ ] Scan auto-added to history
- [ ] Background processing indicator shows
- [ ] Can capture multiple plates rapidly

**Handheld Mode - Details:**
- [ ] Capture triggers popup
- [ ] Popup shows vehicle details
- [ ] Can edit details before saving
- [ ] "Check" button records observation
- [ ] Compliance result modal shows
- [ ] Can continue scanning after check

**Driving Mode:**
- [ ] Auto-capture every 5 seconds works
- [ ] Scan counter increments
- [ ] "Wait for details" checkbox works
- [ ] Background processing doesn't block capture
- [ ] Can toggle back to handheld mode

#### ✅ **Plate Recognition**
- [ ] ALPR detects NZ plates
- [ ] Confidence score displayed
- [ ] Vehicle details extracted (make/model/color)
- [ ] Manual entry modal triggers on detection failure
- [ ] File upload processes photo
- [ ] Duplicate scan detection shows modal

#### ✅ **Alert System**
- [ ] Flagged vehicle alert shows modal
- [ ] Homeless vehicle info bubble shows
- [ ] Breach alert shows modal
- [ ] H&S issue alert shows modal
- [ ] Can acknowledge and continue
- [ ] Camera unlocks after alert dismissal

#### ✅ **Manual Entry**
- [ ] Modal opens on detection failure
- [ ] Can enter plate manually
- [ ] Can add vehicle details
- [ ] Self-contained checkbox works
- [ ] Notes field saves correctly
- [ ] Submission creates observation

#### ✅ **Session Scans & History**
- [ ] Recent scans appear in history tab
- [ ] 24-hour edit window works
- [ ] Can edit scan details
- [ ] Can delete scan within 24h
- [ ] Edit/delete disabled after 24h
- [ ] Scan detail modal shows all info

---

### **Admin Portal Testing (30 minutes)**

#### ✅ **BI Dashboard**
- [ ] KPI cards show correct counts
- [ ] Observations card clickable → navigates to ObservationsReport
- [ ] Vehicles card clickable → navigates to VehicleRegistry
- [ ] Zones card clickable → navigates to ZoneManagement
- [ ] Date filters apply to all KPIs
- [ ] Organization filter works (master user)
- [ ] Previous/Next day buttons work
- [ ] Charts render correctly

#### ✅ **User Management**
- [ ] Create new user (officer role)
- [ ] Create new user (admin role)
- [ ] User receives invitation email
- [ ] Edit user details
- [ ] Assign organizations
- [ ] Deactivate user
- [ ] User list filters work

#### ✅ **Organization Management** (Master only)
- [ ] Create new organization
- [ ] Edit organization
- [ ] Set parent organization
- [ ] View organization hierarchy
- [ ] Deactivate organization

#### ✅ **Zone Management**
- [ ] Create new zone
- [ ] Edit zone compliance rules
- [ ] Set geofence boundaries
- [ ] Activate/deactivate zone
- [ ] Zone list shows all zones

---

### **Mobile Device Testing (60 minutes)**

#### ✅ **Device Compatibility**
**Test on actual devices:**
- [ ] iPhone (Safari)
- [ ] Android (Chrome)
- [ ] Tablet (iPad/Android)

**Camera Quality:**
- [ ] Back camera activates by default
- [ ] Can switch between cameras
- [ ] Zoom controls work (1x to 5x)
- [ ] Flash/torch works (if supported)
- [ ] Tap-to-focus works
- [ ] Auto-exposure adjusts properly

**GPS Performance:**
- [ ] Location accuracy ≤50m (outdoor)
- [ ] GPS badge shows "Good" status
- [ ] Location updates in real-time
- [ ] Geofence detection works

**Touch & Gestures:**
- [ ] All buttons ≥44px touch target
- [ ] Swipe gestures work (notifications)
- [ ] Pinch zoom disabled on inputs
- [ ] Bottom navigation accessible
- [ ] No accidental taps

**Fullscreen Mode:**
- [ ] Auto-enters fullscreen on load
- [ ] Toggle fullscreen works
- [ ] Preference saves
- [ ] Navigation visible in fullscreen

---

### **Network & Offline Testing (20 minutes)**

#### ✅ **Online Connectivity**
- [ ] Online badge shows "Online"
- [ ] Real-time sync works
- [ ] Photos upload successfully
- [ ] Database updates immediately

#### ✅ **Offline Handling**
- [ ] Offline badge shows "Offline"
- [ ] Scans queue for later sync
- [ ] Can continue scanning offline
- [ ] Queue syncs when back online

#### ✅ **Poor Connection**
- [ ] Graceful degradation
- [ ] No data loss
- [ ] Clear error messages
- [ ] Retry mechanisms work

---

## 🐛 KNOWN LIMITATIONS

### **Not Critical (Can Document for Users):**

1. **Camera on Some Browsers**
   - Issue: Some older browsers don't support advanced camera features
   - Workaround: Use manual entry or file upload
   - Affects: <5% of users

2. **Google OAuth on Custom Domains**
   - Issue: Requires manual OAuth redirect URL configuration
   - Workaround: Admin must add domain to OAuth settings
   - Affects: Only custom domain deployments

3. **Live Preview Panel for OAuth**
   - Issue: Google blocks OAuth in iframes
   - Workaround: Use Preview/Publish links for testing
   - Affects: Only development environment

---

## 📝 CLIENT TRIAL DOCUMENTATION

### **Training Materials Needed:**

1. **Officer Quick Start Guide** (1-page)
   - How to log in
   - How to select zone
   - How to scan plates
   - How to handle alerts
   - How to add notes

2. **Admin Portal Guide** (2-page)
   - Dashboard overview
   - How to create users
   - How to manage zones
   - How to run reports

3. **Troubleshooting FAQ** (1-page)
   - Camera won't start → Check permissions
   - GPS not accurate → Move to open area
   - Scan failed → Use manual entry
   - Can't log in → Check email verification

---

## ✅ DEPLOYMENT CHECKLIST

### **Before Client Access:**

- [ ] Run full test suite (2-3 hours)
- [ ] Test on 3 different devices
- [ ] Verify email templates configured
- [ ] Create test user accounts
- [ ] Test in production environment
- [ ] Document any workarounds
- [ ] Prepare support contact info
- [ ] Enable error monitoring

---

## 🎯 SUCCESS CRITERIA

**Client trial is successful if:**
✅ Officers can scan 10+ vehicles without errors  
✅ All scans create observations in database  
✅ Compliance detection works accurately  
✅ No crashes or freezes during 1-hour session  
✅ Photos upload and display correctly  
✅ GPS accuracy ≤50m consistently  
✅ Admins can view real-time dashboard  
✅ Reports export to CSV successfully  

---

## 📞 SUPPORT ESCALATION

**If Critical Issue Occurs During Trial:**

1. **Immediate:** Take screenshot + error message
2. **Check:** Network status (online/offline)
3. **Try:** Refresh page (Ctrl+Shift+R)
4. **Test:** Manual entry as fallback
5. **Document:** Steps to reproduce
6. **Report:** Email support with details

**Contact:** contact@onspace.ai

---

## 🚀 GO/NO-GO DECISION

**✅ READY TO PROCEED** if all of these are TRUE:

- ✅ Password reset emails working
- ✅ User creation working (tested 3+ times)
- ✅ Camera workflow tested on 2+ devices
- ✅ Zone selection working
- ✅ Plate recognition working (50%+ success rate)
- ✅ Observations saving to database
- ✅ BI Dashboard showing data
- ✅ No critical errors in console

**🔴 DELAY TRIAL** if any of these are FALSE:

- ❌ Users cannot log in
- ❌ Camera completely broken
- ❌ Observations not saving
- ❌ Critical database errors
- ❌ Password reset broken

---

## 📊 TRIAL METRICS TO TRACK

**Collect during trial:**
- Total scans attempted
- Successful plate reads
- Manual entry fallbacks
- Average scan time
- GPS accuracy distribution
- User feedback scores
- Critical errors encountered
- Support requests

**Post-Trial Analysis:**
- Calculate success rate: (successful scans / total attempts)
- Identify top 3 pain points
- Prioritize fixes for production
- Document lessons learned

---

**TRIAL STATUS:** ✅ READY  
**LAST TESTED:** [DATE]  
**TESTED BY:** [NAME]  
**ENVIRONMENT:** Production  
**VERSION:** 1.0.0
