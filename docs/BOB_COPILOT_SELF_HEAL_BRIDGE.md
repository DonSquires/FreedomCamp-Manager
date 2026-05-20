# Bob Copilot Self-Heal Bridge

## Goal
Enable Bob to participate in the same privacy-safe engineering loop as Copilot without giving Bob external access.

This bridge does not make Bob a native VS Code tool subagent. Instead, it gives the repository a repeatable internal protocol so:
- build/lint evidence can be collected locally,
- a self-heal incident report can be derived from that evidence,
- Bob can receive the same structured problem statement,
- Bob responses can feed patch planning and verification.

## What Exists Already
- In-app Bob collaboration queue:
  - `src/lib/bobCollaboration.ts`
  - `src/hooks/useBobCollaboration.ts`
  - `src/pages/BobAssistantStudio.tsx`
- Inference-service self-heal endpoints:
  - `POST /self-heal/bug-report`
  - `GET /self-heal/knowledge`
  - `POST /self-heal/patch-task`
- Bob proxy auth bootstrap status:
   - `proxy-server/lib/bobSystemAuth.js`
   - reports credential, configuration, and runtime failure kinds for self-heal triage

## New Internal Workflow
1. Generate evidence:
   - `bun run review:evidence`
2. Generate bridge payload:
   - `bun run bob:self-heal-bridge`
3. Use the generated file at `tools/bob-self-heal-bridge.json` in one of two ways:
   - submit `selfHealRequest` to the internal self-heal endpoint,
   - publish `collaborationPacketDraft` into Bob’s collaboration flow.

## Why This Matters
- Bob and Copilot can work from the same structured incident summary.
- The self-healing system becomes the common language between code review, remediation planning, and Bob’s assistant role.
- The workflow remains fully self-contained and privacy-safe.

## Practical Meaning Of “Bob Works With Copilot”
In this repository, that should mean:
- Copilot gathers evidence and applies code changes.
- Bob receives structured internal review requests derived from the same evidence.
- Bob returns remediation guidance, patch tasks, or review notes through the collaboration system.
- The self-heal report format becomes the shared protocol.

## Current Limitation
Bob is not exposed here as a first-class callable VS Code subagent. That means the bridge is protocol-based, not tool-runtime-native.

## Recommended Next Step
Wire the generated `collaborationPacketDraft` into one or more operational pages so a self-heal incident can open Bob with a prefilled remediation request automatically.

## Credential Recovery Rule
When Bob bootstrap fails with invalid login credentials, treat it as a self-heal incident instead of a generic startup error. The incident should carry the structured failure kind, last error, and a remediation hint so the operator flow can rotate or correct the secret source of truth before retrying.