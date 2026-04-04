# Bob Collaboration Bridge

## Purpose

This bridge provides a lightweight in-app protocol for handing structured build, workflow, and support context into Bob Assistant.

It is intended for:

- failed AI support/intake flows that should continue in Bob
- field portal handoffs where Bob needs current page context
- future Copilot-to-Bob or system-to-Bob collaboration points

## Implementation

Shared bridge module:

- [src/lib/bobCollaboration.ts](src/lib/bobCollaboration.ts)

The bridge stores a short queue of collaboration packets in session storage for the active browser session.

## Packet Shape

Each packet contains:

- `source`: where the handoff came from
- `title`: short operator-facing title
- `summary`: optional short explanation shown in Bob
- `prompt`: full context that Bob should continue from
- `route`: optional suggested destination route
- `createdAt`: packet creation timestamp
- `expiresAt`: optional expiry for short-lived handoffs
- `metadata`: optional structured details for future flows

## Current Flow

Implemented now:

1. AI Feedback Chat publishes a packet when its edge-backed assistant is unavailable.
2. Bob Assistant consumes the newest packet on load.
3. Bob pre-fills the conversation input and shows the packet summary in the UI.

## API

Publish a packet:

```ts
publishBobCollaborationPacket({
  source: 'system',
  title: 'Example Handoff',
  summary: 'Short explanation for the operator',
  prompt: 'Full context for Bob to continue from',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
})
```

Consume the next packet:

```ts
const packet = consumeLatestBobCollaborationPacket()
```

Peek at queued packets without consuming:

```ts
const packets = peekBobCollaborationPackets()
```

## Design Notes

- Session-scoped by design: collaboration context should not leak across browser sessions.
- Queue-based so multiple subsystems can hand off context without overwriting each other.
- Short-lived expiry support prevents stale operational context from resurfacing later.
- The bridge is UI-safe and does not require database migrations.

## Extension Ideas

- Add a Bob inbox panel for multiple queued collaboration packets.
- Add route-specific publishers from officer portals, dispatch, and diagnostics.
- Add audit logging when a packet is consumed by Bob.
- Add typed packet categories for bug triage, incident support, and code-change workflows.