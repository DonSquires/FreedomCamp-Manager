import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts'
import { MapPin } from 'lucide-react'

export interface ZoneActivityData {
  zone_name: string
  total_observations: number
  compliant_count: number
  breach_count: number
  unique_vehicles: number
}

interface ZoneActivityChartProps {
  data: ZoneActivityData[]
  title?: string
  description?: string
}

const COLORS = {
  compliant: '#22c55e',
  breach: '#ef4444',
  neutral: '#3b82f6',
}

export function ZoneActivityChart({ 
  data, 
  title = "Zone Activity",
  description = "Observations and breaches by zone"
}: ZoneActivityChartProps) {
  // Calculate compliance rate for color coding
  const chartData = data.map(zone => ({
    ...zone,
    compliance_rate: zone.total_observations > 0 
      ? (zone.compliant_count / zone.total_observations) * 100 
      : 100,
  }))

  const getBarColor = (rate: number) => {
    if (rate >= 90) return COLORS.compliant
    if (rate < 70) return COLORS.breach
    return COLORS.neutral
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis 
              dataKey="zone_name" 
              type="category" 
              width={150}
              tick={{ fontSize: 12 }}
            />
            <Tooltip 
              formatter={(value: number, name: string) => {
                if (name === 'compliance_rate') return `${value.toFixed(1)}%`
                return value
              }}
            />
            <Legend />
            <Bar dataKey="compliant_count" fill={COLORS.compliant} name="Compliant" />
            <Bar dataKey="breach_count" fill={COLORS.breach} name="Breaches" />
          </BarChart>
        </ResponsiveContainer>

        {/* Zone Summary Table */}
        <div className="mt-6 border-t pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {chartData.slice(0, 6).map((zone, index) => (
              <div 
                key={zone.zone_name} 
                className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm truncate">{zone.zone_name}</div>
                  <div 
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{ 
                      backgroundColor: `${getBarColor(zone.compliance_rate)}20`,
                      color: getBarColor(zone.compliance_rate)
                    }}
                  >
                    {zone.compliance_rate.toFixed(0)}%
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-gray-600">Total</div>
                    <div className="font-semibold">{zone.total_observations}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Vehicles</div>
                    <div className="font-semibold">{zone.unique_vehicles}</div>
                  </div>
                  <div>
                    <div className="text-gray-600">Breaches</div>
                    <div className="font-semibold text-red-600">{zone.breach_count}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
