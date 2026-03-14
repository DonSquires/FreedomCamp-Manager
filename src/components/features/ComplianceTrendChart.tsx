import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  ComposedChart,
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Area,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export interface TrendDataPoint {
  date: string
  compliant: number
  breaches: number
  homeless?: number
  total: number
  /** Per-day compliance rate: (compliant + homeless) / total × 100. Null when total = 0. */
  compliance_rate?: number | null
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
  // Shared constant – used in both the Line name prop and the Tooltip formatter
  // so they can never drift out of sync.
  const RATE_LINE_NAME = 'Rate %'
  // Calculate trend direction
  const trend = useMemo(() => {
    if (data.length < 2) return 'neutral'

    const complianceRatio = (d: TrendDataPoint) => (d.total > 0 ? d.compliant / d.total : 0)
    
    const recent = data.slice(-7) // Last 7 days
    const earlier = data.slice(-14, -7) // Previous 7 days

    if (earlier.length === 0) return 'neutral'
    
    const recentAvg = recent.reduce((sum, d) => sum + complianceRatio(d), 0) / recent.length
    const earlierAvg = earlier.reduce((sum, d) => sum + complianceRatio(d), 0) / earlier.length
    
    const change = recentAvg - earlierAvg
    
    if (change > 0.05) return 'up'
    if (change < -0.05) return 'down'
    return 'neutral'
  }, [data])

  // Aggregate totals across all data points – used by the reconciliation footer
  // so users can verify the chart sums to the same numbers shown in the KPI cards.
  const totals = useMemo(() => data.reduce(
    (acc, d) => ({
      total:     acc.total     + d.total,
      compliant: acc.compliant + d.compliant,
      breaches:  acc.breaches  + d.breaches,
      homeless:  acc.homeless  + (d.homeless ?? 0),
    }),
    { total: 0, compliant: 0, breaches: 0, homeless: 0 }
  ), [data])

  // Overall compliance rate computed from chart-aggregated data.
  // Formula matches the KPI card: (compliant + homeless-exempt) / total.
  const aggregateRate = totals.total > 0
    ? Math.round(((totals.compliant + totals.homeless) / totals.total) * 100)
    : 0

  // Transform data for percentage view (guard against division by zero)
  const chartData = useMemo(() => {
    if (!showPercentage) return data
    
    return data.map(d => ({
      ...d,
      compliant: d.total > 0 ? Math.round((d.compliant / d.total) * 100) : 0,
      breaches:  d.total > 0 ? Math.round((d.breaches  / d.total) * 100) : 0,
      homeless:  d.total > 0 ? Math.round(((d.homeless ?? 0) / d.total) * 100) : 0,
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
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="colorCompliant" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorBreaches" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorHomeless" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
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
            {/* Left axis: observation counts */}
            <YAxis 
              yAxisId="left"
              tick={{ fontSize: 12 }}
              label={{ value: showPercentage ? 'Percentage (%)' : 'Count', angle: -90, position: 'insideLeft' }}
            />
            {/* Right axis: per-day compliance rate % */}
            <YAxis
              yAxisId="rate"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v}%`}
              label={{ value: 'Rate %', angle: 90, position: 'insideRight', offset: 10 }}
            />
            <Tooltip 
              formatter={(value: number, name: string) => {
                if (name === RATE_LINE_NAME) return [`${value ?? 0}%`, name]
                return showPercentage ? [`${value}%`, name] : [value, name]
              }}
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
              yAxisId="left"
              type="monotone"
              dataKey="total"
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="4 2"
              fill="url(#colorTotal)"
              name="Total"
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="compliant"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#colorCompliant)"
              name="Compliant"
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="breaches"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#colorBreaches)"
              name="Breaches"
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="homeless"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#colorHomeless)"
              name="Homeless"
            />
            {/* Compliance rate % line – uses the same (compliant+homeless)/total
                formula as the headline KPI card so the two always agree. */}
            <Line
              yAxisId="rate"
              type="monotone"
              dataKey="compliance_rate"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              name={RATE_LINE_NAME}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Reconciliation footer: aggregate totals from the chart data.
            These should always match the KPI cards above. */}
        {totals.total > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="grid grid-cols-4 gap-2 text-center mb-2">
              <div>
                <p className="text-sm font-bold text-foreground">{totals.total.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Total Obs</p>
              </div>
              <div>
                <p className="text-sm font-bold text-green-600">{totals.compliant.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Compliant</p>
              </div>
              <div>
                <p className="text-sm font-bold text-red-600">{totals.breaches.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Breaches</p>
              </div>
              <div>
                <p className="text-sm font-bold text-orange-500">{totals.homeless.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Exempt</p>
              </div>
            </div>
            <p
              className="text-center text-xs text-muted-foreground"
              aria-label={`Compliance rate equals open paren ${totals.compliant.toLocaleString()} compliant plus ${totals.homeless.toLocaleString()} exempt close paren divided by ${totals.total.toLocaleString()} total equals ${aggregateRate} percent`}
            >
              Compliance rate = (Compliant + Exempt) &divide; Total ={' '}
              ({totals.compliant.toLocaleString()} + {totals.homeless.toLocaleString()}) &divide; {totals.total.toLocaleString()} ={' '}
              <span className="font-semibold text-violet-600">{aggregateRate}%</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
