/**
 * ModuleRoute
 * 
 * Route protection component that checks if a service module is enabled
 * for the current organization before rendering the route content.
 * 
 * Usage:
 * ```tsx
 * <Route path="/parking" element={
 *   <ModuleRoute moduleId="parking">
 *     <ParkingPortal />
 *   </ModuleRoute>
 * } />
 * ```
 */

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEnabledModules } from '@/hooks/useEnabledModules'
import { getModule, type ModuleId } from '@/modules/registry'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Lock, ArrowLeft, Mail } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ModuleRouteProps {
  /** The module ID to check */
  moduleId: ModuleId
  /** Content to render if module is enabled */
  children: ReactNode
  /** Optional custom fallback when module is disabled */
  fallback?: ReactNode
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Not Enabled Page
// ─────────────────────────────────────────────────────────────────────────────

function ModuleNotEnabledPage({ moduleId }: { moduleId: ModuleId }) {
  const navigate = useNavigate()
  const module = getModule(moduleId)
  
  if (!module) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <CardTitle>Module Not Found</CardTitle>
            <CardDescription>
              The requested module does not exist.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const ModuleIcon = module.icon

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <div className={`inline-flex items-center justify-center h-16 w-16 rounded-full ${module.bgColor} mx-auto mb-4`}>
            <ModuleIcon className={`h-8 w-8 ${module.color}`} />
          </div>
          <CardTitle className="text-xl">{module.name}</CardTitle>
          <CardDescription className="text-base mt-2">
            {module.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Not Enabled Message */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-100">
                  Module Not Enabled
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  This module is not currently enabled for your organization.
                  Contact your administrator or our sales team to enable it.
                </p>
              </div>
            </div>
          </div>

          {/* Pricing Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium">Pricing</p>
            <div className="text-sm text-muted-foreground space-y-1">
              {module.pricing.baseFee > 0 && (
                <p>Base: ${(module.pricing.baseFee / 100).toFixed(0)}/month</p>
              )}
              {module.pricing.perSeatFee > 0 && (
                <p>Per seat: ${(module.pricing.perSeatFee / 100).toFixed(0)}/month</p>
              )}
              {module.pricing.perTransactionFee > 0 && (
                <p>Per transaction: ${(module.pricing.perTransactionFee / 100).toFixed(2)}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                // In a real app, this would open a contact form or redirect to sales
                window.location.href = 'mailto:sales@onspace.ai?subject=Module%20Inquiry%20-%20' + encodeURIComponent(module.name)
              }}
            >
              <Mail className="h-4 w-4 mr-2" />
              Contact Sales
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading State
// ─────────────────────────────────────────────────────────────────────────────

function ModuleLoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <div className="relative inline-flex items-center justify-center">
          <div 
            className="absolute h-16 w-16 rounded-full border-[3px] border-transparent border-t-primary animate-spin" 
            style={{ animationDuration: '1.2s' }} 
          />
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">Checking module access...</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRoute Component
// ─────────────────────────────────────────────────────────────────────────────

export function ModuleRoute({ moduleId, children, fallback }: ModuleRouteProps) {
  const { isModuleEnabled, isLoading } = useEnabledModules()

  if (moduleId !== 'core' && isLoading) {
    return <ModuleLoadingState />
  }

  const isEnabled = isModuleEnabled(moduleId)

  if (!isEnabled) {
    return fallback ?? <ModuleNotEnabledPage moduleId={moduleId} />
  }
  
  return <>{children}</>
}

// ─────────────────────────────────────────────────────────────────────────────
// Export the not-enabled page for direct use
// ─────────────────────────────────────────────────────────────────────────────

export { ModuleNotEnabledPage, ModuleLoadingState }
