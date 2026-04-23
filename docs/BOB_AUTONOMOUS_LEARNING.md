# Bob Autonomous Learning

Purpose: define how Bob stays grounded, self-correcting, and context-aware in Codespaces and VPS environments.

## Final Ecosystem Checklist

| Phase | Action | Tool/Script |
| --- | --- | --- |
| Identity | Set the Truth Protocol | `.github/copilot-instructions.md` |
| Logic | Enable Multi-Org context | `useOrganization()` hook template in `docs/BOB_USER_MANAGEMENT_GOLD_STANDARD.md` |
| Memory | Automate ingestion | `scripts/auto-ingest.mjs` |
| Safety | Adversarial Review | `scripts/dr-bob-review.mjs` |
| Growth | Score the responses | `data/bob-response-scores.jsonl` |

## External Reference Set

Use these concepts as training references when refining Bob's autonomous behavior:

- Model Context Protocol (MCP): <https://modelcontextprotocol.io/>
- RAG guidance: <https://www.promptingguide.ai/research/rag>
- Greptile: <https://www.greptile.com/>
- LangSmith evaluation concepts: <https://www.langchain.com/langsmith>
- Mermaid.js Live Editor: <https://mermaid.live/>
- Keep a Changelog: <https://keepachangelog.com/en/1.1.0/>
- ADR GitHub Organization: <https://adr.github.io/>
- Sentry Guide to Error Monitoring: <https://sentry.io/for/error-monitoring/>
- UX Collective: <https://uxdesign.cc/>
- The Twelve-Factor App: <https://12factor.net/>
- AWS SaaS Factory Insights: <https://aws.amazon.com/partners/programs/saas-factory/>

These references are guidance only. Do not claim any external platform is configured in this repo unless the repo or runtime explicitly proves it.

## Automated Workflow

### Step A: Daily System Discovery

- Run `bash scripts/system-check.sh` or `node scripts/broadcast-truth-protocol.mjs` at the start of a session.
- Goal: ground Bob in the actual runtime state, lockfiles, active modules, and reachable delivery paths.

### Step B: Fail-Fast Feedback Loop

- Run `node scripts/summarize-failures.mjs` once per session.
- Review `data/bob-failure-summary.json` and `docs/BOB_FAILURE_SUMMARY.md`.
- If a hallucination pattern repeats 3 or more times, treat it as Never Use Until Verified for the rest of the session.

### Step B1: Automation Paths

- GitHub Actions automation: `.github/workflows/ops-bob-autonomous-learning.yml`
- VPS scheduler automation: `ops/bob-autonomous-learning.service`, `ops/bob-autonomous-learning.timer`, or `ops/bob-autonomous-learning.cron`
- Shared command: `bash scripts/run-autonomous-learning-cycle.sh`

### Step B2: Self-Healing Health Check

- Run `bash scripts/monitor-bob.sh` on the VPS or inside the autonomous cycle.
- It scans PM2, `journalctl`, and `/var/log/syslog` for server-side 500 errors.
- If errors spike above threshold, it appends a `critical_warning` into `system_state.json` so Bob sees degraded runtime health before answering.

### Step C: Adversarial Self-Review

- Run `node scripts/dr-bob-review.mjs --file <artifact>` or `node scripts/review-architecture-artifacts.mjs` before presenting major plans.
- If Dr Bob finds a real blocker or security flaw, add the resolved lesson to `docs/LESSONS_LEARNED.md`.

### Step D: Architectural Decision Records

- Every finalized module or architecture decision should create a new ADR in `docs/adr/00X-name.md`.
- Use `docs/adr/000-template.md` as the starting point.
- ADRs are Bob's long-term design memory and should be ingested by `scripts/auto-ingest.mjs`.

### Step E: Visual Reasoning

- For every complex UX or multi-org flow, generate a Mermaid diagram before implementation.
- Use the diagram to verify organization scoping, route guards, and service boundaries before code changes.

## Autonomous Learning Prompt

Use this grounded session prompt when enabling autonomous learning mode:

Bob, you are now in Autonomous Learning Mode. Follow these steps to stay updated without my intervention: Context Sync: every 10 messages, verify the current repo shape with a grounded file-tree check such as `find src -maxdepth 2 -type f`. Review the Scorecard: once per session, run `node scripts/summarize-failures.mjs`, identify your top 3 hallucination patterns, and state how you will avoid them. Update the Brain: if we solve a complex bug together, append a summary to `docs/DECISIONS.md`. Adversarial Check: do not submit major code or architecture work without first passing it through `scripts/dr-bob-review.mjs`.

## Workspace Tool Loop

| Tool | File Path | Training Function |
| --- | --- | --- |
| Response Logger | `scripts/bob-response-log.mjs` | Records Bob's successes and hallucinations. |
| Adversarial Review | `scripts/dr-bob-review.mjs` | Uses Dr. Bob to find "Blockers" in plans. |
| Truth Broadcaster | `scripts/broadcast-truth-protocol.mjs` | Syncs current VPS state to Bob's brain. |
| Instruction Manifest | `.github/copilot-instructions.md` | Bob's permanent memory for rules. |
