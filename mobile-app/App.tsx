import React, { useEffect } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'
import { Toaster } from 'sonner-native'

import { useAuthStore } from './src/stores/authStore'
import LoginScreen from './src/screens/LoginScreen'
import HomeScreen from './src/screens/HomeScreen'
import ScanScreen from './src/screens/ScanScreen'
import RecentScansScreen from './src/screens/RecentScansScreen'
import BreachAlertsScreen from './src/screens/BreachAlertsScreen'
import EnforcementActionsScreen from './src/screens/EnforcementActionsScreen'
import InfringementNoticesScreen from './src/screens/InfringementNoticesScreen'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 2 } },
})

function OfficerTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#1d4ed8',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: { paddingBottom: 4, height: 60 },
        tabBarLabelStyle: { fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, string> = {
            Home:     focused ? 'home'             : 'home-outline',
            Scan:     focused ? 'camera'           : 'camera-outline',
            Scans:    focused ? 'list'             : 'list-outline',
            Breaches: focused ? 'warning'          : 'warning-outline',
            Enforce:  focused ? 'shield-checkmark' : 'shield-checkmark-outline',
            Fines:    focused ? 'document-text'    : 'document-text-outline',
          }
          return <Ionicons name={icons[route.name] as any} size={size} color={color} />
        },
      })}
    >
      <Tab.Screen name="Home"     component={HomeScreen} />
      <Tab.Screen name="Scan"     component={ScanScreen} />
      <Tab.Screen name="Scans"    component={RecentScansScreen} options={{ tabBarLabel: 'My Scans' }} />
      <Tab.Screen name="Breaches" component={BreachAlertsScreen} options={{ tabBarLabel: 'Breaches' }} />
      <Tab.Screen name="Enforce"  component={EnforcementActionsScreen} options={{ tabBarLabel: 'Actions' }} />
      <Tab.Screen name="Fines"    component={InfringementNoticesScreen} options={{ tabBarLabel: 'Fines' }} />
    </Tab.Navigator>
  )
}

export default function App() {
  const { isAuthenticated, loading, checkSession } = useAuthStore()

  useEffect(() => {
    checkSession()
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
          <StatusBar style="auto" />
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
