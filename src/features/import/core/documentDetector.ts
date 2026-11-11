import type { BankId, DocumentProfile } from "./types";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function detectDocument(text: string, format: "pdf" | "csv" | "ofx"): DocumentProfile {
  const value = normalize(text);
  const signals: string[] = [];
  let bank: BankId = "unknown";

  if (/nubank|nu pagamentos|roxinho/.test(value)) {
    bank = "nubank";
    signals.push("Identidade textual do Nubank");
  } else if (/bradesco|banco bradesco/.test(value)) {
    bank = "bradesco";
    signals.push("Identidade textual do Bradesco");
  } else if (/itau|ita[uú] unibanco/.test(value)) {
    signals.push("Possível documento Itaú");
  } else if (/banco do brasil|bb\.com\.br/.test(value)) {
    signals.push("Possível documento Banco do Brasil");
  }

  // A checking-account statement may mention card invoices or Pix on credit
  // in transaction descriptions. Only classify as credit when invoice headings
  // and invoice totals are present together.
  const accountStatement =
    /total de entradas/.test(value) &&
    /total de saidas/.test(value) &&
    /saldo inicial/.test(value) &&
    /saldo final/.test(value) &&
    /movimentacoes/.test(value);
  const invoiceHeading =
    /resumo da fatura atual|esta e a sua fatura de|fatura\\s+\\d{1,2}\\s+[a-z]{3,}/.test(value);
  const invoiceTotals =
    /total de compras de todos os cartoes/.test(value) ||
    /total a pagar/.test(value) && /vencimento/.test(value);
  if (bank === "nubank" && !accountStatement && (invoiceHeading && invoiceTotals || /creditcardmsgsrsv1/.test(value))) {
    bank = "nubank_credit";
    signals.push("Cabeçalho e totais de fatura de cartão identificados");
  } else if (accountStatement) {
    signals.push("Estrutura de extrato bancário identificada");
  }

  const detectedDateFormat = /\b\d{4}-\d{2}-\d{2}\b/.test(text)
    ? "yyyy-mm-dd"
    : /\b\d{2}\/\d{2}\/\d{4}\b/.test(text)
      ? "dd/mm/yyyy"
      : "unknown";

  return {
    bank,
    format,
    hasSelectableText: text.trim().length > 0,
    detectedDateFormat,
    signals,
  };
}
