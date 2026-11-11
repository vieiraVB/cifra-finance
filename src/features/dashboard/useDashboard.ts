import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

export type DashboardData = {
  income: number;
  expenses: number;
  balance: number;
  recent: Array<{
    id: string;
    description: string;
    amount_cents: number;
    kind: string;
    is_refund: number;
    refund_of: string | null;
    transaction_date: string;
    category_name: string | null;
    category_color: string | null;
    card_name: string | null;
    operation_type: string | null;
  }>;
  categories: Array<{ name: string; color: string | null; total: number }>;
};

export function useDashboard() {
  const db = useSQLiteContext();
  const [data, setData] = useState<DashboardData>({
    income: 0, expenses: 0, balance: 0, recent: [], categories: [],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const totals = await db.getFirstAsync<{ income: number; expenses: number }>(
        `SELECT
          COALESCE(SUM(CASE
            WHEN refund_of = 'income' THEN -amount_cents
            WHEN is_refund = 1 THEN 0
            WHEN kind = 'income' THEN amount_cents
            ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE
            WHEN refund_of = 'expense' THEN -amount_cents
            WHEN is_refund = 1 THEN 0
            WHEN kind IN ('expense', 'card_purchase') THEN amount_cents
            ELSE 0 END), 0) AS expenses
         FROM transactions WHERE substr(transaction_date, 1, 7) = ?`,
        month
      );
      const recent = await db.getAllAsync<DashboardData["recent"][number]>(
        `SELECT t.id, t.description, t.amount_cents, t.kind, t.is_refund, t.refund_of, t.transaction_date,
                c.name AS category_name, c.color AS category_color, cards.name AS card_name, t.operation_type
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN cards ON cards.id = t.card_id
         ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT 5`
      );
      const categories = await db.getAllAsync<DashboardData["categories"][number]>(
        `SELECT c.name, c.color,
                SUM(CASE
                  WHEN t.refund_of = 'expense' THEN -t.amount_cents
                  WHEN t.is_refund = 1 THEN 0
                  ELSE t.amount_cents END) AS total
         FROM transactions t JOIN categories c ON c.id = t.category_id
         WHERE (t.kind IN ('expense', 'card_purchase') OR t.refund_of = 'expense')
           AND substr(t.transaction_date, 1, 7) = ?
         GROUP BY c.id HAVING total > 0 ORDER BY total DESC LIMIT 5`,
        month
      );
      const income = totals?.income ?? 0;
      const expenses = totals?.expenses ?? 0;
      setData({ income, expenses, balance: income - expenses, recent, categories });
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return { ...data, loading, refresh: load };
}
