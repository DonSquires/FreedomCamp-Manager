# Enterprise Rebuild Plan (Bob Independent) - 2026-04-25

## Source

Generated from live RunPod endpoint invocation (`n0bp1ifmq01cx2`) using constrained, stack-grounded prompt.

## Bob Output (verbatim content normalized)

### Stakeholder Requirements

1. Support Freedom Camping Act workflows: warnings, infringements, and notices to vacate.
2. Support multiple organisations acting as service providers with distinct client visibility requirements.
3. Ensure clients can view their own data without seeing unrelated clients.
4. Maintain evidence chain for enforcement actions.
5. Address OIA and Privacy Act compliance expectations.
6. Follow NZ Digital government guidance for accessibility and digital service quality.
7. Meet NZISM-aligned security expectations.
8. Remain on the verified current stack.

### Council Procurement

1. Ensure platform vendors and service model meet NZ public-sector procurement expectations.
2. Make support, security, and compliance commitments explicit.
3. Define SLAs for uptime, response, and maintenance.

### Security Compliance

1. Enforce data protection with RLS.
2. Keep provider/client role boundaries explicit in existing access and RLS controls.
3. Secure RunPod inference access and logging.
4. Keep logging and monitoring across service layers.
5. Keep regular security review and validation cycles.

### Architecture Changes

1. Keep current stack and deployment boundaries explicit.
2. Improve consistency in application state and workflow handling.
3. Keep schema alignment with existing multi-org and client-visibility evidence already present in repo migrations and tests.
4. Strengthen GitHub Actions CI/CD checks.
5. Optimize frontend production behavior.

### Rollout

1. Use staging before production cutover.
2. Conduct UAT with stakeholders and providers.
3. Hold release gates on build/review quality.
4. Perform post-implementation review.

## Bob Build-Review Gate Suggestions

1. Zero lint errors before release.
2. Successful production build.
3. Route chunk strategy for large surfaces.
4. Stable review scoring trend.
5. No unauthorized outbound dependency behavior in protected modes.

## Grounding Notes

1. Bob output was constrained by explicit prompt grounding around NZ council/client/service-provider requirements.
2. Future-state ideas were normalized here into repo-grounded statements only.
3. This artifact stays independent and is not authoritative by itself.
