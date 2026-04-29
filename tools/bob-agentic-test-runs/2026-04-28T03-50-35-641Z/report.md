# Bob Agentic Test Orchestrator Report

- Run ID: 2026-04-28T03-50-35-641Z
- Batch: all
- Scope: full
- Started: 2026-04-28T03:50:35.642Z
- Ended: 2026-04-28T08:12:32.224Z
- Resume Mode: false
- Continue On Failure: true
- Browser Install Attempted: true
- Browser Install Exit Code: 0
- Passed: 5
- Failed: 3

## Stage Results

- PASS lint: Lint codebase (exit=0, durationMs=49737)
- PASS build: Build app (exit=0, durationMs=89264)
- PASS nav-parity: Run navigation parity tests (exit=0, durationMs=12158)
- PASS unit: Run unit tests (exit=0, durationMs=34431)
- PASS api: Run API supporting-function tests (exit=0, durationMs=18440)
- FAIL workflow-e2e-all-projects: Run end-to-end workflow tests across desktop/mobile projects (exit=1, durationMs=12957842)
- FAIL visual-e2e-emulation: Run visual regression-style sweeps on desktop and mobile emulation (exit=1, durationMs=452674)
- FAIL human-engine: Run agentic human-test engine for broad UI workflow probing (exit=1, durationMs=2101252)

