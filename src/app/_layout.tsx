import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { migrateDbIfNeeded } from "@/db/migrations";
import { colors } from "@/theme/colors";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
    <SQLiteProvider databaseName="finance.db" onInit={migrateDbIfNeeded}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="import-statement" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
        <Stack.Screen name="cards" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
        <Stack.Screen name="invoices" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
        <Stack.Screen name="calendar" options={{ headerShown: false, presentation: "card", animation: "slide_from_right" }} />
        <Stack.Screen
          name="transaction/new"
          options={{
            headerShown: false,
            presentation: "card",
            animation: "slide_from_bottom",
            gestureEnabled: true,
          }}
        />
      </Stack>
    </SQLiteProvider>
    </SafeAreaProvider>
  );
}
