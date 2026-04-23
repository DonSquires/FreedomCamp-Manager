# Bob Gold Standard: User Management Module (Multi-Org)

This document is the canonical implementation blueprint for a high-fidelity User Management module in FreedomCamp-Manager.

## Stack Lock (Non-Negotiable)

- React 18
- TypeScript (.ts/.tsx only)
- Tailwind CSS v3
- shadcn/ui primitives from src/components/ui
- TanStack Query v5
- Zustand for app/global state when needed
- react-hook-form + zod for form validation
- Supabase typed client from src/lib/supabase

Do not use Vue, Vuex, Cypress-first test plans, or JavaScript-only module files.

## Module Location and Structure

All files belong under src/modules/user-management/ and must be self-contained.

Required structure:

- src/modules/user-management/components/
- src/modules/user-management/services/
- src/modules/user-management/hooks/
- src/modules/user-management/types.ts
- src/modules/user-management/index.ts

Suggested starter scaffold:

- src/modules/user-management/types.ts
- src/modules/user-management/index.ts
- src/modules/user-management/hooks/useOrganization.ts
- src/modules/user-management/hooks/useUserInvites.ts
- src/modules/user-management/services/userManagementService.ts
- src/modules/user-management/components/UserManagementPage.tsx
- src/modules/user-management/components/InviteUserDialog.tsx
- src/modules/user-management/components/UserTable.tsx
- src/modules/user-management/components/UserManagementEmptyState.tsx

## Multi-Org Contract (Mandatory)

Every read/write path must be tenant-scoped.

### Hook contract

```ts
export type OrganizationPermissions = {
  canInviteUsers: boolean;
  canRemoveUsers: boolean;
  canManageRoles: boolean;
};

export type OrganizationContext = {
  activeOrgId: string;
  activeOrgName: string;
  permissions: OrganizationPermissions;
};

export function useOrganization(): OrganizationContext;
```

Rules:

- activeOrgId must be resolved before data fetch/mutation.
- UI must display activeOrgName as a context indicator in header.
- Service methods must receive orgId and enforce org filters in query/mutation payloads.
- Never issue global user queries without organization scoping.

## Invite Flow State Model (Optimistic UX)

Required states for invite action:

- idle
- processing
- synced
- error

```ts
export type InviteStatus = 'idle' | 'processing' | 'synced' | 'error';
```

Behavior:

- On submit: immediately set processing (optimistic feedback).
- On success: set synced and show success toast.
- On failure: set error, surface actionable message, allow retry.
- Keep submit button disabled only during processing.

## UI/UX Standard

### Header

- Page title: User Management
- Active org indicator chip/badge
- Breadcrumbs (Portal > Admin > User Management)

### Layout

- 12-column desktop grid
- Collapse to single column on mobile
- Avoid heavy borders; prefer spacing and typography hierarchy

### Color semantics

- Primary action buttons: blue
- Success/confirmed: green
- Pending/transmitting status: amber
- Destructive actions: red

### Empty states

Design explicit empty states for:

- No users in organization
- No pending invites
- No search results

Each empty state must include a primary action where applicable.

## Service Boundaries

Use a dedicated service layer in services/userManagementService.ts.

Service API shape:

```ts
export async function listOrganizationUsers(orgId: string): Promise<OrgUser[]>;
export async function listPendingInvites(orgId: string): Promise<UserInvite[]>;
export async function inviteOrganizationUser(input: InviteUserInput): Promise<UserInvite>;
export async function revokeInvite(input: { orgId: string; inviteId: string }): Promise<void>;
```

Where InviteUserInput includes orgId and role constraints.

## Security and Leakage Guards

- Include orgId in all service calls.
- Validate role/permission checks before showing controls.
- Never render users from org B while org A is active.
- Handle forbidden responses with safe UX (no hidden leakage in errors).

## Accessibility Minimum

- All interactive elements keyboard reachable.
- Visible focus states.
- Proper form labels and error text associations.
- Dialogs trap focus and support Escape to close.
- Color is not the only state signal; include icon/text labels.

## Low-Spec Ubuntu VPS Constraints

- Keep module payloads small and paginated.
- Avoid unnecessary rerenders and deep prop chains.
- Use query keys that include orgId and relevant filters.
- Avoid blocking synchronous loops in render paths.
- Prefer server-side filtering over client-side loading of large lists.

## Acceptance Tests (No Cross-Tenant Leakage)

Primary coverage should be Playwright-aligned for this repo.

Must validate:

- Org admin in org A only sees org A users/invites.
- Invite submission includes org A context and cannot target org B.
- Switching active org reloads scoped data and does not show stale org data.
- Destructive actions require proper permission and remain org-scoped.
- Error states do not expose foreign org identifiers.

## Definition of Done

- Module is fully contained in src/modules/user-management.
- All fetch/mutation boundaries are org-scoped.
- Active org indicator appears in UI.
- Invite flow states implemented: idle/processing/synced/error.
- Accessibility and low-spec VPS constraints satisfied.
- Acceptance tests prove no cross-tenant leakage.
