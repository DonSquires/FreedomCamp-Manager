import 'react-native-gesture-handler'
import React, { useEffect } from 'react'
import { useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'
import { Toaster } from 'sonner-native'
import * as Notifications from 'expo-notifications'

import { useAuthStore } from './src/stores/authStore'
import LoginScreen from './src/screens/LoginScreen'
import HomeScreen from './src/screens/HomeScreen'
import ScanScreen from './src/screens/ScanScreen'
import RecentScansScreen from './src/screens/RecentScansScreen'
import BreachAlertsScreen from './src/screens/BreachAlertsScreen'
import EnforcementActionsScreen from './src/screens/EnforcementActionsScreen'
import InfringementNoticesScreen from './src/screens/InfringementNoticesScreen'
import PTTScreen from './src/screens/PTTScreen'
import OfflineModeBanner from './src/components/OfflineModeBanner'
import { SUPABASE_URL } from './src/lib/supabase'
import { highVis } from './src/lib/highVisTheme'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 2 } },
})

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

function OfficerTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: highVis.colors.actionBlue,
        tabBarInactiveTintColor: highVis.colors.nightTextSecondary,
        tabBarStyle: {
          paddingBottom: 6,
          height: 66,
          backgroundColor: highVis.colors.nightSurface,
          borderTopColor: '#1f2937',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, string> = {
            Patrol:   focused ? 'map'              : 'map-outline',
            Scan:     focused ? 'scan'             : 'scan-outline',
            Scans:    focused ? 'list'             : 'list-outline',
            Breaches: focused ? 'warning'          : 'warning-outline',
            Enforce:  focused ? 'shield-checkmark' : 'shield-checkmark-outline',
            Fines:    focused ? 'document-text'    : 'document-text-outline',
            Radio:    focused ? 'radio'            : 'radio-outline',
          }
          return <Ionicons name={icons[route.name] as any} size={size} color={color} />
        },
      })}
    >
      <Tab.Screen name="Patrol"   component={HomeScreen} />
      <Tab.Screen name="Scan"     component={ScanScreen} />
      <Tab.Screen name="Scans"    component={RecentScansScreen} options={{ tabBarLabel: 'My Scans' }} />
      <Tab.Screen name="Breaches" component={BreachAlertsScreen} options={{ tabBarLabel: 'Breaches' }} />
      <Tab.Screen name="Enforce"  component={EnforcementActionsScreen} options={{ tabBarLabel: 'Actions' }} />
      <Tab.Screen name="Fines"    component={InfringementNoticesScreen} options={{ tabBarLabel: 'Fines' }} />
      <Tab.Screen name="Radio"    component={PTTScreen}                 options={{ tabBarLabel: 'Radio' }} />
    </Tab.Navigator>
  )
}

export default function App() {
  const { isAuthenticated, loading, checkSession, initializeNotificationRuntime } = useAuthStore()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    initializeNotificationRuntime().catch(() => {})
    checkSession()
  }, [])

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setInterval> | null = null

    const checkConnectivity = async () => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 4000)
        const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        clearTimeout(timeout)
        if (mounted) setOffline(!res.ok)
      } catch {
        if (mounted) setOffline(true)
      }
    }

    checkConnectivity()
    timer = setInterval(checkConnectivity, 15000)

    return () => {
      mounted = false
      if (timer) clearInterval(timer)
    }
  }, [])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eff6ff' }}>
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <OfflineModeBanner offline={offline} />
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {isAuthenticated ? (
              <Stack.Screen name="Main" component={OfficerTabs} />
            ) : (
              <Stack.Screen name="Login" component={LoginScreen} />
            )}
          </Stack.Navigator>
          <Toaster />
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  )
}
