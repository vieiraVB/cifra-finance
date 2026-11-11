import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { colors } from "@/theme/colors";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 86,
          paddingTop: 9,
          paddingBottom: 22,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Início", tabBarIcon: ({ color }) => <TabGlyph glyph="⌂" color={color} /> }} />
      <Tabs.Screen name="transactions" options={{ title: "Movimentos", tabBarIcon: ({ color }) => <TabGlyph glyph="⇄" color={color} /> }} />
      <Tabs.Screen name="loans" options={{ title: "Empréstimos", tabBarIcon: ({ color }) => <TabGlyph glyph="↗" color={color} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Relatórios", tabBarIcon: ({ color }) => <TabGlyph glyph="▥" color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Ajustes", tabBarIcon: ({ color }) => <TabGlyph glyph="⚙" color={color} /> }} />
    </Tabs>
  );
}

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue | null }) {
  return <Text style={{ color: color ?? colors.muted, fontSize: 22, lineHeight: 25, fontWeight: "600" }}>{glyph}</Text>;
}
