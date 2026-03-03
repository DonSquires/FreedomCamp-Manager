/**
 * VehicleComplianceChart Component
 * Visual compliance metrics using recharts
 */

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { BarChart3, TrendingUp, AlertTriangle } from 'lucide-react'

interface VehicleComplianceChartProps {
  plateNumber: string
  chartType?: 'bar' | 'line' | 'pie'
  period?: 'week' | 'month' | 'year'
}

export function VehicleComplianceChart({
  plateNumber,
  chartType = 'bar',
  period = 'month',
}: VehicleComplianceChartProps) {
  // Fetch compliance data
  const { data: complianceData, isLoading } = useQuery({
    queryKey: ['vehicle-compliance-chart', plateNumber, period],
    queryFn: async () => {
      // Calculate date range
      const endDate = new Date()
      const startDate = new Date()
      
      switch (period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7)
          break
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1)
          break
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
      }

      // Fetch observations
      const { data: observations, error } = await (supabase.from('observations') as any)
        .select('*')
        .eq('plate_number', plateNumber)
        .gte('recorded_at', startDate.toISOString())
        .lte('recorded_at', endDate.toISOString())
        .order('recorded_at', { ascending: true })

      if (error) throw error

      // Group by date
      const grouped: Record<string, { compliant: number; breach: number }> = {}
      
      observations.forEach((obs) => {
        const date = new Date(obs.recorded_at).toLocaleDateString()
        
        if (!grouped[date]) {
          grouped[date] = { compliant: 0, breach: 0 }
        }
        
        if (obs.is_compliant) {
          grouped[date].compliant++
        } else {
          grouped[date].breach++
        }
      })

      // Convert to array for charts
      const chartData = Object.entries(grouped).map(([date, counts]) => ({
        date,
        compliant: counts.compliant,
        breach: counts.breach,
        total: counts.compliant + counts.breach,
      }))

      // Calculate totals
      const totalCompliant = observations.filter(o => o.is_compliant).length
      const totalBreach = observations.filter(o => !o.is_compliant).length
      const complianceRate = observations.length > 0
        ? ((totalCompliant / observations.length) * 100).toFixed(1)
        : '0'

      return {
        chartData,
        totalCompliant,
        totalBreach,
        complianceRate,
        total: observations.length,
      }
    },
  })

  const COLORS = {
    compliant: '#16a34a', // green-600
    breach: '#dc2626', // red-600
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading compliance data...</div>
        </CardContent>
      </Card>
    )
  }

  if (!complianceData || complianceData.total === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No observations in this period</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const pieData = [
    { name: 'Compliant', value: complianceData.totalCompliant, color: COLORS.compliant },
    { name: 'Breaches', value: complianceData.totalBreach, color: COLORS.breach },
  ]

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Observations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{complianceData.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Compliant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {complianceData.totalCompliant}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Breaches
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {complianceData.totalBreach}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Compliance Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {complianceData.complianceRate}%
            </div>
            <Badge
              variant={parseFloat(complianceData.complianceRate) >= 80 ? 'default' : 'destructive'}
              className="mt-1"
            >
              {parseFloat(complianceData.complianceRate) >= 80 ? 'Good' : 'Poor'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Compliance Trend
          </CardTitle>
          <CardDescription>
            {period === 'week' && 'Last 7 days'}
            {period === 'month' && 'Last 30 days'}
            {period === 'year' && 'Last 12 months'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            {chartType === 'bar' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={complianceData.chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="compliant" fill={COLORS.compliant} name="Compliant" />
                  <Bar dataKey="breach" fill={COLORS.breach} name="Breaches" />
                </BarChart>
              </ResponsiveContainer>
            )}

            {chartType === 'line' && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={complianceData.chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="compliant" 
                    stroke={COLORS.compliant} 
                    strokeWidth={2}
                    name="Compliant"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="breach" 
                    stroke={COLORS.breach} 
                    strokeWidth={2}
                    name="Breaches"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}

            {chartType === 'pie' && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value, percent }) => 
                      `${name}: ${value} (${(percent * 100).toFixed(0)}%)`
                    }
                    outerRadius={120}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
