# PTT Enterprise Stack Fit and Build Baseline

Updated: 2026-04-24

Owner: Platform + Voice Team

## 1) Executive Summary

This codebase can support enterprise-grade PTT, but repeated failures are mostly deployment and configuration drift, not missing transport fundamentals.

Current baseline:

1. Web PTT transport path exists and is functional in code.
2. Security posture is close, but strict production guards were incomplete.
3. Speech translation exists as text translation plus TTS synthesis.
4. Voice cloning and voice emulation are not currently implemented.
5. ONNX runtime is primarily wired for vision and safety features, not low-latency cloned-voice speech.

## 2) What Is Already in Place

1. Signaling server with half-duplex control, protocol negotiation, diagnostics, and TURN posture checks.
2. Supabase edge function for token mint brokering and org-scoped access control.
3. Web client protection for mixed-content websocket failures, reconnect logic, and WebRTC diagnostics.
4. Edge functions for transcription, translation, and speech synthesis.

## 3) High-Risk Gaps Found in Current Runtime Strategy

1. Production protocol drift (http or ws instead of https or wss) has been a primary failure source.
2. No admin hard-revocation endpoint existed for immediate user deactivation.
3. Mobile-native PTT implementation is not yet present.
4. Current TTS path uses espeak-ng style voices and cannot emulate a specific officer voice.

## 4) Changes Applied in This Session

1. Added force-disconnect endpoint on signaling server at DELETE /api/connections/:userId.
2. Added production secure URL enforcement in ptt-signaling-token edge function.
3. Added controlled local override support with PTT_ALLOW_INSECURE_HTTP=true.

These changes directly reduce repeated connect failures and stale session issues.

## 5) ONNX and Model Fit Assessment

1. onnxruntime-node is installed and used for detection and vision workloads.
2. Speech transcription uses Whisper service or CLI fallback, not ONNX streaming ASR.
3. TTS uses espeak-ng, which is reliable but not natural and not voice-clone capable.
4. Voice emulation and voice cloning are not implemented in the current inference runtime.

Conclusion: current ONNX setup is valid for existing AI features, but not sufficient by itself for enterprise low-latency multilingual voice cloning.

## 6) Recommended Enterprise Voice Architecture

The items in this section are proposed future-state designs, not claims of current implementation.

1. Keep current signaling path and add a dedicated speech pipeline.
2. Build real-time pipeline stages as receive audio, ASR, translation, synthesized playback.
3. Support two voice modes: compliance-safe synthetic presets and consent-based voice-match profiles.
4. Keep current TTS as fallback and add premium neural TTS or self-hosted voice-clone service for high-quality voice match.

## 7) Build Order

All phases below are proposed roadmap steps.

Phase 0 reliability and security:

1. Complete TLS and wss rollout checks in all deployed environments.
2. Verify TURN credentials and relay policy in production diagnostics.
3. Wire admin offboarding to call DELETE /api/connections/:userId.

Phase 1 translation without cloning:

1. Add PTT receive transcript stream.
2. Add listener-side live translation overlay.
3. Add translated TTS playback channel with mute and duck controls.

Phase 2 voice emulation:

1. Add voice-profile enrollment and explicit consent workflow.
2. Add secure voice profile storage with org-scoped policy.
3. Add anti-abuse controls including watermarking, rate limits, and audit logs.

Phase 3 mobile parity:

1. Build mobile-app native PTT module with background receive.
2. Add translation and TTS playback controls to mobile parity screens.

## 8) Enterprise Acceptance Criteria

1. Zero http or ws signaling in production.
2. Connection success rate greater than or equal to 99.5% over 24 hours with live users.
3. Median one-way translated voice latency less than or equal to 1200 ms.
4. Forced disconnect works within 3 seconds of admin action.
5. PTT plus translation path has an audit trail per transmission.
6. Voice-match mode cannot be enabled without explicit per-user consent.

## 9) Immediate Next Ticket

Implement server-side and UI wiring for admin offboarding so revoking PTT access triggers DELETE /api/connections/:userId.
