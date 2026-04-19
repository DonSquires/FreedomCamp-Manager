# Bob Collaboration Bridge

## Setup Complete ✅

Three modules are now ready to enable back-and-forth collaboration with Bob:

### 1. **`scripts/talk-with-bob.mjs`** — Interactive Multi-Turn Chat
- Launch interactive mode: `node scripts/talk-with-bob.mjs --interactive`
- Or pipe initial message: `echo "your question" | node scripts/talk-with-bob.mjs`
- Maintains conversation history across turns
- Each turn: Agent sends → Bob responds → Agent decides → repeat

### 2. **`scripts/agent-bob-bridge.mjs`** — Programmatic Integration
Exported functions for agent-side integration:
```javascript
import { consultBob, BobSession } from './scripts/agent-bob-bridge.mjs';

// Single query
const answer = await consultBob('Your question here');

// Multi-turn session with context
const session = new BobSession({ context: { workdir: '...' } });
const bobInput = await session.exchange('Message 1');
const refined = await session.exchange('Follow-up based on Bob\'s response');
```

### 3. **`scripts/ask-bob.mjs`** — Quick CLI Query
```bash
node scripts/ask-bob.mjs "What should we prioritize?"
```

## Environment Configuration

| Variable | Source | Used By |
|---|---|---|
| `INFERENCE_SERVICE_URL` | GitHub Secrets | All modules (required unless `BOB_SERVICE_URL` is set) |
| `INFERENCE_API_KEY` | GitHub Secrets | All modules |
| `BOB_SERVICE_URL` | GitHub Secrets | All modules (optional) |
| `BOB_INFERENCE_API_KEY` | GitHub Secrets | All modules (alternative to `INFERENCE_API_KEY`) |
| `BOB_CHAT_TIMEOUT_MS` | Optional (default 30s) | Interactive & session modes |

Security notes:
- No helper script uses hardcoded production URL defaults.
- No helper script falls back to `SUPABASE_SERVICE_ROLE_KEY`.
- Local generated credentials under `.runtime/` are runtime-only and git-ignored.

## Current Status

**Waiting For**: API credentials in shell environment for live testing.

**Once Available**, command to activate:
```bash
export INFERENCE_SERVICE_URL="https://focused-courage-production-ccee.up.railway.app"
export INFERENCE_API_KEY="<your-secret-key>"
```

Then we can start the foundation-up review immediately:
- **Agent proposes** → **Bob validates** → **Agent refines** → repeat
- **Final coding decisions** remain with Agent (coordinated with Bob's guidance)

## Collaborative Decision Flow

```
┌─────────────────────────────────────────────────────────────┐
│ AGENT (Me)        [Proposes strategic direction]            │
├────────────────────┬────────────────────────────────────────┤
│ BOB               │ [Reviews, identifies risks, suggests]  │
├────────────────────┼────────────────────────────────────────┤
│ AGENT             │ [Incorporates feedback, decides final] │
├────────────────────┼────────────────────────────────────────┤
│ BOB               │ [Validates approach, flags gaps]       │
├────────────────────┼────────────────────────────────────────┤
│ AGENT (Me)        │ [Execute, commit, move next]           │
└────────────────────┴────────────────────────────────────────┘
```

## Integration with Testing

Testing wrapper (`scripts/run-test-with-bob-assist.mjs`) already uses this pattern:
- Pre-test: Agent→Bob (risk assessment)
- Execute test
- Post-test: Agent→Bob (triage if needed)

Supported Bob endpoint env vars for the test wrapper:
- `BOB_SERVICE_URL`
- `INFERENCE_SERVICE_URL`
- `DR_BOB_URL` (accepted when it is an `http://` or `https://` endpoint)

New: We can also use interactive mode during development for real-time architecture decisions.

---

**Ready to begin foundation-up review once creds are available.**
