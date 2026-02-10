# FreedomCamp Manager - Beginner's User Manual

**Version:** 1.0  
**Last Updated:** January 2026

---

## Table of Contents

1. [Field Staff Instructions](#field-staff-instructions)
2. [Admin Instructions](#admin-instructions)
3. [Troubleshooting](#troubleshooting)

---

# Field Staff Instructions

## Getting Started

### 1. First Time Login

1. **Open the app** on your mobile device (works best on phones/tablets)
2. **Enter your email and password** provided by your administrator
3. You'll automatically enter the **Field Officer Portal**
4. **Allow location permissions** when prompted (required for GPS tracking)
5. **Allow camera permissions** for vehicle scanning
6. **Allow notification permissions** for investigation jobs and welfare alerts

### 2. Understanding Your Dashboard

When you first log in, you'll see:

- **Your Profile Card** - Shows your name and officer status
- **Vehicle Scanning Card** - Main button to start scanning vehicles
- **Zone Selector** - Choose which zone you're patrolling
- **Today's Statistics** - Your scan count and compliance rate
- **Recent Scans** - Last few vehicles you've scanned

---

## Core Features

### 📸 Scanning Vehicles

**This is your main daily task - recording vehicles in freedom camping zones.**

#### How to Scan:

1. **Select Your Zone** on the dashboard (should auto-detect based on GPS)
2. Tap the large green **"Start Scanning"** button
3. **Choose scanning method:**
   - **Camera** - Point at licence plate (AI will read it automatically)
   - **Manual Entry** - Type the plate number if camera doesn't work

4. **Take Evidence Photos:**
   - Photo of whole vehicle
   - Photo of any compliance stickers (self-contained certification)
   - Photo of any issues (waste, damage, etc.)

5. **Vehicle Details Auto-Fill:**
   - Make, model, colour detected by AI
   - You can edit if incorrect

6. **Mark Compliance:**
   - ✅ **Self-Contained?** - Toggle YES if vehicle has proper certification
   - ✅ **Compliant?** - Toggle NO if breaking zone rules

7. **Add Notes** (optional) - Describe any issues or observations

8. Tap **"Submit Observation"**

#### What Happens Next:

- Vehicle is recorded in the database
- Compliance check runs automatically
- You'll see confirmation with plate number
- Vehicle appears in your "Recent Scans" list
- **GPS location is recorded automatically**
- **Your welfare monitoring timer resets**

---

### 📋 Session History

**Your session history keeps all scans for 24 hours on your device.**

#### Viewing Your Scans:

1. Tap **"Session History"** in the sidebar menu
2. See all vehicles scanned during your shift
3. Each scan shows:
   - Plate number
   - Time scanned
   - Zone name
   - Compliance status (✅ or ⚠️)
   - Flagged vehicles (🚩 red warning)

#### Exporting Your Session:

1. Scroll to bottom of Session History
2. Choose export format:
   - **CSV** - For spreadsheets/Excel
   - **JSON** - For technical use

3. File downloads to your device
4. **Clear Session** removes all scans from list (doesn't delete from database)

---

### 🚨 Creating Incident Reports

**Use this when you see issues requiring follow-up (vandalism, illegal dumping, threatening behavior, etc.)**

#### How to Report an Incident:

1. From **"Recent Scans"** or **"Scanned Vehicles"**, find the vehicle
2. Tap **"Create Incident"** button
3. Fill in the report:
   - **Incident Type:** Vandalism, Illegal Dumping, Threatening Behavior, etc.
   - **Description:** What happened (be detailed)
   - **Severity:** Low, Medium, High
   - **Photos:** Add evidence photos
   - **Location:** Auto-filled from GPS

4. Tap **"Submit Incident Report"**

#### What Happens Next:

- Report is saved to your device (24-hour retention)
- Report uploads to admin dashboard
- **You receive confirmation notification**
- Admin will review and may contact you
- **Admin approval locks the report** (court-ready)

#### View Your Incidents:

- Tap **"My Incidents"** in sidebar
- See all reports from last 24 hours
- Check approval status

---

### 🔍 Investigation Jobs

**Admin assigns you investigation jobs for specific sites/vehicles.**

#### Checking Your Jobs:

1. Tap **"Investigation Jobs"** in sidebar
2. See jobs assigned to you:
   - **Pending** - Not started yet
   - **In Progress** - You're working on it
   - **Completed** - Finished

#### Completing an Investigation:

1. **Tap on the job** to open details
2. **Start the Job:**
   - Tap "Start Investigation"
   - Status changes to "In Progress"

3. **At the Site:**
   - **GPS auto-records** when you arrive
   - Take photos (automatically watermarked with GPS + time)
   - Add findings notes
   - Record:
     - Structures found (tents, shelters, etc.)
     - Vehicles present (plate numbers)
     - Persons contacted (names, details)

4. **Complete the Job:**
   - Tap "Complete Investigation"
   - Add final recommendations
   - Submit findings

#### What Happens Next:

- Admin receives completion notification
- Job marked complete
- Evidence photos stored securely

---

### 🏥 Health & Safety Reports

**Report any safety hazards you encounter (broken glass, needles, aggressive animals, unsafe structures, etc.)**

#### How to Report H&S Issues:

1. From **"Recent Scans"**, tap on a vehicle
2. Tap **"Report H&S Issue"**
3. Fill in:
   - **Issue Details** - Describe the hazard
   - **Severity:** Low, Medium, High, Critical
   - **Photos** - Evidence of the hazard
   - **Location** - Auto-filled from GPS

4. Tap **"Submit H&S Report"**

#### What Happens Next:

- Admin team receives immediate notification
- High/Critical issues flagged for urgent action
- Follow-up assigned as needed

---

### 📶 Working Offline

**The app works without internet! Your data syncs when connection returns.**

#### When You're Offline:

- **Yellow banner** appears: "Offline Mode - X scans queued for sync"
- Continue scanning normally
- All data saves to your device
- GPS locations recorded locally

#### When Connection Returns:

- **Auto-sync starts** automatically
- Queued scans upload to database
- Success notification shows: "Synced X records"
- Offline banner disappears

#### Viewing Offline Queue:

1. Tap **"Offline Queue"** in sidebar
2. See all pending uploads
3. Tap **"Retry Upload"** if sync fails

---

### 💚 Officer Welfare Monitoring

**Your safety is important! The app monitors your activity and sends alerts if you're inactive.**

#### How It Works:

- **GPS tracking** runs automatically in background (every 30 seconds)
- **Activity monitoring** tracks when you scan vehicles
- **Pre-warnings** alert you before admin is notified

#### Warning Types:

1. **Inactivity Warning (⚠️ Amber):**
   - No vehicle scans for 10+ minutes
   - 30-second countdown before logoff
   - **Continuous beep sound plays**
   - Tap "Acknowledge" to dismiss

2. **GPS Welfare Check (🚨 Red):**
   - No GPS movement for 10+ minutes
   - 30-second countdown before admin alert
   - **Loud pulsing alarm plays**
   - Tap "Acknowledge" immediately

#### What to Do:

- **Don't ignore warnings!** Sound continues until acknowledged
- **Tap "I'm OK"** to reset monitoring
- **If you're safe but busy** - acknowledge and continue
- **Investigation Exception** - Warnings disabled during active investigations

#### If Offline:

- **Welfare monitoring pauses** on server (no false alerts)
- **Activities queued** for sync when online
- **Blue banner shows:** "Welfare Monitoring Paused - Offline"

---

### 🎯 Quick Tips for Field Staff

✅ **Do's:**
- Keep GPS enabled always
- Take clear photos of vehicles and plates
- Add detailed notes to observations
- Respond to welfare warnings promptly
- Charge your device before shifts
- Export sessions before clearing them

❌ **Don'ts:**
- Don't ignore welfare warnings (sound continues!)
- Don't edit other officers' scans
- Don't forget to select the correct zone
- Don't clear session without exporting first
- Don't disable location permissions

---

# Admin Instructions

## Getting Started

### 1. First Time Login

1. **Open the app** on desktop or mobile
2. **Enter admin credentials** (email and password)
3. **Desktop users** → Routed to Admin Portal automatically
4. **Mobile admins** → Routed to Field Officer Portal (you can do field work!)
5. Review the **notification settings** prompt

---

## Admin Portal Overview

### Dashboard Layout

**Left Sidebar Menu:**
- Zone Management
- Matrix Management
- Patrol Management
- Live Officer Tracking
- Welfare Settings
- Welfare Alerts
- Investigation Jobs
- Breach Alert Management
- Incident Reports
- Data Import
- Reports & Analytics

**Top Bar:**
- Notification Center (🔔)
- Organisation selector (for Masters)
- Your profile menu

---

## Core Admin Features

### 🗺️ Zone Management

**Zones are geographical areas where freedom camping is allowed/monitored.**

#### Creating a New Zone:

1. **Navigate to "Zone Management"**
2. Tap **"Create Zone"**
3. **Fill in Details:**
   - **Zone Name** (e.g., "Tahuna Beach North")
   - **Description** (optional)
   - **Compliance Rules:**
     - ✅ Self-Contained Required? (YES/NO)
     - Max Consecutive Nights (e.g., 3)
     - Nights Per Month Allowed (e.g., 28)
     - Day Visit Only? (YES/NO)
     - Allowed Days (select days of week)

4. **Draw Geofence on Map:**
   - **Toggle Map View:** Satellite or Street
   - **Drawing Tools:**
     - **Circle Tool** - Click center, drag to set radius
     - **Polygon Tool** - Click corners to draw custom shape
   - **Geofence shows** as blue overlay
   - Drag handles to adjust

5. **Set Center GPS** (auto-fills from geofence)
6. Tap **"Save Zone"**

#### What Happens Next:

- Zone appears in field officers' zone selector
- Geofence auto-detects when officers enter
- Zone becomes "sticky" (stays selected until officer leaves)
- Compliance rules apply to all vehicles in zone

---

### 📋 Zone Legal Configuration

**Set up legal details for Notice to Vacate generation.**

#### Configuring Legal Details:

1. **Go to "Zone Management"**
2. **Select a zone** from list
3. Tap **"Legal Configuration"**
4. **Fill in:**
   - **Legal Location Description** (official property name)
   - **Authorising Officer** (who signs notices)
   - **Officer Title** (e.g., "Compliance Manager")
   - **Applicable Acts** (e.g., "Reserves Act 1977")
   - **Breach Descriptions** (what violations allow trespass/fines)

5. Tap **"Save Legal Configuration"**

#### What Happens Next:

- Details auto-populate Notice to Vacate documents
- Officers can generate notices for breach alerts
- Professional legal formatting applied

---

### 👥 User Management

**Control who can access the system and their permissions.**

#### Creating New Users:

1. **Navigate to "User Management"** (Settings → Users)
2. Tap **"Create User"**
3. **Fill in Details:**
   - First Name
   - Last Name
   - Email (becomes username)
   - Phone Number
   - **Role:**
     - **Officer** - Field staff only
     - **Admin** - Your organisation management
     - **Master** - Super user (all organisations)
   - **Organisation** - Which organisation they belong to
   - **Temporary Password** - User must change on first login

4. Tap **"Create User"**

#### Managing Existing Users:

- **View All Users** in organisation
- **Edit User Details** - Change name, phone, role
- **Reset Password** - Send password reset email
- **Deactivate User** - Disable login without deleting
- **Delete User** - Permanent removal (use carefully!)

---

### 🚔 Patrol Management

**Schedule and track field officer patrols.**

#### Creating Patrol Schedules:

1. **Navigate to "Patrol Management"**
2. Tap **"Schedule Patrol"**
3. **Fill in:**
   - **Date** - When patrol happens
   - **Shift** - Morning, Afternoon, Evening, Night
   - **Zone** - Which zone to patrol
   - **Assigned Officer** - Who does the patrol

4. Tap **"Save Patrol"**

#### Monitoring Patrols:

- **Scheduled** - Awaiting officer check-in
- **Active** - Officer checked in, patrol in progress
- **Completed** - Patrol finished
- **Check-In Time** - When officer started
- **Completion Time** - When officer finished
- **Notes** - Officer's patrol summary

---

### 📍 Live Officer Tracking

**Real-time map showing field officer locations and activity.**

#### Viewing Officer Locations:

1. **Navigate to "Live Officer Tracking"**
2. **Map shows:**
   - **Green markers** - Active officers (GPS updated <15 min ago)
   - **Amber markers** - Recent officers (GPS updated 15-60 min ago)
   - **Red markers** - Inactive officers (GPS updated >60 min ago)
   - **Pulsing red markers** - Welfare alert active

3. **Click on marker** to see:
   - Officer name and phone
   - Last GPS update time
   - Recent scan count
   - Last scanned plate
   - Current zone
   - Investigation status
   - Welfare status

#### Map Controls:

- **Toggle View:** Satellite ↔ Street
- **Auto-Refresh:** ON (updates every 30 seconds) / OFF
- **Show All Officers** - Zoom to fit all markers
- **Click Officer** - Zoom to individual officer

#### Officer List (Right Panel):

- Shows all active officers
- Click officer name to center map
- Status badges:
  - **Active** - Currently working
  - **Recent** - Worked in last hour
  - **Inactive** - No activity >1 hour
  - **🔍 Investigation** - On active investigation job
  - **⚠️ Welfare Alert** - Requires immediate attention

---

### 💚 Welfare Settings

**Configure officer welfare monitoring parameters per officer.**

#### Setting Up Welfare Monitoring:

1. **Navigate to "Welfare Settings"**
2. **Select Officer** from list
3. **Configure Auto-Logoff:**
   - **Enable/Disable** toggle
   - **Inactivity Warning Time** (minutes before warning, default 10)
   - **Auto-Logoff Time** (minutes before logoff, default 20)
   - **Investigation Exception** - Skip logoff during investigations

4. **Configure Welfare Checks:**
   - **Enable/Disable** toggle
   - **GPS Inactivity Threshold** (minutes, default 10)
   - **Admin Escalation Time** (minutes for HIGH priority, default 5)
   - **Critical Escalation Time** (minutes for CRITICAL, default 5)
   - **GPS Ping Interval** (seconds between GPS updates, default 30, range 10-300)

5. **Tap "Save Settings"**

#### Escalation Timeline Example:

With default settings:
- **@ 10 min:** Initial welfare check sent to officer
- **@ 15 min:** HIGH PRIORITY - Admin team notified
- **@ 20 min:** CRITICAL PRIORITY - Masters notified with GPS location

---

### 🚨 Welfare Alerts

**Monitor and respond to officer welfare checks.**

#### Active Alerts Dashboard:

1. **Navigate to "Welfare Alerts"**
2. **Summary Cards Show:**
   - Initial Checks (blue)
   - High Priority (amber)
   - CRITICAL (pulsing red)
   - Total Active

3. **Each Alert Shows:**
   - Officer name and phone
   - Escalation level badge
   - Time since alert
   - Last activity timestamp
   - GPS location (if available)

#### Responding to Alerts:

1. **Call Officer:**
   - Tap **"Call Officer"** button
   - Phone dialer opens automatically
   - Confirm officer is safe

2. **View Location:**
   - Tap **"Open Maps"** button
   - Google Maps opens with officer's GPS coordinates
   - Drive to location if needed

3. **Acknowledge Alert:**
   - Tap **"Acknowledge"** button
   - Add notes about response (e.g., "Spoke to officer, confirmed safe")
   - Tap **"Confirm Acknowledgement"**
   - Alert status changes to "Acknowledged"
   - Alert removed from active list

---

### 🔍 Investigation Jobs

**Assign and track field investigation work.**

#### Creating Investigation Jobs:

1. **Navigate to "Investigation Jobs"**
2. Tap **"Create Job"**
3. **Fill in Details:**
   - **Reference Number** - Auto-generated or custom
   - **Job Type:**
     - Homeless Occupation
     - Abandoned Vehicle
     - Unauthorized Structure
     - Compliance Follow-Up
     - Other
   - **Location Address** - Full street address
   - **GPS Coordinates** - Click map or enter manually
   - **Briefing Notes** - Instructions for officer
   - **Client Name** (if third-party request)
   - **Client Reference** (their job number)
   - **Priority:** Low, Medium, High
   - **Due Date** - When job must be completed
   - **Assigned To** - Which field officer

4. Tap **"Create Investigation Job"**

#### What Happens Next:

- **Officer receives push notification** (with sound!)
- Job appears in officer's "Investigation Jobs" list
- Status changes to "Assigned"
- **Welfare monitoring exemption** activates when officer starts job

#### Monitoring Jobs:

- **Pending** - Created, not assigned
- **Assigned** - Officer notified
- **In Progress** - Officer started work
- **Completed** - Findings submitted
- **Review Findings:**
  - Visit date/time
  - Arrival and departure times
  - Findings summary
  - Photos (GPS-watermarked automatically)
  - Recommendations
  - Follow-up required? (YES/NO)

---

### ⚠️ Breach Alert Management

**View vehicles that broke zone compliance rules and issue formal notices.**

#### Viewing Breach Alerts:

1. **Navigate to "Breach Alert Management"**
2. **Each Alert Shows:**
   - Vehicle plate number
   - Breach type (e.g., "Exceeded consecutive nights")
   - Number of breached observations
   - Notice count (how many notices issued)
   - Status: Pending, Resolved

3. **Expand Alert** to see:
   - Individual observations that triggered breach
   - Timestamps and zones
   - Violation reasons
   - Evidence photos

#### Generating Notice to Vacate:

1. **Select Breach Alert**
2. Tap **"Generate Notice"**
3. **Review Auto-Populated Details:**
   - Vehicle registration
   - Zone name and legal description
   - Authorising officer
   - Applicable acts
   - Breach summary

4. **Choose Delivery Method:**
   - **Print On-Site** - Officer prints from phone
   - **Email** - Send to vehicle owner (if known)
   - **Postal** - Mail formal notice

5. Tap **"Generate and Record Notice"**

#### What Happens Next:

- **PDF notice generated** with professional legal formatting
- **Enforcement action recorded** in database
- **Notice count increments** on breach alert
- **Breach status** remains "Pending" until resolved
- **Officer can mark resolved** when compliance achieved

---

### 📝 Incident Reports

**Review and approve court-ready incident reports from field officers.**

#### Reviewing Incidents:

1. **Navigate to "Incident Reports"**
2. **Filter by:**
   - Status: Pending, Approved, Resolved
   - Severity: Low, Medium, High
   - Date range

3. **Each Report Shows:**
   - Officer who reported
   - Vehicle involved (plate number)
   - Zone and GPS location
   - Incident type
   - Description
   - Evidence photos
   - Timestamp

#### Approving Incidents:

1. **Click on incident** to open details
2. **Review all information:**
   - Photos (GPS watermarked)
   - Officer notes
   - Location accuracy

3. **Approve or Request Changes:**
   - **Approve** - Marks as court-ready (locked from editing)
   - **Request Changes** - Send back to officer with notes
   - **Reject** - Dismiss if not valid

4. **Add Admin Notes** (optional)
5. Tap **"Approve Incident"**

#### What Happens Next:

- **Officer receives notification** of approval
- **Report locked** (court-ready status)
- **Evidence preserved** with hash verification
- Report appears in **enforcement actions** log

---

### 📊 Compliance Recalculation

**Re-run compliance checks when zone rules change.**

#### When to Recalculate:

- After changing zone compliance rules
- After fixing incorrect zone assignments
- After bulk data import
- When compliance results look incorrect

#### Running Recalculation:

1. **Navigate to "Admin Recalculation"**
2. **Choose Scope:**
   - **All Zones** - Entire organisation
   - **Specific Zone** - One zone only
   - **Date Range** - Specific time period

3. **Select Target:**
   - Zone(s) from dropdown
   - Start and end dates (if applicable)

4. Tap **"Start Recalculation"**

#### Monitoring Progress:

- **Real-time progress bar** shows completion %
- **Statistics:**
   - Observations processed
   - Compliance changed
   - Drift events created (rule changes)
   - Auto-corrections applied
   - Errors encountered

5. **Completion Summary:**
   - Total processing time
   - Final counts
   - Download audit log (CSV)

#### Auto-Correction Features:

- Missing organisation IDs filled automatically
- Missing compliance matrices created
- Orphaned observations linked to vehicles
- Zone assignments corrected via GPS

---

### 📈 Reports & Analytics

**View compliance statistics and zone performance.**

#### Available Reports:

1. **Zone Performance:**
   - Total observations per zone
   - Compliance rate
   - Most active days
   - Average vehicles per day

2. **Vehicle Activity:**
   - Frequent visitors
   - Compliance trends
   - Flagged vehicles
   - Homeless tracking

3. **Officer Performance:**
   - Scans per officer
   - Patrol completion rates
   - Average patrol duration
   - Investigation completion times

4. **Compliance Analytics:**
   - Overall compliance rate
   - Breach trends
   - Common violations
   - Seasonal patterns

#### Exporting Reports:

- **CSV** - For Excel/spreadsheet analysis
- **PDF** - For printing/distribution
- **JSON** - For technical integration

---

### 🎯 Quick Tips for Admins

✅ **Do's:**
- Set up zones with accurate geofences before field work starts
- Configure welfare settings for each officer
- Review and approve incidents within 24 hours
- Monitor Live Officer Tracking during shifts
- Respond to welfare alerts immediately
- Keep zone legal configurations up to date
- Export and archive reports regularly

❌ **Don'ts:**
- Don't change zone rules without recalculating compliance
- Don't ignore Critical welfare alerts
- Don't approve incidents without reviewing photos
- Don't delete users (deactivate instead)
- Don't modify geofences while officers are in the field
- Don't change GPS ping intervals too frequently (affects battery)

---

# Troubleshooting

## Common Issues - Field Staff

### "Zone Not Auto-Detecting"

**Problem:** App doesn't select zone automatically when I arrive  
**Solution:**
1. Check GPS/Location is enabled in phone settings
2. Check you're actually inside the geofence boundary
3. Manually select zone from dropdown
4. GPS accuracy must be <100m for auto-detection

---

### "Camera Won't Scan Plates"

**Problem:** Plate recognition not working  
**Solution:**
1. Ensure good lighting (not backlit)
2. Hold phone steady for 2-3 seconds
3. Make sure plate is in focus
4. Try manual entry if camera fails
5. Clean camera lens

---

### "Scans Not Syncing"

**Problem:** Offline queue not uploading  
**Solution:**
1. Check internet connection (WiFi or mobile data)
2. Tap "Offline Queue" → "Retry Upload"
3. Wait 1-2 minutes for auto-sync
4. If still failing, contact admin

---

### "Welfare Warning Won't Stop Beeping"

**Problem:** Sound continues playing  
**Solution:**
1. **Tap "I'm OK" button** - Only way to stop sound!
2. Sound designed to be insistent for safety
3. If button not working, refresh app
4. Contact admin if warnings too frequent

---

### "Session History Disappeared"

**Problem:** My scans are gone!  
**Solution:**
1. Session history is **24-hour retention only**
2. Scans automatically delete after 24 hours
3. **Always export before 24 hours pass**
4. Scans still in database (check "Scanned Vehicles")

---

## Common Issues - Admin

### "Officer Not Showing on Live Map"

**Problem:** Officer logged in but not on tracking map  
**Solution:**
1. Check officer has GPS/Location enabled
2. GPS ping interval might be too long (check Welfare Settings)
3. Tap "Refresh" button to reload data
4. Officer may have just logged in (wait 30 seconds)
5. Check officer is using latest app version

---

### "Geofence Not Working"

**Problem:** Officers not auto-assigned to zone  
**Solution:**
1. Geofence must be properly closed (polygon)
2. Circle geofence must have valid radius
3. Check zone is marked as "Active"
4. Verify GPS coordinates are in New Zealand
5. Test by manually entering zone coordinates

---

### "Recalculation Showing Errors"

**Problem:** Compliance recalculation fails  
**Solution:**
1. Check audit log for specific errors
2. Most errors auto-correct now (check "Auto-Fixed" count)
3. If persistent, check:
   - All zones have compliance matrices
   - No orphaned observations
   - Date ranges are valid
4. Contact support if errors continue

---

### "Notice to Vacate Not Generating"

**Problem:** PDF fails to create  
**Solution:**
1. Check zone has legal configuration set up
2. Verify breach alert has vehicle details
3. Ensure authorising officer name is filled
4. Check internet connection
5. Try different browser if on desktop

---

### "Welfare Alerts Not Sending"

**Problem:** No alerts received for inactive officer  
**Solution:**
1. Check officer's Welfare Settings are enabled
2. Verify officer has GPS enabled on device
3. Check if officer is on active investigation (exemption)
4. Verify admin has notification permissions enabled
5. Check officer's device is online (not offline mode)

---

## Emergency Contacts

**Technical Support:**  
- Email: support@freedomcamp.nz  
- Phone: 0800 FREEDOM (0800 373 336)  
- Hours: 24/7

**System Issues:**  
- Database problems  
- Login failures  
- Data loss  

**Training Requests:**  
- New user onboarding  
- Refresher training  
- Advanced features  

---

## Appendix: Glossary

**Term** | **Definition**
--- | ---
**Compliance** | Vehicle meets zone requirements (self-contained, time limits, etc.)
**Geofence** | Virtual boundary around a zone for auto-detection
**Observation** | Single recorded sighting of a vehicle in a zone
**Breach Alert** | Notification that a vehicle violated zone rules
**Matrix** | Set of compliance rules for a zone
**Drift Event** | When compliance results change due to rule changes
**Sticky Zone** | Zone selection persists until officer leaves geofence
**GPS Watermark** | Automatic addition of GPS coordinates + timestamp to photos
**Court-Ready** | Approved incident with verified evidence for legal proceedings
**Welfare Check** | Automated safety monitoring for inactive officers
**Investigation Exception** | Welfare monitoring paused during active investigation work
**Session Retention** | 24-hour storage of scans on device before auto-deletion

---

**End of Manual**  
Version 1.0 - January 2026
