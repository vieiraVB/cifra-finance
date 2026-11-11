import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL, parseBRLToCents, todayISO } from "@/utils/money";

type Invoice = {
  id: string; institution: string; reference_month: string; closing_date: string | null;
  due_date: string | null; total_cents: number; status: string; paid_cents: number;
};
type Account = { id: string; name: string; institution: string | null };
type Payment = {
  id: string; invoice_id: string; amount_cents: number; paid_on: string;
  account_id: string | null; account_name: string | null; notes: string | null; transaction_source: "created" | "matched";
};
type EditingPayment = { id: string; amount_cents: number; paid_on: string; account_id: string | null; notes: string | null; transaction_source: "created" | "matched" };
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const dateBR = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Não informado";
const monthBR = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

export default function InvoicesScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<EditingPayment | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const invoiceRows = await db.getAllAsync<Invoice>(
      `SELECT i.id, i.institution, i.reference_month, i.closing_date, i.due_date,
              i.total_cents, i.status,
              COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) AS paid_cents
       FROM invoices i ORDER BY COALESCE(i.due_date, i.reference_month) DESC, i.institution`
    );
    const accountRows = await db.getAllAsync<Account>(
      "SELECT id, name, institution FROM accounts WHERE is_archived = 0 ORDER BY name"
    );
    const paymentRows = await db.getAllAsync<Payment>(
      `SELECT p.id, p.invoice_id, p.amount_cents, p.paid_on, p.account_id,
              a.name AS account_name, p.notes, p.transaction_source
       FROM invoice_payments p LEFT JOIN accounts a ON a.id = p.account_id
       ORDER BY p.paid_on DESC, p.created_at DESC`
    );
    setInvoices(invoiceRows);
    setAccounts(accountRows);
    setPayments(paymentRows);
    setActiveInvoice(current => current ? invoiceRows.find(row => row.id === current.id) ?? null : null);
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const paymentsByInvoice = useMemo(() => {
    const grouped: Record<string, Payment[]> = {};
    for (const payment of payments) (grouped[payment.invoice_id] ??= []).push(payment);
    return grouped;
  }, [payments]);

  function openPayment(invoice: Invoice, payment?: Payment) {
    setActiveInvoice(invoice);
    setEditing(payment ? { id: payment.id, amount_cents: payment.amount_cents, paid_on: payment.paid_on, account_id: payment.account_id, notes: payment.notes, transaction_source: payment.transaction_source } : null);
    setAmount(payment ? (payment.amount_cents / 100).toFixed(2).replace(".", ",") : "");
    setPaidOn(payment?.paid_on ?? todayISO());
    setAccountId(payment?.account_id ?? accounts[0]?.id ?? "");
    setNotes(payment?.notes ?? "");
    setModalVisible(true);
  }

  async function refreshInvoiceStatus(invoiceId: string) {
    const row = await db.getFirstAsync<{ total_cents: number; status: string; paid_cents: number }>(
      `SELECT i.total_cents, i.status,
              COALESCE((SELECT SUM(amount_cents) FROM invoice_payments WHERE invoice_id = i.id), 0) AS paid_cents
       FROM invoices i WHERE i.id = ?`, invoiceId
    );
    if (!row) return;
    const nextStatus = row.total_cents > 0 && row.paid_cents >= row.total_cents
      ? "paid" : row.paid_cents > 0 ? "partial" : row.status === "closed" ? "closed" : "open";
    await db.runAsync("UPDATE invoices SET status = ? WHERE id = ?", nextStatus, invoiceId);
  }

  async function savePayment() {
    if (!activeInvoice) return;
    const cents = parseBRLToCents(amount);
    if (!cents) { Alert.alert("Valor inválido", "Informe um valor de pagamento maior que zero."); return; }
    const parsedPaidOn = new Date(`${paidOn}T12:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(parsedPaidOn.getTime()) || parsedPaidOn.toISOString().slice(0, 10) !== paidOn) {
      Alert.alert("Data inválida", "Use uma data válida no formato AAAA-MM-DD, por exemplo 2026-11-05."); return;
    }
    if (!accountId) { Alert.alert("Conta necessária", "Selecione a conta de onde saiu o pagamento."); return; }
    const alreadyPaid = activeInvoice.paid_cents - (editing?.amount_cents ?? 0);
    const remaining = Math.max(0, activeInvoice.total_cents - alreadyPaid);
    if (cents > remaining) {
      Alert.alert("Valor acima do restante", `O valor máximo que falta pagar é ${formatBRL(remaining)}.`); return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editing) {
        await db.withTransactionAsync(async () => {
          if (editing.transaction_source === "matched") {
            // Keep imported bank movements immutable; only edit the annotation.
            await db.runAsync("UPDATE invoice_payments SET notes = ? WHERE id = ?", notes.trim() || null, editing.id);
          } else {
            await db.runAsync(
              "UPDATE invoice_payments SET amount_cents = ?, paid_on = ?, account_id = ?, notes = ? WHERE id = ?",
              cents, paidOn, accountId, notes.trim() || null, editing.id
            );
            await db.runAsync(
              `UPDATE transactions SET account_id = ?, amount_cents = ?, transaction_date = ?,
               description = ?, notes = ?, updated_at = ? WHERE id = (SELECT transaction_id FROM invoice_payments WHERE id = ?)`,
              accountId, cents, paidOn, `Pagamento fatura ${activeInvoice.institution}`, notes.trim() || null, now, editing.id
            );
          }
        });
      } else {
        const paymentId = makeId("invpay");
        const matches = await db.getAllAsync<{ id: string }>(
          `SELECT t.id FROM transactions t
           WHERE t.kind = 'card_payment' AND t.account_id = ? AND t.amount_cents = ?
             AND t.transaction_date = ?
             AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.transaction_id = t.id)`,
          accountId, cents, paidOn
        );
        if (matches.length > 1) {
          Alert.alert("Mais de um pagamento encontrado", "Há várias movimentações de pagamento com o mesmo valor, data e conta. Para evitar associar a movimentação errada, confira os lançamentos antes de registrar este pagamento.");
          return;
        }
        const matchedTransactionId = matches[0]?.id ?? null;
        const transactionId = matchedTransactionId ?? makeId("tx");
        await db.withTransactionAsync(async () => {
          if (!matchedTransactionId) {
            await db.runAsync(
              `INSERT INTO transactions
               (id, account_id, category_id, kind, description, amount_cents, transaction_date, notes,
                transfer_group_id, import_item_id, created_at, updated_at, card_id, is_refund, refund_of,
                operation_type, refund_transaction_id)
               VALUES (?, ?, NULL, 'card_payment', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, 0, NULL, 'card_invoice_payment', NULL)`,
              transactionId, accountId, `Pagamento fatura ${activeInvoice.institution}`, cents, paidOn,
              notes.trim() || `Pagamento da fatura ${monthBR(activeInvoice.reference_month)}`, now, now
            );
          }
          await db.runAsync(
            `INSERT INTO invoice_payments (id, invoice_id, amount_cents, paid_on, account_id, transaction_id, transaction_source, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            paymentId, activeInvoice.id, cents, paidOn, accountId, transactionId, matchedTransactionId ? "matched" : "created", notes.trim() || null, now
          );
        });
      }
      await refreshInvoiceStatus(activeInvoice.id);
      setModalVisible(false); setEditing(null); setAmount(""); setNotes("");
      await load();
      Alert.alert(editing ? "Pagamento atualizado" : "Pagamento registrado", editing ? "O registro foi atualizado." : "O pagamento foi vinculado à fatura. Se havia uma movimentação de pagamento idêntica no extrato, ela foi reutilizada em vez de duplicada.");
    } catch (error) {
      Alert.alert("Não foi possível salvar", error instanceof Error ? error.message : "Tente novamente.");
    } finally { setSaving(false); }
  }

  function deletePayment(payment: Payment) {
    Alert.alert("Excluir pagamento?", "O registro de pagamento e a movimentação bancária criada junto com ele serão excluídos.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Excluir", style: "destructive", onPress: () => {
        void (async () => {
          await db.withTransactionAsync(async () => {
            await db.runAsync("DELETE FROM transactions WHERE id = (SELECT transaction_id FROM invoice_payments WHERE id = ? AND transaction_source = 'created')", payment.id);
            await db.runAsync("DELETE FROM invoice_payments WHERE id = ?", payment.id);
          });
          await refreshInvoiceStatus(payment.invoice_id);
          await load();
        })().catch(error => Alert.alert("Erro", error instanceof Error ? error.message : "Não foi possível excluir."));
      } },
    ]);
  }

  function invoiceStatus(invoice: Invoice) {
    if (invoice.total_cents > 0 && invoice.paid_cents >= invoice.total_cents) return { label: "Quitada", color: colors.success };
    if (invoice.paid_cents > 0) return { label: "Parcialmente paga", color: colors.warning };
    if (invoice.due_date && invoice.due_date.slice(0, 10) < todayISO()) return { label: "Vencida", color: colors.danger };
    return { label: invoice.status === "closed" ? "Fechada · não paga" : "Em aberto", color: colors.muted };
  }

  return <Screen>
    <Pressable onPress={() => router.back()}><Text style={styles.back}>‹ Voltar</Text></Pressable>
    <Text style={styles.kicker}>CARTÕES E FATURAS</Text>
    <Text style={styles.title}>Gestão de faturas</Text>
    <Text style={styles.subtitle}>Registre pagamentos totais ou parciais. Cada pagamento sai de uma conta e reduz o saldo pendente da fatura, sem virar uma nova despesa.</Text>

    {invoices.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>Nenhuma fatura importada</Text><Text style={styles.muted}>Quando você importar uma fatura, poderá acompanhar os pagamentos por aqui.</Text></View> : invoices.map(invoice => {
      const paid = invoice.paid_cents;
      const remaining = Math.max(0, invoice.total_cents - paid);
      const progress = invoice.total_cents > 0 ? Math.min(1, paid / invoice.total_cents) : 0;
      const status = invoiceStatus(invoice);
      const invoicePayments = paymentsByInvoice[invoice.id] ?? [];
      return <View key={invoice.id} style={styles.invoiceCard}>
        <View style={styles.invoiceHeader}>
          <View style={{ flex: 1 }}><Text style={styles.invoiceName}>Fatura {invoice.institution}</Text><Text style={styles.muted}>{monthBR(invoice.reference_month)} · Vence {dateBR(invoice.due_date)}</Text></View>
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
        </View>
        <Text style={styles.total}>{formatBRL(invoice.total_cents)}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.amountRow}><Text style={styles.muted}>Pago: {formatBRL(paid)}</Text><Text style={styles.muted}>Restante: {formatBRL(remaining)}</Text></View>
        <View style={styles.amountRow}><Text style={styles.label}>Fechamento: {dateBR(invoice.closing_date)}</Text><Text style={styles.label}>{Math.round(progress * 100)}% pago</Text></View>
        {invoicePayments.length > 0 && <View style={styles.paymentList}>
          <Text style={styles.paymentHeading}>Histórico de pagamentos</Text>
          {invoicePayments.map(payment => <View key={payment.id} style={styles.paymentRow}>
            <View style={{ flex: 1 }}><Text style={styles.paymentAmount}>{formatBRL(payment.amount_cents)}</Text><Text style={styles.muted}>{dateBR(payment.paid_on)} · {payment.account_name ?? "Conta não identificada"}</Text>{payment.notes ? <Text style={styles.note}>{payment.notes}</Text> : null}</View>
            <Pressable onPress={() => openPayment(invoice, payment)} style={styles.smallButton}><Text style={styles.smallButtonText}>Editar</Text></Pressable>
            <Pressable onPress={() => deletePayment(payment)} style={[styles.smallButton, styles.deleteButton]}><Text style={[styles.smallButtonText, { color: colors.danger }]}>Excluir</Text></Pressable>
          </View>)}
        </View>}
        {remaining > 0 && <Pressable onPress={() => openPayment(invoice)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>＋ Registrar pagamento</Text></Pressable>}
        {remaining === 0 && <View style={styles.paidBanner}><Text style={styles.paidBannerText}>✓ Fatura totalmente quitada</Text></View>}
      </View>;
    })}
    <Text style={styles.footer}>Os pagamentos registrados aqui geram uma movimentação do tipo “pagamento de fatura”. Eles reduzem o saldo da conta, mas não entram novamente no total de despesas.</Text>

    <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{editing ? "Editar pagamento" : "Registrar pagamento"}</Text>
        <Text style={styles.muted}>{activeInvoice ? `Fatura ${activeInvoice.institution} · ${monthBR(activeInvoice.reference_month)}` : ""}</Text>
        {editing?.transaction_source === "matched" ? <Text style={styles.matchNote}>Este pagamento foi associado a uma movimentação importada. Valor, data e conta ficam protegidos para preservar o extrato original; você pode editar a observação.</Text> : null}
        <Text style={styles.fieldLabel}>Valor pago (R$)</Text>
        <TextInput value={amount} onChangeText={setAmount} editable={!editing || editing.transaction_source === "created"} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={[styles.input, editing?.transaction_source === "matched" && { opacity: .55 }]}/>
        <Text style={styles.fieldLabel}>Data do pagamento (AAAA-MM-DD)</Text>
        <TextInput value={paidOn} onChangeText={setPaidOn} editable={!editing || editing.transaction_source === "created"} placeholder="2026-11-05" placeholderTextColor={colors.muted} style={[styles.input, editing?.transaction_source === "matched" && { opacity: .55 }]}/>
        <Text style={styles.fieldLabel}>Conta de origem</Text>
        {accounts.length === 0 ? <Text style={styles.noAccounts}>Cadastre uma conta antes de registrar o pagamento.</Text> : <View style={styles.accountChoices}>{accounts.map(account => <Pressable key={account.id} disabled={editing?.transaction_source === "matched"} onPress={() => setAccountId(account.id)} style={[styles.accountChoice, accountId === account.id && styles.accountChoiceSelected, editing?.transaction_source === "matched" && { opacity: .55 }]}><Text style={[styles.accountChoiceText, accountId === account.id && styles.accountChoiceTextSelected]}>{account.name}</Text></Pressable>)}</View>}
        <Text style={styles.fieldLabel}>Observação (opcional)</Text>
        <TextInput value={notes} onChangeText={setNotes} placeholder="Ex.: primeira parte da fatura" placeholderTextColor={colors.muted} style={styles.input}/>
        <View style={styles.modalActions}><Pressable onPress={() => setModalVisible(false)} style={styles.cancelButton}><Text style={styles.cancelText}>Cancelar</Text></Pressable><Pressable onPress={() => void savePayment()} disabled={saving || accounts.length === 0} style={[styles.primaryButton, (saving || accounts.length === 0) && { opacity: .5 }]}><Text style={styles.primaryButtonText}>{saving ? "Salvando..." : editing ? "Salvar alterações" : "Confirmar pagamento"}</Text></Pressable></View>
      </View></View>
    </Modal>
  </Screen>;
}

const styles = StyleSheet.create({
  back:{color:colors.primary,fontSize:14,fontWeight:"700",marginBottom:18}, kicker:{color:colors.primary,fontSize:10,fontWeight:"800",letterSpacing:1.4}, title:{color:colors.text,fontSize:28,fontWeight:"800",marginTop:5}, subtitle:{color:colors.muted,fontSize:12,lineHeight:19,marginTop:7,marginBottom:18},
  invoiceCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:17,padding:16,marginBottom:13}, invoiceHeader:{flexDirection:"row",alignItems:"flex-start",gap:8}, invoiceName:{color:colors.text,fontSize:15,fontWeight:"800"}, muted:{color:colors.muted,fontSize:11,marginTop:4}, status:{fontSize:10,fontWeight:"800",textAlign:"right",maxWidth:120}, total:{color:colors.text,fontSize:27,fontWeight:"900",marginTop:17}, progressTrack:{height:8,backgroundColor:colors.surfaceElevated,borderRadius:99,overflow:"hidden",marginTop:12}, progressFill:{height:8,backgroundColor:colors.success,borderRadius:99}, amountRow:{flexDirection:"row",justifyContent:"space-between",marginTop:8,gap:8}, label:{color:colors.muted,fontSize:10}, paymentList:{borderTopWidth:1,borderTopColor:colors.border,marginTop:15,paddingTop:12}, paymentHeading:{color:colors.text,fontSize:12,fontWeight:"800",marginBottom:7}, paymentRow:{flexDirection:"row",alignItems:"center",gap:6,paddingVertical:9,borderBottomWidth:1,borderBottomColor:colors.border}, paymentAmount:{color:colors.text,fontSize:13,fontWeight:"800"}, note:{color:colors.muted,fontSize:10,marginTop:3}, smallButton:{paddingHorizontal:9,paddingVertical:8,borderRadius:9,backgroundColor:colors.surfaceElevated}, smallButtonText:{color:colors.primary,fontSize:10,fontWeight:"800"}, deleteButton:{backgroundColor:"rgba(251,113,133,0.08)"}, primaryButton:{backgroundColor:colors.primaryStrong,borderRadius:12,paddingVertical:13,paddingHorizontal:14,alignItems:"center",marginTop:15}, primaryButtonText:{color:"#fff",fontSize:12,fontWeight:"800"}, paidBanner:{backgroundColor:"rgba(52,211,153,0.10)",borderRadius:10,padding:12,marginTop:14},paidBannerText:{color:colors.success,fontWeight:"800",fontSize:12,textAlign:"center"},footer:{color:colors.muted,fontSize:10,lineHeight:16,marginTop:7,marginBottom:20},empty:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:15,padding:17,marginTop:8},emptyTitle:{color:colors.text,fontSize:15,fontWeight:"800",marginBottom:5},
  modalBackdrop:{flex:1,backgroundColor:"rgba(0,0,0,0.72)",justifyContent:"center",padding:18},modalCard:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:18,padding:17,maxHeight:"90%"},modalTitle:{color:colors.text,fontSize:19,fontWeight:"900",marginBottom:4},matchNote:{color:colors.warning,fontSize:11,lineHeight:17,marginTop:10,marginBottom:2},fieldLabel:{color:colors.text,fontSize:11,fontWeight:"800",marginTop:14,marginBottom:7},input:{backgroundColor:colors.surfaceElevated,borderColor:colors.border,borderWidth:1,borderRadius:11,paddingHorizontal:12,paddingVertical:11,color:colors.text,fontSize:14},accountChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},accountChoice:{paddingHorizontal:11,paddingVertical:9,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surfaceElevated},accountChoiceSelected:{borderColor:colors.primary,backgroundColor:"rgba(167,139,250,0.14)"},accountChoiceText:{color:colors.muted,fontSize:11,fontWeight:"700"},accountChoiceTextSelected:{color:colors.primary},noAccounts:{color:colors.warning,fontSize:11,lineHeight:16},modalActions:{flexDirection:"row",alignItems:"center",gap:9,marginTop:18},cancelButton:{paddingVertical:13,paddingHorizontal:15,borderRadius:12,backgroundColor:colors.surfaceElevated},cancelText:{color:colors.text,fontSize:12,fontWeight:"800"}
});
