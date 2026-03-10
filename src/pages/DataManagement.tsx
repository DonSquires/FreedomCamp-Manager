import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Database, 
  Upload, 
  Download, 
  FileSpreadsheet, 
  Trash2, 
  Shield, 
  BarChart3,
  ArrowRight,
} from 'lucide-react'

export default function DataManagement() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Data Management</h1>
          <p className="text-muted-foreground mt-1">
            Import, export, cleanup, and monitor system data integrity
          </p>
        </div>

        {/* Main Data Management Hub Link */}
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-6 w-6" />
              Data Management Hub
            </CardTitle>
            <CardDescription>
              Central hub for all data management operations, cleanup utilities, and integrity monitoring
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/admin/data-hub">
              <Button size="lg" className="w-full">
                Open Data Management Hub
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Data Cleanup */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5" />
                Data Cleanup
              </CardTitle>
              <CardDescription>
                Remove duplicates, orphaned records, and expired data
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/admin/data-cleanup">
                <Button className="w-full">
                  Open Cleanup Utility
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Data Integrity */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Data Integrity
              </CardTitle>
              <CardDescription>
                Monitor data quality, validation errors, and consistency
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/admin/data-integrity">
                <Button className="w-full">
                  View Integrity Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Import Data */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Import Data
              </CardTitle>
              <CardDescription>
                Import observations, vehicles, and zone data from CSV files
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Link to="/import-historical">
                  <Button className="w-full" variant="outline">
                    Upload Historical CSV/Excel
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
                <Link to="/import-data">
                  <Button className="w-full" variant="outline">
                    Import Other Data
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Export Data */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                Export Data
              </CardTitle>
              <CardDescription>
                Download system data in CSV or JSON format
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button className="w-full" variant="outline">
                  Export as CSV
                </Button>
                <Button className="w-full" variant="outline">
                  Export as JSON
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Database Analytics */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Database Analytics
              </CardTitle>
              <CardDescription>
                View storage usage, table statistics, and growth trends
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/admin/data-hub">
                <Button className="w-full" variant="outline">
                  View Analytics
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Import Templates */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                Import Templates
              </CardTitle>
              <CardDescription>
                Download CSV templates for bulk imports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Button className="w-full" variant="outline">
                  Observations Template
                </Button>
                <Button className="w-full" variant="outline">
                  Zones Template
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Button variant="outline" className="justify-start">
                <Database className="h-4 w-4 mr-2" />
                View Database Stats
              </Button>
              <Button variant="outline" className="justify-start">
                <Trash2 className="h-4 w-4 mr-2" />
                Run Quick Cleanup
              </Button>
              <Button variant="outline" className="justify-start">
                <Shield className="h-4 w-4 mr-2" />
                Run Integrity Check
              </Button>
              <Button variant="outline" className="justify-start">
                <Download className="h-4 w-4 mr-2" />
                Export All Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
