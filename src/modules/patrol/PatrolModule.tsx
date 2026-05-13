import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import PatrolList from './PatrolList'
import Scheduler from './Scheduler'
import LiveMonitor from './LiveMonitor'
import Analytics from './Analytics'

export default function PatrolModule() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Patrol Operations</h1>
        <p className="text-sm text-muted-foreground">Unified patrol scheduling, monitoring, and analytics.</p>
      </div>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
          <TabsTrigger value="monitor">Live Monitor</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <PatrolList />
        </TabsContent>

        <TabsContent value="scheduler" className="mt-4">
          <Scheduler />
        </TabsContent>

        <TabsContent value="monitor" className="mt-4">
          <LiveMonitor />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Analytics />
        </TabsContent>
      </Tabs>
    </div>
  )
}
