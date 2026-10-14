import type { Transaction } from '../types';

/** Signed contribution to spend: debits add, credits (refunds/cashback) subtract. */
export const signed = (t: Pick<Transaction, 'amount' | 'type'>) => (t.type === 'credit' ? -t.amount : t.amount);

export function totalSpent(txns: Transaction[]): number {
  return txns.reduce((sum, t) => sum + signed(t), 0);
}

/** Net spend grouped by a key, sorted by spend descending. */
export function spendBy(txns: Transaction[], key: (t: Transaction) => string): [string, number][] {
  const totals = new Map<string, number>();
  for (const t of txns) totals.set(key(t), (totals.get(key(t)) ?? 0) + signed(t));
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

/** Net spend per day of month, index 0 = day 1. */
export function dailySpend(txns: Transaction[], days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const t of txns) {
    const day = Number(t.occurredAt.slice(8, 10));
    if (day >= 1 && day <= days) out[day - 1] += signed(t);
  }
  return out;
}

/** Group transactions (already sorted newest first) by 'YYYY-MM-DD'. */
export function groupByDay(txns: Transaction[]): { day: string; total: number; items: Transaction[] }[] {
  const groups: { day: string; total: number; items: Transaction[] }[] = [];
  for (const t of txns) {
    const day = t.occurredAt.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, total: 0, items: [] }));
    g.items.push(t);
    g.total += signed(t);
  }
  return groups;
}
