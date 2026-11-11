import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL } from "@/utils/money";

type Row = {
  id: string;
  description: string;
  amount_cents: number;
  kind: string;
  is_refund: number;
  refund_of: string | null;
  transaction_date: string;
  category_name: string | null;
  card_name: string | null;
  operation_type?: string | null;
};

export default function TransactionsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");

  const load = useCallback(async () => {
    const result = await db.getAllAsync<Row>(
      `SELECT t.id, t.description, t.amount_cents, t.kind, t.is_refund, t.refund_of, t.transaction_date,
              c.name AS category_name, cards.name AS card_name, t.operation_type
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN cards ON cards.id = t.card_id
       WHERE (? = 'all' OR t.kind = ?)
       ORDER BY t.transaction_date DESC, t.created_at DESC`,
      filter, filter
    );
    setRows(result);
  }, [db, filter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function confirmDelete(row: Row) {
    Alert.alert(
      "Excluir movimentação?",
      `A movimentação "${row.description}" será removida permanentemente.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await db.runAsync("DELETE FROM transactions WHERE id = ?", row.id);
                await load();
              } catch (error) {
                console.error("Failed to delete transaction:", error);
                Alert.alert("Erro ao excluir", "Não foi possível remover esta movimentação.");
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>HISTÓRICO</Text>
          <Text style={styles.title}>Movimentações</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={styles.importButton} onPress={() => router.push("/import-statement")}>
            <Text style={styles.importText}>PDF</Text>
          </Pressable>
          <Pressable style={styles.add} onPress={() => router.push("/transaction/new")}>
            <Text style={styles.addText}>＋</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.filters}>
        {(["all", "income", "expense"] as const).map((item) => (
          <Pressable
            key={item}
            onPress={() => setFilter(item)}
            style={[styles.filter, filter === item && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item === "all" ? "Todas" : item === "income" ? "Receitas" : "Despesas"}
            </Text>
          </Pressable>
        ))}
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nenhuma movimentação</Text>
          <Text style={styles.emptyText}>Toque no + para registrar sua primeira movimentação.</Text>
          <Pressable style={styles.cta} onPress={() => router.push("/transaction/new")}>
            <Text style={styles.ctaText}>Adicionar agora</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          {rows.map((row, index) => (
            <View key={row.id} style={[styles.row, index > 0 && styles.separator]}>
              <Pressable
                style={styles.info}
                onPress={() => router.push({ pathname: "/transaction/new", params: { id: row.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Editar ${row.description}`}
              >
                <Text style={styles.name}>{row.description}</Text>
                <Text style={styles.meta}>
                  {row.is_refund ? `Estorno · reduz ${row.refund_of === "income" ? "receitas" : "despesas"}` : row.operation_type === "pix_credit" ? "Pix no crédito" : row.category_name || "Sem categoria"} · {row.transaction_date.split("-").reverse().join("/")}{row.card_name ? ` · ${row.card_name}` : ""}
                </Text>
                <Text style={styles.editHint}>Toque para editar</Text>
              </Pressable>
              <Text style={[styles.amount, { color: row.refund_of === "expense" || row.kind === "income" && !row.is_refund || row.kind === "transfer_in" ? colors.success : colors.text }]}>
                {row.is_refund ? "−" : row.kind === "income" || row.kind === "transfer_in" ? "+" : row.kind === "transfer_out" || row.kind === "card_payment" ? "↔ " : "−"}{formatBRL(row.amount_cents)}
              </Text>
              <Pressable
                style={styles.deleteButton}
                onPress={() => confirmDelete(row)}
                accessibilityRole="button"
                accessibilityLabel={`Excluir ${row.description}`}
                hitSlop={8}
              >
                <Text style={styles.deleteText}>⌫</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 27, fontWeight: "800", marginTop: 5 },
  importButton: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  importText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  add: { backgroundColor: colors.primaryStrong, width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  addText: { color: colors.white, fontSize: 25 },
  filters: { flexDirection: "row", gap: 8, marginBottom: 18 },
  filter: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 9 },
  filterActive: { backgroundColor: colors.surfaceElevated, borderColor: colors.primary },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  filterTextActive: { color: colors.primary },
  empty: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 22, alignItems: "center", marginTop: 25 },
  emptyTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  emptyText: { color: colors.muted, textAlign: "center", fontSize: 12, lineHeight: 18, marginTop: 7 },
  cta: { backgroundColor: colors.primaryStrong, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, marginTop: 16 },
  ctaText: { color: colors.white, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 17, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  separator: { borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1, gap: 4 },
  name: { color: colors.text, fontSize: 13, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 10 },
  editHint: { color: colors.primary, fontSize: 9, marginTop: 1 },
  amount: { fontSize: 12, fontWeight: "700" },
  deleteButton: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#3A2028", alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#FB7185", fontSize: 19, fontWeight: "700" },
});
