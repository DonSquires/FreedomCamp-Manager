# PTT Enterprise Manual Testing Checklist

**Date**: 2026-05-14  
**Testers**: Bob (AI assistant), Officer (Field User)  
**Environment**: Live Production  
**Objective**: Validate enterprise-grade PTT functionality across UI, toggles, channels, transmission, and translation

---

## Pre-Test Setup

- [ ] Both users logged into the app (Bob and Officer with different roles)
- [ ] Both users on desktop (1920×1080+) for full UI visibility
- [ ] Network latency measured (RTT to Supabase < 200ms)
- [ ] Audio devices enabled and tested (microphone + speakers)
- [ ] RunPod translator endpoint reachable (test at `/bob-translator-health`)

---

## Section 1: Visual UI & Layout

### Test 1.1: Radio loads with correct layout
- [ ] Navigate to `/ptt-radio`
- [ ] Radio container visible and not clipped
- [ ] Channel selector visible (shows "CH 1", "All Units", or similar)
- [ ] PTT button prominent and clickable in center
- [ ] Settings/gear button visible in top-right or settings area
- [ ] No layout overflow or hidden elements

### Test 1.2: Desktop responsive layout
- [ ] Resize to 1920×1080 (full desktop)
- [ ] Left side: channel selector, PTT button, controls
- [ ] Right side: roster (Units Online) visible
- [ ] Bottom: transmission log scrollable
- [ ] No elements hidden or stacked unexpectedly

### Test 1.3: Mobile layout (if supported)
- [ ] Resize to 375×667 (mobile)
- [ ] PTT button and channel selector centered
- [ ] Settings accessible
- [ ] No horizontal scroll

---

## Section 2: Buttons & Controls Responsiveness

### Test 2.1: PTT Hold-to-Talk button
- [ ] Button visible and has "Push to talk" or similar label
- [ ] Mouse hover highlights button
- [ ] Click/hold activates transmission mode (button style changes, indicator appears)
- [ ] Release stops transmission
- [ ] No lag between press and response (target: < 100ms)

### Test 2.2: Settings button
- [ ] Gear icon or "Settings" button visible
- [ ] Click opens settings panel (no delay > 500ms)
- [ ] Settings panel covers VOX, Translator, Target Language, Scanner Dwell
- [ ] Panel closes when clicked again or on close button

### Test 2.3: Show/Hide Interpreter button
- [ ] Button labeled "Show Interpreter" or "Hide Interpreter"
- [ ] Click toggles interpreter panel visibility
- [ ] Panel slides in/out smoothly
- [ ] Blue highlight appears on active state

### Test 2.4: Emergency Broadcast button
- [ ] Red "Emergency — All Channels" button visible
- [ ] Button has red styling and warning icon
- [ ] Click triggers emergency mode (visual feedback, potential audio alert)

---

## Section 3: Channel Controls

### Test 3.1: Channel selector
- [ ] Channel list visible (dropdown or buttons)
- [ ] Can select different channels (CH 1, CH 2, etc.)
- [ ] Selected channel highlighted/bold
- [ ] Name and frequency/description visible

### Test 3.2: Channel switching latency
- [ ] Switch between 2+ channels
- [ ] Time to switch: < 1 second
- [ ] No dropped connections on switch
- [ ] Roster updates after switch

---

## Section 4: Settings Panel & Toggles (Phase 2 Fixes)

### Test 4.1: VOX Mode toggle
- [ ] Settings panel open
- [ ] VOX Mode switch visible (labeled "Voice-activated transmission")
- [ ] Click switch toggles between enabled/disabled
- [ ] Button style changes (green when on)
- [ ] **No page reload or errors**

### Test 4.2: Wake-Word toggle (Phase 2)
- [ ] Show Interpreter panel
- [ ] Wake-word switch visible (labeled "Wake word ('Hey Bob')")
- [ ] Click switch toggles
- [ ] State persists after page reload: `localStorage.getItem('radio-interpreter-audio-pref-v1')`
- [ ] **No 400 errors or console errors**

### Test 4.3: Audio Ducking toggle (Phase 2)
- [ ] Show Interpreter panel
- [ ] Ducking switch visible (labeled "Audio ducking (coworker stream to 20%)")
- [ ] Click switch toggles
- [ ] Status label updates: "Bob speaking: coworker channel ducked to 20%" or "Coworker channel at normal volume"
- [ ] State persists after refresh
- [ ] **No callback errors**

### Test 4.4: Translator toggle (Phase 2)
- [ ] Settings panel open
- [ ] Translator switch visible (labeled "Enable tactical translation rail")
- [ ] Click switch toggles
- [ ] Disabled state when `providerOrgId` is null
- [ ] Enabled state when provider org is selected
- [ ] **No errors on toggle**

### Test 4.5: Target Language selector
- [ ] Settings panel open
- [ ] Target Language dropdown visible
- [ ] List includes English (NZ), Spanish, French, etc.
- [ ] Select language changes selected value
- [ ] Selection persists in localStorage

### Test 4.6: Scanner Dwell buttons
- [ ] Scanner Dwell section visible with three buttons (5s, 8s, 15s)
- [ ] Click button highlights it (yellow border, text color change)
- [ ] Active button shows which dwell time is selected
- [ ] **Already working (user confirmed this works)**

---

## Section 5: Transmission & Receive

### Test 5.1: Officer transmits on channel
- [ ] Officer holds PTT button
- [ ] Transmit indicator appears (red background, "TX" or similar)
- [ ] Bob's radio receives and shows officer name
- [ ] Officer release stops transmission
- [ ] Status returns to normal

### Test 5.2: Bob transmits on channel
- [ ] Bob holds PTT button (or uses voice PTT if enabled)
- [ ] Officer's radio receives transmission
- [ ] Officer name shows as "Bob" or "Bob Assistant" in roster
- [ ] Transmission log updates with entry

### Test 5.3: Transmission latency measurement
- [ ] Officer transmits a test message (voice or click)
- [ ] Measure time from PTT press to Bob receiving (target: < 500ms)
- [ ] Measure time from Bob transmitting to Officer receiving
- [ ] Document in results

### Test 5.4: Roster presence updates
- [ ] Both users connected
- [ ] Units Online count shows at least 2
- [ ] User names visible with status (green dot = online)
- [ ] Status updates when user disconnects/reconnects

---

## Section 6: Live Translation (Phase 2)

### Test 6.1: Translation setup
- [ ] Translator toggle ON in settings
- [ ] Target Language set to non-English (e.g., Spanish)
- [ ] Bob translator endpoint connected (check `/bob-translator-health`)

### Test 6.2: Officer transmits in English, Bob receives translated
- [ ] Officer: "Hello, can you hear me?"
- [ ] Bob's radio: receives same audio or translated version (if translation rail enabled)
- [ ] Translated text appears in transmission log or interpreter panel
- [ ] Latency: < 2 seconds from transmission to translation completion

### Test 6.3: Bob transmits translated response
- [ ] Bob speaks/types in target language
- [ ] Officer's radio receives audio (original or synthetic voice)
- [ ] Audio quality acceptable (no heavy distortion)
- [ ] Latency: < 1 second from Bob sending to Officer hearing

### Test 6.4: Audio ducking during translation
- [ ] Enable audio ducking toggle
- [ ] Officer transmits (coworker channel at 100%)
- [ ] Bob speaks (coworker channel drops to 20%)
- [ ] Officer hears Bob clearly without coworker channel masking Bob
- [ ] Ducking releases when Bob stops speaking

### Test 6.5: Wake-word control
- [ ] Enable "Wake word ('Hey Bob')" toggle
- [ ] Officer says "Hey Bob" (near microphone)
- [ ] Bob intercom activates (indicator shows)
- [ ] Officer can speak command to Bob
- [ ] Wake-word disengages after command or timeout

---

## Section 7: Multi-User Scenarios

### Test 7.1: Concurrent transmit attempt
- [ ] Officer transmits on Channel 1
- [ ] Bob attempts to transmit on Channel 1 simultaneously
- [ ] Radio handles gracefully (PTT button disabled, queued, or shows "in use")
- [ ] No audio artifacts or corruption

### Test 7.2: Handoff transmission (Officer → Bob → Officer)
- [ ] Officer transmits
- [ ] Officer releases
- [ ] Bob transmits
- [ ] Bob releases
- [ ] Officer transmits again
- [ ] All transitions smooth, no dropped audio

### Test 7.3: Emergency override
- [ ] Bob transmitting on normal channel
- [ ] Officer presses Emergency button
- [ ] Officer's emergency transmission interrupts or overlays (depending on design)
- [ ] All units receive emergency alert

---

## Section 8: Data Persistence & Reliability

### Test 8.1: Settings persist across reload
- [ ] Set: VOX ON, Wake-word ON, Ducking OFF, Target Language Spanish
- [ ] Reload page (F5)
- [ ] Verify settings still set after reload
- [ ] Check `localStorage` for `radio-interpreter-audio-pref-v1`

### Test 8.2: Channel selection persists
- [ ] Select Channel 5
- [ ] Reload page
- [ ] Verify still on Channel 5 (or same channel if stored)

### Test 8.3: Transmission log persists
- [ ] Several transmissions occur
- [ ] Reload page
- [ ] Transmission log still visible with entries

### Test 8.4: No console errors
- [ ] Open browser DevTools Console
- [ ] Perform all tests in Section 5-7
- [ ] No red error messages
- [ ] Warnings acceptable; errors block PTT functionality

---

## Section 9: Performance & Stability

### Test 9.1: PTT responsiveness under load
- [ ] 5+ rapid transmit/release cycles
- [ ] Each cycle: PTT button responds < 100ms
- [ ] No lag accumulation
- [ ] No connection drops

### Test 9.2: Long-duration transmission
- [ ] Hold PTT for 30 seconds (or max allowed duration)
- [ ] Audio streams continuously
- [ ] No cutoff or glitches mid-stream
- [ ] Release stops cleanly

### Test 9.3: Channel switching under transmission
- [ ] Officer transmitting on Channel 1
- [ ] Attempt to switch to Channel 2 (should be blocked or queued)
- [ ] After release, switch succeeds without errors

### Test 9.4: Network interruption recovery
- [ ] Transmit on stable connection
- [ ] Simulate network interruption (toggle WiFi off)
- [ ] Wait 5 seconds
- [ ] Reconnect
- [ ] Radio recovers and transmits again
- [ ] No stale state or dangling connections

---

## Section 10: UI/UX Polish

### Test 10.1: Visual feedback
- [ ] All button clicks provide immediate visual feedback (color change, scale, etc.)
- [ ] Transmit/receive status clearly indicated
- [ ] No ambiguous button states

### Test 10.2: Accessibility
- [ ] All buttons labeled (`aria-label` or text)
- [ ] Keyboard navigation works (Tab, Enter)
- [ ] Color contrast meets WCAG AA standard
- [ ] Screen reader announces button purposes

### Test 10.3: Scrolling & overflow
- [ ] Transmission log scrollable
- [ ] Roster scrollable if > 10 units
- [ ] No horizontal scroll on desktop
- [ ] Settings panel fits on screen without scroll

---

## Results Summary

| Test Category | PASS | FAIL | Notes |
|---|---|---|---|
| Visual UI & Layout | [ ] | [ ] | |
| Buttons & Controls | [ ] | [ ] | |
| Channels | [ ] | [ ] | |
| Settings & Toggles | [ ] | [ ] | |
| Transmission | [ ] | [ ] | |
| Translation | [ ] | [ ] | |
| Multi-User | [ ] | [ ] | |
| Data Persistence | [ ] | [ ] | |
| Performance | [ ] | [ ] | |
| Polish | [ ] | [ ] | |

**Enterprise Grade Sign-Off**: ✓ (all tests PASS) or ✗ (blockers below)

**Blockers Found**:
- [ ] None
- [ ] (List any critical failures)

**Recommended for Production**: Yes / No

**Sign-off by**: _____________________ **Date**: _______
