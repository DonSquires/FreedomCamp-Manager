# ADR 008: Voice-Twin Governance Model and Consent Framework

**Date**: 2026-05-15  
**Status**: Proposed (awaiting Phase 0 entry gate approval)  
**Consequences**: Defines legal, operational, and technical boundaries for optional voice-matched relay in Phase 5.

## Context

Phase 5 of the radio redesign proposes **voice-twin relay**: optional capability allowing officers to receive tactical radio translations in a synthetic voice that matches their original voice profile, enabling rapid recognition under field stress.

Voice-twin introduces significant trust, legal, and operational risks:
- **Deepfake concern**: Officers and leadership must trust that voice-twins are clearly synthetic and auditable
- **Consent model**: Explicit enrollment + ongoing revocation must be enforced
- **Watermarking**: Every voice-twin output must be tagged as synthetic
- **Audit trail**: All voice-twin uses logged and queryable by org
- **Provider selection**: Which provider (ElevenLabs, Google, AWS Polly) is trustworthy and compliant?
- **Emergency clause**: Opt-out and disable-all procedures must work during tactical emergency

This ADR proposes a governance framework to retire early risks before Phase 5 implementation.

## Decision

Implement a **Three-Tier Consent + Audit Model** for voice-twin:

### Tier 1: User Enrollment (Explicit Consent)
> **Implementation Note**: The following pages and functions are planned for Phase 0 implementation and do not yet exist in the codebase. They are referenced here as architectural intent and will be created during Phase 0 ticket execution.
> - **Future Pages**: `src/pages/VoiceTwinEnrollment.tsx`, `src/pages/VoiceProfileManagement.tsx`, `src/pages/VoiceTwinAuditDashboard.tsx`
> - **Future Functions**: `supabase/functions/synthesize-voice-twin/`, `supabase/functions/synthesize-translated-audio/`
> - **Current Status**: Planned in `system_state.json` as `phase_0_planned_modules`


```sql
CREATE TABLE radio_voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  provider TEXT NOT NULL,  -- 'elevenlabs', 'google', 'none'
  provider_voice_id TEXT,  -- external provider's voice profile ID
  enrollment_date TIMESTAMP DEFAULT now(),
  last_updated TIMESTAMP DEFAULT now(),
  is_revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP,
  revoked_by UUID,  -- self-revocation or admin revocation
  -- Consent metadata
  consent_text TEXT NOT NULL,  -- Legal text user accepted
  consent_accepted_at TIMESTAMP NOT NULL,
  consent_version TEXT NOT NULL,  -- versioning for legal updates
  UNIQUE (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (revoked_by) REFERENCES auth.users(id)
);

CREATE POLICY "radio_voice_profiles_org_isolation"
  ON radio_voice_profiles
  FOR ALL
  USING (org_id = current_setting('request.jwt.claims.org_id')::uuid);
```

### Tier 2: Runtime Enablement (User Settings)

- Each officer has a **voice-twin preference** setting: enabled/disabled
- Org admins can **disable all voice-twins** globally in settings (emergency off switch)
- Supervisor can **revoke a user's profile** without user action (escalation path)
- User can **self-revoke** at any time (consent withdrawal)

### Tier 3: Audit & Tagging (Compliance)

```sql
CREATE TABLE radio_voice_twin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  channel_id TEXT NOT NULL,
  user_id UUID NOT NULL,  -- user receiving the translated voice
  speaker_id UUID NOT NULL,  -- original speaker
  provider TEXT NOT NULL,
  voice_profile_id UUID REFERENCES radio_voice_profiles(id),
  transmission_segment_id UUID,  -- links to transcript segment
  created_at TIMESTAMP DEFAULT now(),
  -- Metadata for forensic audit
  is_emergency_bypass BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  INDEX (org_id, user_id, created_at)
);

-- Example query: "Show all voice-twins used for user X in last 7 days"
SELECT * FROM radio_voice_twin_events 
WHERE org_id = $1 AND user_id = $2 AND created_at > now() - interval '7 days';
```

### Audio Watermarking & Transparency

Every voice-twin output is tagged with:
- **Synthetic indicator**: "This is a synthesized translation"
- **Original speaker name**: "Translation of [Original Officer Name]"
- **Timestamp**: When synthesis occurred
- **Confidence**: Translation confidence score (if available)

Example output:
> **[SYNTHETIC TRANSLATION]** Officer Smith: "All units, be advised. Noise complaint in progress at Harbor Road. Over." *[Original speaker: Officer Jones | Confidence: 95% | 13:42:15 NZST]*

## Implementation Plan

> **Future-state proposal**: All pages, edge functions, and tables listed below are planned targets registered in `system_state.json` under `phase_0_planned_modules`. None exist in the repo yet. This section defines the target implementation scope for Phase 0-5 only.

### Phase 5 Scope

1. **Enrollment UI** (`src/pages/VoiceTwinEnrollment.tsx`) *(planned)*:
   - Display consent text (version-controlled)
   - Capture user acceptance and timestamp
   - Record in `radio_voice_profiles` with `is_revoked = FALSE`

2. **Voice Profile Manager** (`src/pages/VoiceProfileManagement.tsx`) *(planned)*:
   - List enrolled profiles
   - Revocation button (sets `is_revoked = TRUE`, `revoked_at = now()`)
   - Show audit trail of voice-twin uses

3. **Runtime Check** (before synthesis):
   ```typescript
   async function shouldUseVoiceTwin(userId: string, orgId: string): Promise<boolean> {
     // Check 1: User has enrolled profile
     const profile = await supabase
       .from('radio_voice_profiles')
       .select('*')
       .eq('user_id', userId)
       .eq('org_id', orgId)
       .maybeSingle();
     
     if (!profile || profile.is_revoked) return false;
     
     // Check 2: User preference is enabled
     const preference = await supabase
       .from('user_radio_preferences')
       .select('voice_twin_enabled')
       .eq('user_id', userId)
       .maybeSingle();
     
     if (!preference?.voice_twin_enabled) return false;
     
     // Check 3: Org admin hasn't disabled globally
     const orgSetting = await supabase
       .from('organization_radio_settings')
       .select('voice_twin_disabled')
       .eq('org_id', orgId)
       .maybeSingle();
     
     if (orgSetting?.voice_twin_disabled) return false;
     
     return true;
   }
   ```

4. **Synthesis Edge Function** (`supabase/functions/synthesize-voice-twin/`) *(planned)*:
   - Check `shouldUseVoiceTwin()`
   - If `true`, call provider API and tag output with watermark
   - Log event to `radio_voice_twin_events`
   - If `false`, use neutral dispatch voice (fallback)

5. **Audit Dashboard** (`src/pages/VoiceTwinAuditDashboard.tsx`) *(planned)*:
   - Org admins view all voice-twin uses by date, user, channel
   - Export audit report for compliance

## Fallback & Emergency Procedures

- **Provider unavailable**: Fall back to neutral voice (no user profile)
- **Enrollment system down**: Disable all voice-twins (safe mode)
- **User emergency revocation**: 1-click global disable in user settings
- **Org emergency disable**: Admin toggle to disable all profiles in org

## Risks & Mitigation

| Risk | Mitigation |
|------|-----------|
| Deepfake misuse in evidence | Watermarking + org audit trail makes synthetic provenance clear |
| Unauthorized profile creation | Require explicit consent + version control; log all changes |
| Provider data breach | Use provider with strong security (SOC 2, ISO 27001); consider self-hosted fallback |
| Officer distrust | Transparent enrollment, clear watermarking, easy revocation |
| Regulatory gap | Consult legal team pre-Phase 5; version consent text |

## Approval Gate

- [ ] **Legal/Compliance**: Consent framework reviewed; privacy impact assessed
- [ ] **Iron Eagle Leadership**: Voice-twin use case and risks understood; opt-in policy approved
- [ ] **Field Operations**: Officer feedback on enrollment and revocation UX collected
- [ ] **Security**: Provider selection (API keys, data residency) approved
- [ ] **Ops**: Audit reporting infrastructure ready

## Consequences

1. **Phase 5 prerequisite**: User enrollment UI + audit tables must pass security review before Phase 4 → Phase 5 transition
2. **Compliance**: Voice-twin audit trail retained per org policy (default: 1 year)
3. **Support**: Officers must be trained on revocation and emergency disable procedures
4. **Cost**: Voice synthesis per-use cost (ElevenLabs ~$0.003 per 1000 chars); metered and reported to Iron Eagle
5. **Future legal**: If New Zealand regulates synthetic media or consent frameworks change, this ADR must be revisited

## ADR Dependencies

- Depends on ADR-006 (SFU Platform) for audio pipeline
- Depends on ADR-007 (Event Backbone) for audit trail integration
- Feeds into Phase 5 implementation + Phase 6+ (future regulatory adaptations)

---

**Phase 0 Entry Gate Status**: ⏳ Pending
