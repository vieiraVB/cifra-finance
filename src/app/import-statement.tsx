import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useSQLiteContext } from "expo-sqlite";
import { Screen } from "@/components/Screen";
import { colors } from "@/theme/colors";
import { formatBRL } from "@/utils/money";
import { extractPdfText } from "@/features/import/pdfText";
import { parseStatement, parseNubankAccount, parseBradescoStatement, parseNubankInvoicePdf, parseNubankCreditOfx } from "@/features/import/statementParser";
import { validateStatement } from "@/features/import/validators/transactionValidator";
import { parseCsvStatement } from "@/features/import/extractors/csvExtractor";
import { parseGenericOfx } from "@/features/import/statementParser";
import type { BankId, ParsedStatementItem } from "@/features/import/statementParser";

const categoryOptions = [
  { id: "cat_income_salary", name: "Salário", kind: "income" },
  { id: "cat_income_other", name: "Outras receitas", kind: "income" },
  { id: "cat_exp_food", name: "Alimentação", kind: "expense" },
  { id: "cat_exp_transport", name: "Transporte", kind: "expense" },
  { id: "cat_exp_home", name: "Moradia", kind: "expense" },
  { id: "cat_exp_health", name: "Saúde", kind: "expense" },
  { id: "cat_exp_education", name: "Educação", kind: "expense" },
  { id: "cat_exp_leisure", name: "Lazer", kind: "expense" },
  { id: "cat_exp_shopping", name: "Compras", kind: "expense" },
  { id: "cat_exp_subscriptions", name: "Assinaturas", kind: "expense" },
  { id: "cat_exp_other", name: "Outros gastos", kind: "expense" },
] as const;

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function dateDistanceDays(a: string, b: string): number {
  const left = new Date(`${a}T12:00:00`).getTime();
  const right = new Date(`${b}T12:00:00`).getTime();
  return Math.abs(Math.round((left - right) / 86400000));
}
function descriptionTokens(value: string): Set<string> {
  return new Set(normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}
function similarity(a: string, b: string): number {
  const left = descriptionTokens(a), right = descriptionTokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return common / Math.max(left.size, right.size);
}

/** Link only unambiguous financial counterparts; never invent a relationship. */
async function reconcileTransaction(db: ReturnType<typeof useSQLiteContext>, transactionId: string) {
  const current = await db.getFirstAsync<{
    id: string; account_id: string | null; kind: string; amount_cents: number;
    transaction_date: string; description: string; is_refund: number;
    refund_of: string | null; transfer_group_id: string | null; refund_transaction_id: string | null;
  }>("SELECT id, account_id, kind, amount_cents, transaction_date, description, is_refund, refund_of, transfer_group_id, refund_transaction_id FROM transactions WHERE id = ?", transactionId);
  if (!current) return;

  if (current.kind === "transfer_in" || current.kind === "transfer_out") {
    const opposite = current.kind === "transfer_in" ? "transfer_out" : "transfer_in";
    const candidates = await db.getAllAsync<{ id: string; account_id: string | null; transaction_date: string; description: string }>(
      `SELECT id, account_id, transaction_date, description FROM transactions
       WHERE id <> ? AND account_id <> ? AND kind = ? AND amount_cents = ? AND transfer_group_id IS NULL
         AND transaction_date BETWEEN date(?, '-3 day') AND date(?, '+3 day')`,
      current.id, current.account_id, opposite, current.amount_cents, current.transaction_date, current.transaction_date
    );
    const ranked = candidates.map((candidate) => ({ ...candidate, score: dateDistanceDays(current.transaction_date, candidate.transaction_date) }))
      .sort((a, b) => a.score - b.score);
    if (ranked.length && (ranked.length === 1 || ranked[0].score < ranked[1].score)) {
      const groupId = `transfer_${current.id}_${ranked[0].id}`;
      await db.runAsync("UPDATE transactions SET transfer_group_id = ? WHERE id IN (?, ?)", groupId, current.id, ranked[0].id);
    }
    return;
  }

  if (current.is_refund !== 1 || !current.refund_of || current.refund_transaction_id) return;
  const candidates = await db.getAllAsync<{ id: string; description: string; transaction_date: string; kind: string }>(
    `SELECT id, description, transaction_date, kind FROM transactions
     WHERE account_id = ? AND id <> ? AND amount_cents = ? AND is_refund = 0
       AND transaction_date <= ? AND transaction_date >= date(?, '-365 day')
       AND ((? = 'income' AND kind = 'income')
         OR (? = 'expense' AND kind IN ('expense', 'card_purchase')))`,
    current.account_id, current.id, current.amount_cents, current.transaction_date, current.transaction_date,
    current.refund_of, current.refund_of
  );
  const ranked = candidates.map((candidate) => ({ ...candidate, score: similarity(current.description, candidate.description) }))
    .filter((candidate) => candidate.score >= 0.25).sort((a, b) => b.score - a.score);
  // Exact amount alone is insufficient: require a unique, clearly better description match.
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score - ranked[1].score >= 0.25)) {
    await db.runAsync("UPDATE transactions SET refund_transaction_id = ? WHERE id = ?", ranked[0].id, current.id);
  }
}
function accountIdentity(bank: BankId) {
  const accountName = bank === "nubank_credit" ? "Nubank Crédito" : bank === "nubank" ? "Nubank"
    : bank === "bradesco" ? "Bradesco" : bank === "infinitepay" ? "InfinitePay" : "Mercado Pago";
  const institution = bank === "bradesco" ? "Bradesco" : bank === "infinitepay" ? "InfinitePay"
    : bank === "mercadopago" ? "Mercado Pago" : "Nubank";
  return { accountName, institution };
}


function shiftMonthDate(date: string, months: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function inferCreditInvoiceDates(text: string, filename: string, closingDay: number | null, dueDay: number | null, rows: ParsedStatementItem[]) {
  const end = text.match(/<DTEND>(\d{4})(\d{2})(\d{2})/i);
  const namedDate = filename.match(/\b(20\d{2})[-_](\d{2})[-_](\d{2})\b/);
  let closingDate: string | null = end ? `${end[1]}-${end[2]}-${end[3]}` : null;
  let dueDate: string | null = null;

  // Some exports put the invoice due date in the filename (e.g. Nubank_2026-11-22.csv).
  if (namedDate) dueDate = `${namedDate[1]}-${namedDate[2]}-${namedDate[3]}`;
  if (!closingDate && dueDate && closingDay) {
    const [year, month] = dueDate.split("-").map(Number);
    const day = Math.min(closingDay, new Date(year, month, 0).getDate());
    closingDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  if (!closingDate && !dueDate && rows.length && closingDay) {
    const sortedDates = rows.map((row) => row.date).sort();
    const latest = sortedDates[sortedDates.length - 1];
    const [year, month] = latest.split("-").map(Number);
    const day = closingDay;
    const close = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    closingDate = latest <= close ? close : shiftMonthDate(close, 1);
  }
  if (!dueDate && closingDate && dueDay) {
    const [year, month] = closingDate.split("-").map(Number);
    const dueMonth = dueDay <= Number(closingDate.slice(8, 10)) ? shiftMonthDate(closingDate, 1).slice(0, 7) : `${year}-${String(month).padStart(2, "0")}`;
    dueDate = `${dueMonth}-${String(dueDay).padStart(2, "0")}`;
  }
  return { closingDate, dueDate, referenceMonth: closingDate?.slice(0, 7) ?? dueDate?.slice(0, 7) ?? null };
}

function installmentInfo(description: string) {
  if (/\b(multa|juros|iof|tarifa|encargo)\b/i.test(description)) return null;
  const match = description.match(/(?:\bparcela\s*)?[-–]\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i)
    ?? description.match(/\bparcela\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (current < 1 || total < 2 || current > total || total > 48) return null;
  return { current, total, description: description.replace(/\s*[-–]?\s*(?:parcela\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/i, "").trim() };
}

export default function ImportStatementScreen() {
  const db = useSQLiteContext();
  const [bank, setBank] = useState<BankId>("nubank");
  const [filename, setFilename] = useState("");
  const [items, setItems] = useState<ParsedStatementItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"choose" | "identify" | "review">("choose");
  const [documentType, setDocumentType] = useState<"account_statement" | "credit_invoice" | "sales_report" | "unknown">("unknown");
  const [fileFormat, setFileFormat] = useState<"pdf" | "csv" | "ofx">("pdf");
  const [pendingText, setPendingText] = useState("");

  async function selectPdf() {
    if (busy) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*", copyToCacheDirectory: true, multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      setBusy(true);
      setFilename(file.name);
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "csv", "ofx", "qfx"].includes(extension)) {
        throw new Error("Formato não suportado. Selecione um arquivo PDF, CSV ou OFX.");
      }
      const format = extension === "pdf" ? "pdf" : extension === "csv" ? "csv" : "ofx";
      let text = "";
      if (format === "pdf") {
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        text = await extractPdfText(base64);
      } else {
        text = await FileSystem.readAsStringAsync(file.uri);
      }
      // Detect institution independently from document type. Avoid generic words
      // such as "cartão" because account statements may mention card payments.
      const profile = normalize(`${file.name} ${text.slice(0, 12000)}`);
      let detected: BankId | "unknown" = "unknown";
      if (/nubank|nu pagamentos|roxinho/.test(profile)) detected = "nubank";
      else if (/bradesco|banco bradesco|bradesco celular|governo do estado do amazonas/.test(profile)) detected = "bradesco";
      else if (/infinite.?pay|infinitepay/.test(profile)) detected = "infinitepay";
      else if (/mercado.?pago|mercadopago/.test(profile)) detected = "mercadopago";
      else if (format === "ofx" && /creditcardmsgsrsv1/.test(profile)) detected = "nubank_credit";

      // Document type must be inferred from the document's structure, not from
      // transaction descriptions. Nubank account statements can mention "fatura do cartão"
      // inside a payment transaction and "Pix no crédito" in account movements.
      const explicitAccountStatement =
        /total de entradas/.test(profile) &&
        /total de saidas/.test(profile) &&
        /saldo inicial/.test(profile) &&
        /saldo final/.test(profile) &&
        /movimentacoes/.test(profile);

      // Require invoice-level headings. A single mention of "fatura" or "cartão"
      // is not enough because it commonly appears in checking-account statements.
      const invoiceHeading =
        /resumo da fatura atual|esta e a sua fatura de|fatura\s+\d{1,2}\s+[a-z]{3,}/.test(profile);
      const invoiceTotals =
        /total de compras de todos os cartoes/.test(profile) ||
        /total a pagar/.test(profile) && /vencimento/.test(profile);
      const csvCreditInvoice =
        format === "csv" &&
        /date.*title.*amount/.test(profile) &&
        /pagamento recebido|pix no credito|parcela\s*\d+\s*\/\s*\d+/.test(profile) &&
        /20\d{2}[-_]\d{2}[-_]\d{2}/.test(file.name);
      const explicitCreditInvoice =
        /creditcardmsgsrsv1/.test(profile) ||
        invoiceHeading && invoiceTotals ||
        csvCreditInvoice;
      const explicitSalesReport =
        /relatorio de vendas|vendas realizadas|recebimentos de vendas|resumo de vendas/.test(profile);

      // Account-statement structure takes precedence over incidental invoice wording.
      const detectedDoc: typeof documentType =
        explicitAccountStatement
          ? "account_statement"
          : detected === "nubank_credit" || explicitCreditInvoice
            ? "credit_invoice"
            : explicitSalesReport && (detected === "infinitepay" || detected === "mercadopago")
              ? "sales_report"
              : detected !== "unknown" ? "account_statement" : "unknown";
      if (detectedDoc === "credit_invoice" && detected === "nubank") detected = "nubank_credit";
      setFileFormat(format);
      setBank(detected === "unknown" ? "nubank" : detected);
      setDocumentType(detectedDoc);
      setPendingText(text);
      setPhase("identify");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível abrir o arquivo.";
      Alert.alert("Falha ao abrir arquivo", message);
    } finally {
      setBusy(false);
    }
  }

  async function analyzePendingFile() {
    if (busy || !pendingText) return;
    setBusy(true);
    try {
      let parsed: ParsedStatementItem[] = [];
      if (fileFormat === "pdf") {
        if (bank === "bradesco" && documentType === "account_statement") parsed = parseBradescoStatement(pendingText);
        else if (bank === "nubank_credit" && documentType === "credit_invoice") parsed = parseNubankInvoicePdf(pendingText);
        else if (bank === "nubank" && documentType === "account_statement") parsed = parseNubankAccount(pendingText);
        else if (documentType === "unknown") {
          Alert.alert("Identificação necessária", "Escolha o tipo de documento antes de analisar este PDF.");
          return;
        } else parsed = parseStatement(pendingText, bank === "bradesco" ? "bradesco" : "nubank");
      } else if (fileFormat === "csv") {
        parsed = parseCsvStatement(pendingText).flatMap((row, index) => {
          const normalizedDescription = normalize(row.description);
          // In a credit-card invoice, payments are settlement events, not income.
          if (documentType === "credit_invoice" && /pagamento recebido|pagamento de fatura|pagamento realizado|valor pendente do mes anterior/.test(normalizedDescription)) return [];
          const isCreditInvoice = documentType === "credit_invoice";
          const isRefund = !!row.isRefund || /estorno|reembolso|devolucao|devolução|credito de ajuste/.test(normalizedDescription);
          const kind: ParsedStatementItem["kind"] = isCreditInvoice
            ? (isRefund ? "income" : "card_purchase")
            : row.kind;
          const categoryId = kind === "income" ? "cat_income_other"
            : /ifood|restaurante|lanche|mercado|supermercado/.test(normalizedDescription) ? "cat_exp_food"
            : /uber|99|taxi|combustivel|gasolina|posto/.test(normalizedDescription) ? "cat_exp_transport" : "cat_exp_other";
          const category = categoryOptions.find((c) => c.id === categoryId)!;
          return [{
            id: `csv_${index}_${Date.now()}`, date: row.date, description: row.description,
            amountCents: row.amountCents, kind,
            categoryId: row.refundOf === "expense" ? "cat_exp_other" : category.id,
            categoryName: row.refundOf === "expense" ? "Outros gastos" : category.name,
            duplicate: false, confidence: "medium" as const, warnings: [],
            isRefund: isCreditInvoice ? isRefund : row.isRefund,
            refundOf: isCreditInvoice && isRefund ? "expense" as const : row.refundOf,
            operationType: isCreditInvoice ? (isRefund ? "card_refund" as const : "card_purchase" as const) : undefined,
          }];
        });
      } else {
        parsed = bank === "nubank_credit" ? parseNubankCreditOfx(pendingText) : parseGenericOfx(pendingText);
      }
      if (documentType === "credit_invoice") {
        // Normalize PDF/CSV/OFX credit invoice rows into the same semantic model.
        // A consolidated invoice belongs to the issuer, not to one physical card.
        parsed = parsed.map((row) => {
          const refund = !!row.isRefund || row.kind === "income" ||
            /estorno|reembolso|devolucao|cashback|credito de ajuste/.test(normalize(row.description));
          return {
            ...row,
            kind: refund ? "income" as const : "card_purchase" as const,
            isRefund: refund,
            refundOf: refund ? "expense" as const : undefined,
            operationType: refund ? "card_refund" as const : "card_purchase" as const,
          };
        });
      }
      if (!parsed.length) {
        Alert.alert("Nenhuma movimentação identificada", "O arquivo foi aberto, mas nenhum lançamento foi reconhecido. Confira a instituição e o tipo de documento ou corrija a identificação.");
        return;
      }
      const withDuplicates: ParsedStatementItem[] = [];
      const { accountName } = accountIdentity(bank);
      const targetAccount = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) LIMIT 1", accountName
      );
      for (const item of parsed) {
        let existing: { id: string } | null = null;
        // OFX FITID is the strongest identity available and is scoped to the target account.
        if (targetAccount && item.sourceId) {
          existing = await db.getFirstAsync<{ id: string }>(
            `SELECT t.id FROM transactions t JOIN import_items ii ON ii.id = t.import_item_id
             WHERE t.account_id = ? AND ii.external_id = ? LIMIT 1`,
            targetAccount.id, item.sourceId
          );
        }
        // Fallback identity is deliberately scoped to the same account and transaction kind.
        // This prevents an equal PIX on Bradesco and Nubank from being treated as a duplicate.
        if (!existing && targetAccount) {
          existing = await db.getFirstAsync<{ id: string }>(
            `SELECT id FROM transactions
             WHERE account_id = ? AND transaction_date = ? AND amount_cents = ? AND kind = ?
               AND is_refund = ? AND COALESCE(refund_of, '') = ? AND LOWER(TRIM(description)) = LOWER(TRIM(?)) LIMIT 1`,
            targetAccount.id, item.date, item.amountCents, item.kind, item.isRefund ? 1 : 0, item.refundOf ?? "", item.description
          );
        }
        withDuplicates.push({ ...item, duplicate: !!existing, duplicateTransactionId: existing?.id });
      }
      setItems(withDuplicates);
      setPhase("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível analisar o documento.";
      Alert.alert("Falha ao analisar arquivo", message);
    } finally {
      setBusy(false);
    }
  }

  function cycleCategory(itemId: string) {
    setItems((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      const categoryKind = item.refundOf === "expense" ? "expense" : item.kind === "income" || item.kind === "transfer_in" ? "income" : "expense";
      const options = categoryOptions.filter((category) => category.kind === categoryKind);
      const currentIndex = options.findIndex((category) => category.id === item.categoryId);
      const next = options[(currentIndex + 1) % options.length];
      return { ...item, categoryId: next.id, categoryName: next.name };
    }));
  }

  function toggleKind(itemId: string) {
    setItems((current) => current.map((item) => {
      if (item.id !== itemId) return item;
      if (item.kind !== "income" && item.kind !== "expense") return item;
      const kind = item.kind === "income" ? "expense" : "income";
      const category = categoryOptions.find((candidate) => candidate.kind === kind)!;
      return { ...item, kind, categoryId: category.id, categoryName: category.name, isRefund: false, refundOf: undefined };
    }));
  }

  async function confirmImport() {
    const selected = items.filter((item) => !item.duplicate);
    const validation = selected.length
      ? validateStatement(selected)
      : { valid: documentType === "credit_invoice", errors: [] as string[] };
    if (!validation.valid) {
      Alert.alert("Revise a importação", validation.errors.join("\n"));
      return;
    }
    if (!selected.length && documentType !== "credit_invoice") {
      Alert.alert("Nada para importar", "Todas as movimentações identificadas já existem ou foram marcadas como duplicadas.");
      return;
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const importId = makeId("import");
      const { accountName, institution } = accountIdentity(bank);
      const accountType = bank === "nubank_credit" ? "credit_card" : "checking";
      const cardIds = new Map<string, string>();
      let accountId = "";
      await db.withTransactionAsync(async () => {
        const existingAccount = await db.getFirstAsync<{ id: string }>(
          "SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) LIMIT 1",
          accountName
        );
        if (existingAccount) {
          accountId = existingAccount.id;
        } else {
          accountId = makeId("account");
          await db.runAsync(
            `INSERT INTO accounts (id, name, institution, account_type, opening_balance_cents, is_archived, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
            accountId, accountName, institution, accountType, now, now
          );
        }
        await db.runAsync(
          `INSERT INTO imports (id, original_filename, format, status, imported_at, source_file_path)
           VALUES (?, ?, ?, 'confirmed', ?, NULL)`,
          importId, filename || `${institution}-extrato.${filename.split(".").pop() ?? "pdf"}`,
          filename.split(".").pop()?.toLowerCase() ?? "pdf", now
        );
        for (const item of items) {
          let cardId: string | null = null;
          if (documentType !== "credit_invoice" && item.cardLast4 && bank === "nubank_credit") {
            cardId = cardIds.get(item.cardLast4) ?? null;
            if (!cardId) {
              const foundCard = await db.getFirstAsync<{ id: string }>(
                "SELECT id FROM cards WHERE institution = ? AND last4 = ? LIMIT 1", institution, item.cardLast4
              );
              cardId = foundCard?.id ?? makeId("card");
              if (!foundCard) {
                await db.runAsync(
                  `INSERT INTO cards (id, name, brand, credit_limit_cents, closing_day, due_day, is_archived, created_at, institution, last4)
                   VALUES (?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?)`,
                  cardId, `${institution} final ${item.cardLast4}`, institution, now, institution, item.cardLast4
                );
              }
              cardIds.set(item.cardLast4, cardId);
            }
          }
          const itemId = makeId("importitem");
          const isDuplicate = item.duplicate;
          await db.runAsync(
            `INSERT INTO import_items
             (id, import_id, transaction_date, description, amount_cents, suggested_kind, suggested_category_id, fingerprint, duplicate_status, external_id, confirmed_transaction_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            itemId, importId, item.date, item.description, item.amountCents, item.kind, item.categoryId,
            `${item.date}|${item.amountCents}|${item.kind}|${normalize(item.description)}|${item.refundOf ?? ""}`,
            isDuplicate ? "duplicate" : "confirmed", item.sourceId ?? null, item.duplicateTransactionId ?? null
          );
          if (!isDuplicate) {
            const transactionId = makeId("tx");
            await db.runAsync(
              `INSERT INTO transactions
               (id, account_id, category_id, kind, description, amount_cents, transaction_date, notes, import_item_id, created_at, updated_at, card_id, is_refund, refund_of, operation_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              transactionId, accountId, item.categoryId, item.kind, item.description, item.amountCents,
              item.date, `Importado do extrato ${institution}: ${filename}`, itemId, now, now, cardId, item.isRefund ? 1 : 0, item.refundOf ?? null, item.operationType ?? "generic"
            );
            await db.runAsync("UPDATE import_items SET confirmed_transaction_id = ? WHERE id = ?", transactionId, itemId);
            await reconcileTransaction(db, transactionId);
          }
        }

        // A fatura é consolidada por instituição e ciclo, sem exigir cartão físico.
        if (documentType === "credit_invoice") {
          const dates = inferCreditInvoiceDates(
            pendingText,
            filename,
            /nubank/i.test(institution) ? 15 : null,
            /nubank/i.test(institution) ? 22 : null,
            items
          );
          if (dates.referenceMonth) {
            const invoiceTotal = items.reduce((sum, item) =>
              sum + (item.kind === "card_purchase" ? item.amountCents : item.isRefund && item.refundOf === "expense" ? -item.amountCents : 0), 0);
            const existingInvoice = await db.getFirstAsync<{ id: string }>(
              "SELECT id FROM invoices WHERE institution = ? AND reference_month = ? LIMIT 1",
              institution, dates.referenceMonth
            );
            const invoiceStatus = dates.closingDate && dates.closingDate <= now.slice(0, 10) ? "closed" : "open";
            if (existingInvoice) {
              await db.runAsync(
                "UPDATE invoices SET closing_date = COALESCE(?, closing_date), due_date = COALESCE(?, due_date), total_cents = ?, status = CASE WHEN status = 'paid' THEN status ELSE ? END WHERE id = ?",
                dates.closingDate, dates.dueDate, Math.max(0, invoiceTotal), invoiceStatus, existingInvoice.id
              );
            } else {
              await db.runAsync(
                "INSERT INTO invoices (id, card_id, institution, reference_month, closing_date, due_date, total_cents, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)",
                makeId("invoice"), institution, dates.referenceMonth, dates.closingDate, dates.dueDate, Math.max(0, invoiceTotal), invoiceStatus
              );
            }

            // Create installment plans only from explicit n/total markers.
            if (dates.dueDate) {
              for (const item of items) {
                if (item.kind !== "card_purchase") continue;
                const info = installmentInfo(item.description);
                if (!info) continue;
                const firstDueDate = shiftMonthDate(dates.dueDate, -(info.current - 1));
                const cleanDescription = info.description || item.description;
                const totalCents = item.amountCents * info.total;
                const exists = await db.getFirstAsync<{ id: string }>(
                  "SELECT id FROM installments WHERE description = ? AND total_cents = ? AND installment_amount_cents = ? AND total_installments = ? AND first_due_date = ? LIMIT 1",
                  cleanDescription, totalCents, item.amountCents, info.total, firstDueDate
                );
                if (!exists) {
                  await db.runAsync(
                    "INSERT INTO installments (id, description, total_cents, installment_amount_cents, total_installments, first_due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    makeId("installment"), cleanDescription, totalCents, item.amountCents, info.total, firstDueDate, now
                  );
                }
              }
            }
          }
        }
      });
      Alert.alert(
        "Importação concluída",
        `${selected.length} movimentação(ões) nova(s) importada(s). ${items.length - selected.length} duplicidade(s) ignorada(s). ${documentType === "credit_invoice" ? "Fatura e parcelamentos conferidos." : ""}`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (error) {
      console.error("Statement import failed", error);
      Alert.alert("Erro na importação", "Não foi possível salvar as movimentações. Nenhum lançamento deve ser considerado importado; tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const importableCount = items.filter((item) => !item.duplicate).length;
  const reviewCount = items.filter((item) => item.confidence === "low").length;
  const totalCents = items.filter((item) => !item.duplicate && (item.kind === "income" || item.kind === "expense" || item.kind === "card_purchase")).reduce((sum, item) => sum + (item.refundOf === "expense" ? item.amountCents : item.refundOf === "income" ? -item.amountCents : item.kind === "income" ? item.amountCents : -item.amountCents), 0);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => phase === "review" ? setPhase("identify") : phase === "identify" ? setPhase("choose") : router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>IMPORTAÇÃO LOCAL</Text>
          <Text style={styles.title}>Analisar extrato</Text>
        </View>
      </View>

      {phase === "choose" ? (
        <>
          <Text style={styles.subtitle}>Selecione um arquivo PDF, CSV ou OFX. O aplicativo identifica automaticamente o formato, a instituição e o tipo de documento.</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Como funciona</Text>
            <Text style={styles.infoText}>Depois da identificação, você pode corrigir qualquer informação antes de analisar os lançamentos. Tudo é processado localmente no aparelho.</Text>
          </View>
          <Pressable disabled={busy} onPress={() => void selectPdf()} style={[styles.primaryButton, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Selecionar arquivo</Text>}
          </Pressable>
          <Text style={styles.footnote}>A leitura é local. PDFs escaneados ainda precisam de OCR. Você poderá revisar os lançamentos antes de gravá-los.</Text>
        </>
      ) : phase === "identify" ? (
        <>
          <Text style={styles.subtitle}>Identificamos o arquivo automaticamente. Confira os dados; se algo estiver errado, altere antes de continuar.</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Arquivo selecionado</Text>
            <Text style={styles.infoText}>{filename}</Text>
            <Text style={[styles.infoTitle, { marginTop: 12 }]}>Formato detectado</Text>
            <Text style={styles.infoText}>{fileFormat.toUpperCase()}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Instituição financeira</Text>
            <View style={styles.bankGrid}>
              {([
                {id: documentType === "credit_invoice" ? "nubank_credit" : "nubank", label:"Nubank"},
                {id:"bradesco", label:"Bradesco"},
                {id:"infinitepay", label:"InfinitePay"},
                {id:"mercadopago", label:"Mercado Pago"},
              ] as {id: BankId; label:string}[]).map(option => (
                <Pressable key={option.id} onPress={() => setBank(option.id)} style={[styles.bankCard, bank === option.id && styles.bankSelected]}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={styles.bankName}>{option.label}</Text>
                  {bank === option.id ? <Text style={styles.bankSelectedLabel}>Selecionado</Text> : <Text style={styles.bankSelectedHint}>Instituição</Text>}
                </Pressable>
              ))}
            </View>
            <Text style={[styles.infoTitle, { marginTop: 20, marginBottom: 10 }]}>Tipo de documento</Text>
            <View style={styles.documentGrid}>
              {([
                {id:"account_statement",label:"Extrato bancário",hint:"Entradas e saídas"},
                {id:"credit_invoice",label:"Fatura de crédito",hint:"Compras e parcelas"},
                {id:"sales_report",label:"Relatório de vendas",hint:"Vendas e recebimentos"},
                {id:"unknown",label:"Não identificado",hint:"Definir manualmente"},
              ] as {id: typeof documentType; label:string; hint:string}[]).map(option => (
                <Pressable key={option.id} onPress={() => {
                  setDocumentType(option.id);
                  if (option.id === "credit_invoice" && bank === "nubank") setBank("nubank_credit");
                  if (option.id === "account_statement" && bank === "nubank_credit") setBank("nubank");
                }} style={[styles.documentCard, documentType === option.id && styles.documentSelected]}>
                  <View style={{flex:1}}>
                    <Text numberOfLines={1} adjustsFontSizeToFit style={styles.documentName}>{option.label}</Text>
                    <Text style={styles.documentHint}>{option.hint}</Text>
                  </View>
                  {documentType === option.id ? <Text style={styles.documentCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </View>
          </View>
          {documentType === "credit_invoice" ? (
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Fatura consolidada</Text>
              <Text style={styles.infoText}>A fatura será registrada em {accountIdentity(bank).institution}, sem vincular a um cartão físico específico.</Text>
            </View>
          ) : null}
          <Pressable disabled={busy || documentType === "unknown"} onPress={() => void analyzePendingFile()} style={[styles.primaryButton, (busy || documentType === "unknown") && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Confirmar identificação e analisar</Text>}
          </Pressable>
          <Pressable disabled={busy} onPress={() => { setPhase("choose"); setPendingText(""); }} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Escolher outro arquivo</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.summary}>
            <Text style={styles.fileName} numberOfLines={2}>{filename}</Text>
            <Text style={styles.summaryText}>{items.length} identificadas · {importableCount} para importar · {items.length - importableCount} duplicadas · {reviewCount} revisar</Text>
            <Text style={[styles.summaryTotal, { color: totalCents >= 0 ? colors.success : colors.danger }]}>{totalCents >= 0 ? "+" : "−"}{formatBRL(Math.abs(totalCents))}</Text>
          </View>
          <View style={styles.reviewHint}>
            <Text style={styles.reviewHintText}>Toque no tipo para alternar receita/despesa. Toque na categoria para percorrer as categorias disponíveis.</Text>
          </View>
          <ScrollView style={{ maxHeight: 470 }} contentContainerStyle={{ gap: 9, paddingBottom: 12 }}>
            {items.map((item) => (
              <View key={item.id} style={[styles.itemCard, item.duplicate && styles.duplicateCard]}>
                <View style={styles.itemTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemDescription}>{item.description}</Text>
                    <Text style={styles.itemDate}>{item.date.split("-").reverse().join("/")} · Confiança {item.confidence === "high" ? "alta" : item.confidence === "medium" ? "média" : "baixa"}{item.cardLast4 ? ` · Cartão final ${item.cardLast4}` : ""}</Text>
                  </View>
                  <Text style={[styles.itemAmount, { color: item.kind === "income" && !item.isRefund || item.refundOf === "expense" ? colors.success : colors.text }]}>{item.refundOf === "expense" ? "+" : item.refundOf === "income" ? "−" : item.kind === "income" || item.kind === "transfer_in" ? "+" : item.kind === "transfer_out" || item.kind === "card_payment" ? "↔ " : "−"}{formatBRL(item.amountCents)}</Text>
                </View>
                <View style={styles.itemActions}>
                  {(item.kind === "income" || item.kind === "expense") ? (
                    <Pressable onPress={() => toggleKind(item.id)} style={styles.smallChip}>
                      <Text style={styles.chipText}>{item.isRefund ? (item.refundOf === "income" ? "Estorno de receita" : "Estorno de despesa") : item.kind === "income" ? "Receita" : "Despesa"}</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.smallChip}>
                      <Text style={styles.chipText}>{item.kind === "transfer_in" ? "Transferência recebida" : item.kind === "transfer_out" ? "Transferência enviada" : item.kind === "card_payment" ? "Pagamento de fatura" : "Compra no crédito"}</Text>
                    </View>
                  )}
                  <Pressable onPress={() => cycleCategory(item.id)} style={styles.smallChip}>
                    <Text style={styles.chipText}>{item.categoryName} · alterar</Text>
                  </Pressable>
                  {item.duplicate ? <View style={styles.duplicateTag}><Text style={styles.duplicateText}>Já existe</Text></View> : null}
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable disabled={busy || importableCount === 0} onPress={() => void confirmImport()} style={[styles.primaryButton, (busy || importableCount === 0) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Importar {importableCount} movimentação(ões)</Text>}
          </Pressable>
          <Pressable disabled={busy} onPress={() => { setPhase("choose"); setItems([]); }} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancelar análise</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, marginTop: -4 },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 27, fontWeight: "800", marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 20 },
  bankGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  bankCard: { width: "48%", minHeight: 82, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 18, backgroundColor: colors.surface },
  bankSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  bankName: { color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "center" },
  bankSelectedLabel: { position: "absolute", right: 9, bottom: 5, color: colors.primary, fontSize: 8, fontWeight: "800" },
  bankSelectedHint: { position: "absolute", right: 9, bottom: 5, color: colors.muted, fontSize: 8 },
  documentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  documentCard: { width: "48%", minHeight: 76, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: colors.surface },
  documentSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceElevated },
  documentName: { color: colors.text, fontSize: 11, fontWeight: "800" },
  documentHint: { color: colors.muted, fontSize: 8, marginTop: 3 },
  documentCheck: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  infoCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 17, marginTop: 18 },
  infoTitle: { color: colors.text, fontWeight: "800", fontSize: 13 },
  infoText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 7 },
  primaryButton: { backgroundColor: colors.primaryStrong, borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 20 },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  footnote: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 12, textAlign: "center" },
  summary: { padding: 15, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  fileName: { color: colors.text, fontSize: 12, fontWeight: "700" },
  summaryText: { color: colors.muted, fontSize: 10, marginTop: 5 },
  summaryTotal: { fontSize: 23, fontWeight: "900", marginTop: 10 },
  reviewHint: { padding: 11, borderRadius: 12, backgroundColor: colors.surfaceElevated, marginBottom: 10 },
  reviewHintText: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  itemCard: { borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  duplicateCard: { opacity: 0.65 },
  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  itemDescription: { color: colors.text, fontSize: 12, fontWeight: "700" },
  itemDate: { color: colors.muted, fontSize: 9, marginTop: 4 },
  itemAmount: { fontSize: 12, fontWeight: "800" },
  itemActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 },
  smallChip: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, paddingVertical: 6 },
  chipText: { color: colors.primary, fontSize: 9, fontWeight: "700" },
  duplicateTag: { backgroundColor: "#3B2C1D", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20 },
  duplicateText: { color: "#FBBF24", fontSize: 9, fontWeight: "800" },
  cancelButton: { alignItems: "center", paddingVertical: 14 },
  cancelText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
});
