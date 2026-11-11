import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL, parseBRLToCents, todayISO } from "@/utils/money";

type Account = { id: string; name: string };
type Loan = {
  id: string; direction: "lent" | "borrowed"; person_or_institution: string;
  description: string | null; principal_cents: number; agreed_total_cents: number;
  installment_count: number; frequency: string; started_on: string; first_due_date: string | null;
  status: string; notes: string | null; paid_cents: number; created_at: string;
};
type Installment = { id: string; installment_number: number; due_date: string; amount_cents: number; paid_cents: number };
type LoanPayment = { id: string; amount_cents: number; paid_on: string; notes: string | null };

const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const addPeriod = (iso: string, frequency: string, count: number) => {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (frequency === "weekly") date.setDate(date.getDate() + count * 7);
  else if (frequency === "biweekly") date.setDate(date.getDate() + count * 14);
  else {
    const targetMonth = date.getMonth() + count;
    const lastDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
    date.setDate(1); date.setMonth(targetMonth); date.setDate(Math.min(day, lastDay));
  }
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};
const brDate = (iso: string) => iso ? iso.split("-").reverse().join("/") : "";
const toBRInput = (iso: string) => brDate(iso);
const maskBRDate = (value: string, previous = "") => {
  let digits = value.replace(/\D/g, "").slice(0, 8);
  const previousDigits = previous.replace(/\D/g, "");
  if (value.length < previous.length && digits.length === previousDigits.length) digits = digits.slice(0, -1);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};
const parseBRDate = (value: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export default function LoansScreen() {
  const db = useSQLiteContext();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [direction, setDirection] = useState<"lent" | "borrowed">("lent");
  const [person, setPerson] = useState("");
  const [description, setDescription] = useState("");
  const [principal, setPrincipal] = useState("");
  const [agreed, setAgreed] = useState("");
  const [count, setCount] = useState("1");
  const [frequency, setFrequency] = useState("monthly");
  const [startedOn, setStartedOn] = useState(toBRInput(todayISO()));
  const [firstDue, setFirstDue] = useState(toBRInput(todayISO()));
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(toBRInput(todayISO()));
  const [paymentNotes, setPaymentNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.getAllAsync<Loan>(
        `SELECT l.id, l.direction, l.person_or_institution, l.description, l.principal_cents,
                COALESCE(NULLIF(l.agreed_total_cents, 0), l.principal_cents + l.interest_cents) AS agreed_total_cents,
                l.installment_count, l.frequency, l.started_on, l.first_due_date, l.status, l.notes, l.created_at,
                COALESCE((SELECT SUM(p.amount_cents) FROM loan_payments p WHERE p.loan_id = l.id), 0) AS paid_cents
         FROM loans l ORDER BY l.created_at DESC`
      );
      setLoans(rows);
      setAccounts(await db.getAllAsync<Account>("SELECT id, name FROM accounts WHERE is_archived = 0 ORDER BY name"));
    } finally { setLoading(false); }
  }, [db]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const totals = useMemo(() => loans.reduce((acc, loan) => {
    if (loan.direction === "lent") {
      acc.lent += loan.principal_cents;
      acc.toReceive += Math.max(0, loan.agreed_total_cents - loan.paid_cents);
      acc.received += loan.paid_cents;
    } else {
      acc.borrowed += loan.principal_cents;
      acc.toPay += Math.max(0, loan.agreed_total_cents - loan.paid_cents);
      acc.paid += loan.paid_cents;
    }
    return acc;
  }, { lent: 0, toReceive: 0, received: 0, borrowed: 0, toPay: 0, paid: 0 }), [loans]);

  async function openDetails(loan: Loan) {
    setSelected(loan);
    const [parts, history] = await Promise.all([
      db.getAllAsync<Installment>(
        `SELECT i.id, i.installment_number, i.due_date, i.amount_cents,
                COALESCE((SELECT SUM(p.amount_cents) FROM loan_payments p WHERE p.installment_id = i.id), 0) AS paid_cents
         FROM loan_installments i WHERE i.loan_id = ? ORDER BY i.installment_number`, loan.id),
      db.getAllAsync<LoanPayment>(
        "SELECT id, amount_cents, paid_on, notes FROM loan_payments WHERE loan_id = ? ORDER BY paid_on DESC, created_at DESC", loan.id),
    ]);
    setInstallments(parts); setPayments(history);
  }

  function resetCreate() {
    setDirection("lent"); setPerson(""); setDescription(""); setPrincipal(""); setAgreed("");
    setCount("1"); setFrequency("monthly"); setStartedOn(toBRInput(todayISO())); setFirstDue(toBRInput(todayISO()));
    setNotes(""); setAccountId("");
  }

  async function createLoan() {
    const principalCents = parseBRLToCents(principal);
    const agreedCents = parseBRLToCents(agreed);
    const installmentCount = Math.floor(Number(count));
    const startedISO = parseBRDate(startedOn);
    const firstDueISO = parseBRDate(firstDue);
    if (!person.trim() || !principalCents || !agreedCents || installmentCount < 1 || installmentCount > 120 || !startedISO || !firstDueISO) {
      Alert.alert("Confira os dados", "Informe a pessoa, os valores, a quantidade de parcelas (1 a 120) e datas válidas no formato DD/MM/AAAA.");
      return;
    }
    if (agreedCents < principalCents) {
      Alert.alert("Valor combinado inválido", "O total combinado não pode ser menor que o valor emprestado/recebido.");
      return;
    }
    const loanId = makeId("loan");
    const now = new Date().toISOString();
    const base = Math.floor(agreedCents / installmentCount);
    const remainder = agreedCents - base * installmentCount;
    try {
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO loans (id, direction, person_or_institution, description, principal_cents, interest_cents,
            started_on, due_date, status, notes, created_at, updated_at, agreed_total_cents, installment_count,
            frequency, first_due_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
          loanId, direction, person.trim(), description.trim() || null, principalCents,
          agreedCents - principalCents, startedISO, firstDueISO, notes.trim() || null, now, now,
          agreedCents, installmentCount, frequency, firstDueISO
        );
        for (let i = 0; i < installmentCount; i++) {
          await db.runAsync(
            "INSERT INTO loan_installments (id, loan_id, installment_number, due_date, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            makeId("loaninst"), loanId, i + 1, addPeriod(firstDueISO, frequency, i), base + (i < remainder ? 1 : 0), now
          );
        }
        await db.runAsync(
          `INSERT INTO transactions (id, account_id, kind, description, amount_cents, transaction_date, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("tx"), accountId || null, direction === "lent" ? "loan_given" : "loan_received",
          direction === "lent" ? `Empréstimo para ${person.trim()}` : `Empréstimo recebido de ${person.trim()}`,
          principalCents, startedISO, notes.trim() || null, now, now
        );
      });
      setShowCreate(false); resetCreate(); await load();
      Alert.alert("Empréstimo cadastrado", "O cronograma de parcelas foi criado.");
    } catch (error) {
      Alert.alert("Não foi possível cadastrar", error instanceof Error ? error.message : "Tente novamente.");
    }
  }

  async function openPaymentModal(loan: Loan) {
    setSelected(loan);
    setPaymentAmount(""); setPaymentDate(toBRInput(todayISO())); setPaymentNotes(""); setAccountId("");
    setShowPayment(true);
    try {
      const parts = await db.getAllAsync<Installment>(
        `SELECT i.id, i.installment_number, i.due_date, i.amount_cents,
                COALESCE((SELECT SUM(p.amount_cents) FROM loan_payments p WHERE p.installment_id = i.id), 0) AS paid_cents
         FROM loan_installments i WHERE i.loan_id = ? ORDER BY i.installment_number`, loan.id);
      setInstallments(parts);
      if (parts.length === 0) Alert.alert("Parcelas não encontradas", "Este empréstimo não possui parcelas cadastradas.");
    } catch (error) {
      setShowPayment(false);
      Alert.alert("Não foi possível abrir o pagamento", error instanceof Error ? error.message : "Erro ao carregar as parcelas.");
    }
  }

  async function registerPayment() {
    if (!selected) return;
    const amount = parseBRLToCents(paymentAmount);
    const paymentISO = parseBRDate(paymentDate);
    const remainingTotal = Math.max(0, selected.agreed_total_cents - selected.paid_cents);
    const next = installments.find((item) => item.paid_cents < item.amount_cents);
    if (!paymentISO) {
      Alert.alert("Data inválida", "Informe a data no formato DD/MM/AAAA.");
      return;
    }
    if (!amount || amount > remainingTotal) {
      Alert.alert("Valor inválido", `Informe um valor positivo de até ${formatBRL(remainingTotal)}.`);
      return;
    }
    if (!next) { Alert.alert("Empréstimo quitado", "Não há parcelas pendentes."); return; }
    const installmentRemaining = next.amount_cents - next.paid_cents;
    if (amount > installmentRemaining) {
      Alert.alert("Divida o pagamento", `A próxima parcela tem ${formatBRL(installmentRemaining)} em aberto. Registre esse valor e depois continue na próxima parcela.`);
      return;
    }
    const now = new Date().toISOString();
    const paymentId = makeId("loanpay");
    const transactionId = makeId("tx");
    try {
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          "INSERT INTO transactions (id, account_id, kind, description, amount_cents, transaction_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          transactionId, accountId || null, selected.direction === "lent" ? "loan_collection" : "loan_repayment",
          selected.direction === "lent" ? `Recebimento de ${selected.person_or_institution}` : `Pagamento de empréstimo - ${selected.person_or_institution}`,
          amount, paymentISO, paymentNotes.trim() || null, now, now
        );
        await db.runAsync(
          "INSERT INTO loan_payments (id, loan_id, amount_cents, paid_on, notes, transaction_id, created_at, installment_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          paymentId, selected.id, amount, paymentISO, paymentNotes.trim() || null, transactionId, now, next.id, accountId || null
        );
        const paid = selected.paid_cents + amount;
        if (paid >= selected.agreed_total_cents) {
          await db.runAsync("UPDATE loans SET status = 'closed', updated_at = ? WHERE id = ?", now, selected.id);
        }
      });
      setShowPayment(false); await load();
      const refreshed = await db.getFirstAsync<Loan>(
        `SELECT l.id, l.direction, l.person_or_institution, l.description, l.principal_cents,
                l.agreed_total_cents, l.installment_count, l.frequency, l.started_on, l.first_due_date,
                l.status, l.notes, l.created_at, COALESCE((SELECT SUM(p.amount_cents) FROM loan_payments p WHERE p.loan_id=l.id),0) AS paid_cents
         FROM loans l WHERE l.id = ?`, selected.id);
      if (refreshed) await openDetails(refreshed);
      Alert.alert("Pagamento registrado", "O pagamento foi vinculado à parcela e ao histórico do empréstimo.");
    } catch (error) {
      Alert.alert("Erro ao registrar pagamento", error instanceof Error ? error.message : "Tente novamente.");
    }
  }

  async function deleteLoan(loan: Loan) {
    Alert.alert(
      "Excluir empréstimo?",
      `O cadastro de ${loan.person_or_institution} e suas parcelas serão excluídos. Os lançamentos financeiros criados por este empréstimo também serão removidos. Esta ação não pode ser desfeita.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir", style: "destructive", onPress: () => {
          void (async () => {
            try {
              await db.withTransactionAsync(async () => {
                const linked = await db.getAllAsync<{ transaction_id: string | null }>(
                  "SELECT transaction_id FROM loan_payments WHERE loan_id = ? AND transaction_id IS NOT NULL", loan.id
                );
                for (const row of linked) {
                  if (row.transaction_id) await db.runAsync("DELETE FROM transactions WHERE id = ?", row.transaction_id);
                }
                const origin = await db.getFirstAsync<{ id: string }>(
                  "SELECT id FROM transactions WHERE created_at = ? AND transaction_date = ? AND amount_cents = ? AND kind = ? LIMIT 1",
                  loan.created_at, loan.started_on, loan.principal_cents, loan.direction === "lent" ? "loan_given" : "loan_received"
                );
                if (origin) await db.runAsync("DELETE FROM transactions WHERE id = ?", origin.id);
                await db.runAsync("DELETE FROM loans WHERE id = ?", loan.id);
              });
              setSelected(null);
              setShowPayment(false);
              await load();
              Alert.alert("Empréstimo excluído", "O cadastro e os lançamentos vinculados foram removidos.");
            } catch (error) {
              Alert.alert("Não foi possível excluir", error instanceof Error ? error.message : "Tente novamente.");
            }
          })();
        }}
      ]
    );
  }

  const input = (label: string, value: string, set: (v: string) => void, placeholder: string, keyboard: "default" | "numeric" = "default") => (
    <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={set} placeholder={placeholder}
      placeholderTextColor={colors.muted} keyboardType={keyboard} style={styles.input}/></View>
  );
  const dateInput = (label: string, value: string, set: (v: string) => void) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={(text) => set(maskBRDate(text, value))}
        placeholder="DD/MM/AAAA" placeholderTextColor={colors.muted}
        keyboardType="number-pad" maxLength={10} style={styles.input}/>
    </View>
  );

  return <Screen>
    <Text style={styles.kicker}>CONTROLE DE CRÉDITOS E DÍVIDAS</Text>
    <Text style={styles.title}>Empréstimos</Text>
    <Text style={styles.subtitle}>Acompanhe o que emprestou, o que pegou emprestado e os pagamentos combinados.</Text>
    <View style={styles.summaryGrid}>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Emprestei</Text><Text style={styles.summaryValue}>{formatBRL(totals.lent)}</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Tenho a receber</Text><Text style={[styles.summaryValue,{color:colors.success}]}>{formatBRL(totals.toReceive)}</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Já recebi</Text><Text style={styles.summaryValue}>{formatBRL(totals.received)}</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Tenho a pagar</Text><Text style={[styles.summaryValue,{color:colors.danger}]}>{formatBRL(totals.toPay)}</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Peguei emprestado</Text><Text style={styles.summaryValue}>{formatBRL(totals.borrowed)}</Text></View>
      <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Já paguei</Text><Text style={styles.summaryValue}>{formatBRL(totals.paid)}</Text></View>
    </View>
    <Pressable style={styles.primaryButton} onPress={() => { resetCreate(); setShowCreate(true); }}><Text style={styles.primaryButtonText}>＋  Novo empréstimo</Text></Pressable>
    <Text style={styles.sectionTitle}>Seus empréstimos</Text>
    {loading ? <Text style={styles.empty}>Carregando...</Text> : loans.length === 0 ?
      <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Nenhum empréstimo cadastrado</Text><Text style={styles.emptyText}>Cadastre o primeiro para acompanhar parcelas, recebimentos e valores pendentes.</Text></View> :
      loans.map((loan) => {
        const remaining = Math.max(0, loan.agreed_total_cents - loan.paid_cents);
        const percent = loan.agreed_total_cents > 0 ? Math.min(100, loan.paid_cents / loan.agreed_total_cents * 100) : 0;
        return <Pressable key={loan.id} style={styles.loanCard} onPress={() => void openDetails(loan)}>
          <View style={styles.cardTop}><View style={{flex:1}}><Text style={styles.person}>{loan.person_or_institution}</Text><Text style={styles.meta}>{loan.direction === "lent" ? "Você emprestou" : "Você pegou emprestado"} · {loan.installment_count} parcela(s)</Text></View><Text style={[styles.status,loan.status === "closed" ? styles.statusDone : styles.statusOpen]}>{loan.status === "closed" ? "QUITADO" : "ATIVO"}</Text></View>
          <View style={styles.amountRow}><View><Text style={styles.smallLabel}>Combinado</Text><Text style={styles.amount}>{formatBRL(loan.agreed_total_cents)}</Text></View><View style={{alignItems:"flex-end"}}><Text style={styles.smallLabel}>{loan.direction === "lent" ? "Falta receber" : "Falta pagar"}</Text><Text style={styles.amount}>{formatBRL(remaining)}</Text></View></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill,{width:`${percent}%`}]} /></View>
          <Text style={styles.meta}>Original: {formatBRL(loan.principal_cents)} · {percent.toFixed(0)}% concluído</Text>
          <Pressable style={styles.secondaryButton} onPress={(event) => { event.stopPropagation(); void openPaymentModal(loan); }}><Text style={styles.secondaryButtonText}>{loan.direction === "lent" ? "＋ Registrar recebimento" : "＋ Registrar pagamento"}</Text></Pressable>
        </Pressable>;
      })
    }

    <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
      <Screen>
        <Text style={styles.modalBack} onPress={() => setShowCreate(false)}>‹  Cancelar</Text>
        <Text style={styles.title}>Novo empréstimo</Text>
        <View style={styles.switchRow}>
          <Pressable style={[styles.switchButton,direction==="lent"&&styles.switchActive]} onPress={() => setDirection("lent")}><Text style={[styles.switchText,direction==="lent"&&styles.switchTextActive]}>Emprestei</Text></Pressable>
          <Pressable style={[styles.switchButton,direction==="borrowed"&&styles.switchActive]} onPress={() => setDirection("borrowed")}><Text style={[styles.switchText,direction==="borrowed"&&styles.switchTextActive]}>Peguei</Text></Pressable>
        </View>
        {input("Pessoa ou instituição",person,setPerson,"Ex.: João Silva")}
        {input("Descrição (opcional)",description,setDescription,"Ex.: Empréstimo pessoal")}
        {input(direction==="lent"?"Quanto você emprestou":"Quanto recebeu",principal,setPrincipal,"Ex.: 1.000,00","numeric")}
        {input("Valor total combinado para devolução",agreed,setAgreed,"Ex.: 1.300,00","numeric")}
        <Text style={styles.helper}>Não precisa informar juros. A diferença entre o valor inicial e o combinado será calculada automaticamente.</Text>
        {input("Quantidade de parcelas",count,setCount,"Ex.: 5","numeric")}
        <Text style={styles.label}>Frequência das parcelas</Text>
        <View style={styles.switchRow}>
          {(["weekly","biweekly","monthly"] as const).map((f) => <Pressable key={f} style={[styles.frequencyButton,frequency===f&&styles.switchActive]} onPress={() => setFrequency(f)}><Text style={[styles.switchText,frequency===f&&styles.switchTextActive]}>{f==="weekly"?"Semanal":f==="biweekly"?"Quinzenal":"Mensal"}</Text></Pressable>)}
        </View>
        {dateInput("Data em que o dinheiro foi entregue/recebido",startedOn,setStartedOn)}
        {dateInput("Data da primeira parcela",firstDue,setFirstDue)}
        {input("Observações",notes,setNotes,"Anotações opcionais")}
        <Text style={styles.label}>Conta relacionada (opcional)</Text>
        <View style={styles.accountList}>
          {accounts.map((account) => <Pressable key={account.id} style={[styles.accountChip,accountId===account.id&&styles.accountSelected]} onPress={() => setAccountId(accountId===account.id?"":account.id)}><Text style={styles.accountText}>{account.name}</Text></Pressable>)}
        </View>
        <Pressable style={styles.primaryButton} onPress={() => void createLoan()}><Text style={styles.primaryButtonText}>Salvar empréstimo</Text></Pressable>
      </Screen>
    </Modal>

    <Modal visible={!!selected && !showCreate && !showPayment} animationType="slide" onRequestClose={() => setSelected(null)}>
      <Screen>
        <Text style={styles.modalBack} onPress={() => setSelected(null)}>‹  Voltar</Text>
        {selected ? <>
          <Text style={styles.title}>{selected.person_or_institution}</Text>
          <Text style={styles.subtitle}>{selected.direction==="lent"?"Você emprestou":"Você pegou emprestado"} · {selected.description || "Empréstimo"}</Text>
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Valor combinado</Text><Text style={styles.amount}>{formatBRL(selected.agreed_total_cents)}</Text><Text style={styles.meta}>Valor inicial {formatBRL(selected.principal_cents)} · Diferença {formatBRL(selected.agreed_total_cents-selected.principal_cents)}</Text><Text style={styles.meta}>Recebido/pago {formatBRL(selected.paid_cents)} · Restante {formatBRL(Math.max(0,selected.agreed_total_cents-selected.paid_cents))}</Text></View>
          <Text style={styles.sectionTitle}>Parcelas</Text>
          {installments.map((part) => <View key={part.id} style={styles.installmentRow}><View style={{flex:1}}><Text style={styles.person}>Parcela {part.installment_number}</Text><Text style={styles.meta}>Vencimento {brDate(part.due_date)}</Text></View><View style={{alignItems:"flex-end"}}><Text style={styles.amount}>{formatBRL(part.amount_cents)}</Text><Text style={styles.meta}>Restante {formatBRL(Math.max(0,part.amount_cents-part.paid_cents))}</Text></View></View>)}
          <Text style={styles.sectionTitle}>Histórico de pagamentos</Text>
          {payments.length===0?<Text style={styles.empty}>Nenhum pagamento registrado.</Text>:payments.map((p)=><View key={p.id} style={styles.installmentRow}><View style={{flex:1}}><Text style={styles.person}>{brDate(p.paid_on)}</Text><Text style={styles.meta}>{p.notes || "Pagamento registrado"}</Text></View><Text style={styles.amount}>{formatBRL(p.amount_cents)}</Text></View>)}
          {selected.status!=="closed"?<Pressable style={styles.primaryButton} onPress={() => void openPaymentModal(selected)}><Text style={styles.primaryButtonText}>{selected.direction==="lent"?"Registrar recebimento":"Registrar pagamento"}</Text></Pressable>:null}
          <Pressable style={styles.dangerButton} onPress={() => deleteLoan(selected)}><Text style={styles.dangerButtonText}>Excluir empréstimo</Text></Pressable>
        </>:null}
      </Screen>
    </Modal>

    <Modal visible={showPayment} animationType="slide" onRequestClose={() => setShowPayment(false)}>
      <Screen>
        <Text style={styles.modalBack} onPress={() => setShowPayment(false)}>‹  Cancelar</Text>
        <Text style={styles.title}>{selected?.direction==="lent"?"Registrar recebimento":"Registrar pagamento"}</Text>
        <Text style={styles.subtitle}>{selected?.person_or_institution}</Text>
        {input("Valor pago/recebido",paymentAmount,setPaymentAmount,"Ex.: 260,00","numeric")}
        {dateInput("Data do pagamento",paymentDate,setPaymentDate)}
        {input("Observação",paymentNotes,setPaymentNotes,"Opcional")}
        <Text style={styles.label}>Conta relacionada (opcional)</Text>
        <View style={styles.accountList}>{accounts.map((account)=><Pressable key={account.id} style={[styles.accountChip,accountId===account.id&&styles.accountSelected]} onPress={()=>setAccountId(accountId===account.id?"":account.id)}><Text style={styles.accountText}>{account.name}</Text></Pressable>)}</View>
        <Text style={styles.helper}>O pagamento será vinculado à próxima parcela em aberto. Para pagar mais de uma parcela, registre os valores separadamente.</Text>
        <Pressable style={styles.primaryButton} onPress={() => void registerPayment()}><Text style={styles.primaryButtonText}>Confirmar pagamento</Text></Pressable>
      </Screen>
    </Modal>
  </Screen>;
}

const styles = StyleSheet.create({
  kicker:{color:colors.primary,fontSize:10,fontWeight:"800",letterSpacing:1.5},
  title:{color:colors.text,fontSize:29,fontWeight:"900",marginTop:6},
  subtitle:{color:colors.muted,fontSize:13,lineHeight:20,marginTop:8,marginBottom:14},
  summaryGrid:{flexDirection:"row",flexWrap:"wrap",gap:10,marginTop:18},
  summaryCard:{width:"48%",flexGrow:1,backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:16,padding:14},
  summaryLabel:{color:colors.muted,fontSize:11,fontWeight:"700"},
  summaryValue:{color:colors.text,fontSize:17,fontWeight:"900",marginTop:7},
  primaryButton:{backgroundColor:colors.primary,borderRadius:14,padding:16,alignItems:"center",marginTop:16,marginBottom:14},
  primaryButtonText:{color:"#FFFFFF",fontSize:14,fontWeight:"900"},
  sectionTitle:{color:colors.text,fontSize:17,fontWeight:"900",marginTop:22,marginBottom:10},
  empty:{color:colors.muted,fontSize:13,marginTop:14},
  emptyCard:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:16,padding:18,marginTop:10},
  emptyTitle:{color:colors.text,fontSize:15,fontWeight:"800"},
  emptyText:{color:colors.muted,fontSize:12,lineHeight:19,marginTop:7},
  loanCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:18,padding:16,marginBottom:12},
  cardTop:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  person:{color:colors.text,fontSize:15,fontWeight:"800"},
  meta:{color:colors.muted,fontSize:11,marginTop:5},
  status:{fontSize:9,fontWeight:"900",paddingHorizontal:9,paddingVertical:6,borderRadius:20,overflow:"hidden"},
  statusDone:{color:colors.success,backgroundColor:"#123329"},
  statusOpen:{color:colors.primary,backgroundColor:colors.surfaceElevated},
  amountRow:{flexDirection:"row",justifyContent:"space-between",marginTop:17},
  smallLabel:{color:colors.muted,fontSize:10,fontWeight:"700"},
  amount:{color:colors.text,fontSize:17,fontWeight:"900",marginTop:4},
  progressTrack:{height:7,borderRadius:8,backgroundColor:colors.surfaceElevated,overflow:"hidden",marginTop:14},
  progressFill:{height:7,backgroundColor:colors.success,borderRadius:8},
  secondaryButton:{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,alignItems:"center",marginTop:14},
  secondaryButtonText:{color:colors.primary,fontSize:12,fontWeight:"800"},
  modalBack:{color:colors.primary,fontSize:14,fontWeight:"800",paddingVertical:10,marginTop:28},
  dangerButton:{borderWidth:1,borderColor:colors.danger,borderRadius:14,padding:15,alignItems:"center",marginTop:8,marginBottom:24},
  dangerButtonText:{color:colors.danger,fontSize:13,fontWeight:"900"},
  switchRow:{flexDirection:"row",gap:8,marginTop:14,marginBottom:12},
  switchButton:{flex:1,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:13,alignItems:"center"},
  switchActive:{backgroundColor:colors.surfaceElevated,borderColor:colors.primary},
  switchText:{color:colors.muted,fontSize:12,fontWeight:"800"},
  switchTextActive:{color:colors.primary},
  frequencyButton:{flex:1,borderWidth:1,borderColor:colors.border,borderRadius:10,padding:10,alignItems:"center"},
  field:{marginTop:10},
  label:{color:colors.muted,fontSize:11,fontWeight:"800",marginBottom:6},
  input:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:12,paddingHorizontal:13,paddingVertical:12,color:colors.text,fontSize:14},
  helper:{color:colors.muted,fontSize:11,lineHeight:17,marginTop:7},
  accountList:{flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:6},
  accountChip:{borderWidth:1,borderColor:colors.border,borderRadius:20,paddingHorizontal:12,paddingVertical:9},
  accountSelected:{borderColor:colors.primary,backgroundColor:colors.surfaceElevated},
  accountText:{color:colors.text,fontSize:11,fontWeight:"700"},
  installmentRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border},
});
