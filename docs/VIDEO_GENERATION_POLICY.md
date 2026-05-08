# Video Generation Policy

## Purpose

This policy defines technical and governance controls for Bob-generated video artifacts in FieldOps Manager.

## Allowed Use

Video generation is permitted only for:
- research
- training
- operational briefing

The caller must provide an explicit `purpose` value in every generation request.

## Authorization

Allowed roles:
- admin
- admin_officer
- master

All generation and retrieval actions must be org-scoped.

## Required Metadata

Every generated artifact must persist:
- org_id
- actor_user_id
- purpose
- source references (incident, breach, or case ids)
- model provider/name/version
- output hash
- created_at
- retention_days
- revoked_at (nullable)
- legal_hold (boolean)

## Media Constraints

Default output profile:
- container: mp4
- codec: h264
- frame rate: 30 fps
- bitrate tier: medium

Supported profiles:
- low: 720p, lower bitrate
- medium: 1080p, standard bitrate
- high: 1080p+, higher bitrate

## Consent Rules

If artifact content includes personally identifying visuals, consent status must be recorded before generation.

No synthetic impersonation workflows are allowed.

## Retention and Deletion

- Default retention: 90 days
- Revoked artifacts are hidden immediately and queued for deletion
- Legal hold blocks deletion until released

## Audit and Chain of Custody

Generation requests and outputs must be written to immutable audit records.

Audit records must include source/output hashes and generation model metadata to support evidentiary review.

## Non-Compliance Handling

Requests are denied when:
- purpose is missing or not allowed
- caller role is not allowed
- org scope validation fails
- required consent metadata is missing
