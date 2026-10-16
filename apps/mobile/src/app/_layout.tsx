import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../context/AuthContext';
import { LocationProvider } from '../context/LocationContext';
import { ToastProvider } from '../components/ui/Toast';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LocationProvider>
          <ToastProvider>
          <StatusBar style="light" />
          <Stack
            initialRouteName="(tabs)"
            screenOptions={{
              headerStyle: {
                backgroundColor: colors.background,
              },
              headerTintColor: colors.textPrimary,
              headerTitleStyle: {
                fontWeight: '700',
                fontSize: 17,
              },
              contentStyle: {
                backgroundColor: colors.background,
              },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false }} />
            <Stack.Screen name="auth/login" options={{ headerShown: false, presentation: 'modal' }} />
            <Stack.Screen name="auth/register" options={{ headerShown: false }} />
            <Stack.Screen name="movie/[id]" options={{ headerShown: false }} />
            <Stack.Screen
              name="booking/showtimes/[movieId]"
              options={{
                title: 'Select Showtime',
                headerBackTitle: 'Back',
                headerTintColor: colors.gold,
              }}
            />
            <Stack.Screen
              name="booking/seats/[showtimeId]"
              options={{
                title: 'Select Seats',
                headerBackTitle: 'Showtimes',
                headerTintColor: colors.gold,
              }}
            />
            <Stack.Screen
              name="gallery"
              options={{
                title: 'Design System Gallery',
                headerTintColor: colors.gold,
              }}
            />
          </Stack>
          </ToastProvider>
        </LocationProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
