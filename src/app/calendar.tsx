import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL } from "@/utils/money";

type EventItem = {
  id: string; date: string; title: string; amount_cents: number;
  kind: "recurring" | "invoice" | "installment" | "loan";
  detail: string; status: string;
};
type RecurringRow = { id: string; description: string; amount_cents: number; due_day: number; start_month: string; end_month: string | null; is_active: number };
type InvoiceRow = { id: string; due_date: string | null; total_cents: number; remaining_cents: number; status: string; institution: string; reference_month: string };
type InstallmentRow = { id: string; description: string; installment_amount_cents: number; total_installments: number; first_due_date: string };

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dateKey = (d: Date) => `${monthKey(d)}-${pad(d.getDate())}`;
const parseDate = (value: string) => {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [period, setPeriod] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedDay, setSelectedDay] = useState(dateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const month = useMemo(() => monthKey(period), [period]);
  const monthLabel = useMemo(() => period.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result: EventItem[] = [];
      const nextMonthStart = new Date(period.getFullYear(), period.getMonth() + 1, 1);
      const nextMonthKey = dateKey(nextMonthStart);
      const recurring = await db.getAllAsync<RecurringRow>(
        `SELECT id, description, amount_cents, due_day, start_month, end_month, is_active
         FROM recurring_expenses WHERE is_active = 1 AND start_month <= ?
           AND (end_month IS NULL OR end_month >= ?)`,
        month, month
      );
      for (const item of recurring) {
        const day = Math.min(item.due_day, new Date(period.getFullYear(), period.getMonth() + 1, 0).getDate());
        result.push({ id: `rec_${item.id}_${month}`, date: `${month}-${pad(day)}`, title: item.description,
          amount_cents: item.amount_cents, kind: "recurring", detail: "Despesa recorrente", status: "Previsto" });
      }

      const invoices = await db.getAllAsync<InvoiceRow>(
        `SELECT i.id, i.due_date, i.total_cents,
                MAX(0, i.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)) AS remaining_cents,
                i.status, i.reference_month,
                COALESCE(i.institution, c.institution, c.name, 'Cartão') AS institution
         FROM invoices i LEFT JOIN cards c ON c.id = i.card_id
         WHERE i.due_date >= ? AND i.due_date < ?`,
        `${month}-01`, nextMonthKey
      );
      for (const invoice of invoices) {
        if (!invoice.due_date) continue;
        result.push({ id: `inv_${invoice.id}`, date: invoice.due_date.slice(0,10),
          title: `Fatura ${invoice.institution}`, amount_cents: invoice.remaining_cents,
          kind: "invoice", detail: `Referência ${invoice.reference_month}`,
          status: invoice.status === "paid" ? "Paga" : invoice.status === "partial" ? "Parcialmente paga" : invoice.status === "closed" ? "Fechada" : "Em aberto" });
      }

      const installments = await db.getAllAsync<InstallmentRow>(
        "SELECT id, description, installment_amount_cents, total_installments, first_due_date FROM installments"
      );
      const first = new Date(period.getFullYear(), period.getMonth(), 1);
      const last = new Date(period.getFullYear(), period.getMonth() + 1, 0);
      for (const item of installments) {
        const firstDue = parseDate(item.first_due_date);
        for (let index = 0; index < item.total_installments; index++) {
          const dueMonth = new Date(firstDue.getFullYear(), firstDue.getMonth() + index, 1);
          const dueLastDay = new Date(dueMonth.getFullYear(), dueMonth.getMonth() + 1, 0).getDate();
          const due = new Date(dueMonth.getFullYear(), dueMonth.getMonth(), Math.min(firstDue.getDate(), dueLastDay));
          if (due >= first && due <= last) {
            result.push({ id: `ins_${item.id}_${index+1}`, date: dateKey(due),
              title: item.description, amount_cents: item.installment_amount_cents,
              kind: "installment", detail: `Parcela ${index+1}/${item.total_installments}`, status: "Prevista" });
          }
        }
      }

      const loans = await db.getAllAsync<{
        id: string; loan_id: string; person_or_institution: string; description: string | null;
        due_date: string; amount_cents: number; paid_cents: number; direction: string; installment_number: number;
      }>(
        `SELECT i.id, i.loan_id, l.person_or_institution, l.description, i.due_date, i.amount_cents,
                i.installment_number, l.direction,
                COALESCE((SELECT SUM(p.amount_cents) FROM loan_payments p WHERE p.installment_id = i.id), 0) AS paid_cents
         FROM loan_installments i JOIN loans l ON l.id = i.loan_id
         WHERE i.due_date >= ? AND i.due_date < ? AND l.status = 'active'`,
        `${month}-01`, nextMonthKey
      );
      for (const loan of loans) {
        const remaining = Math.max(0, loan.amount_cents - loan.paid_cents);
        if (remaining <= 0) continue;
        result.push({ id: `loan_${loan.id}`, date: loan.due_date.slice(0,10),
          title: loan.description || (loan.direction === "borrowed" ? `Empréstimo de ${loan.person_or_institution}` : `Empréstimo para ${loan.person_or_institution}`),
          amount_cents: remaining, kind: "loan",
          detail: `${loan.direction === "borrowed" ? "A pagar" : "A receber"} · Parcela ${loan.installment_number}`,
          status: "Em aberto" });
      }
      result.sort((a,b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
      setEvents(result);
      if (!result.some((e) => e.date === selectedDay) && selectedDay.slice(0,7) !== month) {
        setSelectedDay(`${month}-01`);
      }
    } finally { setLoading(false); }
  }, [db, month, period, selectedDay]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const days = useMemo(() => {
    const firstDay = new Date(period.getFullYear(), period.getMonth(), 1).getDay();
    const count = new Date(period.getFullYear(), period.getMonth()+1, 0).getDate();
    return [...Array(firstDay).fill(null), ...Array.from({length: count}, (_,i) => i+1)];
  }, [period]);
  const selectedEvents = events.filter((event) => event.date === selectedDay);
  const totalSelected = selectedEvents.reduce((sum,event) => sum + event.amount_cents, 0);
  const monthTotal = events.reduce((sum,event) => sum + event.amount_cents, 0);
  const todayKey = dateKey(new Date());

  function changeMonth(offset: number) {
    const next = new Date(period.getFullYear(), period.getMonth()+offset, 1);
    setPeriod(next);
    setSelectedDay(`${monthKey(next)}-01`);
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹  Voltar aos relatórios</Text></Pressable>
      <Text style={styles.kicker}>ORGANIZAÇÃO FINANCEIRA</Text>
      <Text style={styles.title}>Calendário</Text>
      <Text style={styles.subtitle}>Vencimentos e compromissos previstos, sem criar movimentações automaticamente.</Text>
      <View style={styles.monthNav}>
        <Pressable style={styles.navButton} onPress={() => changeMonth(-1)}><Text style={styles.navText}>‹</Text></Pressable>
        <Text style={styles.monthTitle}>{monthLabel}</Text>
        <Pressable style={styles.navButton} onPress={() => changeMonth(1)}><Text style={styles.navText}>›</Text></Pressable>
      </View>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Soma dos compromissos exibidos</Text>
        <Text style={styles.summaryValue}>{formatBRL(monthTotal)}</Text>
        <Text style={styles.summaryHint}>{events.length} evento(s) · faturas podem incluir compras parceladas; não trate a soma como saldo projetado</Text>
      </View>
      <View style={styles.calendar}>
        {["D","S","T","Q","Q","S","S"].map((day,index) => <Text key={`${day}_${index}`} style={styles.weekday}>{day}</Text>)}
        {days.map((day,index) => {
          if (day === null) return <View key={`empty_${index}`} style={styles.dayCell}/>;
          const key = `${month}-${pad(day)}`;
          const hasEvents = events.some((event) => event.date === key);
          const selected = selectedDay === key;
          return <Pressable key={key} onPress={() => setSelectedDay(key)}
            style={[styles.dayCell, selected ? styles.daySelected : null, key === todayKey ? styles.todayCell : null]}>
            <Text style={[styles.dayNumber, selected ? styles.daySelectedText : null]}>{day}</Text>
            {hasEvents ? <View style={[styles.eventDot, selected ? styles.eventDotSelected : null]}/> : null}
          </Pressable>;
        })}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendDot}/>
        <Text style={styles.legendText}>Dia com compromisso</Text>
      </View>
      <View style={styles.eventsHeader}>
        <Text style={styles.sectionTitle}>{parseDate(selectedDay).toLocaleDateString("pt-BR", {day:"2-digit",month:"long"})}</Text>
        <Text style={styles.eventsTotal}>{formatBRL(totalSelected)}</Text>
      </View>
      {loading ? <Text style={styles.empty}>Carregando compromissos...</Text> :
        selectedEvents.length === 0 ? <Text style={styles.empty}>Nenhum compromisso previsto para este dia.</Text> :
        selectedEvents.map((event) => (
          <View key={event.id} style={styles.eventCard}>
            <View style={styles.eventTop}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventAmount}>{formatBRL(event.amount_cents)}</Text>
            </View>
            <Text style={styles.eventDetail}>{event.detail} · {event.status}</Text>
            <Text style={styles.eventType}>{event.kind === "invoice" ? "FATURA" : event.kind === "installment" ? "PARCELA" : event.kind === "loan" ? "EMPRÉSTIMO" : "RECORRENTE"}</Text>
          </View>
        ))
      }
      <Text style={styles.footerNote}>O calendário reúne modelos recorrentes, faturas, parcelas e empréstimos com vencimento cadastrado. Uma parcela pode já estar incluída no total da fatura; por isso, a soma dos eventos é informativa e pode conter sobreposição. O calendário não confirma pagamentos nem altera seu saldo bancário.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: "flex-start", paddingVertical: 8, paddingRight: 14 },
  backText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  kicker: { color: colors.primary, fontSize: 10, letterSpacing: 2.2, fontWeight: "900", marginTop: 12 },
  title: { color: colors.text, fontSize: 34, fontWeight: "900", marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 12 },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 16 },
  navButton: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  navText: { color: colors.primary, fontSize: 28, lineHeight: 30 },
  monthTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textTransform: "capitalize" },
  summary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 20, marginBottom: 18 },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  summaryValue: { color: colors.primary, fontSize: 30, fontWeight: "900", marginTop: 8 },
  summaryHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 6 },
  calendar: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 12, flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.2857%", textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "800", paddingVertical: 10 },
  dayCell: { width: "14.2857%", height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, marginVertical: 2 },
  dayNumber: { color: colors.text, fontSize: 13, fontWeight: "700" },
  daySelected: { backgroundColor: colors.primary },
  daySelectedText: { color: "#FFFFFF" },
  todayCell: { borderWidth: 1, borderColor: colors.primary },
  eventDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary, marginTop: 3 },
  eventDotSelected: { backgroundColor: "#FFFFFF" },
  legend: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 },
  legendDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  legendText: { color: colors.muted, fontSize: 10 },
  eventsHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textTransform: "capitalize" },
  eventsTotal: { color: colors.primary, fontSize: 15, fontWeight: "900" },
  eventCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 15, marginBottom: 9 },
  eventTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eventTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800" },
  eventAmount: { color: colors.text, fontSize: 13, fontWeight: "900" },
  eventDetail: { color: colors.muted, fontSize: 11, marginTop: 6 },
  eventType: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginTop: 9 },
  empty: { color: colors.muted, fontSize: 12, paddingVertical: 18 },
  footerNote: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 16, marginBottom: 16 },
});
