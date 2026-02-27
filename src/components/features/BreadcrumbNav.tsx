/**
 * BreadcrumbNav Component
 * Navigation breadcrumbs
 */

import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

interface Breadcrumb {
  label: string
  href?: string
  icon?: React.ReactNode
}

interface BreadcrumbNavProps {
  items: Breadcrumb[]
  showHome?: boolean
}

export function BreadcrumbNav({ items, showHome = true }: BreadcrumbNavProps) {
  const allItems = showHome
    ? [{ label: 'Home', href: '/', icon: <Home className="h-4 w-4" /> }, ...items]
    : items

  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      {allItems.map((item, index) => {
        const isLast = index === allItems.length - 1

        return (
          <div key={index} className="flex items-center gap-2">
            {item.href && !isLast ? (
              <Link
                to={item.href}
                className="flex items-center gap-2 hover:text-foreground transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                {item.icon}
                <span className={isLast ? 'font-medium text-foreground' : ''}>
                  {item.label}
                </span>
              </div>
            )}

            {!isLast && <ChevronRight className="h-4 w-4" />}
          </div>
        )
      })}
    </nav>
  )
}
