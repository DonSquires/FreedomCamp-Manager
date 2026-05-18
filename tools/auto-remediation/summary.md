# Automated Remediation Report

Generated: 2026-05-18T22:14:29.523Z
Dependency auto-fix enabled: false

## Steps

| Step | Result | Command |
|---|---|---|
| install | ok | bun install --frozen-lockfile |
| eslint-fix | ok | bunx eslint . --fix --format json --output-file '/home/runner/work/FreedomCamp-Manager/FreedomCamp-Manager/tools/auto-remediation/eslint-report.json' |
| bun-audit | warning | bun audit > '/home/runner/work/FreedomCamp-Manager/FreedomCamp-Manager/tools/auto-remediation/bun-audit.txt' |
| bun-outdated | ok | bun outdated > '/home/runner/work/FreedomCamp-Manager/FreedomCamp-Manager/tools/auto-remediation/bun-outdated.txt' |
| npm-audit | warning | npm audit --json > '/home/runner/work/FreedomCamp-Manager/FreedomCamp-Manager/tools/auto-remediation/npm-audit.json' |
| npm-outdated | warning | npm outdated --json > '/home/runner/work/FreedomCamp-Manager/FreedomCamp-Manager/tools/auto-remediation/npm-outdated.json' |

## Changed Files

- tools/auto-remediation/

## Notes

- none

## Artifacts

- tools/auto-remediation/summary.json
- tools/auto-remediation/eslint-report.json (if produced)
- tools/auto-remediation/bun-audit.txt (if produced)
- tools/auto-remediation/npm-audit.json (if produced)
