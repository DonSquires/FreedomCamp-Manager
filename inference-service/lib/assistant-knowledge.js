function trimText(value, maxLen = 1200) {
  const text = String(value || '').trim();
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

const KNOWLEDGE_PACKS = {
  build_context: {
    name: 'fieldops-build-context',
    summary: 'React + TypeScript frontend, Supabase backend, Railway inference microservice, strict self-contained mode supported.',
    key_points: [
      'Frontend stack: React 18, TypeScript, Vite, Tailwind, shadcn/ui.',
      'Backend stack: Supabase Postgres + Edge Functions + RLS.',
      'Inference stack: Node/Express + ONNX + OCR with local-first pathways.',
      'Strict mode goal: block outbound cloud egress and keep processing local.',
      'CI gates should validate build, API behavior, and mobile compatibility.',
    ],
  },
  nz_compliance_context: {
    name: 'nz-compliance-context',
    summary: 'Operational guidance for privacy-by-design and evidence handling in New Zealand deployments.',
    key_points: [
      'Minimize personal data collection and retain only what is operationally necessary.',
      'Apply access controls, audit logging, and least privilege for enforcement data.',
      'Treat legal/compliance output as engineering guidance, not formal legal advice.',
      'Prefer deterministic local processing for sensitive imagery and identifiers.',
      'Ensure traceability of automated decisions and allow human review.',
    ],
  },
  coding_context: {
    name: 'solution-engineering-context',
    summary: 'Structured debugging and remediation planning for production systems.',
    key_points: [
      'Reproduce first, isolate root cause, then apply minimal targeted fix.',
      'Prioritize severity-based mitigation: security, data integrity, availability, UX.',
      'Add tests for regression prevention before shipping high-risk fixes.',
      'Prefer reversible rollout with feature flags when impact is uncertain.',
      'Document assumptions and unknowns in every remediation plan.',
    ],
  },
  ui_design_context: {
    name: 'ui-ux-design-assessment',
    summary: 'UI visualisation, layout analysis, colour assessment, accessibility auditing, and human-friendliness evaluation for FieldOps Manager pages.',
    key_points: [
      'Design system: Tailwind CSS v3 + shadcn/ui (Radix). HSL CSS variables for theming. Four themes: light, dark, high-contrast, night-patrol.',
      'Primary colour: teal (HSL 187 72% 37%). Accent: amber (HSL 48 96% 53%). Destructive: red (HSL 0 84% 60%). All from CSS custom properties.',
      'Night-patrol mode: pure black background, bright cyan primary, 56px min button height, 52px min input height, 17px base font — designed for gloves and low-light.',
      'WCAG accessibility: minimum AA contrast (4.5:1 text, 3:1 large text). Use ARIA attributes, semantic HTML, focus-visible rings, sr-only labels.',
      'Responsive breakpoints: sm 640px, md 768px, lg 1024px, xl 1280px. Mobile-first layout with flex/grid containers.',
      'Component patterns: dashboard (grid cards + table), form (labelled inputs + validation), list (virtualized + empty states), detail (hero + tabs), map (full-height + overlays).',
      'Spacing rhythm: consistent padding/margin scale (Tailwind p-2/p-4/p-6). Cards use rounded-lg (0.75rem). Elevated cards have multi-layer box-shadow.',
      'Typography hierarchy: headings (text-lg to text-3xl, font-semibold/bold), body (text-sm/text-base), muted captions (text-muted-foreground).',
      'Human-friendliness rubric: accessibility (35% weight), responsiveness (30% weight), design consistency (35% weight). Score 80+ is good.',
      'Image analysis: assess whitespace (15-40% ideal), colour variety (5-15 significant buckets), contrast ratio, visual complexity via edge density.',
    ],
  },
};

function classifyBugType(report) {
  const text = `${report.summary || ''}\n${report.stack_trace || ''}`.toLowerCase();
  if (text.includes('timeout') || text.includes('latency')) return 'performance';
  if (text.includes('permission') || text.includes('forbidden') || text.includes('unauthorized')) return 'auth';
  if (text.includes('cannot') && text.includes('module')) return 'dependency';
  if (text.includes('null') || text.includes('undefined') || text.includes('typeerror')) return 'runtime';
  if (text.includes('cors')) return 'cors';
  if (text.includes('migration') || text.includes('schema') || text.includes('column')) return 'database';
  return 'general';
}

function severityWeight(severity) {
  const value = String(severity || 'medium').toLowerCase();
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'low') return 1;
  return 2;
}

function buildSelfHealingPlan(report, options = {}) {
  const bugType = classifyBugType(report);
  const sev = String(report.severity || 'medium').toLowerCase();
  const weight = severityWeight(sev);
  const inSelfContainedMode = Boolean(options.selfContainedMode);

  const reproduction = [
    'Capture request payload and endpoint path from logs.',
    'Replay with minimal input that still reproduces the issue.',
    'Confirm expected vs actual behavior with one deterministic test case.',
  ];

  const remediation = [
    'Patch the smallest code path that triggers the failure.',
    'Add a regression test tied to the reproduced case.',
    'Deploy behind a guarded rollout if severity is high or critical.',
  ];

  if (bugType === 'auth') {
    remediation.unshift('Validate auth token source and required claims before handler logic.');
  }
  if (bugType === 'database') {
    remediation.unshift('Verify migration state and table/column compatibility against runtime types.');
  }
  if (bugType === 'dependency') {
    remediation.unshift('Check runtime image includes required module/native library artifacts.');
  }
  if (inSelfContainedMode) {
    remediation.push('Verify no external network dependency is introduced by the fix.');
  }

  const safeguards = [
    'Enable structured logging for this failure signature.',
    'Add alerting threshold for recurrence in 15-minute windows.',
    'Store incident timeline and final patch reference for audit.',
  ];

  const automation = [
    {
      action: 'triage',
      enabled: true,
      detail: `Classified bug type: ${bugType}`,
    },
    {
      action: 'auto_patch',
      enabled: weight <= 2,
      detail: weight <= 2
        ? 'Low/medium severity can auto-open patch task.'
        : 'High severity requires human approval before patching.',
    },
    {
      action: 'auto_deploy',
      enabled: false,
      detail: 'Require human review before production rollout.',
    },
  ];

  return {
    summary: trimText(report.summary, 500),
    severity: sev,
    bug_type: bugType,
    recommended_owner: bugType === 'database' ? 'backend-data-team' : 'platform-engineering',
    reproduction,
    remediation,
    safeguards,
    automation,
    legal_note: 'Guidance is operational and technical only; obtain legal review for statutory interpretation.',
    context_used: Object.keys(KNOWLEDGE_PACKS),
  };
}

function getKnowledgePacks() {
  return KNOWLEDGE_PACKS;
}

function buildPatchTask(report, plan) {
  const summary = trimText(report?.summary || plan?.summary || 'Unspecified incident', 300);
  const severity = String(report?.severity || plan?.severity || 'medium').toLowerCase();
  const weight = severityWeight(severity);
  const bugType = plan?.bug_type || classifyBugType(report || {});

  const riskScore = Math.max(1, Math.min(10, weight * 2 + (bugType === 'security' ? 2 : 0)));
  const requiresApproval = riskScore >= 7;

  const tasks = [
    {
      id: 'reproduce',
      title: 'Reproduce issue with deterministic input',
      status: 'pending',
    },
    {
      id: 'fix',
      title: 'Apply minimal targeted code fix',
      status: 'pending',
    },
    {
      id: 'regression-test',
      title: 'Add regression test for incident signature',
      status: 'pending',
    },
    {
      id: 'deploy-check',
      title: 'Run deployment gate checks before release',
      status: 'pending',
    },
  ];

  return {
    version: 1,
    summary,
    severity,
    bug_type: bugType,
    risk_score: riskScore,
    requires_human_approval: requiresApproval,
    owner: plan?.recommended_owner || 'platform-engineering',
    tasks,
    safeguards: plan?.safeguards || [],
    notes: [
      'No automatic production deploy without human approval.',
      'Preserve audit trace of analysis, patch, and verification.',
    ],
  };
}

module.exports = {
  buildSelfHealingPlan,
  buildPatchTask,
  getKnowledgePacks,
};
