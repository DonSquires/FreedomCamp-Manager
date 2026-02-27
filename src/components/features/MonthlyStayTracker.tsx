/**
 * MonthlyStayTracker Component
 * Visual calendar showing monthly stays
 */

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  Calendar,
  ChevronLeft,
  ChevronRight,
  Moon,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface MonthlyStayTrackerProps {
  plateNumber: string
  zoneId: string
  maxNights?: number
  maxConsecutive?: number
}

export function MonthlyStayTracker({
  plateNumber,
  zoneId,
  maxNights = 28,
  maxConsecutive = 3,
}: MonthlyStayTrackerProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  // Fetch observations for the month
  const { data: observations, isLoading } = useQuery({
    queryKey: ['monthly-stays', plateNumber, zoneId, currentMonth.getMonth(), currentMonth.getFullYear()],
    queryFn: async () => {
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)

      const { data, error } = await supabase
        .from('observations')
        .select('*')
        .eq('plate_number', plateNumber)
        .eq('zone_id', zoneId)
        .gte('recorded_at', startOfMonth.toISOString())
        .lte('recorded_at', endOfMonth.toISOString())
        .order('recorded_at', { ascending: true })

      if (error) throw error
      return data || []
    },
  })

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))
  }

  const goToCurrentMonth = () => {
    setCurrentMonth(new Date())
  }

  // Generate calendar days
  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startDayOfWeek = firstDay.getDay()

    const days: (number | null)[] = []

    // Add empty cells for days before month starts
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null)
    }

    // Add days of month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }

    return days
  }

  // Check if a day has observations
  const getDayStatus = (day: number | null) => {
    if (day === null) return null

    const dayDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
    const dayStr = dayDate.toDateString()

    const hasObservation = observations?.some(obs => {
      const obsDate = new Date(obs.recorded_at)
      return obsDate.toDateString() === dayStr
    })

    return hasObservation
  }

  // Calculate stats
  const nightsStayed = observations?.length || 0
  const compliancePercentage = maxNights > 0 ? ((nightsStayed / maxNights) * 100) : 0
  const isOverLimit = nightsStayed > maxNights

  const days = getDaysInMonth()
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Monthly Stay Tracker
            </CardTitle>
            <CardDescription className="mt-1">
              Visual calendar of overnight stays
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Moon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Nights This Month</span>
              </div>
              <div className="text-3xl font-bold">
                {nightsStayed}
                <span className="text-lg text-muted-foreground ml-2">/ {maxNights}</span>
              </div>
              <Badge
                variant={isOverLimit ? 'destructive' : 'secondary'}
                className="mt-2"
              >
                {isOverLimit ? 'Over Limit' : `${compliancePercentage.toFixed(0)}% Used`}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Max Consecutive</span>
              </div>
              <div className="text-3xl font-bold">
                {maxConsecutive}
                <span className="text-lg text-muted-foreground ml-2">nights</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="outline" size="sm" onClick={goToPreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="font-medium">
              {currentMonth.toLocaleDateString('default', { month: 'long', year: 'numeric' })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={goToCurrentMonth}
              className="text-xs mt-1"
            >
              Go to current month
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={goToNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading calendar...
          </div>
        ) : (
          <div className="border rounded-lg p-4">
            {/* Week day headers */}
            <div className="grid grid-cols-7 gap-2 mb-2">
              {weekDays.map((day) => (
                <div
                  key={day}
                  className="text-center text-xs font-medium text-muted-foreground"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-2">
              {days.map((day, index) => {
                const hasStay = getDayStatus(day)
                const isToday =
                  day !== null &&
                  new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day).toDateString() ===
                    new Date().toDateString()

                return (
                  <div
                    key={index}
                    className={`
                      aspect-square flex items-center justify-center rounded-lg text-sm
                      ${day === null ? 'invisible' : ''}
                      ${hasStay ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted'}
                      ${isToday ? 'ring-2 ring-primary' : ''}
                      ${hasStay ? 'cursor-pointer hover:opacity-80' : ''}
                    `}
                  >
                    {day}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-primary rounded" />
                <span className="text-muted-foreground">Stayed overnight</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-muted rounded" />
                <span className="text-muted-foreground">No observation</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-muted rounded ring-2 ring-primary" />
                <span className="text-muted-foreground">Today</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
