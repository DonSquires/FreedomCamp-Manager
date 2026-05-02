import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { AppLayout } from '@/components/features/AppLayout'
import { useAuthStore } from '@/stores/authStore'
import { useSessionLockStore } from '@/stores/sessionLockStore'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'
import { signalSessionActivity } from '@/hooks/useSessionInactivityLock'
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  PlayCircle, 
  RotateCcw,
  FileText,
  AlertTriangle,
  TrendingUp
} from 'lucide-react'

interface TestResult {
  id: string
  name: string
  status: 'passed' | 'failed' | 'running' | 'pending'
  duration?: number
  error?: string
  timestamp?: string
}

interface TestArea {
  id: string
  name: string
  description: string
  priority: number
  tests: TestResult[]
}

export default function TestDashboard() {
  const { logout } = useAuthStore()
  const {
    isLocked,
    isWarningVisible,
    warningSecondsRemaining,
    lock,
    unlock,
    showWarning,
    updateWarningSeconds,
    clearWarning,
  } = useSessionLockStore()
  const { autoLogoffEnabled, inactivityMinutes, setAutoLogoffEnabled, setInactivityMinutes } = useSessionPreferencesStore()

  const [testAreas, setTestAreas] = useState<TestArea[]>([])
  const [overallProgress, setOverallProgress] = useState(0)
  const [testResults, setTestResults] = useState<any>(null)
  const [isRunning, setIsRunning] = useState(false)

  // Load test results from JSON file (if exists)
  const loadTestResults = useCallback(async () => {
    try {
      const response = await fetch('/test-results/results.json')
      if (response.ok) {
        const data = await response.json()
        setTestResults(data)

        // Parse Playwright test results and organize by test area
        const areas = getDefaultTestAreas()

        if (data.suites) {
          data.suites.forEach((suite: any) => {
            const area = areas.find(a => suite.title.includes(a.name))
            if (area) {
              suite.specs.forEach((spec: any) => {
                area.tests.push({
                  id: spec.id || spec.title,
                  name: spec.title,
                  status: spec.ok ? 'passed' : 'failed',
                  duration: spec.tests?.[0]?.results?.[0]?.duration,
                  error: spec.tests?.[0]?.results?.[0]?.error?.message,
                  timestamp: new Date().toISOString(),
                })
              })
            }
          })
        }

        setTestAreas(areas)
        calculateProgress(areas)
      }
    } catch (error) {
      console.error('Failed to load test results:', error)
      // Load default test areas structure
      setTestAreas(getDefaultTestAreas())
    }
  }, [])

  useEffect(() => {
    loadTestResults()
  }, [loadTestResults])

  const getDefaultTestAreas = (): TestArea[] => [
    {
      id: 'scan-flow',
      name: 'Scan Flow',
      description: 'PlateScanner → Railway → Database',
      priority: 1,
      tests: [
        { id: 'scan-1', name: 'Manual plate entry', status: 'pending' },
        { id: 'scan-2', name: 'Camera capture with OCR', status: 'pending' },
        { id: 'scan-3', name: 'Bob vehicle detection', status: 'pending' },
      ],
    },
    {
      id: 'nzscv',
      name: 'NZSCV Integration',
      description: 'Proxy → Cache → Display',
      priority: 2,
      tests: [
        { id: 'nzscv-1', name: 'Check self-contained certification', status: 'pending' },
        { id: 'nzscv-2', name: 'Update vehicle status', status: 'pending' },
      ],
    },
    {
      id: 'motorweb',
      name: 'Vehicle Details Integration',
      description: 'Enrichment → Update → Refresh',
      priority: 3,
      tests: [
        { id: 'motorweb-1', name: 'Enrich vehicle data', status: 'pending' },
        { id: 'motorweb-2', name: 'Update canonical vehicle attributes', status: 'pending' },
      ],
    },
    {
      id: 'compliance',
      name: 'Compliance Recalculation',
      description: 'Matrix → Pipeline → Alerts',
      priority: 4,
      tests: [
        { id: 'compliance-1', name: 'Manual recalculation', status: 'pending' },
        { id: 'compliance-2', name: 'Automatic evaluation', status: 'pending' },
      ],
    },
    {
      id: 'multi-org-rls',
      name: 'Multi-Org RLS',
      description: 'Organisation isolation tests',
      priority: 5,
      tests: [
        { id: 'rls-1', name: 'Organisation data isolation', status: 'pending' },
        { id: 'rls-2', name: 'Multi-org hierarchy access', status: 'pending' },
      ],
    },
    {
      id: 'reports',
      name: 'Report Generation',
      description: 'PDF/CSV export tests',
      priority: 6,
      tests: [
        { id: 'report-1', name: 'Generate leadership pack', status: 'pending' },
        { id: 'report-2', name: 'Export observations CSV', status: 'pending' },
      ],
    },
    {
      id: 'realtime',
      name: 'Realtime Updates',
      description: 'Live notifications',
      priority: 7,
      tests: [
        { id: 'realtime-1', name: 'Live breach alerts', status: 'pending' },
        { id: 'realtime-2', name: 'Officer location tracking', status: 'pending' },
      ],
    },
    {
      id: 'offline',
      name: 'Offline Queue',
      description: 'IndexedDB persistence',
      priority: 8,
      tests: [
        { id: 'offline-1', name: 'Offline observation creation', status: 'pending' },
        { id: 'offline-2', name: 'Offline photo upload', status: 'pending' },
      ],
    },
    {
      id: 'pwa',
      name: 'PWA Features',
      description: 'Service Worker, biometric auth',
      priority: 9,
      tests: [
        { id: 'pwa-1', name: 'PWA installation', status: 'pending' },
        { id: 'pwa-2', name: 'Service worker cache', status: 'pending' },
        { id: 'pwa-3', name: 'Biometric authentication', status: 'pending' },
      ],
    },
    {
      id: 'integration',
      name: 'System Integration',
      description: 'Complete E2E workflow',
      priority: 10,
      tests: [
        { id: 'integration-1', name: 'Complete enforcement workflow', status: 'pending' },
      ],
    },
  ]

  const calculateProgress = (areas: TestArea[]) => {
    const totalTests = areas.reduce((sum, area) => sum + area.tests.length, 0)
    const passedTests = areas.reduce(
      (sum, area) => sum + area.tests.filter(t => t.status === 'passed').length,
      0
    )
    setOverallProgress((passedTests / totalTests) * 100)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'running':
        return <Clock className="h-4 w-4 text-blue-600 animate-spin" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      passed: 'default',
      failed: 'destructive',
      running: 'outline',
      pending: 'secondary',
    }
    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status}
      </Badge>
    )
  }

  const stats = {
    total: testAreas.reduce((sum, area) => sum + area.tests.length, 0),
    passed: testAreas.reduce(
      (sum, area) => sum + area.tests.filter(t => t.status === 'passed').length,
      0
    ),
    failed: testAreas.reduce(
      (sum, area) => sum + area.tests.filter(t => t.status === 'failed').length,
      0
    ),
    pending: testAreas.reduce(
      (sum, area) => sum + area.tests.filter(t => t.status === 'pending').length,
      0
    ),
  }

  return (
    <AppLayout 
      title="Test Dashboard" 
      description="Phase 9 Integration Testing Progress" 
      showBackButton
    >
      {/* Overall Progress */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Overall Testing Progress</CardTitle>
          <CardDescription>Phase 9 Integration Testing - 10 Test Areas</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={overallProgress} className="h-3" />
            <div className="flex justify-between text-sm text-gray-600">
              <span>{stats.passed} / {stats.total} tests passed</span>
              <span>{overallProgress.toFixed(1)}% complete</span>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4 pt-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-gray-600">Total</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{stats.passed}</div>
                <div className="text-xs text-gray-600">Passed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
                <div className="text-xs text-gray-600">Failed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600">{stats.pending}</div>
                <div className="text-xs text-gray-600">Pending</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={() => {
                  setIsRunning(true)
                  // In real scenario, trigger Playwright test run
                  setTimeout(() => {
                    setIsRunning(false)
                    loadTestResults()
                  }, 3000)
                }}
                disabled={isRunning}
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                {isRunning ? 'Running Tests...' : 'Run All Tests'}
              </Button>
              <Button variant="outline" onClick={loadTestResults}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Refresh Results
              </Button>
              <Button variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                View Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Timeout Flow Test Controls */}
      <Card className="mb-6 border-amber-300 dark:border-amber-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            Session Timeout Flow Test
          </CardTitle>
          <CardDescription>
            Manual controls to verify warning/continue/lock/logout behavior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Current State</p>
              <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                <p>Warning visible: <strong>{isWarningVisible ? 'yes' : 'no'}</strong></p>
                <p>Locked: <strong>{isLocked ? 'yes' : 'no'}</strong></p>
                <p>Warning seconds: <strong>{warningSecondsRemaining}</strong></p>
                <p>Auto logoff: <strong>{autoLogoffEnabled ? 'enabled' : 'disabled'}</strong></p>
                <p>Inactivity minutes: <strong>{inactivityMinutes}</strong></p>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Quick Actions</p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => showWarning(60)}>
                  Show Warning (60s)
                </Button>
                <Button size="sm" variant="outline" onClick={() => updateWarningSeconds(10)}>
                  Set Warning to 10s
                </Button>
                <Button size="sm" variant="outline" onClick={() => signalSessionActivity()}>
                  Trigger Continue Event
                </Button>
                <Button size="sm" variant="outline" onClick={() => clearWarning()}>
                  Clear Warning
                </Button>
                <Button size="sm" variant="outline" onClick={() => lock()}>
                  Force Lock Screen
                </Button>
                <Button size="sm" variant="outline" onClick={() => unlock()}>
                  Unlock Screen
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAutoLogoffEnabled(!autoLogoffEnabled)}>
                  Toggle Auto Logoff
                </Button>
                <Button size="sm" variant="outline" onClick={() => setInactivityMinutes(5)}>
                  Set Timeout to 5 min
                </Button>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={async () => {
                  await logout()
                }}
              >
                Test Full Logout
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <p><strong>Expected behavior:</strong></p>
            <p>1. Warning countdown should not auto-clear from mouse movement while warning is visible.</p>
            <p>2. Only Trigger Continue Event should clear warning and reset timers.</p>
            <p>3. Force Lock Screen then Test Full Logout should return to login and clear lock state.</p>
          </div>
        </CardContent>
      </Card>

      {/* Test Areas Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {testAreas.map((area) => {
          const areaStats = {
            total: area.tests.length,
            passed: area.tests.filter(t => t.status === 'passed').length,
            failed: area.tests.filter(t => t.status === 'failed').length,
          }
          const areaProgress = (areaStats.passed / areaStats.total) * 100

          return (
            <Card key={area.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-bold text-sm">
                      {area.priority}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{area.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {area.description}
                      </CardDescription>
                    </div>
                  </div>
                  {areaStats.failed > 0 && (
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  )}
                  {areaStats.passed === areaStats.total && (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Progress Bar */}
                  <Progress value={areaProgress} className="h-2" />
                  <div className="text-xs text-gray-600">
                    {areaStats.passed}/{areaStats.total} tests passed
                  </div>

                  {/* Test List */}
                  <div className="space-y-2">
                    {area.tests.map((test) => (
                      <div
                        key={test.id}
                        className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                      >
                        <div className="flex items-center gap-2">
                          {getStatusIcon(test.status)}
                          <span className="text-xs">{test.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {test.duration && (
                            <span className="text-xs text-gray-500">
                              {test.duration}ms
                            </span>
                          )}
                          {getStatusBadge(test.status)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Run Area Tests */}
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    <PlayCircle className="h-3 w-3 mr-2" />
                    Run {area.name} Tests
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Test Execution Tips */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Test Execution Guide
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-gray-600">
            <p><strong>Run Tests Locally:</strong></p>
            <code className="block bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1">
              npx playwright test
            </code>

            <p className="pt-3"><strong>Run Specific Test Area:</strong></p>
            <code className="block bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1">
              npx playwright test tests/e2e/scan-flow.spec.ts
            </code>

            <p className="pt-3"><strong>View Test Report:</strong></p>
            <code className="block bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1">
              npx playwright show-report
            </code>

            <p className="pt-3"><strong>Debug Tests:</strong></p>
            <code className="block bg-gray-100 dark:bg-gray-800 p-2 rounded mt-1">
              npx playwright test --debug
            </code>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
