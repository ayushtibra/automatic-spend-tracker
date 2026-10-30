import type { Category, PaymentMethod, Transaction } from '../types';
import { CHANNEL_LABELS } from '../types';

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV that opens cleanly in Google Sheets / Excel. Amounts are signed rupees (refunds negative). */
export function toCSV(txns: Transaction[], methods: PaymentMethod[], categories: Category[]): string {
  const pm = new Map(methods.map((m) => [m.id, m.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const header = ['Date', 'Time', 'Amount', 'Type', 'Where spent', 'Category', 'Payment method', 'Channel', 'Notes', 'Source'];
  const rows = txns.map((t) => [
    t.occurredAt.slice(0, 10),
    t.occurredAt.slice(11, 16),
    ((t.type === 'credit' ? -t.amount : t.amount) / 100).toFixed(2),
    t.type === 'credit' ? 'Refund/Credit' : 'Spend',
    t.merchant,
    cat.get(t.categoryId) ?? '',
    pm.get(t.paymentMethodId) ?? '',
    t.channel ? CHANNEL_LABELS[t.channel] : '',
    t.notes ?? '',
    t.source,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export interface Backup {
  app: 'spend-tracker';
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  paymentMethods: PaymentMethod[];
  categories: Category[];
}

export function parseBackup(text: string): Backup {
  const data = JSON.parse(text);
  if (data?.app !== 'spend-tracker' || !Array.isArray(data.transactions)) {
    throw new Error('Not a Spend Tracker backup file');
  }
  return data as Backup;
}

/** Save a file: browser download on the web, Android share sheet (Drive, Files, WhatsApp…) in the app. */
export async function downloadFile(filename: string, content: string, mime: string) {
  const { isNative, SmsInbox } = await import('../native/smsInbox');
  if (isNative) {
    await SmsInbox.shareFile({ filename, content, mime });
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
