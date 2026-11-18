import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";
import { parseBRLToCents, todayISO } from "@/utils/money";

type InvoiceOption = { id: string; institution: string; reference_month: string; due_date: string | null; total_cents: number; extra_cents: number };

type Category = {
  id: string;
  name: string;
  kind: "income" | "expense";
  color: string | null;
};

export default function NewTransactionScreen() {
  const db = useSQLiteContext();
  const { id: transactionId } = useLocalSearchParams<{ id?: string }>();
  const isEditing = typeof transactionId === "string" && transactionId.length > 0;
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entryMode, setEntryMode] = useState<"standard" | "credit_operation">("standard");
  const [creditOperationType, setCreditOperationType] = useState<"pix_credit" | "limit_to_account">("pix_credit");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadCategories() {
      try {
        const result = await db.getAllAsync<Category>(
          "SELECT id, name, kind, color FROM categories ORDER BY name"
        );
        const invoiceRows = await db.getAllAsync<InvoiceOption>(
          `SELECT i.id, i.institution, i.reference_month, i.due_date, i.total_cents,
                  COALESCE((SELECT SUM(a.amount_cents) FROM invoice_adjustments a WHERE a.invoice_id = i.id), 0) AS extra_cents
           FROM invoices i ORDER BY COALESCE(i.due_date, i.reference_month) DESC, i.institution`
        );
        if (mounted) {
          setInvoices(invoiceRows);
          setInvoiceId(invoiceRows[0]?.id ?? "");
          setCategories(result);
          const firstExpense = result.find((item) => item.kind === "expense");
          if (firstExpense) setCategoryId(firstExpense.id);
        }
      } catch {
        if (mounted) {
          Alert.alert(
            "Erro ao carregar categorias",
            "Não foi possível consultar as categorias do banco local."
          );
        }
      } finally {
        if (mounted) setLoadingCategories(false);
      }
    }

    void loadCategories();
    return () => {
      mounted = false;
    };
  }, [db]);

  useEffect(() => {
    let mounted = true;
    if (!isEditing) return;

    async function loadTransaction() {
      try {
        const transaction = await db.getFirstAsync<{
          id: string;
          kind: "income" | "expense";
          description: string;
          amount_cents: number;
          transaction_date: string;
          category_id: string | null;
          operation_type: string | null;
        }>(
          `SELECT id, kind, description, amount_cents, transaction_date, category_id, operation_type
           FROM transactions WHERE id = ?`,
          transactionId ?? ""
        );

        if (!mounted) return;
        if (!transaction) {
          Alert.alert("Movimentação não encontrada", "Este registro pode ter sido excluído.");
          router.back();
          return;
        }

        if (transaction.operation_type === "pix_credit" || transaction.operation_type === "limit_to_account") {
          Alert.alert("Edição indisponível", "Para não desalinhar o valor da fatura, exclua este lançamento e cadastre novamente com os valores corretos.");
          router.back();
          return;
        }

        if (transaction.kind !== "income" && transaction.kind !== "expense") {
          Alert.alert("Edição indisponível", "Este tipo de movimentação ainda não pode ser editado.");
          router.back();
          return;
        }

        setKind(transaction.kind);
        setDescription(transaction.description);
        setAmount(`${Math.floor(transaction.amount_cents / 100)},${String(transaction.amount_cents % 100).padStart(2, "0")}`);
        setDate(transaction.transaction_date);
        setCategoryId(transaction.category_id ?? "");
      } catch (error) {
        console.error("Failed to load transaction:", error);
        Alert.alert("Erro", "Não foi possível carregar esta movimentação.");
        router.back();
      }
    }

    void loadTransaction();
    return () => { mounted = false; };
  }, [db, transactionId, isEditing]);

  const availableCategories = useMemo(
    () => categories.filter((item) => item.kind === kind),
    [categories, kind]
  );

  function changeKind(next: "income" | "expense") {
    setKind(next);
    const first = categories.find((item) => item.kind === next);
    setCategoryId(first?.id ?? "");
  }

  async function save() {
    if (saving) return;

    const cleanDescription = description.trim();
    const cents = parseBRLToCents(amount);
    const parsedDate = new Date(`${date}T12:00:00`);

    if (!cleanDescription && entryMode === "standard") {
      Alert.alert("Falta a descrição", "Informe o que você pagou ou recebeu.");
      return;
    }

    if (entryMode === "standard" && (cents === null || cents <= 0)) {
      Alert.alert("Valor inválido", "Digite um valor maior que zero. Exemplo: 125,90.");
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime())) {
      Alert.alert("Data inválida", "Use o formato AAAA-MM-DD. Exemplo: 2026-11-09.");
      return;
    }

    if (entryMode === "credit_operation" && isEditing) {
      Alert.alert("Edição indisponível", "Exclua e cadastre novamente para alterar uma operação vinculada à fatura.");
      return;
    }

    if (entryMode === "credit_operation") {
      const receivedCents = parseBRLToCents(receivedAmount);
      const repaymentCents = parseBRLToCents(invoiceAmount);
      if (receivedCents === null || receivedCents <= 0) { Alert.alert("Valor recebido inválido", "Informe quanto entrou na sua conta."); return; }
      if (repaymentCents === null || repaymentCents <= 0) { Alert.alert("Valor da fatura inválido", "Informe quanto será cobrado na fatura."); return; }
      if (!invoiceId || !invoices.some((item) => item.id === invoiceId)) { Alert.alert("Fatura necessária", "Cadastre ou importe uma fatura antes de lançar esta operação."); return; }
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || Number.isNaN(parsedDate.getTime())) { Alert.alert("Data inválida", "Use uma data válida no formato AAAA-MM-DD."); return; }
      setSaving(true);
      try {
        const now = new Date().toISOString();
        const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const adjustmentId = `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const operationLabel = creditOperationType === "pix_credit" ? "Pix no crédito" : "Limite convertido em saldo";
        const operationDescription = cleanDescription || operationLabel;
        await db.withTransactionAsync(async () => {
          await db.runAsync(
            `INSERT INTO transactions (id, account_id, category_id, kind, description, amount_cents, transaction_date, notes, created_at, updated_at, is_refund, operation_type)
             VALUES (?, NULL, NULL, 'card_purchase', ?, ?, ?, ?, ?, ?, 0, ?)`,
            txId, cleanDescription || operationLabel, repaymentCents, date, `Valor recebido: R$ ${(receivedCents / 100).toFixed(2)}`, now, now, creditOperationType
          );
          await db.runAsync(
            `INSERT INTO invoice_adjustments (id, invoice_id, transaction_id, operation_type, received_cents, amount_cents, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            adjustmentId, invoiceId, txId, creditOperationType, receivedCents, repaymentCents, now
          );
        });
        router.back();
      } catch (error) {
        console.error("Failed to save credit operation:", error);
        Alert.alert("Não foi possível salvar", error instanceof Error ? error.message : "Tente novamente.");
      } finally { setSaving(false); }
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();

      if (isEditing) {
        await db.runAsync(
          `UPDATE transactions
           SET category_id = ?, kind = ?, description = ?, amount_cents = ?,
               transaction_date = ?, updated_at = ?
           WHERE id = ?`,
          categoryId || null,
          kind,
          cleanDescription,
          cents,
          date,
          now,
          transactionId ?? ""
        );
      } else {
        const newId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.runAsync(
          `INSERT INTO transactions
            (id, category_id, kind, description, amount_cents, transaction_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId,
          categoryId || null,
          kind,
          cleanDescription,
          cents,
          date,
          now,
          now
        );
      }

      router.back();
    } catch (error) {
      console.error("Failed to save transaction:", error);
      Alert.alert(
        "Não foi possível salvar",
        "Ocorreu um erro ao gravar a movimentação. Seus dados digitados continuam nesta tela; tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              onPress={() => router.back()}
              hitSlop={12}
              style={styles.backButton}
            >
              <Text style={styles.backGlyph}>‹</Text>
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.title}>{isEditing ? "Editar movimentação" : "Nova movimentação"}</Text>
              <Text style={styles.subtitle}>Registre uma entrada ou saída</Text>
            </View>
          </View>

          {!isEditing ? (
            <View style={styles.modeSwitch}>
              <Pressable style={[styles.modeButton, entryMode === "standard" && styles.modeButtonActive]} onPress={() => setEntryMode("standard")}>
                <Text style={[styles.modeText, entryMode === "standard" && styles.modeTextActive]}>Comum</Text>
              </Pressable>
              <Pressable style={[styles.modeButton, entryMode === "credit_operation" && styles.modeButtonActive]} onPress={() => setEntryMode("credit_operation")}>
                <Text style={[styles.modeText, entryMode === "credit_operation" && styles.modeTextActive]}>Pix no crédito / Limite</Text>
              </Pressable>
            </View>
          ) : null}

          {entryMode === "credit_operation" && !isEditing ? (
            <>
              <Text style={styles.label}>TIPO DE OPERAÇÃO</Text>
              <View style={styles.segment}>
                <Pressable style={[styles.segmentButton, creditOperationType === "pix_credit" && styles.expenseActive]} onPress={() => setCreditOperationType("pix_credit")}>
                  <Text style={[styles.segmentText, creditOperationType === "pix_credit" && styles.segmentSelected]}>Pix no crédito</Text>
                </Pressable>
                <Pressable style={[styles.segmentButton, creditOperationType === "limit_to_account" && styles.expenseActive]} onPress={() => setCreditOperationType("limit_to_account")}>
                  <Text style={[styles.segmentText, creditOperationType === "limit_to_account" && styles.segmentSelected]}>Limite em conta</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>QUANTO ENTROU NA CONTA</Text>
              <View style={styles.amountContainer}><Text style={styles.currency}>R$</Text><TextInput value={receivedAmount} onChangeText={setReceivedAmount} placeholder="0,00" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={styles.amountInput} /></View>
              <Text style={styles.label}>QUANTO SERÁ COBRADO NA FATURA</Text>
              <View style={styles.amountContainer}><Text style={styles.currency}>R$</Text><TextInput value={invoiceAmount} onChangeText={setInvoiceAmount} placeholder="0,00" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={styles.amountInput} /></View>
              <Text style={styles.helper}>Informe o valor final que você terá que pagar. Ele será acrescentado à fatura escolhida, sem descontar o saldo da sua conta novamente.</Text>
              <Text style={styles.label}>FATURA QUE VAI RECEBER O LANÇAMENTO</Text>
              {invoices.length === 0 ? <Text style={styles.helper}>Nenhuma fatura cadastrada. Importe a fatura do cartão antes de registrar esta operação.</Text> : <View style={styles.categories}>{invoices.map((invoice) => {
                const selected = invoiceId === invoice.id;
                const [year, month] = invoice.reference_month.split("-").map(Number);
                const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                return <Pressable key={invoice.id} onPress={() => setInvoiceId(invoice.id)} style={[styles.category, selected && styles.categorySelected]}>
                  <View style={[styles.dot, { backgroundColor: selected ? colors.primary : colors.muted }]} />
                  <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{invoice.institution} · {monthLabel}</Text>
                  {selected ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>;
              })}</View>}
              {invoices.find((item) => item.id === invoiceId) ? (() => {
                const selectedInvoice = invoices.find((item) => item.id === invoiceId)!;
                const extra = parseBRLToCents(invoiceAmount) ?? 0;
                const [year, month] = selectedInvoice.reference_month.split("-").map(Number);
                const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
                return <Text style={styles.helper}>Total atual: {((selectedInvoice.total_cents + selectedInvoice.extra_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Após este lançamento: {((selectedInvoice.total_cents + selectedInvoice.extra_cents + extra) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({monthLabel})</Text>;
              })() : null}
              <Text style={styles.label}>DESCRIÇÃO</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder={creditOperationType === "pix_credit" ? "Ex.: Pix no crédito" : "Ex.: Limite convertido em saldo"} placeholderTextColor={colors.muted} style={styles.input} maxLength={100} />
              <Text style={styles.label}>DATA DA OPERAÇÃO</Text>
              <TextInput value={date} onChangeText={setDate} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={10} />
            </>
          ) : (
          <>
          <View style={styles.segment}>
            <Pressable
              style={[styles.segmentButton, kind === "expense" && styles.expenseActive]}
              onPress={() => changeKind("expense")}
            >
              <Text style={[styles.segmentText, kind === "expense" && styles.segmentSelected]}>
                Despesa
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, kind === "income" && styles.incomeActive]}
              onPress={() => changeKind("income")}
            >
              <Text style={[styles.segmentText, kind === "income" && styles.segmentSelected]}>
                Receita
              </Text>
            </Pressable>
          </View>

          <Text style={styles.label}>VALOR</Text>
          <View style={styles.amountContainer}>
            <Text style={styles.currency}>R$</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0,00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              returnKeyType="done"
              style={styles.amountInput}
              accessibilityLabel="Valor da movimentação"
            />
          </View>

          <Text style={styles.label}>DESCRIÇÃO</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={kind === "expense" ? "Ex.: Mercado, gasolina..." : "Ex.: Salário, venda..."}
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={100}
            returnKeyType="done"
          />

          <Text style={styles.label}>DATA</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />

          <View style={styles.categoryHeader}>
            <Text style={styles.label}>CATEGORIA</Text>
            {loadingCategories ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          </View>

          {loadingCategories ? (
            <View style={styles.loadingCategories}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Carregando categorias...</Text>
            </View>
          ) : availableCategories.length === 0 ? (
            <Text style={styles.helper}>Nenhuma categoria disponível para este tipo.</Text>
          ) : (
            <View style={styles.categories}>
              {availableCategories.map((item) => {
                const selected = categoryId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setCategoryId(item.id)}
                    style={[styles.category, selected && styles.categorySelected]}
                  >
                    <View style={[styles.dot, { backgroundColor: item.color || colors.primary }]} />
                    <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                      {item.name}
                    </Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          </>
          )}

          <Pressable
            disabled={saving || loadingCategories || (entryMode === "credit_operation" && invoices.length === 0)}
            style={[styles.saveButton, (saving || loadingCategories) && styles.saveDisabled]}
            onPress={() => void save()}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.saveText}>{saving ? "Salvando..." : entryMode === "credit_operation" ? "Adicionar à fatura" : isEditing ? "Salvar alterações" : "Salvar movimentação"}</Text>
            )}
          </Pressable>

          <Pressable
            disabled={saving}
            onPress={() => router.back()}
            style={styles.cancelButton}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 36 },
  header: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 25 },
  backButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  backGlyph: { color: colors.text, fontSize: 32, lineHeight: 35, marginTop: -4 },
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 19, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  modeSwitch: { flexDirection: "row", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 4, borderRadius: 14, marginBottom: 18 },
  modeButton: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 10 },
  modeButtonActive: { backgroundColor: colors.surfaceElevated },
  modeText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  modeTextActive: { color: colors.primary },
  segment: { flexDirection: "row", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 4, borderRadius: 15, marginBottom: 25 },
  segmentButton: { flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 11 },
  expenseActive: { backgroundColor: "#4A202D" },
  incomeActive: { backgroundColor: "#15382D" },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  segmentSelected: { color: colors.text },
  label: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 9, marginTop: 17 },
  amountContainer: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
  currency: { color: colors.primary, fontSize: 20, fontWeight: "700", marginRight: 10 },
  amountInput: { flex: 1, color: colors.text, fontSize: 35, fontWeight: "800", paddingVertical: 5 },
  input: { color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 14, fontSize: 14 },
  categoryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  loadingCategories: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  loadingText: { color: colors.muted, fontSize: 11 },
  helper: { color: colors.muted, fontSize: 12 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  category: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 },
  categorySelected: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  categoryText: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  categoryTextSelected: { color: colors.primary },
  dot: { width: 7, height: 7, borderRadius: 4 },
  check: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  saveButton: { backgroundColor: colors.primaryStrong, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 30 },
  saveDisabled: { opacity: 0.55 },
  saveText: { color: colors.white, fontSize: 14, fontWeight: "800" },
  cancelButton: { alignItems: "center", paddingVertical: 15 },
  cancelText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
});
