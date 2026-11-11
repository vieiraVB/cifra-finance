import type { Confidence, ImportedTransaction } from "./core/types";

export type BankId = "nubank" | "nubank_credit" | "bradesco" | "infinitepay" | "mercadopago";
export type ParsedStatementItem = Omit<ImportedTransaction, "kind"> & { kind: "income" | "expense" | "transfer_in" | "transfer_out" | "card_purchase" | "card_payment"; sourceId?: string; cardLast4?: string; isRefund?: boolean; refundOf?: "income" | "expense"; operationType?: "pix_credit" | "pix_credit_refund" | "card_purchase" | "card_refund" | "debit_refund" | "sale_refund" | "generic"; duplicateTransactionId?: string };

const categories = [
  { id: "cat_income_salary", name: "Salário", kind: "income" as const, words: ["salario", "folha", "pagto salario", "pagamento salario"] },
  { id: "cat_income_other", name: "Outras receitas", kind: "income" as const, words: ["pix recebido", "transferencia recebida", "deposito", "ted recebida", "credito recebido", "recebimento"] },
  { id: "cat_exp_food", name: "Alimentação", kind: "expense" as const, words: ["ifood", "mercado", "supermercado", "restaurante", "lanche", "padaria", "acai", "99 food"] },
  { id: "cat_exp_transport", name: "Transporte", kind: "expense" as const, words: ["uber", "99app", "99 tecnologia", "99pop", "posto", "combustivel", "gasolina", "estacionamento", "taxi"] },
  { id: "cat_exp_home", name: "Moradia", kind: "expense" as const, words: ["aluguel", "energia", "agua", "internet", "condominio"] },
  { id: "cat_exp_health", name: "Saúde", kind: "expense" as const, words: ["farmacia", "drogaria", "hospital", "consulta", "clinica"] },
  { id: "cat_exp_education", name: "Educação", kind: "expense" as const, words: ["faculdade", "curso", "livraria", "escola"] },
  { id: "cat_exp_leisure", name: "Lazer", kind: "expense" as const, words: ["cinema", "steam", "playstation", "spotify", "netflix", "k4 lounge"] },
  { id: "cat_exp_shopping", name: "Compras", kind: "expense" as const, words: ["cea", "c e a", "renner", "amazon", "shopee", "magazine", "mercadolivre", "mercado livre", "modas", "pichau"] },
  { id: "cat_exp_subscriptions", name: "Assinaturas", kind: "expense" as const, words: ["assinatura", "mensalidade", "netflix", "spotify", "prime video"] },
  { id: "cat_exp_other", name: "Outros gastos", kind: "expense" as const, words: [] },
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function repairNubankDescription(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  const normalized = normalize(clean);
  if (/^pagamento de fatur$/.test(normalized)) return "Pagamento de fatura";
  if (/^credito em cont$/.test(normalized)) return "Crédito em conta";
  if (/^debito em cont$/.test(normalized)) return "Débito em conta";
  if (/^compra no debito dl\s*\*?\s*99\s*9$/.test(normalized)) return "Compra no débito 99 (DL *99 99)";
  if (/^compra no debito zigpa$/.test(normalized)) return "Compra no débito ZIGPAY";
  if (/^compra no debito mp\s*\*?jbexpres$/.test(normalized)) return "Compra no débito JBEXPRESS";
  return clean;
}

const datePattern = /\b(?:\d{2}[\/.-]\d{2}(?:[\/.-]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/;

function inferYear(text: string): number | null {
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  // Statement period headers are usually near the beginning; avoid using arbitrary years in descriptions.
  return years[0];
}
function parseDate(value: string, fallbackYear: number | null): { date: string | null; hadYear: boolean } {
  let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: validDate(+m[1], +m[2], +m[3]), hadYear: true };
  m = value.match(/^(\d{2})[\/.-](\d{2})(?:[\/.-](\d{2,4}))?$/);
  if (!m) return { date: null, hadYear: false };
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (year === null) return { date: null, hadYear: false };
  if (year < 100) year += 2000;
  return { date: validDate(year, Number(m[2]), Number(m[1])), hadYear: !!m[3] };
}
function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function moneyTokens(text: string) {
  // Accept both R$ -10,00 and −R$ 10,00 (the latter appears in Nubank invoices).
  const regex = /([+\-−]\s*)?(?:R\$\s*)?([+\-−]?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})/g;
  const found: Array<{ cents: number; raw: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    const raw = m[2].replace(/\s/g, "");
    const negative = (m[1] ?? "").trim().startsWith("-") || (m[1] ?? "").trim().startsWith("−") || raw.startsWith("-") || raw.startsWith("−");
    const numeric = Number(raw.replace(/[+\-−]/g, "").replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(numeric)) found.push({ cents: (negative ? -1 : 1) * Math.round(numeric * 100), raw, index: m.index });
  }
  return found;
}
function categoryFor(description: string, kind: "income" | "expense") {
  const normalized = normalize(description).replace(/[.*_/-]+/g, " ").replace(/\s+/g, " ").trim();
  if (kind === "expense") {
    // Prefer explicit merchant signatures; never infer from arbitrary substrings such as "bar" in "Barbosa".
    if (/\b99\s*food\b|\b99food\b|\b99\s*entrega\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_food")!;
    if (/\b99(?:\s*(?:tecnologia|pop|app))?\b|\buber\b|\btrip help\b|\buber trip\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_transport")!;
    if (/\b(c\s*e\s*a|cea)\b|\brenner\b|\bmodas\b|\bshopee\b|\bamazon\b|\bpichau\b|\bcalcados\b|\bimportadora\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_shopping")!;
    if (/\b99\s*food\b|\bifood\b|\brestaurante\b|\bpadaria\b|\bsupermercado\b|\bmercado\b|\bcafe\b|\bcafeteria\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_food")!;
    if (/\bspotify\b|\bnetflix\b|\bprime video\b|\bassinatura\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_subscriptions")!;
    if (/\bcinema\b|\bingresso\b|\bingressomix\b|\bsteam\b|\bplaystation\b|\bk4 lounge\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_leisure")!;
    if (/\b(farmacia|drogaria|farma|hospital|clinica|academia)\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_health")!;
    if (/\b(faculdade|curso|livraria|escola)\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_education")!;
    if (/\b(aluguel|energia|agua|internet|condominio)\b/.test(normalized)) return categories.find(c => c.id === "cat_exp_home")!;
  }
  return categories.find(c => c.kind === kind && c.words.some(w => normalized.includes(w)))
    ?? categories.find(c => c.id === (kind === "income" ? "cat_income_other" : "cat_exp_other"))!;
}
function inferKind(description: string, signedCents: number): "income" | "expense" {
  const d = normalize(description);
  if (/(recebid|entrada|credito|deposit|salario|estorno|devolu|reembolso|cashback)/.test(d)) return "income";
  if (/(enviado|pagamento|compra|debito|saque|tarifa|parcela|boleto|pix enviado)/.test(d)) return "expense";
  return signedCents < 0 ? "expense" : "income";
}
function isNoise(text: string) {
  return /(saldo anterior|saldo do dia|saldo final|saldo disponivel|total de creditos|total de debitos|limite disponivel|lancamentos futuros|extrato de movimentacoes)/.test(normalize(text));
}

/**
 * Conservative line-group parser. It does not assume the first date-like token
 * is always a transaction: headers and balance rows are filtered and ambiguous
 * multi-amount rows are downgraded instead of silently treated as certain.
 */
export function parseStatement(text: string, bank: BankId): ParsedStatementItem[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  const year = inferYear(text.slice(0, 2500));
  const groups: string[] = [];
  let active: string[] = [];

  const flush = () => {
    if (active.length) groups.push(active.join(" "));
    active = [];
  };

  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    const startsNew = !!dateMatch && (active.length === 0 || dateMatch.index === 0 || /^\d{2}[\/.-]\d{2}/.test(line));
    if (startsNew) flush();
    if (active.length || dateMatch) active.push(line);
    // A line that contains a date and at least one money value may be a complete row.
    if (active.length && moneyTokens(active.join(" ")).length && active.join(" ").length > 18) {
      // Do not flush here: the next date starts the next row. This preserves split descriptions.
    }
  }
  flush();

  const rows: ParsedStatementItem[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const dateMatch = group.match(datePattern);
    if (!dateMatch || isNoise(group)) continue;
    const parsedDate = parseDate(dateMatch[0], year);
    if (!parsedDate.date) continue;
    const afterDate = group.slice((dateMatch.index ?? 0) + dateMatch[0].length);
    const amounts = moneyTokens(afterDate);
    if (!amounts.length) continue;

    // In generic statements the amount is normally the first monetary value after description.
    // Multi-column layouts are treated as ambiguous unless a bank-specific layout is recognized.
    let signed = amounts[0].cents;
    let confidence: Confidence = parsedDate.hadYear ? "medium" : "low";
    const warnings: string[] = [];
    if (!parsedDate.hadYear) warnings.push("Ano inferido pelo período do documento.");
    if (amounts.length > 1) {
      warnings.push("Mais de um valor na mesma linha; confira se não há coluna de saldo.");
      confidence = "low";
    }
    if (bank === "bradesco" && amounts.length >= 3) {
      const credit = Math.abs(amounts[0].cents);
      const debit = Math.abs(amounts[1].cents);
      if (credit > 0 && debit === 0) { signed = credit; confidence = "medium"; }
      else if (debit > 0 && credit === 0) { signed = -debit; confidence = "medium"; }
      else warnings.push("Layout de colunas Bradesco não identificado com segurança.");
    }
    let description = afterDate.slice(0, amounts[0].index).replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim();
    description = description.replace(/^\d{4,}\s+/, "").replace(/^[|:–—-]+\s*/, "");
    if (description.length < 2 || description.length > 180) continue;
    if (/(data|descricao|historico|lancamento|valor|saldo)/i.test(description) && description.length < 35) continue;
    const kind = inferKind(description, signed);
    const amountCents = Math.abs(signed);
    if (!amountCents) continue;
    const category = categoryFor(description, kind);
    const fingerprint = `${parsedDate.date}|${amountCents}|${normalize(description)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rows.push({
      id: `parsed_${rows.length}_${Math.random().toString(36).slice(2, 8)}`,
      date: parsedDate.date,
      description: description.slice(0, 300),
      amountCents,
      kind,
      categoryId: category.id,
      categoryName: category.name,
      duplicate: false,
      confidence,
      warnings,
    });
  }
  return rows;
}


const makeItem = (
  date: string, description: string, amountCents: number,
  kind: ParsedStatementItem["kind"], confidence: Confidence = "high",
  warnings: string[] = [], sourceId?: string, cardLast4?: string, refundOf?: "income" | "expense", operationType?: ParsedStatementItem["operationType"]
): ParsedStatementItem => {
  const categoryKind = refundOf === "expense" ? "expense" : kind === "income" || kind === "transfer_in" ? "income" : "expense";
  const category = categoryFor(description, categoryKind);
  return {
    id: `bank_${rowsafe(description)}_${date}_${Math.random().toString(36).slice(2, 7)}`,
    date, description: description.slice(0, 300), amountCents, kind,
    categoryId: category.id, categoryName: category.name,
    duplicate: false, confidence, warnings, sourceId, cardLast4, isRefund: !!refundOf, refundOf, operationType,
  };
};
function rowsafe(value: string) { return normalize(value).replace(/[^a-z0-9]+/g, "_").slice(0, 18); }

const months: Record<string, string> = {
  JAN: "01", JANEIRO: "01", FEV: "02", FEVEREIRO: "02", MAR: "03", MARCO: "03", MARÇO: "03",
  ABR: "04", ABRIL: "04", MAI: "05", MAIO: "05", JUN: "06", JUNHO: "06",
  JUL: "07", JULHO: "07", AGO: "08", AGOSTO: "08", SET: "09", SETEMBRO: "09",
  OUT: "10", OUTUBRO: "10", NOV: "11", NOVEMBRO: "11", DEZ: "12", DEZEMBRO: "12",
};
function dateFromPt(value: string, year: number): string | null {
  const m = value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/\b(\d{1,2})\s+(?:DE\s+)?(JANEIRO|JAN|FEVEREIRO|FEV|MARCO|MAR|ABRIL|ABR|MAIO|MAI|JUNHO|JUN|JULHO|JUL|AGOSTO|AGO|SETEMBRO|SET|OUTUBRO|OUT|NOVEMBRO|NOV|DEZEMBRO|DEZ)\b/);
  if (!m) return null;
  const month = months[m[2]];
  return month ? validDate(year, Number(month), Number(m[1])) : null;
}
function yearFromRange(text: string, fallback = new Date().getFullYear()): number {
  const m = text.match(/\b(?:20\d{2})\b/);
  return m ? Number(m[0]) : fallback;
}
function transactionDescription(lines: string[]) {
  return lines.join(" ").replace(/\s+/g, " ").replace(/R\$\s*/g, "").trim();
}

function cleanNubankAccountDescription(value: string): string {
  return value
    // The account statement prints recipient CPF/CNPJ and bank routing data after the name.
    .replace(/\s+-\s+•••.*$/u, "")
    .replace(/\s+-\s+\d{2}\.?\d{3}\.?\d{3}\/?\d{0,4}.*$/u, "")
    .replace(/\s+(?:PAGAMENTOS|PAGAMENTOS - IP|NU PAGAMENTOS|BCO [A-Z]|BANCO [A-Z]).*$/i, "")
    .replace(/\s+Agência:.*$/i, "")
    .replace(/\s+Conta:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAmountInTransaction(lines: string[]): { amount: number; description: string } | null {
  // The value belongs to the transaction row, not to the last monetary token in the block.
  // Some PDFs wrap a long merchant/person name onto a line immediately before the amount.
  const descriptionParts: string[] = [];
  for (const line of lines) {
    const normalized = normalize(line);
    if (/^(agencia:|conta:|nu pagamentos|pagamentos - ip|bco |banco |bradesco s\.a\.|itau unibanco|mercado pago ip)/i.test(normalized)) continue;
    const amounts = moneyTokens(line);
    if (!amounts.length) {
      if (line.trim()) descriptionParts.push(line.trim());
      continue;
    }
    const token = amounts[0];
    const prefix = line.slice(0, token.index).replace(/R\$\s*$/, "").trim();
    if (prefix) descriptionParts.push(prefix);
    return { amount: Math.abs(token.cents), description: descriptionParts.join(" ").replace(/\s+/g, " ").trim() };
  }
  return null;
}

/** Nubank account statement adapter: uses daily sections and the bank's transaction labels. */
export function parseNubankAccount(text: string): ParsedStatementItem[] {
  const lines = text.split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const year = yearFromRange(text);
  const out: ParsedStatementItem[] = [];
  let currentDate: string | null = null;
  let section: "income" | "expense" | null = null;
  let block: string[] = [];
  const flush = () => {
    if (!currentDate || !block.length || !section) { block = []; return; }
    const raw = transactionDescription(block);
    const norm = normalize(raw);
    const transaction = firstAmountInTransaction(block);
    block = [];
    if (!transaction || transaction.amount <= 0) return;
    // Investment balance movements are excluded; Pix no crédito is a card liability.
    if (/valor adicionado|aplicacao rdb|resgate rdb/.test(norm)) return;

    let kind: ParsedStatementItem["kind"] = section;
    let operationType: ParsedStatementItem["operationType"] = "generic";
    let refundOf: "income" | "expense" | undefined;
    if (/estorno.*pix no credito|devolucao.*pix no credito/.test(norm)) {
      kind = "card_purchase"; operationType = "pix_credit_refund"; refundOf = "expense";
    } else if (/pix no credito/.test(norm)) {
      kind = "card_purchase"; operationType = "pix_credit";
    } else if (/pagamento de fatura/.test(norm)) kind = "card_payment";
    else if (/vitor vieira barbosa/.test(norm)) kind = section === "income" ? "transfer_in" : "transfer_out";
    else if (/estorno|reembolso/.test(norm)) { kind = "income"; refundOf = "expense"; operationType = "debit_refund"; }

    let description = transaction.description || raw;
    description = cleanNubankAccountDescription(description);
    description = description
      .replace(/^(compra no debito(?: via nupay)?|transferencia recebida pelo pix|transferencia recebida|transferencia enviada pelo pix|credito em conta|debito em conta|estorno - compra no debito|estorno - ajuste de compra no debito|pagamento de fatura)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!description) description = transaction.description || raw;
    const cleaned = repairNubankDescription(description);
    out.push(makeItem(currentDate, cleaned, transaction.amount, kind, "high", [], undefined, undefined, refundOf, operationType));
  };
  const startLabels = /^(transferencia recebida|transferencia enviada|compra no debito|pix no credito|pagamento de fatura|credito em conta|debito em conta|estorno|reembolso|valor adicionado|aplicacao rdb|resgate rdb)/i;
  for (const line of lines) {
    // The PDF repeats the full period (01 DE OUTUBRO DE 2026) in every page header.
    // Only the short transaction heading (01 OUT 2026) changes the active date.
    const day = line.match(/^(\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ))\s+(\d{4})/i);
    if (day) {
      flush();
      currentDate = dateFromPt(day[1], Number(day[2]));
      section = null;
      const rest = line.slice(day[0].length).trim();
      if (rest && /^total de (entradas|saidas)/i.test(normalize(rest))) {
        section = normalize(rest).includes("entradas") ? "income" : "expense";
      }
      continue;
    }
    const normalizedLine = normalize(line);
    if (/^total de entradas\b/.test(normalizedLine)) { flush(); section = "income"; continue; }
    if (/^total de saidas\b/.test(normalizedLine)) { flush(); section = "expense"; continue; }
    if (/^01 de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de 20\d{2}/.test(normalizedLine)
      || /^saldo (inicial|final)|^rendimento liquido|^movimentacoes|^tem alguma duvida|^caso a solucao|^disponiveis em nubank|^nubank$/i.test(normalizedLine)) {
      flush(); section = null; continue;
    }
    if (startLabels.test(normalize(line))) {
      flush();
      if (section) block = [line];
      continue;
    }
    if (block.length) block.push(line);
  }
  flush();
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.date}|${item.amountCents}|${normalize(item.description)}|${item.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Bradesco statement adapter: handles the bank's multi-line statement rows and separate credit/debit columns. */
export function parseBradescoStatement(text: string): ParsedStatementItem[] {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: ParsedStatementItem[] = [];
  let currentDate: string | null = null;
  let block: string[] = [];
  const operation = /^(rendimentos|recebimento fornecedor|transf cc para cc|transfer cc para cc|pix enviado|pix recebido|ted|doc|saque|pagamento|tarifa|credito em conta|debito em conta)/i;
  const flush = () => {
    if (!block.length || !currentDate) { block = []; return; }
    const raw = block.join(" ").replace(/\s+/g, " ").trim();
    block = [];
    const amounts = moneyTokens(raw);
    if (!amounts.length) return;
    // Bradesco columns: transaction value followed by resulting balance.
    const amount = Math.abs((amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]).cents);
    if (!amount) return;
    const normalized = normalize(raw);
    let description = raw
      .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "")
      .replace(/\b\d{5,}\b/g, "")
      .replace(/(?:R\$\s*)?[+\-−]?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?:\s+(?:R\$\s*)?[+\-−]?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})*\s*$/, "")
      .replace(/\s+/g, " ").trim();
    description = description.replace(/(?:R\$\s*)?[+\-−]?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g, " ").replace(/^(rendimentos|recebimento fornecedor|transf cc para cc|transfer cc para cc|pix enviado|pix recebido)\s*/i, "$1 ").replace(/\s+/g, " ").trim();
    if (!description || /^(total|data|historico|docto|credito|debito|saldo)$/i.test(description)) return;
    let kind: ParsedStatementItem["kind"] = "expense";
    let label = description;
    if (/pix enviado/.test(normalized)) {
      kind = /vitor vieira barbosa/.test(normalized) ? "transfer_out" : "expense";
      if (kind === "transfer_out") label = "Transferência para conta própria";
    } else if (/transf cc para cc|transfer cc para cc|transferencia entre contas/.test(normalized)) {
      kind = "transfer_in";
    } else if (/pix recebido|ted recebida|credito em conta|recebimento fornecedor|rendimento|poup facil/.test(normalized)) {
      kind = "income";
      if (/rendimento|poup facil/.test(normalized)) label = "Rendimento de poupança";
    }
    out.push(makeItem(currentDate, label.slice(0, 300), amount, kind, "high"));
  };
  for (const line of lines) {
    const dateMatch = line.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (dateMatch) {
      currentDate = validDate(Number(dateMatch[3]), Number(dateMatch[2]), Number(dateMatch[1]));
      if (block.length) block.push(line);
      else block = [line];
      continue;
    }
    if (/^total\b/i.test(line)) { flush(); continue; }
    if (operation.test(normalize(line))) {
      flush();
      block = [line];
      continue;
    }
    if (/^(data|historico|docto|credito|debito|saldo|extrato de:|folha:)/i.test(normalize(line))) continue;
    if (block.length) block.push(line);
  }
  flush();
  return out;
}

/** Nubank credit card invoice PDF: reads only the transaction section and ignores payments. */
export function parseNubankInvoicePdf(text: string): ParsedStatementItem[] {
  const sectionMatch = /TRANSAÇÕES|TRANSACTIONS/i.exec(text);
  const start = sectionMatch?.index ?? -1;
  if (start < 0) return [];
  const body = text.slice(start);
  const lines = body.split(/\r?\n/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  const year = yearFromRange(text);
  const period = text.match(/DE\s+\d{1,2}\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+A\s+\d{1,2}\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/i);
  const monthNumber = (month: string) => Number(months[month.toUpperCase()] ?? "0");
  const startMonth = period ? monthNumber(period[1]) : 0;
  const endMonth = period ? monthNumber(period[2]) : 0;
  const dateYear = (month: string) => startMonth > endMonth && monthNumber(month) > endMonth ? year - 1 : year;
  const out: ParsedStatementItem[] = [];
  let date: string | null = null;
  let block: string[] = [];
  let pendingMerchant = "";
  const flush = () => {
    if (!date || !block.length) { block = []; return; }
    const raw = transactionDescription(block);
    const amounts = moneyTokens(raw);
    if (!amounts.length) { block = []; return; }
    const dateLineIndex = block.findIndex((line) => /^\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/i.test(line));
    const transactionLine = block[dateLineIndex >= 0 ? dateLineIndex : 0] ?? "";
    const leadingMerchant = dateLineIndex > 0 ? block.slice(0, dateLineIndex).join(" ").trim() : "";
    const cardLast4 = transactionLine.match(/(?:••••|\*{4})\s*(\d{4})/)?.[1];
    const desc = leadingMerchant || transactionLine.replace(/^\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+/i, "").trim();
    const norm = normalize(desc);
    if (/^pagamento em |^pagamento recebido|^pagamentos e financiamentos|^total a pagar|^total de compras|^saldo restante/.test(norm)) { block = []; return; }
    // In the Nubank invoice the amount beside the merchant is the actual installment charged.
    // The explanatory paragraph below may contain transaction total, IOF and interest.
    const amount = amounts[0].cents;
    if (!amount) { block = []; return; }
    const kind: ParsedStatementItem["kind"] = amount < 0 || /estorno|reembolso|devolucao/.test(norm) ? "income" : "card_purchase";
    const cleaned = desc.replace(/••••\s*\d{4}\s*/g, "").replace(/\s*[−-]?\s*R\$\s*[+-]?[\d.,]+.*$/i, "").replace(/[−-]\s*$/, "").replace(/\s+/g, " ").trim();
    if (cleaned.length > 2) out.push(makeItem(date, cleaned, Math.abs(amount), kind, "high", [], undefined, cardLast4, kind === "income" && /estorno|reembolso|devolucao/.test(norm) ? "expense" : undefined, kind === "income" ? "card_refund" : "card_purchase"));
    block = [];
  };
  for (const line of lines) {
    const dateMatch = line.match(/^(\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ))\b/i);
    if (dateMatch) {
      flush();
      date = dateFromPt(dateMatch[1], dateYear(dateMatch[1].split(/\s+/)[1]));
      block = pendingMerchant ? [pendingMerchant, line] : [line];
      pendingMerchant = "";
      continue;
    }
    if (/^TRANSAÇÕES|^DE \d{1,2} |^VITOR V|^FATURA|^\d+ de \d+$/i.test(line)) continue;
    if (/^PAGAMENTOS E FINANCIAMENTOS$/i.test(line)) { flush(); continue; }
    // In some Nubank pages the merchant name is printed immediately before its dated/valued row.
    if (/^[A-Z0-9À-Ü][A-Z0-9À-Ü* .&'/-]{5,}\s+-\s+Parcela\s*$/i.test(line) && !moneyTokens(line).length) {
      pendingMerchant = line;
      continue;
    }
    if (block.length) block.push(line);
  }
  flush();
  return out;
}

/** Generic OFX account statement adapter for compatible exports. */
export function parseGenericOfx(text: string): ParsedStatementItem[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const out: ParsedStatementItem[] = [];
  for (const block of blocks) {
    const field = (name: string) => block.match(new RegExp(`<${name}>([^\\r\\n<]+)`, "i"))?.[1]?.trim() ?? "";
    const dm = field("DTPOSTED").match(/^(\d{4})(\d{2})(\d{2})/);
    const amount = Number(field("TRNAMT"));
    const desc = field("MEMO") || field("NAME") || field("PAYEE");
    if (!dm || !desc || !Number.isFinite(amount) || amount === 0) continue;
    const date = `${dm[1]}-${dm[2]}-${dm[3]}`, normDesc = normalize(desc);
    if (/saldo anterior|saldo inicial|saldo final/.test(normDesc)) continue;
    let kind: ParsedStatementItem["kind"] = amount < 0 ? "expense" : "income";
    if (/transferencia entre contas|transferencia propria|transferencia para minha conta/.test(normDesc)) kind = amount < 0 ? "transfer_out" : "transfer_in";
    else if (/pagamento de fatura|pagamento cartao/.test(normDesc)) kind = "card_payment";
    else if (/estorno|reembolso|devolucao|cashback/.test(normDesc)) kind = "income";
    out.push(makeItem(date, desc, Math.round(Math.abs(amount) * 100), kind, "medium", ["Confira a natureza do lançamento no extrato original."], field("FITID") || undefined, undefined, /estorno|reembolso|devolucao|cashback/.test(normDesc) ? ((/estorno de venda|reversao de venda/.test(normDesc) ? "income" : "expense")) : undefined, /estorno de venda|reversao de venda/.test(normDesc) ? "sale_refund" : "generic"));
  }
  return out;
}

/** Nubank credit-card OFX: debit rows are purchases/charges; invoice payments are not income. */
export function parseNubankCreditOfx(text: string): ParsedStatementItem[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const out: ParsedStatementItem[] = [];
  for (const block of blocks) {
    const field = (name: string) => block.match(new RegExp(`<${name}>([^\\r\\n<]+)`, "i"))?.[1]?.trim() ?? "";
    const dateRaw = field("DTPOSTED");
    const dateMatch = dateRaw.match(/^(\d{4})(\d{2})(\d{2})/);
    const amount = Number(field("TRNAMT"));
    const desc = field("MEMO") || field("NAME") || field("PAYEE");
    if (!dateMatch || !desc || !Number.isFinite(amount) || amount === 0) continue;
    const norm = normalize(desc);
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    // Positive credit rows that are actual refunds reduce the invoice. Ordinary
    // payments/settlements and previous-cycle carry-over are excluded.
    if (amount > 0) {
      if (/estorno|reembolso|devolucao|cashback/.test(norm)) {
        out.push(makeItem(date, desc, Math.round(Math.abs(amount) * 100), "income", "high", [], field("FITID"), undefined, "expense", "card_refund"));
      }
      continue;
    }
    if (/pagamento recebido|valor pendente do mes anterior/.test(norm)) continue;
    // Preserve identical purchases: OFX can contain two legitimate charges with the same date,
    // merchant and amount. FITID is retained as provenance but is not globally unique in this export.
    out.push(makeItem(date, desc, Math.round(Math.abs(amount) * 100), "card_purchase", "high", [], field("FITID")));
  }
  return out;
}
