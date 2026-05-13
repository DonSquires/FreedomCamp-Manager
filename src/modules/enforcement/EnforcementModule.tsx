import { useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import CompliancePage from '@/pages/CompliancePage'
import EnforcementActions from '@/pages/EnforcementActions'
import EvidencePackages from '@/pages/EvidencePackages'
import BreachDetail from './BreachDetail'
import BreachList from './BreachList'

export default function EnforcementModule() {
  const [selectedBreachId, setSelectedBreachId] = useState<string | null>(null)
  const breachDetail = useMemo(() => {
    if (!selectedBreachId) {
      return <p className="text-sm text-muted-foreground">Select a breach from the queue to inspect and resolve.</p>
    }
    return <BreachDetail breachId={selectedBreachId} />
  }, [selectedBreachId])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Enforcement Operations</h1>
        <p className="text-sm text-muted-foreground">
          Unified breach response, compliance tracking, action queues, and evidence handling.
        </p>
      </div>

      <Tabs defaultValue="breaches" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="breaches">Breaches</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>

        <TabsContent value="breaches" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
            <BreachList selectedBreachId={selectedBreachId} onSelectBreach={setSelectedBreachId} />
            {breachDetail}
          </div>
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <CompliancePage />
        </TabsContent>

        <TabsContent value="actions" className="mt-4">
          <EnforcementActions />
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <EvidencePackages />
        </TabsContent>
      </Tabs>
    </div>
  )
}