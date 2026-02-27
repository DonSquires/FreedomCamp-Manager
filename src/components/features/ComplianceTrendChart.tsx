import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface TrendDataPoint {
  date: string
  compliant: number
  breaches: number
  total: number
}

interface ComplianceTrendChartProps {
  data: TrendDataPoint[]
  title?: string
  description?: string
  showPercentage?: boolean
}

export function ComplianceTrendChart({ 
  data, 
  title = "Compliance Trends",
  description = "Daily compliance rates over time",
  showPercentage = false
}: ComplianceTrendChartProps) {
  // Calculate trend direction
  const trend = useMemo(() => {
    if (data.length < 2) return 'neutral'
    
    const recent = data.slice(-7) // Last 7 days
    const earlier = data.slice(-14, -7) // Previous 7 days
    
    const recentAvg = recent.reduce((sum, d) => sum + (d.compliant / d.total), 0) / recent.length
    const earlierAvg = earlier.reduce((sum, d) => sum + (d.compliant / d.total), 0) / earlier.length
    
    const change = recentAvg - earlierAvg
    
    if (change > 0.05) return 'up'
    if (change < -0.05) return 'down'
    return 'neutral'
  }, [data])

  // Transform data for percentage view
  const chartData = useMemo(() => {
    if (!showPercentage) return data
    
    return data.map(d => ({
      ...d,
      compliant: Math.round((d.compliant / d.total) * 100),
      breaches: Math.round((d.breaches / d.total) * 100),
    }))
  }, [data, showPercentage])

  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-5 w-5 text-green-600" />
      case 'down':
        return <TrendingDown className="h-5 w-5 text-red-600" />
      default:
        return <Minus className="h-5 w-5 text-gray-600" />
    }
  }

  const getTrendColor = () => {
    switch (trend) {
      case 'up': return 'text-green-600'
      case 'down': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getTrendText = () => {
    switch (trend) {
      case 'up': return 'Improving'
      case 'down': return 'Declining'
      default: return 'Stable'
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className={`flex items-center gap-2 ${getTrendColor()}`}>
            {getTrendIcon()}
            <span className="text-sm font-medium">{getTrendText()}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorCompliant" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorBreaches" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="date" 
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => {
                const date = new Date(value)
                return `${date.getMonth() + 1}/${date.getDate()}`
              }}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              label={{ value: showPercentage ? 'Percentage (%)' : 'Count', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip 
              formatter={(value: number) => showPercentage ? `${value}%` : value}
              labelFormatter={(label) => {
                const date = new Date(label)
                return date.toLocaleDateString('en-NZ', { 
                  month: 'short', 
                  day: 'numeric',
                  year: 'numeric'
                })
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="compliant"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#colorCompliant)"
              name="Compliant"
            />
            <Area
              type="monotone"
              dataKey="breaches"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#colorBreaches)"
              name="Breaches"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
