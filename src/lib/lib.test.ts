import { describe, expect, it } from 'vitest';
import { formatINR, parseToPaise } from './money';
import { dailySpend, groupByDay, spendBy, totalSpent } from './stats';
import { toCSV, parseBackup } from './export';
import { shiftMonth } from './dates';
import type { Transaction } from '../types';

const txn = (p: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(),
  amount: 10000,
  type: 'debit',
  occurredAt: '2026-10-14T10:00',
  merchant: 'Blinkit',
  paymentMethodId: 'hdfc',
  categoryId: 'groceries',
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('money', () => {
  it('parses rupee inputs to paise', () => {
    expect(parseToPaise('250')).toBe(25000);
    expect(parseToPaise('₹ 1,234.5')).toBe(123450);
    expect(parseToPaise('Rs.99.99')).toBe(9999);
    expect(parseToPaise('12.345')).toBeNull();
    expect(parseToPaise('abc')).toBeNull();
    expect(parseToPaise('')).toBeNull();
  });
  it('formats in Indian grouping', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(12350)).toBe('₹123.50');
  });
});

describe('stats', () => {
  const txns = [
    txn({ amount: 50000, paymentMethodId: 'hdfc', occurredAt: '2026-10-14T09:00' }),
    txn({ amount: 20000, paymentMethodId: 'axis', categoryId: 'food', occurredAt: '2026-10-02T09:00' }),
    txn({ amount: 5000, type: 'credit', paymentMethodId: 'hdfc', occurredAt: '2026-10-14T08:00' }),
  ];
  it('nets refunds against spend', () => {
    expect(totalSpent(txns)).toBe(65000);
    expect(spendBy(txns, (t) => t.paymentMethodId)).toEqual([['hdfc', 45000], ['axis', 20000]]);
  });
  it('builds daily series and day groups', () => {
    const daily = dailySpend(txns, 31);
    expect(daily[13]).toBe(45000);
    expect(daily[1]).toBe(20000);
    const groups = groupByDay(txns);
    expect(groups.map((g) => [g.day, g.items.length])).toEqual([['2026-10-14', 1], ['2026-10-02', 1], ['2026-10-14', 1]]);
  });
});

describe('export', () => {
  it('escapes CSV cells and signs refunds', () => {
    const csv = toCSV(
      [txn({ merchant: 'Cafe, "Bombay"', notes: 'line1\nline2' }), txn({ type: 'credit', amount: 999 })],
      [{ id: 'hdfc', name: 'HDFC Regalia', kind: 'credit_card', createdAt: '', updatedAt: '' }],
      [{ id: 'groceries', name: 'Groceries', icon: '🛒', createdAt: '', updatedAt: '' }],
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('2026-10-14,10:00,100.00,Spend,"Cafe, ""Bombay""",Groceries,HDFC Regalia,,"line1\nline2",manual');
    expect(lines[2]).toContain('-9.99,Refund/Credit');
  });
  it('rejects non-backup JSON', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow();
  });
});

describe('dates', () => {
  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
