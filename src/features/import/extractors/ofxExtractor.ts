export type OfxRow = { date: string; description: string; amountCents: number; kind: "income" | "expense"; fitId?: string };

export function parseOfxStatement(content: string): OfxRow[] {
  const rows: OfxRow[] = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? [];
  for (const block of blocks) {
    const field = (name: string) => block.match(new RegExp(`<${name}>([^\\r\\n<]+)`, "i"))?.[1]?.trim() ?? "";
    const rawDate = field("DTPOSTED");
    const rawAmount = field("TRNAMT");
    const dateMatch = rawDate.match(/^(\d{4})(\d{2})(\d{2})/);
    const amount = Number(rawAmount.replace(",", "."));
    const description = field("NAME") || field("MEMO") || field("PAYEE");
    if (!dateMatch || !description || !Number.isFinite(amount) || amount === 0) continue;
    rows.push({
      date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      description,
      amountCents: Math.round(Math.abs(amount) * 100),
      kind: amount < 0 ? "expense" : "income",
      fitId: field("FITID") || undefined,
    });
  }
  return rows;
}
