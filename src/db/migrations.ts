import type { SQLiteDatabase } from "expo-sqlite";

const DATABASE_VERSION = 9;

const defaultCategories = [
  ["cat_income_salary", "Salário", "income", "#34D399", "briefcase"],
  ["cat_income_other", "Outras receitas", "income", "#34D399", "wallet"],
  ["cat_exp_food", "Alimentação", "expense", "#FBBF24", "utensils"],
  ["cat_exp_transport", "Transporte", "expense", "#60A5FA", "car"],
  ["cat_exp_home", "Moradia", "expense", "#A78BFA", "house"],
  ["cat_exp_health", "Saúde", "expense", "#FB7185", "heart"],
  ["cat_exp_education", "Educação", "expense", "#38BDF8", "book"],
  ["cat_exp_leisure", "Lazer", "expense", "#C084FC", "gamepad"],
  ["cat_exp_shopping", "Compras", "expense", "#F472B6", "shopping-bag"],
  ["cat_exp_subscriptions", "Assinaturas", "expense", "#818CF8", "repeat"],
  ["cat_exp_other", "Outros gastos", "expense", "#A49AAF", "ellipsis"],
] as const;

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const result = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
          color TEXT,
          icon TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          institution TEXT,
          account_type TEXT NOT NULL DEFAULT 'checking',
          opening_balance_cents INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
          category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (
            kind IN ('income', 'expense', 'transfer_in', 'transfer_out',
                     'card_purchase', 'card_payment', 'loan_given',
                     'loan_received', 'loan_repayment', 'loan_collection')
          ),
          description TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
          transaction_date TEXT NOT NULL,
          notes TEXT,
          transfer_group_id TEXT,
          import_item_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
        CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY NOT NULL,
          original_filename TEXT NOT NULL,
          format TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('review', 'confirmed', 'cancelled')),
          imported_at TEXT NOT NULL,
          source_file_path TEXT
        );

        CREATE TABLE IF NOT EXISTS import_items (
          id TEXT PRIMARY KEY NOT NULL,
          import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
          transaction_date TEXT NOT NULL,
          description TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          suggested_kind TEXT,
          suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          fingerprint TEXT,
          duplicate_status TEXT NOT NULL DEFAULT 'unchecked',
          confirmed_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS loans (
          id TEXT PRIMARY KEY NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('lent', 'borrowed')),
          person_or_institution TEXT NOT NULL,
          description TEXT,
          principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
          interest_cents INTEGER NOT NULL DEFAULT 0,
          started_on TEXT NOT NULL,
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS loan_payments (
          id TEXT PRIMARY KEY NOT NULL,
          loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          paid_on TEXT NOT NULL,
          notes TEXT,
          transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cards (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          brand TEXT,
          credit_limit_cents INTEGER NOT NULL DEFAULT 0,
          closing_day INTEGER,
          due_day INTEGER,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY NOT NULL,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          reference_month TEXT NOT NULL,
          closing_date TEXT,
          due_date TEXT,
          total_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          UNIQUE(card_id, reference_month)
        );

        CREATE TABLE IF NOT EXISTS installments (
          id TEXT PRIMARY KEY NOT NULL,
          description TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          installment_amount_cents INTEGER NOT NULL,
          total_installments INTEGER NOT NULL,
          first_due_date TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        PRAGMA user_version = 1;
      `);
    });
  }

  if (currentVersion > DATABASE_VERSION) {
    throw new Error(`Database version ${currentVersion} is newer than supported version ${DATABASE_VERSION}.`);
  }

  // Version 2 is additive: keep every existing account, transaction and import.
  if (currentVersion < 2) {
    const transactionColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
    const importItemColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(import_items)");
    const cardColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(cards)");
    const txNames = new Set(transactionColumns.map((column) => column.name));
    const itemNames = new Set(importItemColumns.map((column) => column.name));
    const cardNames = new Set(cardColumns.map((column) => column.name));
    await db.withTransactionAsync(async () => {
      if (!txNames.has("card_id")) await db.execAsync("ALTER TABLE transactions ADD COLUMN card_id TEXT REFERENCES cards(id) ON DELETE SET NULL;");
      if (!txNames.has("is_refund")) await db.execAsync("ALTER TABLE transactions ADD COLUMN is_refund INTEGER NOT NULL DEFAULT 0;");
      if (!txNames.has("refund_of")) await db.execAsync("ALTER TABLE transactions ADD COLUMN refund_of TEXT;");
      if (!itemNames.has("external_id")) await db.execAsync("ALTER TABLE import_items ADD COLUMN external_id TEXT;");
      if (!cardNames.has("institution")) await db.execAsync("ALTER TABLE cards ADD COLUMN institution TEXT;");
      if (!cardNames.has("last4")) await db.execAsync("ALTER TABLE cards ADD COLUMN last4 TEXT;");
      await db.execAsync(`
        UPDATE import_items
           SET confirmed_transaction_id = (
             SELECT t.id FROM transactions t WHERE t.import_item_id = import_items.id LIMIT 1
           )
         WHERE confirmed_transaction_id IS NULL
           AND EXISTS (SELECT 1 FROM transactions t WHERE t.import_item_id = import_items.id);
        CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_id);
        CREATE INDEX IF NOT EXISTS idx_import_items_external_id ON import_items(external_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_institution_last4 ON cards(institution, last4) WHERE last4 IS NOT NULL;
        PRAGMA user_version = 2;
      `);
    });
  }


  // Version 3 adds semantic operation metadata without rebuilding or deleting user data.
  if (currentVersion < 3) {
    const transactionColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
    const txNames = new Set(transactionColumns.map((column) => column.name));
    await db.withTransactionAsync(async () => {
      if (!txNames.has("operation_type")) await db.execAsync("ALTER TABLE transactions ADD COLUMN operation_type TEXT NOT NULL DEFAULT 'generic';");
      if (!txNames.has("refund_transaction_id")) await db.execAsync("ALTER TABLE transactions ADD COLUMN refund_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL;");
      await db.execAsync("CREATE INDEX IF NOT EXISTS idx_transactions_refund_link ON transactions(refund_transaction_id); PRAGMA user_version = 3;");
    });
  }

  // Version 4 adds indexes used by safe transfer/refund reconciliation.
  // Existing records are preserved; ambiguous matches are intentionally not auto-linked.
  if (currentVersion < 4) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS idx_transactions_transfer_match
          ON transactions(kind, amount_cents, transaction_date, transfer_group_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_refund_match
          ON transactions(account_id, amount_cents, transaction_date, is_refund, refund_of);
      `);
      // Backfill only one-to-one transfer matches with same amount, opposite direction,
      // different accounts and a maximum three-day date difference.
      const transfers = await db.getAllAsync<{ id: string; account_id: string; kind: string; amount_cents: number; transaction_date: string; transfer_group_id: string | null }>(
        `SELECT id, account_id, kind, amount_cents, transaction_date, transfer_group_id
         FROM transactions WHERE kind IN ('transfer_in', 'transfer_out') AND transfer_group_id IS NULL`
      );
      for (const item of transfers) {
        const opposite = item.kind === "transfer_in" ? "transfer_out" : "transfer_in";
        const candidates = await db.getAllAsync<{ id: string; transaction_date: string }>(
          `SELECT id, transaction_date FROM transactions
           WHERE account_id <> ? AND kind = ? AND amount_cents = ? AND transfer_group_id IS NULL
             AND transaction_date BETWEEN date(?, '-3 day') AND date(?, '+3 day')`,
          item.account_id, opposite, item.amount_cents, item.transaction_date, item.transaction_date
        );
        if (candidates.length === 1) {
          const groupId = `transfer_${item.id}_${candidates[0].id}`;
          await db.runAsync("UPDATE transactions SET transfer_group_id = ? WHERE id IN (?, ?) AND transfer_group_id IS NULL", groupId, item.id, candidates[0].id);
        }
      }
    });
    await db.execAsync("PRAGMA user_version = 4;");
  }


  // Version 5 adds monthly category budgets. This is additive and preserves all
  // existing financial records.
  if (currentVersion < 5) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS category_budgets (
          id TEXT PRIMARY KEY NOT NULL,
          category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          reference_month TEXT NOT NULL,
          limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(category_id, reference_month)
        );
        CREATE INDEX IF NOT EXISTS idx_category_budgets_month
          ON category_budgets(reference_month);
      `);
    });
    await db.execAsync("PRAGMA user_version = 5;");
  }

  // Version 6 adds recurring expense templates for cash-flow forecasting.
  // Templates do not create transactions automatically, preventing duplicate expenses.
  if (currentVersion < 6) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS recurring_expenses (
          id TEXT PRIMARY KEY NOT NULL,
          description TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
          due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
          start_month TEXT NOT NULL,
          end_month TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recurring_expenses_active
          ON recurring_expenses(is_active, start_month, end_month);
      `);
    });
    await db.execAsync("PRAGMA user_version = 6;");
  }



  // Version 7: invoices belong to a billing institution/cycle, not necessarily
  // to one physical card. This supports issuers such as Nubank where multiple
  // cards share a single consolidated invoice. Existing invoices are preserved.
  if (currentVersion < 7) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE invoices_v7 (
          id TEXT PRIMARY KEY NOT NULL,
          card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
          institution TEXT NOT NULL DEFAULT 'Desconhecida',
          reference_month TEXT NOT NULL,
          closing_date TEXT,
          due_date TEXT,
          total_cents INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open'
        );

        INSERT INTO invoices_v7
          (id, card_id, institution, reference_month, closing_date, due_date, total_cents, status)
        SELECT i.id, NULL,
               COALESCE(c.institution, c.brand, c.name, 'Desconhecida'),
               i.reference_month, i.closing_date, i.due_date, i.total_cents, i.status
          FROM invoices i
          LEFT JOIN cards c ON c.id = i.card_id;

        DROP TABLE invoices;
        ALTER TABLE invoices_v7 RENAME TO invoices;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_institution_month
          ON invoices(institution, reference_month);
        CREATE INDEX IF NOT EXISTS idx_invoices_due_date
          ON invoices(due_date);
        UPDATE cards
           SET closing_day = 15, due_day = 22
         WHERE LOWER(COALESCE(institution, brand, name, '')) LIKE '%nubank%';

        -- Consolidated Nubank invoice purchases must not be assigned to one physical card.
        UPDATE transactions
           SET card_id = NULL,
               operation_type = CASE
                 WHEN kind = 'card_purchase' THEN 'card_purchase'
                 WHEN is_refund = 1 THEN 'card_refund'
                 ELSE operation_type
               END
         WHERE account_id IN (SELECT id FROM accounts WHERE LOWER(name) = LOWER('Nubank Crédito'));
      `);
    });
    await db.execAsync("PRAGMA user_version = 7;");
  }

  // Version 8 adds multiple partial payments per consolidated invoice.
  // Each manually registered payment creates one card_payment transaction so
  // the source account reflects the cash outflow, while reports keep it out of expenses.
  if (currentVersion < 8) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS invoice_payments (
          id TEXT PRIMARY KEY NOT NULL,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          paid_on TEXT NOT NULL,
          account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
          transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
          transaction_source TEXT NOT NULL DEFAULT 'created' CHECK (transaction_source IN ('created', 'matched')),
          notes TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
          ON invoice_payments(invoice_id, paid_on);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_transaction
          ON invoice_payments(transaction_id) WHERE transaction_id IS NOT NULL;
      `);
    });
    await db.execAsync("PRAGMA user_version = 8;");
  }


  // Version 9: complete loan agreements with a negotiated total and an installment schedule.
  // Existing loans are preserved and converted to a single scheduled installment when possible.
  if (currentVersion < 9) {
    const loanColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loans)");
    const paymentColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loan_payments)");
    const loanNames = new Set(loanColumns.map((column) => column.name));
    const paymentNames = new Set(paymentColumns.map((column) => column.name));
    await db.withTransactionAsync(async () => {
      if (!loanNames.has("agreed_total_cents")) await db.execAsync("ALTER TABLE loans ADD COLUMN agreed_total_cents INTEGER NOT NULL DEFAULT 0;");
      if (!loanNames.has("installment_count")) await db.execAsync("ALTER TABLE loans ADD COLUMN installment_count INTEGER NOT NULL DEFAULT 1;");
      if (!loanNames.has("frequency")) await db.execAsync("ALTER TABLE loans ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly';");
      if (!loanNames.has("first_due_date")) await db.execAsync("ALTER TABLE loans ADD COLUMN first_due_date TEXT;");
      if (!paymentNames.has("installment_id")) await db.execAsync("ALTER TABLE loan_payments ADD COLUMN installment_id TEXT REFERENCES loan_installments(id) ON DELETE SET NULL;");
      if (!paymentNames.has("account_id")) await db.execAsync("ALTER TABLE loan_payments ADD COLUMN account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL;");
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS loan_installments (
          id TEXT PRIMARY KEY NOT NULL,
          loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
          installment_number INTEGER NOT NULL,
          due_date TEXT NOT NULL,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          created_at TEXT NOT NULL,
          UNIQUE(loan_id, installment_number)
        );
        CREATE INDEX IF NOT EXISTS idx_loan_installments_due ON loan_installments(due_date, loan_id);
        CREATE INDEX IF NOT EXISTS idx_loan_payments_installment ON loan_payments(installment_id);
        UPDATE loans
           SET agreed_total_cents = CASE WHEN agreed_total_cents > 0 THEN agreed_total_cents ELSE principal_cents + interest_cents END,
               first_due_date = COALESCE(first_due_date, due_date),
               installment_count = CASE WHEN installment_count < 1 THEN 1 ELSE installment_count END;
      `);
      const legacyLoans = await db.getAllAsync<{ id: string; agreed_total_cents: number; due_date: string | null; first_due_date: string | null }>(
        "SELECT id, agreed_total_cents, due_date, first_due_date FROM loans"
      );
      for (const loan of legacyLoans) {
        const existing = await db.getFirstAsync<{ id: string }>("SELECT id FROM loan_installments WHERE loan_id = ? LIMIT 1", loan.id);
        const due = loan.first_due_date || loan.due_date;
        if (!existing && due && loan.agreed_total_cents > 0) {
          await db.runAsync(
            "INSERT INTO loan_installments (id, loan_id, installment_number, due_date, amount_cents, created_at) VALUES (?, ?, 1, ?, ?, ?)",
            `legacy_${loan.id}`, loan.id, due, loan.agreed_total_cents, new Date().toISOString()
          );
        }
      }
      // Attach legacy payments to the single migrated installment so their
      // existing paid amounts are reflected in the calendar and schedule.
      await db.execAsync(`
        UPDATE loan_payments
           SET installment_id = (
             SELECT i.id FROM loan_installments i
              WHERE i.loan_id = loan_payments.loan_id
              ORDER BY i.installment_number LIMIT 1
           )
         WHERE installment_id IS NULL
           AND EXISTS (SELECT 1 FROM loan_installments i WHERE i.loan_id = loan_payments.loan_id);
      `);
    });
    await db.execAsync("PRAGMA user_version = 9;");
  }

  // Seed idempotently, including for databases that already had schema v1.
  const now = new Date().toISOString();
  for (const [id, name, kind, color, icon] of defaultCategories) {
    await db.runAsync(
      `INSERT OR IGNORE INTO categories (id, name, kind, color, icon, is_system, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      id, name, kind, color, icon, now
    );
  }
}
