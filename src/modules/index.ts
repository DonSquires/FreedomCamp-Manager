/**
 * Modules Index
 * 
 * Re-exports all module system components for clean imports.
 * 
 * Usage:
 * ```typescript
 * import { SERVICE_MODULES, useEnabledModules, ModuleRoute } from '@/modules'
 * ```
 */

// Module Registry
export {
  SERVICE_MODULES,
  getModule,
  getModulesByCategory,
  getLicensableModules,
  getRoutesForModules,
  getModuleForRoute,
  formatModulePricing,
  getCategoryLabel,
  type ModuleId,
  type ModuleCategory,
  type ModuleRoute as ModuleRouteDef,
  type ModulePricing,
  type ServiceModule,
} from './registry'

// Module surfaces
export * from './enforcement'
export * from './patrol'
export * from './dashboard'
export * from './shared'
export * from './messaging'
export { default as MessagingPage } from './messaging'
