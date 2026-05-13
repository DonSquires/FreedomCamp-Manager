/**
 * DetailPanelLayout - Reusable detail page layout with tabs
 * 
 * Consolidates list-detail-tabs patterns across all modules.
 * See docs/ENTERPRISE_UI_CONSOLIDATION_PATTERNS.md §5.3
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface DetailTab {
  id: string
  label: string
  icon?: React.ReactNode
  component: React.ReactNode
  badge?: number | string
}

interface DetailPanelLayoutProps {
  title: string
  subtitle?: string
  tabs: DetailTab[]
  defaultTab?: string
  actions?: {
    label: string
    onClick: () => void
    variant?: 'default' | 'outline' | 'destructive'
    disabled?: boolean
  }[]
  loading?: boolean
  onBack?: () => void
}

export function DetailPanelLayout({
  title,
  subtitle,
  tabs,
  defaultTab,
  actions,
  loading = false,
  onBack,
}: DetailPanelLayoutProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                ← Back
              </Button>
            )}
            <h1 className="text-3xl font-bold">{title}</h1>
          </div>
          {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
        </div>

        {/* Action Buttons */}
        {actions && actions.length > 0 && (
          <div className="flex gap-2">
            {actions.map((action, idx) => (
              <Button
                key={idx}
                onClick={action.onClick}
                variant={action.variant || 'default'}
                disabled={action.disabled || loading}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      {loading ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {tabs.map(tab => (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2">
                {tab.icon && <span>{tab.icon}</span>}
                {tab.label}
                {tab.badge !== undefined && (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                    {tab.badge}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map(tab => (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {tab.component}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
