export type BankId = "nubank" | "nubank_credit" | "bradesco" | "unknown";
export type TransactionKind = "income" | "expense" | "transfer_in" | "transfer_out" | "card_purchase" | "card_payment";
export type Confidence = "high" | "medium" | "low";
export type ExtractionMethod = "pdf-text" | "ocr" | "csv" | "ofx" | "ai-assisted";

export type ImportedTransaction = {
  id: string;
  date: string; // ISO YYYY-MM-DD
  description: string;
  amountCents: number; // always positive; direction is in kind
  kind: TransactionKind;
  categoryId: string;
  categoryName: string;
  duplicate: boolean;
  confidence: Confidence;
  sourcePage?: number;
  warnings: string[];
  cardLast4?: string;
};

export type DocumentProfile = {
  bank: BankId;
  format: "pdf" | "csv" | "ofx";
  hasSelectableText: boolean;
  detectedDateFormat: "dd/mm/yyyy" | "yyyy-mm-dd" | "unknown";
  signals: string[];
};

export type ImportAnalysis = {
  profile: DocumentProfile;
  items: ImportedTransaction[];
  warnings: string[];
  extractedCharacters: number;
  method: ExtractionMethod;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};
