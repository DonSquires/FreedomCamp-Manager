/**
 * Service Module Registry
 * 
 * Central registry of all service modules in the platform.
 * Each module is a self-contained vertical that can be enabled/disabled
 * per organization for individual licensing.
 * 
 * This is a standalone, white-label system that integrates with:
 * - NZSCV (NZ Self-Contained Vehicle registry)
 * - Motoweb (NZ vehicle registration)
 * - OpenAI (optional AI features)
 * - Self-hosted AI on Railway (ALPR, face recognition)
 */

import type { LucideIcon } from 'lucide-react'
import {
  Shield,
  Tent,
  ParkingSquare,
  Volume2,
  Car,
  Calendar,
  Radio,
  Building2,
  Ambulance,
  MonitorPlay,
  Ticket,
  FileWarning,
  Users,
  ShieldCheck,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ModuleCategory = 'enforcement' | 'security' | 'operations' | 'communication'

// CRM is now integrated into core, not a separate module
export type ModuleId = 
  | 'core'           // CRM Hub + Auth + Tracking + PTT + Welfare + Bugs
  | 'freedom_camping'
  | 'parking'
  | 'noise'
  | 'guarding'
  | 'patrol'
  | 'rostering'
  | 'ptt_chat'       // Kept for backwards compatibility, but now part of core
  | 'ems'
  | 'dispatch'
  | 'ticketing'
  | 'incidents'

export interface ModuleRoute {
  path: string
  label: string
  roles: string[]
  adminOnly?: boolean
  officerOnly?: boolean
}

export interface ModulePricing {
  model: 'seat' | 'transaction' | 'hybrid' | 'flat'
  baseFee?: number      // Monthly base fee in cents
  perSeatFee?: number   // Per-seat fee in cents
  perTransactionFee?: number  // Per-transaction fee in cents
}

export interface ServiceModule {
  id: ModuleId
  name: string
  description: string
  shortDescription: string
  icon: LucideIcon
  color: string
  bgColor: string
  borderColor: string
  
  // Categorization
  category: ModuleCategory
  isCore: boolean
  
  // Dependencies
  requiresModules: ModuleId[]
  
  // Pricing
  pricing: ModulePricing
  
  // Routes this module adds
  routes: ModuleRoute[]
  
  // Database tables owned by this module
  tables: string[]
  
  // Edge Functions owned by this module
  edgeFunctions: string[]
  
  // Feature flags for phased rollout
  featureFlags: string[]
  
  // Display order in UI
  displayOrder: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Registry
// ─────────────────────────────────────────────────────────────────────────────

export const SERVICE_MODULES: Record<ModuleId, ServiceModule> = {
  // ─────────────────────────────────────────────────────────────────────────
  // CORE (Always enabled - CRM-Centric Hub)
  // Iron Eagle Security is the hardcoded platform owner
  // ─────────────────────────────────────────────────────────────────────────
  core: {
    id: 'core',
    name: 'Core Platform (CRM Hub)',
    description: 'CRM-centric platform hub with Iron Eagle Security as the platform owner. CRM Features: Accounts/Organizations (hierarchical), Users (assigned to accounts), Zones/Sites (owned by accounts), Contacts (stakeholders), Contracts (with line items & SLAs), Invoices & Payments, Activities (calls, meetings, tasks), Opportunities (sales pipeline), Documents & Notes, Tags & Account History. Platform Features: Live officer tracking, PTT/Team Chat, Officer welfare system, Self-healing bug detection. Compliance: NZ Privacy Act 2020 (consent tracking, DSAR), NZ Private Security Personnel Act (COA tracking), Workflow Automation, Email Templates, Custom Fields, SLA Monitoring, API Webhooks, Rate Limiting, Data Export.',
    shortDescription: 'Full CRM + Compliance + Automation',
    icon: Shield,
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-100 dark:bg-slate-800',
    borderColor: 'border-slate-300 dark:border-slate-600',
    category: 'operations',
    isCore: true,
    requiresModules: [],
    pricing: { model: 'flat', baseFee: 0 },
    routes: [
      // CRM Hub Routes (Central Entity Management)
      { path: '/admin', label: 'Command Centre', roles: ['admin', 'master', 'admin_officer'] },
      { path: '/crm', label: 'CRM Dashboard', roles: ['admin', 'master', 'admin_officer'] },
      { path: '/accounts', label: 'Accounts', roles: ['admin', 'master'] },
      { path: '/organization-management', label: 'Organizations', roles: ['master', 'grand_master'] },
      { path: '/user-management', label: 'Users', roles: ['admin', 'master'] },
      { path: '/zones', label: 'Zones', roles: ['admin', 'master'] },
      { path: '/sites', label: 'Sites', roles: ['admin', 'master'] },
      // CRM Contracts & Billing
      { path: '/contracts', label: 'Contracts', roles: ['admin', 'master'] },
      { path: '/invoices', label: 'Invoices', roles: ['admin', 'master'] },
      { path: '/payments', label: 'Payments', roles: ['admin', 'master'] },
      // CRM Contacts & Activities
      { path: '/contacts', label: 'Contacts', roles: ['admin', 'master'] },
      { path: '/activities', label: 'Activities', roles: ['admin', 'master', 'admin_officer'] },
      // CRM Sales Pipeline
      { path: '/opportunities', label: 'Opportunities', roles: ['admin', 'master'] },
      // CRM Documents & Notes
      { path: '/documents', label: 'Documents', roles: ['admin', 'master'] },
      // Compliance & Privacy
      { path: '/privacy-consents', label: 'Privacy Consents', roles: ['admin', 'master'] },
      { path: '/dsar', label: 'Data Subject Requests', roles: ['admin', 'master'] },
      { path: '/officer-compliance', label: 'Officer Compliance', roles: ['admin', 'master'] },
      { path: '/officer-training', label: 'Officer Training', roles: ['admin', 'master'] },
      // Workflow & Automation
      { path: '/workflows', label: 'Workflows', roles: ['admin', 'master'] },
      { path: '/email-templates', label: 'Email Templates', roles: ['admin', 'master'] },
      // SLA & Monitoring
      { path: '/sla-rules', label: 'SLA Rules', roles: ['admin', 'master'] },
      { path: '/sla-events', label: 'SLA Events', roles: ['admin', 'master'] },
      // API & Integrations
      { path: '/webhooks', label: 'Webhooks', roles: ['admin', 'master'] },
      { path: '/api-usage', label: 'API Usage', roles: ['admin', 'master'] },
      // Data Management
      { path: '/custom-fields', label: 'Custom Fields', roles: ['admin', 'master'] },
      { path: '/data-exports', label: 'Data Exports', roles: ['admin', 'master'] },
      // Core Platform Routes
      { path: '/live-tracking', label: 'Live Officer Tracking', roles: ['admin', 'master', 'admin_officer'] },
      { path: '/audit-log', label: 'Audit Log', roles: ['admin', 'master'] },
      { path: '/settings', label: 'Settings', roles: ['admin', 'master', 'officer', 'admin_officer'] },
      { path: '/profile', label: 'Profile', roles: ['admin', 'master', 'officer', 'admin_officer'] },
      { path: '/notifications', label: 'Notifications', roles: ['admin', 'master', 'officer', 'admin_officer'] },
      // PTT & Team Chat (Core Feature)
      { path: '/team-chat', label: 'Team Chat', roles: ['admin', 'master', 'admin_officer', 'officer'] },
      // Officer Welfare (Core Feature)
      { path: '/officer-welfare', label: 'Officer Welfare Settings', roles: ['admin', 'master'] },
    ],
    tables: [
      // CRM Hub Tables (Central Entity Management)
      'organizations',           // Accounts (Iron Eagle → Service Providers → Clients)
      'user_profiles',           // Users assigned to accounts
      'zones',                   // Geographic zones owned by accounts
      'client_sites',            // Physical sites managed by accounts
      // CRM Contacts
      'crm_contacts',            // Named contacts at accounts
      // CRM Contracts & Billing
      'crm_contracts',           // Service agreements between accounts
      'crm_contract_lines',      // Contract line items (per-module pricing)
      'crm_invoices',            // Invoices
      'crm_invoice_lines',       // Invoice line items
      'crm_payments',            // Payment records
      // CRM Activities & Pipeline
      'crm_activities',          // Calls, meetings, tasks, follow-ups
      'crm_opportunities',       // Sales pipeline
      // CRM Documents & Notes
      'crm_documents',           // File attachments
      'crm_notes',               // Freeform notes
      // CRM Tags & History
      'crm_tags',                // Tag definitions
      'crm_organization_tags',   // Org-tag junction
      'crm_contact_tags',        // Contact-tag junction
      'crm_opportunity_tags',    // Opportunity-tag junction
      'crm_account_history',     // Audit trail
      // Privacy & Compliance (NZ Privacy Act 2020)
      'privacy_consents',        // Consent tracking
      'data_subject_requests',   // DSAR handling
      // Officer Compliance (NZ Private Security Personnel Act)
      'officer_compliance_alerts', // COA/credential expiry alerts
      'officer_training_records',  // Training records
      // Workflow Automation
      'crm_workflows',           // Workflow definitions
      'crm_workflow_executions', // Execution history
      'crm_workflow_triggers',   // Record-workflow tracking
      // Email & Communication
      'crm_email_templates',     // Email templates with merge fields
      'crm_communications',      // Communication history
      // Custom Fields
      'crm_custom_field_definitions', // Field definitions
      'crm_custom_field_values',      // Field values
      // SLA Monitoring
      'crm_sla_rules',           // SLA rule definitions
      'crm_sla_events',          // SLA events/breaches
      // API & Webhooks
      'api_webhooks',            // Webhook subscriptions
      'api_webhook_deliveries',  // Delivery log
      'api_rate_limits',         // Rate limit configs
      'api_rate_limit_hits',     // Rate limit tracking
      // Data Export
      'data_exports',            // Export requests
      // Core Platform Tables
      'officer_locations',       // Live GPS tracking
      'audit_log',               // Action audit trail
      'notifications',           // In-app notifications
      // PTT tables
      'ptt_channels', 'ptt_channel_members', 'ptt_messages', 'ptt_presence',
      // Welfare tables
      'officer_welfare_checks', 'officer_welfare_alerts', 'welfare_schedules',
      // Bug reporting tables
      'bug_reports',
    ],
    edgeFunctions: [
      'auth', 'user-profile', 'organization',
      // CRM
      'crm-sync', 'contract-management', 'invoice-generate', 'payment-process',
      // Privacy & Compliance
      'process-dsar', 'check-compliance-alerts',
      // Workflow Automation
      'execute-workflow', 'trigger-workflow',
      // Email & Communication
      'send-email', 'send-sms',
      // SLA Monitoring
      'check-sla', 'process-sla-breach',
      // Webhooks
      'dispatch-webhook',
      // Data Export
      'generate-export',
      // PTT
      'ptt-signaling-token',
      // Welfare
      'monitor-officer-welfare',
      // Bug System
      'auto-analyse-report',
    ],
    featureFlags: [],
    displayOrder: 0,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FREEDOM CAMPING
  // ─────────────────────────────────────────────────────────────────────────
  freedom_camping: {
    id: 'freedom_camping',
    name: 'Freedom Camping',
    description: 'Vehicle compliance monitoring for freedom camping zones. Includes plate scanning, overnight stay tracking, breach detection, notice to vacate workflow, and compliance reporting.',
    shortDescription: 'Vehicle scanning & compliance',
    icon: Tent,
    color: 'text-green-700 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900',
    borderColor: 'border-green-400 dark:border-green-700',
    category: 'enforcement',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'hybrid', baseFee: 19900, perSeatFee: 2900, perTransactionFee: 5 },
    routes: [
      { path: '/field-officer', label: 'Field Officer Portal', roles: ['officer', 'admin_officer'], officerOnly: true },
      { path: '/compliance', label: 'Compliance', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/breaches', label: 'Breach Alerts', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/breach-notices', label: 'Breach Notices', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/notice-to-vacate', label: 'Notice to Vacate', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/observation-records', label: 'Observation Records', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/observations-report', label: 'Observations Report', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/vehicles', label: 'Vehicle Management', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/vehicle-registry', label: 'Vehicle Registry', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/enforcement-actions', label: 'Enforcement Actions', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/enforcement-review', label: 'Enforcement Review', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/infringements', label: 'Infringements', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['observations', 'breach_alerts', 'notices_to_vacate', 'canonical_vehicles', 'enforcement_cases'],
    edgeFunctions: ['plate-scanner-complete', 'plate-scanner-photo-first', 'evaluate-compliance', 'alpr-process'],
    featureFlags: ['FEATURE_INGEST_V2', 'FEATURE_ENFORCEMENT', 'FEATURE_OFFICER_OUTBOX'],
    displayOrder: 10,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PARKING ENFORCEMENT
  // ─────────────────────────────────────────────────────────────────────────
  parking: {
    id: 'parking',
    name: 'Parking Enforcement',
    description: 'Full parking violation workflow including chalking, time-limit monitoring, infringement notices, permit management, and ParkPow integration.',
    shortDescription: 'Parking violations & permits',
    icon: ParkingSquare,
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    borderColor: 'border-blue-400 dark:border-blue-700',
    category: 'enforcement',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'hybrid', baseFee: 24900, perSeatFee: 3900, perTransactionFee: 10 },
    routes: [
      { path: '/parking-officer', label: 'Parking Officer Portal', roles: ['officer', 'admin_officer'], officerOnly: true },
      { path: '/parking', label: 'Parking Enforcement', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['parking_sessions', 'parking_infringements', 'parking_permits', 'parking_zones'],
    edgeFunctions: ['parking-chalk', 'parking-infringement', 'parkpow-sync'],
    featureFlags: ['FEATURE_PARKING'],
    displayOrder: 20,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // NOISE CONTROL
  // ─────────────────────────────────────────────────────────────────────────
  noise: {
    id: 'noise',
    name: 'Noise Control',
    description: 'NZ RMA-compliant noise complaint management including job dispatch, abatement notices, direction notices, enforcement orders, and equipment seizure tracking.',
    shortDescription: 'Noise complaints & RMA compliance',
    icon: Volume2,
    color: 'text-purple-700 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900',
    borderColor: 'border-purple-400 dark:border-purple-700',
    category: 'enforcement',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'hybrid', baseFee: 14900, perSeatFee: 2900, perTransactionFee: 25 },
    routes: [
      { path: '/noise-officer', label: 'Noise Officer Portal', roles: ['officer', 'admin_officer'], officerOnly: true },
      { path: '/noise-control', label: 'Noise Control', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['noise_jobs', 'noise_notices', 'noise_seizures', 'noise_addresses'],
    edgeFunctions: ['noise-job-dispatch', 'noise-notice-generate'],
    featureFlags: ['FEATURE_NOISE'],
    displayOrder: 30,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SITE GUARDING
  // ─────────────────────────────────────────────────────────────────────────
  guarding: {
    id: 'guarding',
    name: 'Site Guarding',
    description: 'Static site security management including shift logs, checkpoint verification, visitor check-in, face recognition, and incident reporting.',
    shortDescription: 'Site security & checkpoints',
    icon: Shield,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900',
    borderColor: 'border-amber-400 dark:border-amber-700',
    category: 'security',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'seat', baseFee: 29900, perSeatFee: 4900 },
    routes: [
      { path: '/site-guard', label: 'Site Guard Portal', roles: ['officer', 'admin_officer'], officerOnly: true },
      { path: '/client-sites', label: 'Client Sites', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/access-control', label: 'Access Control', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/points-of-interest', label: 'Points of Interest', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/face-recognition', label: 'Face Recognition', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/site-risk-assessment', label: 'Site Risk Assessment', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['client_sites', 'site_checkpoints', 'checkpoint_verifications', 'visitor_logs', 'face_encodings'],
    edgeFunctions: ['checkpoint-verify', 'visitor-checkin', 'process-face-scan'],
    featureFlags: ['FEATURE_GUARDING', 'FEATURE_FACE_RECOGNITION'],
    displayOrder: 40,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GENERAL PATROL
  // ─────────────────────────────────────────────────────────────────────────
  patrol: {
    id: 'patrol',
    name: 'General Patrol',
    description: 'Mobile patrol operations including route tracking, checkpoint verification, alarm response, and incident reporting.',
    shortDescription: 'Mobile patrol & alarm response',
    icon: Car,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900',
    borderColor: 'border-red-400 dark:border-red-700',
    category: 'security',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'seat', baseFee: 19900, perSeatFee: 3900 },
    routes: [
      { path: '/patrol-checkpoints', label: 'Patrol Checkpoints', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/patrol-schedules', label: 'Patrol Schedules', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/patrol-kpi', label: 'Patrol KPI Dashboard', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/live-patrol-monitor', label: 'Live Patrol Monitor', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['patrols', 'patrol_routes', 'patrol_checkpoints', 'alarm_responses'],
    edgeFunctions: ['patrol-start', 'patrol-checkpoint', 'alarm-dispatch'],
    featureFlags: ['FEATURE_PATROL_GEOFENCE'],
    displayOrder: 50,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ROSTERING
  // ─────────────────────────────────────────────────────────────────────────
  rostering: {
    id: 'rostering',
    name: 'Roster & Scheduling',
    description: 'Deputy-style shift planning including visual roster board, officer availability, shift swaps, and timesheet integration.',
    shortDescription: 'Shift planning & availability',
    icon: Calendar,
    color: 'text-cyan-700 dark:text-cyan-400',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900',
    borderColor: 'border-cyan-400 dark:border-cyan-700',
    category: 'operations',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'seat', baseFee: 9900, perSeatFee: 1900 },
    routes: [
      { path: '/roster', label: 'Roster Planner', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/open-shifts', label: 'Open Shifts', roles: ['admin', 'master', 'admin_officer', 'officer'] },
      { path: '/officer-availability', label: 'Officer Availability', roles: ['admin', 'master', 'admin_officer', 'officer'] },
      { path: '/officer-skills', label: 'Officer Skills', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/timesheet-review', label: 'Timesheet Review', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['roster_shifts', 'officer_availability', 'officer_skills', 'shift_swaps', 'timesheets'],
    edgeFunctions: ['roster-publish', 'shift-swap-request'],
    featureFlags: ['FEATURE_ROSTERING'],
    displayOrder: 60,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PTT & CHAT (Now included in Core Platform - kept for backwards compatibility)
  // ─────────────────────────────────────────────────────────────────────────
  ptt_chat: {
    id: 'ptt_chat',
    name: 'PTT & Team Chat',
    description: 'Real-time push-to-talk communication including channel management, VOX mode, Bluetooth PTT button support, and team chat. NOTE: Now included in Core Platform at no additional cost.',
    shortDescription: 'Push-to-talk & messaging (Included in Core)',
    icon: Radio,
    color: 'text-indigo-700 dark:text-indigo-400',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900',
    borderColor: 'border-indigo-400 dark:border-indigo-700',
    category: 'communication',
    isCore: true,  // Now part of core
    requiresModules: [],
    pricing: { model: 'flat', baseFee: 0 },  // Free - included in core
    routes: [
      { path: '/team-chat', label: 'Team Chat', roles: ['admin', 'master', 'admin_officer', 'officer'] },
    ],
    tables: ['ptt_channels', 'ptt_channel_members', 'chat_messages'],
    edgeFunctions: ['ptt-signaling-token'],
    featureFlags: ['FEATURE_PTT'],
    displayOrder: 70,
  },

  // NOTE: CRM has been integrated into the Core Platform (CRM Hub)
  // Organizations, Users, Zones, Sites, Contracts, and Contacts are all
  // managed through the core module. See core.routes and core.tables above.

  // ─────────────────────────────────────────────────────────────────────────
  // EMS
  // ─────────────────────────────────────────────────────────────────────────
  ems: {
    id: 'ems',
    name: 'EMS Response',
    description: 'Emergency medical response coordination including triage, dispatch, and patient tracking.',
    shortDescription: 'Emergency response',
    icon: Ambulance,
    color: 'text-rose-700 dark:text-rose-400',
    bgColor: 'bg-rose-100 dark:bg-rose-900',
    borderColor: 'border-rose-400 dark:border-rose-700',
    category: 'security',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'hybrid', baseFee: 14900, perSeatFee: 2900, perTransactionFee: 50 },
    routes: [
      { path: '/ems', label: 'EMS Portal', roles: ['officer', 'admin_officer'], officerOnly: true },
    ],
    tables: ['ems_incidents', 'ems_patients', 'ems_resources'],
    edgeFunctions: ['ems-dispatch'],
    featureFlags: ['FEATURE_EMS'],
    displayOrder: 90,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DISPATCH
  // ─────────────────────────────────────────────────────────────────────────
  dispatch: {
    id: 'dispatch',
    name: 'Dispatch Console',
    description: 'CAD-style job dispatch across all service types with real-time officer status and proximity-based assignment.',
    shortDescription: 'Job dispatch & coordination',
    icon: MonitorPlay,
    color: 'text-violet-700 dark:text-violet-400',
    bgColor: 'bg-violet-100 dark:bg-violet-900',
    borderColor: 'border-violet-400 dark:border-violet-700',
    category: 'operations',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'seat', baseFee: 14900, perSeatFee: 2900 },
    routes: [
      { path: '/dispatch', label: 'Dispatch Console', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: ['dispatch_jobs', 'dispatch_assignments'],
    edgeFunctions: ['dispatch-job', 'dispatch-assign'],
    featureFlags: ['FEATURE_DISPATCH'],
    displayOrder: 100,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TICKETING (Infringement & Notice System)
  // ─────────────────────────────────────────────────────────────────────────
  ticketing: {
    id: 'ticketing',
    name: 'Ticketing & Infringements',
    description: 'Complete infringement notice system with fine management, dispute handling, payment tracking, court referrals, and automated reminders. Supports FCA (Freedom Camping Act), RMA (Resource Management Act), and parking infringements.',
    shortDescription: 'Infringements & fines',
    icon: Ticket,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900',
    borderColor: 'border-amber-400 dark:border-amber-700',
    category: 'enforcement',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'hybrid', baseFee: 19900, perSeatFee: 2900, perTransactionFee: 100 }, // $1 per infringement issued
    routes: [
      { path: '/infringement-notices', label: 'Infringement Notices', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/breach-notices', label: 'Breach Notices', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/notice-to-vacate', label: 'Notice to Vacate', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/enforcement-review', label: 'Enforcement Review', roles: ['admin', 'master'], adminOnly: true },
      { path: '/dispute-portal', label: 'Dispute Portal', roles: ['admin', 'master'], adminOnly: true },
    ],
    tables: [
      'infringement_notices',
      'infringement_notice_counters',
      'breach_notices',
      'notices_to_vacate',
      'enforcement_actions',
      'enforcement_cases',
      'enforcement_case_events',
      'dispute_submissions',
      'payment_records',
    ],
    edgeFunctions: [
      'generate-infringement',
      'render-infringement-notice',
      'generate-warning-notice',
      'generate-notice-to-vacate',
      'generate-seizure-receipt',
      'process-dispute',
      'send-reminder-notice',
    ],
    featureFlags: ['FEATURE_TICKETING', 'FEATURE_INFRINGEMENTS'],
    displayOrder: 110,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INCIDENT MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────
  incidents: {
    id: 'incidents',
    name: 'Incident Management',
    description: 'Comprehensive incident reporting and management system for security events, H&S incidents, investigations, and evidence collection. Includes court-ready reporting and witness management.',
    shortDescription: 'Incident tracking & evidence',
    icon: FileWarning,
    color: 'text-orange-700 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900',
    borderColor: 'border-orange-400 dark:border-orange-700',
    category: 'security',
    isCore: false,
    requiresModules: ['core'],
    pricing: { model: 'seat', baseFee: 14900, perSeatFee: 2900 },
    routes: [
      { path: '/incident-management', label: 'Incident Management', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/incident-reports', label: 'Incident Reports', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/investigation-jobs', label: 'Investigation Jobs', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
      { path: '/health-safety', label: 'Health & Safety', roles: ['admin', 'master', 'admin_officer'], adminOnly: true },
    ],
    tables: [
      'incidents',
      'incident_attachments',
      'incident_evidence_rls',
      'investigation_jobs',
      'investigation_job_types',
      'investigation_job_templates',
      'health_safety_reports',
      'person_interactions',
      'witness_statements',
    ],
    edgeFunctions: [
      'generate-incident-pdf',
      'admin-incident-ops',
      'process-investigation-document',
      'submit-dispute-intake',
    ],
    featureFlags: ['FEATURE_INCIDENTS', 'FEATURE_INVESTIGATION'],
    displayOrder: 120,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a module by ID
 */
export function getModule(moduleId: ModuleId): ServiceModule | undefined {
  return SERVICE_MODULES[moduleId]
}

/**
 * Get all modules in a category
 */
export function getModulesByCategory(category: ModuleCategory): ServiceModule[] {
  return Object.values(SERVICE_MODULES)
    .filter(m => m.category === category)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

/**
 * Get all non-core modules
 */
export function getLicensableModules(): ServiceModule[] {
  return Object.values(SERVICE_MODULES)
    .filter(m => !m.isCore)
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

/**
 * Get all routes for a set of enabled modules
 */
export function getRoutesForModules(enabledModuleIds: ModuleId[]): ModuleRoute[] {
  const routes: ModuleRoute[] = []
  
  // Always include core routes
  routes.push(...SERVICE_MODULES.core.routes)
  
  // Add routes from enabled modules
  for (const moduleId of enabledModuleIds) {
    const module = SERVICE_MODULES[moduleId]
    if (module && !module.isCore) {
      routes.push(...module.routes)
    }
  }
  
  return routes
}

/**
 * Check if a route path belongs to a specific module
 */
export function getModuleForRoute(path: string): ModuleId | undefined {
  for (const [moduleId, module] of Object.entries(SERVICE_MODULES)) {
    if (module.routes.some(r => path.startsWith(r.path))) {
      return moduleId as ModuleId
    }
  }
  return undefined
}

/**
 * Format pricing for display
 */
export function formatModulePricing(module: ServiceModule): string {
  const { pricing } = module
  const parts: string[] = []
  
  if (pricing.baseFee) {
    parts.push(`$${(pricing.baseFee / 100).toFixed(0)}/mo base`)
  }
  if (pricing.perSeatFee) {
    parts.push(`$${(pricing.perSeatFee / 100).toFixed(0)}/seat`)
  }
  if (pricing.perTransactionFee) {
    parts.push(`$${(pricing.perTransactionFee / 100).toFixed(2)}/transaction`)
  }
  
  return parts.join(' + ') || 'Free'
}

/**
 * Get category label
 */
export function getCategoryLabel(category: ModuleCategory): string {
  const labels: Record<ModuleCategory, string> = {
    enforcement: 'Enforcement',
    security: 'Security',
    operations: 'Operations',
    communication: 'Communication',
  }
  return labels[category]
}
