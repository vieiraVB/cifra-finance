import type { ImportedTransaction, ValidationResult } from "../core/types";

export function validateImportedTransaction(item: Omit<ImportedTransaction, "kind"> & { kind: string }): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) errors.push("Data fora do padrão ISO.");
  else {
    const [year, month, day] = item.date.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      errors.push("Data inexistente no calendário.");
    }
  }
  if (!item.description.trim()) errors.push("Descrição vazia.");
  if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) errors.push("Valor inválido.");
  if (item.confidence === "low") warnings.push("Interpretação com baixa confiança: revisar antes de importar.");
  if (item.warnings.length) warnings.push(...item.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

export function validateStatement(items: Array<Omit<ImportedTransaction, "kind"> & { kind: string }>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!items.length) errors.push("Nenhuma movimentação foi identificada.");
  const invalid = items.filter((item) => !validateImportedTransaction(item).valid);
  if (invalid.length) errors.push(`${invalid.length} movimentação(ões) possuem campos inválidos.`);
  const low = items.filter((item) => item.confidence === "low").length;
  if (low) warnings.push(`${low} movimentação(ões) precisam de revisão cuidadosa.`);
  return { valid: errors.length === 0, errors, warnings };
}
