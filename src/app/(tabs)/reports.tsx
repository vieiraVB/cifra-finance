import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL } from "@/utils/money";

type ReportTotals = {
  income: number; expenses: number; refunds: number; transfers: number;
  cardPayments: number; cardPurchases: number;
};
type PendingRefund = {
  id: string; description: string; amount_cents: number; transaction_date: string;
  refund_of: string | null; account_id: string | null; card_id: string | null;
};
type Candidate = { id: string; description: string; amount_cents: number; transaction_date: string };
type BudgetRow = { category_id: string; category_name: string; limit_cents: number; spent_cents: number };
type ExpenseCategory = { id: string; name: string };
type RecurringExpense = {
  id: string; description: string; amount_cents: number; category_id: string | null;
  category_name: string | null; due_day: number; start_month: string; end_month: string | null; is_active: number;
};

export default function ReportsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [totals, setTotals] = useState<ReportTotals>({ income: 0, expenses: 0, refunds: 0, transfers: 0, cardPayments: 0, cardPurchases: 0 });
  const [pending, setPending] = useState<PendingRefund[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [budgetModal, setBudgetModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [recurringModal, setRecurringModal] = useState(false);
  const [recurringDescription, setRecurringDescription] = useState("");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringCategory, setRecurringCategory] = useState("");
  const [recurringDueDay, setRecurringDueDay] = useState("10");
  const [period, setPeriod] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [loading, setLoading] = useState(true);
  const month = useMemo(() => `${period.getFullYear()}-${String(period.getMonth() + 1).padStart(2, "0")}`, [period]);
  const monthLabel = useMemo(() => period.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.getFirstAsync<ReportTotals>(
        `SELECT
          COALESCE(SUM(CASE WHEN kind = 'income' AND is_refund = 0 THEN amount_cents WHEN is_refund = 1 AND refund_of = 'income' THEN -amount_cents ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN kind IN ('expense','card_purchase') AND is_refund = 0 THEN amount_cents WHEN is_refund = 1 AND refund_of = 'expense' THEN -amount_cents ELSE 0 END), 0) AS expenses,
          COALESCE(SUM(CASE WHEN is_refund = 1 THEN amount_cents ELSE 0 END), 0) AS refunds,
          COALESCE(SUM(CASE WHEN kind IN ('transfer_in','transfer_out') THEN amount_cents ELSE 0 END), 0) AS transfers,
          COALESCE(SUM(CASE WHEN kind = 'card_payment' THEN amount_cents ELSE 0 END), 0) AS cardPayments,
          COALESCE(SUM(CASE WHEN kind = 'card_purchase' AND is_refund = 0 THEN amount_cents ELSE 0 END), 0) AS cardPurchases
         FROM transactions WHERE substr(transaction_date,1,7) = ?`, month
      );
      const unresolved = await db.getAllAsync<PendingRefund>(
        `SELECT id, description, amount_cents, transaction_date, refund_of, account_id, card_id
         FROM transactions WHERE is_refund = 1 AND refund_transaction_id IS NULL
           AND substr(transaction_date,1,7) = ?
         ORDER BY transaction_date DESC`, month
      );
      setTotals(result ?? { income: 0, expenses: 0, refunds: 0, transfers: 0, cardPayments: 0, cardPurchases: 0 });
      setPending(unresolved);
      const categories = await db.getAllAsync<ExpenseCategory>(
        "SELECT id, name FROM categories WHERE kind = 'expense' ORDER BY name"
      );
      setExpenseCategories(categories);
      const budgetRows = await db.getAllAsync<BudgetRow>(
        `SELECT b.category_id, c.name AS category_name, b.limit_cents,
          COALESCE(SUM(CASE
            WHEN t.is_refund = 0 AND t.kind IN ('expense','card_purchase') THEN t.amount_cents
            WHEN t.is_refund = 1 AND t.refund_of = 'expense' THEN -t.amount_cents
            ELSE 0 END), 0) AS spent_cents
         FROM category_budgets b
         JOIN categories c ON c.id = b.category_id
         LEFT JOIN transactions t ON t.category_id = b.category_id
           AND substr(t.transaction_date,1,7) = b.reference_month
         WHERE b.reference_month = ?
         GROUP BY b.id, b.category_id, c.name, b.limit_cents
         ORDER BY c.name`,
        month
      );
      setBudgets(budgetRows);
      const recurringRows = await db.getAllAsync<RecurringExpense>(
        `SELECT r.id, r.description, r.amount_cents, r.category_id, c.name AS category_name,
                r.due_day, r.start_month, r.end_month, r.is_active
         FROM recurring_expenses r
         LEFT JOIN categories c ON c.id = r.category_id
         ORDER BY r.is_active DESC, r.due_day, r.description`
      );
      setRecurring(recurringRows);
    } finally { setLoading(false); }
  }, [db, month]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function changeMonth(offset: number) {
    setPeriod((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  async function saveBudget() {
    const raw = budgetAmount.trim();
    const normalized = raw.includes(",") ? raw.replace(/\\./g, "").replace(",", ".") : raw;
    const amount = Number(normalized);
    const cents = Math.round(amount * 100);
    if (!selectedCategory) {
      Alert.alert("Escolha uma categoria", "Selecione a categoria que deseja acompanhar.");
      return;
    }
    if (!Number.isFinite(amount) || cents <= 0) {
      Alert.alert("Valor inválido", "Informe um limite mensal maior que zero. Exemplo: 500,00.");
      return;
    }
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO category_budgets (id, category_id, reference_month, limit_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(category_id, reference_month) DO UPDATE SET
         limit_cents = excluded.limit_cents, updated_at = excluded.updated_at`,
      `budget_${selectedCategory}_${month}`, selectedCategory, month, cents, now, now
    );
    setBudgetModal(false);
    setBudgetAmount("");
    await load();
  }

  async function removeBudget(categoryId: string) {
    await db.runAsync("DELETE FROM category_budgets WHERE category_id = ? AND reference_month = ?", categoryId, month);
    await load();
  }

  async function saveRecurringExpense() {
    const description = recurringDescription.trim();
    const raw = recurringAmount.trim();
    const normalized = raw.includes(",") ? raw.replace(/\\./g, "").replace(",", ".") : raw;
    const amount = Number(normalized);
    const cents = Math.round(amount * 100);
    const dueDay = Number.parseInt(recurringDueDay, 10);
    if (!description) {
      Alert.alert("Falta a descrição", "Informe o nome da despesa recorrente.");
      return;
    }
    if (!Number.isFinite(amount) || cents <= 0) {
      Alert.alert("Valor inválido", "Informe um valor maior que zero. Exemplo: 99,90.");
      return;
    }
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      Alert.alert("Dia inválido", "Escolha um dia entre 1 e 28 para evitar problemas em meses mais curtos.");
      return;
    }
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO recurring_expenses
        (id, description, amount_cents, category_id, due_day, start_month, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      description, cents, recurringCategory || null, dueDay, month, now, now
    );
    setRecurringModal(false);
    setRecurringDescription("");
    setRecurringAmount("");
    await load();
  }

  async function toggleRecurring(item: RecurringExpense) {
    await db.runAsync(
      "UPDATE recurring_expenses SET is_active = ?, updated_at = ? WHERE id = ?",
      item.is_active ? 0 : 1, new Date().toISOString(), item.id
    );
    await load();
  }

  async function deleteRecurring(item: RecurringExpense) {
    Alert.alert("Excluir despesa recorrente", `Excluir “${item.description}”? As movimentações já importadas ou lançadas não serão afetadas.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => {
        void db.runAsync("DELETE FROM recurring_expenses WHERE id = ?", item.id).then(load);
      } },
    ]);
  }

  const activeRecurring = recurring.filter((item) => item.is_active === 1);
  const forecast = [0, 1, 2].map((offset) => {
    const date = new Date(period.getFullYear(), period.getMonth() + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    const total = activeRecurring
      .filter((item) => item.start_month <= key && (!item.end_month || item.end_month >= key))
      .reduce((sum, item) => sum + item.amount_cents, 0);
    return { key, label, total };
  });

  async function offerLink(refund: PendingRefund) {
    const candidateKinds = refund.refund_of === "income" ? ["income"] : ["expense", "card_purchase"];
    const placeholders = candidateKinds.map(() => "?").join(", ");
    const candidates = await db.getAllAsync<Candidate>(
      `SELECT id, description, amount_cents, transaction_date FROM transactions
       WHERE is_refund = 0 AND kind IN (${placeholders})
         AND amount_cents = ? AND transaction_date <= date(?, '+0 day')
         AND transaction_date >= date(?, '-365 day')
         AND (? IS NULL OR account_id = ?)
         AND id <> ?
         AND NOT EXISTS (SELECT 1 FROM transactions linked WHERE linked.refund_transaction_id = transactions.id)
       ORDER BY transaction_date DESC LIMIT 8`,
      ...candidateKinds, refund.amount_cents, refund.transaction_date, refund.transaction_date,
      refund.account_id, refund.account_id, refund.id
    );
    if (!candidates.length) {
      Alert.alert("Nenhuma correspondência segura", "Não encontrei uma movimentação original com o mesmo valor e conta. O estorno continuará sem vínculo.");
      return;
    }
    Alert.alert("Vincular estorno", `Escolha a movimentação original para “${refund.description}”.`, [
      { text: "Cancelar", style: "cancel" },
      ...candidates.slice(0, 3).map((candidate) => ({
        text: `${candidate.description.slice(0, 24)} · ${candidate.transaction_date.split("-").reverse().join("/")}`,
        onPress: () => {
          void db.runAsync("UPDATE transactions SET refund_transaction_id = ?, updated_at = ? WHERE id = ? AND refund_transaction_id IS NULL",
            candidate.id, new Date().toISOString(), refund.id).then(load).catch(() => Alert.alert("Erro", "Não foi possível vincular o estorno."));
        },
      })),
    ]);
  }

  const rows = [
    ["Receitas líquidas", totals.income], ["Despesas líquidas", totals.expenses],
    ["Estornos identificados", totals.refunds], ["Movimentações entre contas", totals.transfers],
    ["Compras no cartão", totals.cardPurchases], ["Pagamentos de fatura", totals.cardPayments],
  ] as const;
  return <Screen>
    <Text style={styles.kicker}>ANÁLISE FINANCEIRA</Text>
    <Text style={styles.title}>Relatórios</Text>
    <Text style={styles.subtitle}>Receitas, despesas, estornos, transferências e pagamentos de fatura são apresentados separadamente.</Text>
    <Pressable style={styles.calendarShortcut} onPress={() => router.push("/calendar")}>
      <Text style={styles.calendarShortcutText}>▦  Abrir calendário financeiro</Text>
      <Text style={styles.calendarShortcutArrow}>›</Text>
    </Pressable>
    <Pressable style={[styles.calendarShortcut, { borderColor: colors.border, marginTop: 9 }]} onPress={() => router.push("/invoices")}>
      <Text style={[styles.calendarShortcutText, { color: colors.text }]}>▣  Gerenciar faturas e pagamentos</Text>
      <Text style={styles.calendarShortcutArrow}>›</Text>
    </Pressable>
    <View style={styles.period}>
      <Pressable onPress={() => changeMonth(-1)} style={styles.periodButton}><Text style={styles.periodArrow}>‹</Text></Pressable>
      <Text style={styles.periodLabel}>{monthLabel}</Text>
      <Pressable onPress={() => changeMonth(1)} style={styles.periodButton}><Text style={styles.periodArrow}>›</Text></Pressable>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Resultado do período</Text>
      <Text style={styles.result}>{loading ? "Carregando..." : formatBRL(totals.income - totals.expenses)}</Text>
      <Text style={styles.body}>Receitas líquidas menos despesas líquidas</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Composição financeira</Text>
      {rows.map(([label, value]) => <View key={label} style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{loading ? "—" : formatBRL(value)}</Text></View>)}
    </View>
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Orçamento por categoria</Text>
          <Text style={styles.body}>Defina limites mensais e acompanhe seus gastos líquidos.</Text>
        </View>
        <Pressable style={styles.linkButton} onPress={() => {
          setSelectedCategory(expenseCategories[0]?.id ?? "");
          setBudgetAmount("");
          setBudgetModal(true);
        }}>
          <Text style={styles.linkText}>+ Limite</Text>
        </Pressable>
      </View>
      {budgets.length === 0 ? (
        <Text style={styles.empty}>Nenhum limite definido para este mês.</Text>
      ) : budgets.map((budget) => {
        const ratio = budget.limit_cents > 0 ? budget.spent_cents / budget.limit_cents : 0;
        const percent = Math.round(ratio * 100);
        const remaining = budget.limit_cents - budget.spent_cents;
        return <View key={budget.category_id} style={styles.budgetRow}>
          <View style={styles.budgetTop}>
            <Text style={styles.pendingTitle}>{budget.category_name}</Text>
            <Text style={[styles.budgetPercent, ratio > 1 ? styles.overBudget : null]}>{percent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, percent))}%` }, ratio > 1 ? styles.progressOver : null]} />
          </View>
          <View style={styles.budgetBottom}>
            <Text style={styles.body}>{formatBRL(budget.spent_cents)} de {formatBRL(budget.limit_cents)}</Text>
            <Text style={[styles.budgetRemaining, remaining < 0 ? styles.overBudget : null]}>
              {remaining >= 0 ? `Restam ${formatBRL(remaining)}` : `Excedido ${formatBRL(Math.abs(remaining))}`}
            </Text>
          </View>
          <View style={styles.budgetActions}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.budgetActionButton, styles.budgetEditButton, pressed ? styles.actionPressed : null]}
              onPress={() => { setSelectedCategory(budget.category_id); setBudgetAmount((budget.limit_cents / 100).toFixed(2).replace(".", ",")); setBudgetModal(true); }}>
              <Text style={styles.budgetEditText}>Editar limite</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.budgetActionButton, styles.budgetRemoveButton, pressed ? styles.actionPressed : null]}
              onPress={() => Alert.alert("Remover limite", `Remover o orçamento de ${budget.category_name} deste mês?`, [
                { text: "Cancelar", style: "cancel" }, { text: "Remover", style: "destructive", onPress: () => void removeBudget(budget.category_id) }
              ])}>
              <Text style={styles.budgetRemoveText}>Remover</Text>
            </Pressable>
          </View>
        </View>;
      })}
    </View>
    <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.cardTitle}>Definir orçamento</Text>
          <Text style={styles.body}>Escolha uma categoria para {monthLabel}.</Text>
          <View style={styles.categoryChoices}>
            {expenseCategories.map((category) => (
              <Pressable key={category.id} onPress={() => setSelectedCategory(category.id)}
                style={[styles.categoryChoice, selectedCategory === category.id ? styles.categoryChoiceActive : null]}>
                <Text style={[styles.categoryChoiceText, selectedCategory === category.id ? styles.categoryChoiceTextActive : null]}>{category.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.inputLabel}>Limite mensal (R$)</Text>
          <TextInput value={budgetAmount} onChangeText={setBudgetAmount} keyboardType="decimal-pad"
            placeholder="Ex.: 500,00" placeholderTextColor={colors.muted} style={styles.budgetInput} />
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelButton} onPress={() => setBudgetModal(false)}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
            <Pressable style={styles.saveButton} onPress={() => void saveBudget()}><Text style={styles.saveText}>Salvar limite</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Despesas recorrentes</Text>
          <Text style={styles.body}>Cadastre compromissos mensais e visualize uma previsão, sem lançar despesas automaticamente.</Text>
        </View>
        <Pressable style={styles.linkButton} onPress={() => {
          setRecurringDescription("");
          setRecurringAmount("");
          setRecurringCategory(expenseCategories[0]?.id ?? "");
          setRecurringDueDay("10");
          setRecurringModal(true);
        }}>
          <Text style={styles.linkText}>+ Nova</Text>
        </Pressable>
      </View>
      {recurring.length === 0 ? (
        <Text style={styles.empty}>Nenhuma despesa recorrente cadastrada.</Text>
      ) : recurring.map((item) => (
        <View key={item.id} style={styles.recurringRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>{item.description}</Text>
            <Text style={styles.body}>{item.category_name ?? "Sem categoria"} · Dia {item.due_day} · {formatBRL(item.amount_cents)}/mês</Text>
            <Text style={[styles.recurringStatus, item.is_active ? styles.recurringActive : styles.recurringPaused]}>
              {item.is_active ? "Ativa" : "Pausada"}
            </Text>
          </View>
          <View style={styles.recurringActions}>
            <Pressable style={styles.smallAction} onPress={() => void toggleRecurring(item)}>
              <Text style={styles.linkText}>{item.is_active ? "Pausar" : "Ativar"}</Text>
            </Pressable>
            <Pressable style={[styles.smallAction, styles.smallDanger]} onPress={() => void deleteRecurring(item)}>
              <Text style={styles.budgetRemoveText}>Excluir</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Text style={[styles.cardTitle, { marginTop: 18 }]}>Previsão dos próximos 3 meses</Text>
      <Text style={styles.body}>Estimativa baseada nas despesas recorrentes ativas, a partir do mês selecionado.</Text>
      {forecast.map((item) => (
        <View key={item.key} style={styles.row}>
          <Text style={styles.label}>{item.label.charAt(0).toUpperCase() + item.label.slice(1)} de {item.key.slice(0,4)}</Text>
          <Text style={styles.value}>{formatBRL(item.total)}</Text>
        </View>
      ))}
    </View>
    <Modal visible={recurringModal} transparent animationType="fade" onRequestClose={() => setRecurringModal(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.cardTitle}>Nova despesa recorrente</Text>
          <Text style={styles.body}>O primeiro mês será {monthLabel}. Nenhuma movimentação será criada automaticamente.</Text>
          <Text style={styles.inputLabel}>Descrição</Text>
          <TextInput value={recurringDescription} onChangeText={setRecurringDescription}
            placeholder="Ex.: Internet, academia, aluguel" placeholderTextColor={colors.muted} style={styles.budgetInput}/>
          <Text style={styles.inputLabel}>Valor mensal (R$)</Text>
          <TextInput value={recurringAmount} onChangeText={setRecurringAmount} keyboardType="decimal-pad"
            placeholder="Ex.: 99,90" placeholderTextColor={colors.muted} style={styles.budgetInput}/>
          <Text style={styles.inputLabel}>Categoria</Text>
          <View style={styles.categoryChoices}>
            {expenseCategories.map((category) => (
              <Pressable key={category.id} onPress={() => setRecurringCategory(category.id)}
                style={[styles.categoryChoice, recurringCategory === category.id ? styles.categoryChoiceActive : null]}>
                <Text style={[styles.categoryChoiceText, recurringCategory === category.id ? styles.categoryChoiceTextActive : null]}>{category.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.inputLabel}>Dia do vencimento (1 a 28)</Text>
          <TextInput value={recurringDueDay} onChangeText={setRecurringDueDay} keyboardType="number-pad"
            maxLength={2} placeholder="10" placeholderTextColor={colors.muted} style={styles.budgetInput}/>
          <View style={styles.modalActions}>
            <Pressable style={styles.cancelButton} onPress={() => setRecurringModal(false)}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
            <Pressable style={styles.saveButton} onPress={() => void saveRecurringExpense()}><Text style={styles.saveText}>Salvar recorrência</Text></Pressable>
          </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Estornos sem vínculo</Text>
      <Text style={styles.body}>Associe manualmente um estorno à compra ou receita original quando tiver certeza da correspondência.</Text>
      {pending.length === 0 ? <Text style={styles.empty}>Nenhum estorno pendente neste período.</Text> : pending.map((item) => (
        <View key={item.id} style={styles.pendingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>{item.description}</Text>
            <Text style={styles.body}>{item.transaction_date.split("-").reverse().join("/")} · {formatBRL(item.amount_cents)}</Text>
          </View>
          <Pressable style={styles.linkButton} onPress={() => void offerLink(item)}><Text style={styles.linkText}>Vincular</Text></Pressable>
        </View>
      ))}
    </View>
    <View style={styles.note}><Text style={styles.noteTitle}>Como ler este relatório</Text><Text style={styles.body}>Estornos reduzem a receita ou a despesa original. Transferências entre contas próprias não são renda nem consumo. Pagamentos de fatura quitam o cartão e não devem ser somados novamente às compras.</Text></View>
  </Screen>;
}
const styles = StyleSheet.create({
  calendarShortcut: { marginTop: 16, marginBottom: 4, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarShortcutText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  calendarShortcutArrow: { color: colors.primary, fontSize: 25, fontWeight: "500" },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 9 },
  period: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 },
  periodButton: { width: 42, height: 38, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  periodArrow: { color: colors.primary, fontSize: 25, lineHeight: 28 },
  periodLabel: { color: colors.text, fontSize: 14, fontWeight: "700", textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 19, marginTop: 18 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  result: { color: colors.primary, fontSize: 29, fontWeight: "800", marginTop: 12 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { color: colors.muted, fontSize: 12, flex: 1 },
  value: { color: colors.text, fontSize: 12, fontWeight: "700" },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  pendingTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
  linkButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.primary },
  linkText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  empty: { color: colors.success, fontSize: 12, marginTop: 12 },
  note: { marginTop: 18, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  noteTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  budgetRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  budgetTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetPercent: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  overBudget: { color: colors.danger },
  progressTrack: { height: 8, borderRadius: 8, backgroundColor: colors.surfaceElevated, marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 8, backgroundColor: colors.primary },
  progressOver: { backgroundColor: colors.danger },
  budgetBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" },
  budgetRemaining: { color: colors.success, fontSize: 11, fontWeight: "700" },
  budgetActions: { flexDirection: "row", gap: 10, marginTop: 13 },
  budgetActionButton: { flex: 1, minHeight: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderWidth: 1 },
  budgetEditButton: { backgroundColor: colors.surfaceElevated, borderColor: colors.primary },
  budgetRemoveButton: { backgroundColor: "transparent", borderColor: colors.danger },
  budgetEditText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  budgetRemoveText: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  actionPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  recurringRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  recurringStatus: { fontSize: 10, fontWeight: "800", marginTop: 5 },
  recurringActive: { color: colors.success },
  recurringPaused: { color: colors.warning },
  recurringActions: { gap: 7 },
  smallAction: { minWidth: 74, minHeight: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  smallDanger: { borderColor: colors.danger },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, maxHeight: "85%" },
  categoryChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  categoryChoice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  categoryChoiceActive: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  categoryChoiceText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  categoryChoiceTextActive: { color: colors.primary },
  inputLabel: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  budgetInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13, color: colors.text, fontSize: 16 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  cancelButton: { paddingHorizontal: 14, paddingVertical: 12 },
  cancelText: { color: colors.muted, fontWeight: "700" },
  saveButton: { backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  saveText: { color: "#FFFFFF", fontWeight: "800" },
});
