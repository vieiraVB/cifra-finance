import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { SectionTitle } from "@/components/SectionTitle";
import { useDashboard } from "@/features/dashboard/useDashboard";
import { colors } from "@/theme/colors";
import { formatBRL } from "@/utils/money";

export default function DashboardScreen() {
  const { income, expenses, balance, recent, categories, loading } = useDashboard();
  const monthLabel = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>SEU CONTROLE FINANCEIRO</Text>
          <Text style={styles.heading}>Visão geral</Text>
          <Text style={styles.month}>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>V</Text></View>
      </View>

      <View style={styles.balanceCard}>
        <View style={styles.balanceTop}><Text style={styles.cardLabel}>Resultado do mês</Text><Text style={styles.pill}>●  LOCAL</Text></View>
        <Text style={styles.balance}>{loading ? "Carregando..." : formatBRL(balance)}</Text>
        <Text style={styles.balanceHint}>Receitas menos despesas registradas</Text>
        <View style={styles.divider} />
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <View style={styles.metricTitle}><View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={styles.metricLabel}>Receitas</Text></View>
            <Text style={styles.metricValue}>{formatBRL(income)}</Text>
          </View>
          <View style={styles.metric}>
            <View style={styles.metricTitle}><View style={[styles.dot, { backgroundColor: colors.danger }]} /><Text style={styles.metricLabel}>Despesas</Text></View>
            <Text style={styles.metricValue}>{formatBRL(expenses)}</Text>
          </View>
        </View>
      </View>

      <Pressable style={styles.addButton} onPress={() => router.push("/transaction/new")}>
        <Text style={styles.addPlus}>＋</Text><Text style={styles.addText}>Adicionar movimentação</Text>
      </Pressable>

      <SectionTitle title="Despesas por categoria" />
      {categories.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyIcon}>◷</Text><Text style={styles.emptyTitle}>Sem despesas por enquanto</Text><Text style={styles.emptyText}>Quando você registrar gastos, sua análise por categoria aparecerá aqui.</Text></View>
      ) : (
        <View style={styles.listCard}>
          {categories.map((item) => {
            const percent = expenses > 0 ? Math.min(100, (item.total / expenses) * 100) : 0;
            return <View key={item.name} style={styles.categoryRow}>
              <View style={styles.categoryHead}><View style={styles.categoryName}><View style={[styles.dot, { backgroundColor: item.color || colors.primary }]} /><Text style={styles.categoryText}>{item.name}</Text></View><Text style={styles.categoryAmount}>{formatBRL(item.total)}</Text></View>
              <View style={styles.track}><View style={[styles.fill, { width: `${percent}%`, backgroundColor: item.color || colors.primary }]} /></View>
            </View>;
          })}
        </View>
      )}

      <SectionTitle title="Últimas movimentações" action="Ver todas" />
      {recent.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Seu histórico começa aqui</Text><Text style={styles.emptyText}>Adicione sua primeira receita ou despesa para começar a acompanhar seu dinheiro.</Text></View>
      ) : (
        <View style={styles.listCard}>
          {recent.map((item, index) => (
            <View key={item.id} style={[styles.transactionRow, index > 0 && styles.rowBorder]}>
              <View style={styles.transactionIcon}><Text style={styles.transactionIconText}>{item.refund_of === "expense" || ["income", "loan_received", "loan_collection"].includes(item.kind) && !item.is_refund ? "↙" : "↗"}</Text></View>
              <View style={styles.transactionInfo}><Text style={styles.transactionName}>{item.description}</Text><Text style={styles.transactionMeta}>{item.is_refund ? `Estorno · reduz ${item.refund_of === "income" ? "receitas" : "despesas"}` : item.operation_type === "pix_credit" ? "Pix no crédito" : item.category_name || "Sem categoria"} · {item.transaction_date.split("-").reverse().join("/")}{item.card_name ? ` · ${item.card_name}` : ""}</Text></View>
              <Text style={[styles.transactionAmount, { color: ["income", "loan_received", "loan_collection"].includes(item.kind) && !item.is_refund ? colors.success : item.is_refund ? colors.primary : colors.text }]}>{item.is_refund ? "−" : ["income", "loan_received", "loan_collection"].includes(item.kind) ? "+" : "−"}{formatBRL(item.amount_cents)}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  heading: { color: colors.text, fontSize: 29, fontWeight: "800", marginTop: 5 },
  month: { color: colors.muted, fontSize: 13, marginTop: 4, textTransform: "capitalize" },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: 17, fontWeight: "800" },
  balanceCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 22, padding: 20 },
  balanceTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  pill: { color: colors.success, backgroundColor: "#123329", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  balance: { color: colors.text, fontSize: 34, fontWeight: "800", marginTop: 12, letterSpacing: -1 },
  balanceHint: { color: colors.muted, fontSize: 11, marginTop: 5 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 18 },
  metrics: { flexDirection: "row" },
  metric: { flex: 1, gap: 8 },
  metricTitle: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  metricLabel: { color: colors.muted, fontSize: 11 },
  metricValue: { color: colors.text, fontSize: 15, fontWeight: "700" },
  addButton: { backgroundColor: colors.primaryStrong, borderRadius: 15, paddingVertical: 15, marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  addPlus: { color: colors.white, fontSize: 20, fontWeight: "400", marginTop: -2 },
  addText: { color: colors.white, fontWeight: "700", fontSize: 14 },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 17, padding: 20, alignItems: "center" },
  emptyIcon: { color: colors.primary, fontSize: 25, marginBottom: 8 },
  emptyTitle: { color: colors.text, fontWeight: "700", fontSize: 14, textAlign: "center" },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  listCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 17, paddingHorizontal: 15, paddingVertical: 4 },
  categoryRow: { paddingVertical: 12, gap: 9 },
  categoryHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  categoryName: { flexDirection: "row", alignItems: "center", gap: 9 },
  categoryText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  categoryAmount: { color: colors.text, fontSize: 12, fontWeight: "700" },
  track: { height: 5, borderRadius: 5, backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  fill: { height: 5, borderRadius: 5 },
  transactionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  transactionIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
  transactionIconText: { color: colors.primary, fontSize: 19, fontWeight: "700" },
  transactionInfo: { flex: 1, gap: 4 },
  transactionName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  transactionMeta: { color: colors.muted, fontSize: 10 },
  transactionAmount: { fontSize: 11, fontWeight: "700" },
});
