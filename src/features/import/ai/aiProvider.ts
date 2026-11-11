import type { ImportedTransaction } from "../core/types";

/**
 * Optional AI adapter. The app never contains an API secret.
 * A user-configured HTTPS proxy is required; requests are only made after explicit consent.
 */
export type AiImportRequest = {
  extractedText: string;
  bankHint: string;
  documentName?: string;
};
export type AiImportResponse = { transactions: Array<{
  date: string;
  description: string;
  amount: number;
  kind: "income" | "expense";
}> };

export async function requestAiInterpretation(
  endpoint: string,
  request: AiImportRequest,
  explicitlyAuthorized: boolean,
): Promise<AiImportResponse> {
  if (!explicitlyAuthorized) throw new Error("É necessário autorizar o envio do conteúdo para a IA.");
  if (!/^https:\/\//i.test(endpoint)) throw new Error("O serviço de IA precisa usar uma URL HTTPS.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "parse_bank_statement",
      instructions: "Retorne apenas movimentações explícitas. Não invente datas, valores, saldos ou descrições. Use YYYY-MM-DD e amount positivo. Diferencie receita e despesa. Se houver ambiguidade, omita o item.",
      ...request,
    }),
  });
  if (!response.ok) throw new Error(`Serviço de IA indisponível (HTTP ${response.status}).`);
  const data = await response.json() as AiImportResponse;
  if (!data || !Array.isArray(data.transactions)) throw new Error("Resposta da IA em formato inválido.");
  return data;
}
