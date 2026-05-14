/**
 * Detail Tabs Layout Component
 * 
 * Provides reusable tab-based detail view for any entity:
 * - Summary tab (main info)
 * - History tab (changes + audit log)
 * - Actions tab (workflow actions if applicable)
 * - Notes tab (comments + discussion)
 * - Related tab (linked records)
 * 
 * Usage:
 *   <DetailTabsLayout
 *     entity={patrol}
 *     entityType="patrol"
 *     tabs={[
 *       { id: 'summary', label: 'Summary', component: PatrolSummary },
 *       { id: 'history', label: 'History', component: EntityHistory },
 *     ]}
 *   />
 */

import { useState, ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface DetailTab {
  id: string
  label: string
  component: React.ComponentType<any>
  props?: Record<string, any>
  badge?: number | string // Optional badge count (e.g., 5 for 5 related items)
}

export interface DetailTabsLayoutProps {
  title: string
  subtitle?: string
  entityType: string
  entityId: string
  tabs: DetailTab[]
  defaultTab?: string
  actions?: ReactNode
}

export default function DetailTabsLayout({
  title,
  subtitle,
  entityType,
  entityId,
  tabs,
  defaultTab = 'summary',
  actions,
}: DetailTabsLayoutProps) {
  const [activeTab, setActiveTab] = useState(defaultTab)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            {tabs.map(tab => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
                {tab.badge && <span className="ml-2 text-xs">{tab.badge}</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map(tab => (
            <TabsContent key={tab.id} value={tab.id} className="mt-6">
              <tab.component
                entityId={entityId}
                entityType={entityType}
                {...(tab.props || {})}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  )
}
