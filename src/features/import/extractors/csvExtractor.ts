export type CsvRow = { date: string; description: string; amountCents: number; kind: "income" | "expense"; isRefund?: boolean; refundOf?: "income" | "expense" };
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []; let current = "", quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { cells.push(current.trim()); current = ""; } else current += c;
  }
  cells.push(current.trim()); return cells;
}
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function parseDate(v: string): string | null {
  let m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.trim().match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function parseMoney(v: string): number | null {
  let s = v.replace(/[R$\s]/g, "").trim(); if (!s || s === "-" || s === "—") return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-"); s = s.replace(/[()+-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s); return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) * (neg ? -1 : 1) : null;
}
export function parseCsvStatement(content: string): CsvRow[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(x => x.trim()); if (lines.length < 2) return [];
  const delimiter = [",", ";", "\t"].sort((a,b) => lines[0].split(b).length-lines[0].split(a).length)[0];
  const h = splitCsvLine(lines[0], delimiter).map(norm);
  const di=h.findIndex(x=>/data|date/.test(x)), si=h.findIndex(x=>/descricao|historico|description|memo|estabelecimento|favorecido|nome|titulo|title|merchant/.test(x));
  const ai=h.findIndex(x=>/^(valor|amount|value|valor liquido|valor da transacao)$/.test(x));
  const ci=h.findIndex(x=>/credito|credit|entrada/.test(x)), oi=h.findIndex(x=>/debito|debit|saida/.test(x)), ti=h.findIndex(x=>/tipo|natureza|type|operacao/.test(x));
  if(di<0||si<0||(ai<0&&ci<0&&oi<0)) return [];
  const out: CsvRow[]=[];
  for(const line of lines.slice(1)) { const c=splitCsvLine(line,delimiter), date=parseDate(c[di]??""), desc=(c[si]??"").trim(); if(!date||!desc) continue;
    const credit=ci>=0?parseMoney(c[ci]??""):null, debit=oi>=0?parseMoney(c[oi]??""):null, raw=ai>=0?parseMoney(c[ai]??""):null;
    const amount=credit!==null&&credit!==0?Math.abs(credit):debit!==null&&debit!==0?-Math.abs(debit):raw; if(amount===null||amount===0) continue;
    const type=norm(c[ti]??""), kind=/credito|credit|entrada|receita|recebimento/.test(type)?"income":/debito|debit|saida|despesa|pagamento/.test(type)?"expense":amount<0?"expense":"income";
    const refundOf = /estorno de venda|reversao de venda/i.test(desc) ? "income"
      : /estorno|reembolso|devolucao|devolução|cashback/i.test(desc) ? "expense" : undefined;
    out.push({date,description:desc,amountCents:Math.abs(amount),kind,isRefund:!!refundOf,refundOf});
  } return out;
}
