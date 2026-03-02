import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Map } from 'lucide-react'
import { toast } from 'sonner'

interface OrganizationBoundaryEditorProps {
  organizationId: string
  organizationName: string
  currentBoundary?: unknown
  onBoundaryUpdated?: () => void
}

export function OrganizationBoundaryEditor({
  organizationId,
  organizationName,
  currentBoundary,
  onBoundaryUpdated,
}: OrganizationBoundaryEditorProps) {
  const hasBoundary = !!currentBoundary

  const handleDrawBoundary = () => {
    toast.info('Boundary drawing tool coming soon')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Map className="h-5 w-5 text-blue-600" />
          Organization Boundary: {organizationName}
        </CardTitle>
        <CardDescription>
          {hasBoundary
            ? 'A boundary is currently defined for this organization'
            : 'No boundary defined. Draw a boundary to define your jurisdiction.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300 min-h-[200px] flex items-center justify-center">
            {hasBoundary ? (
              <p className="text-sm text-gray-600">
                Boundary map preview (Organization ID: {organizationId})
              </p>
            ) : (
              <p className="text-sm text-gray-500">No boundary defined</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleDrawBoundary} variant="outline">
              {hasBoundary ? 'Edit Boundary' : 'Draw Boundary'}
            </Button>
            {hasBoundary && onBoundaryUpdated && (
              <Button variant="ghost" onClick={onBoundaryUpdated}>
                Refresh
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
