Mumble/Murmur Side-by-Side Stack

Purpose:
- Optional voice backbone service for strict topology parity.
- Runs alongside existing ptt-server until cutover is validated.

Quick start:
1. cp mumble-stack/.env.example mumble-stack/.env
2. npm run mumble:stack:up
3. Verify port 64738 TCP+UDP is reachable from client networks.
4. Keep ptt-server active during initial testing.

Suggested cutover:
1. Route pilot users to Mumble channels while retaining WebRTC path fallback.
2. Compare latency/jitter and packet loss under field load.
3. Move production traffic only after parity checklist passes.
