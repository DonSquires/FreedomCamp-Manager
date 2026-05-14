/**
 * Module Layout Component
 * 
 * Provides consistent layout for all module pages:
 * - Sidebar navigation
 * - Breadcrumb trail
 * - Module header with title/description
 * - Content area with role-based visibility guards
 */

import { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface ModuleLayoutProps {
  title: string
  description?: string
  breadcrumbs?: Array<{ label: string; href?: string }>
  requiredRoles?: string[]
  children: ReactNode
  actions?: ReactNode
}

/**
 * Role-based access check.
 * If user role is not in requiredRoles, show access denied message.
 */
function RoleGate({ userRole, requiredRoles, children }: any) {
  if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(userRole)) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <div className="text-sm text-red-800">
            <strong>Access Denied</strong>: You do not have permission to view this module. Required roles:{' '}
            {requiredRoles.join(', ')}
          </div>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}

export default function ModuleLayout({
  title,
  description,
  breadcrumbs = [],
  requiredRoles = [],
  children,
  actions,
}: ModuleLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, role } = useAuthStore()

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      {breadcrumbs.length > 0 && (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, idx) => (
              <div key={idx}>
                <BreadcrumbItem>
                  {crumb.href ? (
                    <BreadcrumbLink onClick={() => crumb.href && navigate(crumb.href)} className="cursor-pointer">
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {idx < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
              </div>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          {description && <p className="text-gray-600 mt-2">{description}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>

      {/* Role-gated content */}
      <RoleGate userRole={role || ''} requiredRoles={requiredRoles}>
        {children}
      </RoleGate>
    </div>
  )
}
