# Bob/Dr Bob Training Pack: Tenant Isolation Proof

Purpose: force explicit proof of no cross-tenant leakage for every redesign/new module.

## Multi-Org Contract

- All reads/writes must be scoped by active organizationId.
- Every page shows active-org context indicator.
- Hidden controls are insufficient: service-layer org enforcement is mandatory.

## Required Proof Section in Responses

Include a section titled: Tenant Isolation Proof

It must list:

- Data boundaries: where orgId is injected in each query/mutation
- UI boundaries: where active org indicator is rendered
- Permission boundaries: role/permission gates
- Error boundaries: no foreign-tenant data leakage in messages
- State boundaries: cache keys include orgId and reset on org switch

## Negative Test Cases (Mandatory)

- Org A user cannot read Org B users/invites
- Org A invite cannot target Org B
- Switching org clears stale org data
- Unauthorized role cannot invoke privileged org actions

## Acceptance Gate

Pass only if no unresolved leakage vector remains.
