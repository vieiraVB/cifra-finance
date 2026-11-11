import { inflate } from "pako";

function decodeBase64(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    if (char === "=") break;
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return new Uint8Array(bytes);
}

function latin1(bytes: Uint8Array): string {
  let result = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return result;
}

function unescapePdfLiteral(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c !== "\\") {
      bytes.push(value.charCodeAt(i) & 255);
      continue;
    }
    i++;
    if (i >= value.length) break;
    const n = value[i];
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (n in escapes) bytes.push(escapes[n]);
    else if (n === "\r" || n === "\n") {
      if (n === "\r" && value[i + 1] === "\n") i++;
    } else if (/[0-7]/.test(n)) {
      let octal = n;
      while (octal.length < 3 && /[0-7]/.test(value[i + 1] || "")) octal += value[++i];
      bytes.push(parseInt(octal, 8) & 255);
    } else bytes.push(n.charCodeAt(0) & 255);
  }
  return new Uint8Array(bytes);
}

function decodeWithCMap(bytes: Uint8Array, cmap: Map<string, string>): string | null {
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  const keys = Array.from(cmap.keys()).sort((a, b) => b.length - a.length);
  let mapped = "";
  let position = 0;
  while (position < hex.length) {
    const key = keys.find((candidate) => hex.startsWith(candidate, position));
    if (!key) return null;
    mapped += cmap.get(key) ?? "";
    position += key.length;
  }
  return mapped || null;
}

function scoreDecodedText(value: string): number {
  if (!value) return -1000;
  let score = 0;
  for (const char of value) {
    if (/[A-Za-zÀ-ÿ0-9]/.test(char)) score += 3;
    else if (/\s/.test(char)) score += 2;
    else if (/[.,:;!?()+\-/'’]/.test(char)) score += 1;
    else if (char.charCodeAt(0) < 32 || char === "�") score -= 8;
    else score -= 2;
  }
  if (/\b(?:pix|compra|transferencia|recebida|enviada|debito|credito|saldo|outubro|novembro|nubank)\b/i.test(value)) score += 12;
  return score;
}

function decodePdfBytes(bytes: Uint8Array, cmaps?: Map<string, string>[]): string {
  if (cmaps?.length) {
    const candidates = cmaps.map((map) => decodeWithCMap(bytes, map)).filter((value): value is string => value !== null);
    if (candidates.length) return candidates.sort((a, b) => scoreDecodedText(b) - scoreDecodedText(a))[0];
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const cp1252: Record<number, number> = {
      0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026,
      0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160,
      0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019,
      0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
      0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153,
      0x9e: 0x17e, 0x9f: 0x178,
    };
    return Array.from(bytes, (byte) => String.fromCharCode(cp1252[byte] ?? byte)).join("");
  }
}

function decodePdfStream(objectBody: string): string {
  const marker = /stream\r?\n/.exec(objectBody);
  if (!marker) return "";
  const start = marker.index + marker[0].length;
  const end = objectBody.indexOf("endstream", start);
  if (end < 0) return "";
  const raw = objectBody.slice(start, end).replace(/\r?\n$/, "");
  const dictionary = objectBody.slice(0, marker.index);
  if (/\/Subtype\s*\/Image/.test(dictionary)) return "";
  if (/\/FlateDecode/.test(dictionary)) {
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0) & 255);
    try { return latin1(inflate(bytes)); }
    catch {
      try { return latin1(inflate(bytes, { windowBits: -15 })); }
      catch { return ""; }
    }
  }
  return raw;
}

function extractPdfStreams(pdf: string): { content: string[]; cmaps: string[] } {
  const objects = new Map<number, string>();
  for (const match of pdf.matchAll(/(?:^|\n)(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) {
    objects.set(Number(match[1]), match[2]);
  }
  const cmapStreams: string[] = [];
  const cmapRefs = new Set<number>();
  for (const body of objects.values()) {
    const ref = body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (ref) cmapRefs.add(Number(ref[1]));
  }
  for (const ref of cmapRefs) {
    const body = objects.get(ref);
    if (body) {
      const stream = decodePdfStream(body);
      if (stream) cmapStreams.push(stream);
    }
  }

  const pageContents: string[] = [];
  const pageBodies = [...objects.values()].filter((body) => /\/Type\s*\/Page\b/.test(body));
  for (const page of pageBodies) {
    const contents = page.match(/\/Contents\s*(\[[^\]]+\]|\d+\s+\d+\s+R)/);
    if (!contents) continue;
    const refs = [...contents[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    if (!refs.length) {
      const single = contents[1].match(/^(\d+)/);
      if (single) refs.push(Number(single[1]));
    }
    for (const ref of refs) {
      const body = objects.get(ref);
      if (!body) continue;
      const stream = decodePdfStream(body);
      if (stream && /\b(?:Tj|TJ)\b/.test(stream)) pageContents.push(stream);
    }
  }
  if (pageContents.length) return { content: pageContents, cmaps: cmapStreams };

  // Fallback for PDFs with compressed object streams or nonstandard page dictionaries.
  const allStreams: string[] = [];
  for (const body of objects.values()) {
    const stream = decodePdfStream(body);
    if (stream) allStreams.push(stream);
  }
  return { content: allStreams, cmaps: cmapStreams.length ? cmapStreams : allStreams };
}

function buildCMaps(streams: string[]): Map<string, string>[] {
  const maps: Map<string, string>[] = [];
  for (const stream of streams) {
    if (!/beginbfchar|beginbfrange/.test(stream)) continue;
    const cmap = new Map<string, string>();
    const decodeTarget = (hex: string) => {
      const clean = hex.replace(/\s/g, "");
      let value = "";
      for (let i = 0; i + 3 < clean.length; i += 4) value += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
      return value;
    };
    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        cmap.set(pair[1].toUpperCase(), decodeTarget(pair[2]));
      }
    }
    for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const start = parseInt(range[1], 16), end = parseInt(range[2], 16);
        const targetStart = parseInt(range[3], 16);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 4096) continue;
        for (let code = start; code <= end; code++) {
          const target = (targetStart + code - start).toString(16).padStart(range[3].length, "0");
          cmap.set(code.toString(16).padStart(range[1].length, "0").toUpperCase(), decodeTarget(target));
        }
      }
    }
    if (cmap.size) maps.push(cmap);
  }
  return maps;
}

function extractTextFromStream(stream: string, cmaps?: Map<string, string>[]): string[] {
  const items: Array<{ text: string; x: number; y: number; order: number }> = [];
  const tokenPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[((?:.|\r|\n)*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  let order = 0;
  while ((match = tokenPattern.exec(stream))) {
    const before = stream.slice(0, match.index);
    const matrices = [...before.matchAll(/1\s+0\s+0\s+1\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm/g)];
    const matrix = matrices[matrices.length - 1];
    const x = matrix ? Number(matrix[1]) : 0;
    const y = matrix ? Number(matrix[2]) : 0;
    let value = "";
    if (match[1] !== undefined) value = decodePdfBytes(unescapePdfLiteral(match[1]), cmaps);
    else if (match[2] !== undefined) {
      const clean = match[2].replace(/\s/g, "");
      const bytes = new Uint8Array(clean.match(/.{1,2}/g)?.map((v) => parseInt(v.padEnd(2, "0"), 16)) ?? []);
      value = decodePdfBytes(bytes, cmaps);
    } else {
      const parts: string[] = [];
      const tokens = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
      let token: RegExpExecArray | null;
      while ((token = tokens.exec(match[3]))) {
        if (token[1] !== undefined) parts.push(decodePdfBytes(unescapePdfLiteral(token[1]), cmaps));
        else {
          const clean = token[2].replace(/\s/g, "");
          const bytes = new Uint8Array(clean.match(/.{1,2}/g)?.map((v) => parseInt(v.padEnd(2, "0"), 16)) ?? []);
          parts.push(decodePdfBytes(bytes, cmaps));
        }
      }
      value = parts.join("");
    }
    if (value.trim()) items.push({ text: value, x, y, order: order++ });
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x || a.order - b.order);
  const lines: string[] = [];
  let currentY: number | null = null;
  let current = "";
  for (const item of items) {
    if (currentY === null || Math.abs(item.y - currentY) > 1.8) {
      if (current.trim()) lines.push(current.trim());
      current = item.text;
      currentY = item.y;
    } else {
      current += (current ? " " : "") + item.text;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export async function extractPdfText(base64: string): Promise<string> {
  const bytes = decodeBase64(base64);
  if (bytes.length < 8 || latin1(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("O arquivo selecionado não parece ser um PDF válido.");
  }
  const pdf = latin1(bytes);
  const extracted = extractPdfStreams(pdf);
  const cmaps = buildCMaps(extracted.cmaps);
  const text = extracted.content.flatMap((stream) => extractTextFromStream(stream, cmaps)).join("\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (text.length < 20) {
    throw new Error("Não consegui extrair texto deste PDF. Ele pode ser um documento digitalizado como imagem ou usar uma codificação não suportada. Este leitor funciona com extratos PDF que possuem texto selecionável.");
  }
  return text;
}
