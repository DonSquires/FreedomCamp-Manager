/**
 * ImportHistoryViewer Component
 * View import logs and status
 */

import { useImportHistory } from '@/hooks/useImportHistory'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Calendar,
  FileText,
  RefreshCw,
  Eye,
} from 'lucide-react'

interface ImportHistoryViewerProps {
  limit?: number
  onViewDetails?: (importId: string) => void
}

export function ImportHistoryViewer({
  limit = 20,
  onViewDetails,
}: ImportHistoryViewerProps) {
  const { imports, isLoading, refetch } = useImportHistory({ limit })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />
      case 'partial':
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />
      default:
        return <Upload className="h-5 w-5 text-gray-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-600">Completed</Badge>
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>
      case 'partial':
        return <Badge variant="secondary">Partial Success</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import History
            </CardTitle>
            <CardDescription className="mt-1">
              View recent data import operations
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading import history...
          </div>
        ) : imports && imports.length > 0 ? (
          <div className="space-y-3">
            {imports.map((importRecord: any) => (
              <Card key={importRecord.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    {getStatusIcon(importRecord.status)}

                    <div className="flex-1 min-w-0">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-medium">
                            {importRecord.import_type?.replace(/_/g, ' ').toUpperCase() || 'Data Import'}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {importRecord.file_name || 'Unknown file'}
                          </div>
                        </div>
                        {getStatusBadge(importRecord.status)}
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-4 mb-3">
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="text-2xl font-bold text-green-600">
                            {importRecord.records_imported || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">Imported</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="text-2xl font-bold text-yellow-600">
                            {importRecord.duplicates_skipped || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">Skipped</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded">
                          <div className="text-2xl font-bold text-red-600">
                            {importRecord.failed_records || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">Failed</div>
                        </div>
                      </div>

                      {/* Meta info */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(importRecord.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          <span>
                            {importRecord.records_imported + importRecord.duplicates_skipped + importRecord.failed_records} total records
                          </span>
                        </div>
                      </div>

                      {/* Error log preview */}
                      {importRecord.error_log && Array.isArray(importRecord.error_log) && importRecord.error_log.length > 0 && (
                        <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs">
                          <div className="font-medium mb-1">Errors ({importRecord.error_log.length}):</div>
                          <div className="max-h-20 overflow-y-auto">
                            {importRecord.error_log.slice(0, 3).map((error: any, idx: number) => (
                              <div key={idx} className="text-red-900 dark:text-red-100">
                                {typeof error === 'string' ? error : JSON.stringify(error)}
                              </div>
                            ))}
                            {importRecord.error_log.length > 3 && (
                              <div className="text-muted-foreground mt-1">
                                +{importRecord.error_log.length - 3} more errors
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      {onViewDetails && (
                        <div className="mt-3 pt-3 border-t">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onViewDetails(importRecord.id)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Upload className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No import history</p>
            <p className="text-sm mt-1">Import records will appear here</p>
          </div>
        )}

        {/* Count */}
        {imports && imports.length > 0 && (
          <div className="text-sm text-center text-muted-foreground border-t pt-4 mt-4">
            Showing {imports.length} recent import{imports.length > 1 ? 's' : ''}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
