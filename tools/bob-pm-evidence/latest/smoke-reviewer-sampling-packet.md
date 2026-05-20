# Smoke Reviewer Sampling Packet

Generated: 2026-05-20T03:28:28.006Z

- Source: data/smoke-ablation-evals.jsonl
- Review status: sampling-packet-attached-human-signoff-pending
- Sample size: 5

| Record ID | Action | Excessive | Smoke profile | Fire type | Duration (min) |
|---|---|---|---|---|---|
| a0000000-0000-4000-0000-000000000000 | no_action | false | light/white | residential_domestic | 8 |
| a1000000-0000-4000-0001-000000000000 | verbal_warning | false | moderate/light_grey | burn_off | 20 |
| a10000000-0000-4000-0010-000000000000 | abatement_notice | false | moderate/grey | residential_domestic | 90 |
| a11000000-0000-4000-0011-000000000000 | prosecution_referral | true | heavy/yellow | industrial | 40 |
| a3000000-0000-4000-0003-000000000000 | infringement_notice | true | very_heavy/black | industrial | 60 |

## Reviewer Checklist

1. Confirm the action label matches the observed source facts, not the model prediction.
2. Confirm excessive or non-excessive classification is still defensible under the current policy.
3. Confirm no ambiguity requires adjudication or escalation.
4. Record reviewer identity and review date outside the generated packet before PM use.

