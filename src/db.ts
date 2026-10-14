import Dexie, { type EntityTable } from 'dexie';
import type { Category, PaymentMethod, Transaction } from './types';
import { isoNow, newId } from './lib/id';

interface Meta {
  key: string;
  value: unknown;
}

export class SpendDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  paymentMethods!: EntityTable<PaymentMethod, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(name = 'spend-tracker') {
    super(name);
    this.version(1).stores({
      transactions: 'id, occurredAt, categoryId, paymentMethodId, merchant, updatedAt',
      paymentMethods: 'id, kind',
      categories: 'id, name',
      meta: 'key',
    });
    this.on('populate', (tx) => seed(tx.table('categories'), tx.table('paymentMethods')));
  }
}

const DEFAULT_CATEGORIES: [string, string][] = [
  ['🛒', 'Groceries'],
  ['🍔', 'Food & Dining'],
  ['🛍️', 'Shopping'],
  ['🚕', 'Transport'],
  ['⛽', 'Fuel'],
  ['✈️', 'Travel'],
  ['💡', 'Bills & Utilities'],
  ['🏠', 'Rent'],
  ['🎬', 'Entertainment'],
  ['📺', 'Subscriptions'],
  ['💊', 'Health'],
  ['💇', 'Personal Care'],
  ['📚', 'Education'],
  ['🎁', 'Gifts'],
  ['📦', 'Other'],
];

async function seed(categories: Dexie.Table, paymentMethods: Dexie.Table) {
  const now = isoNow();
  await categories.bulkAdd(
    DEFAULT_CATEGORIES.map(([icon, name]) => ({ id: newId(), icon, name, createdAt: now, updatedAt: now })),
  );
  await paymentMethods.add({ id: newId(), name: 'Cash', kind: 'cash', createdAt: now, updatedAt: now });
}

export const db = new SpendDB();

// ---------- Transactions ----------

export type TransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function addTransaction(input: TransactionInput): Promise<string> {
  const now = isoNow();
  const id = newId();
  await db.transactions.add({ ...input, id, createdAt: now, updatedAt: now });
  await setMeta('lastPaymentMethodId', input.paymentMethodId);
  return id;
}

export async function updateTransaction(id: string, changes: Partial<TransactionInput>) {
  await db.transactions.update(id, { ...changes, updatedAt: isoNow() });
}

export async function deleteTransaction(id: string) {
  const now = isoNow();
  await db.transactions.update(id, { deletedAt: now, updatedAt: now });
}

/** Live (non-deleted) transactions whose occurredAt starts with the given prefix ('YYYY-MM' or '' for all). */
export async function transactionsFor(prefix: string): Promise<Transaction[]> {
  const coll = prefix
    ? db.transactions.where('occurredAt').startsWith(prefix)
    : db.transactions.orderBy('occurredAt');
  const rows = await coll.filter((t) => !t.deletedAt).toArray();
  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
}

/** Category last used for this merchant, to pre-fill the form. */
export async function lastCategoryForMerchant(merchant: string): Promise<string | undefined> {
  const name = merchant.trim().toLowerCase();
  if (!name) return undefined;
  const matches = await db.transactions.filter((t) => !t.deletedAt && t.merchant.toLowerCase() === name).toArray();
  matches.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return matches[0]?.categoryId;
}

export async function knownMerchants(): Promise<string[]> {
  const counts = new Map<string, number>();
  await db.transactions.each((t) => {
    if (!t.deletedAt && t.merchant) counts.set(t.merchant, (counts.get(t.merchant) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

// ---------- Payment methods & categories ----------

export async function savePaymentMethod(pm: Omit<PaymentMethod, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = isoNow();
  if (pm.id) await db.paymentMethods.update(pm.id, { ...pm, updatedAt: now });
  else await db.paymentMethods.add({ ...pm, id: newId(), createdAt: now, updatedAt: now });
}

export async function saveCategory(cat: Omit<Category, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = isoNow();
  if (cat.id) await db.categories.update(cat.id, { ...cat, updatedAt: now });
  else await db.categories.add({ ...cat, id: newId(), createdAt: now, updatedAt: now });
}

// ---------- Meta (settings) ----------

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

// ---------- Live lists (sorted for display) ----------

/** Categories A–Z with 'Other' last. */
export async function listCategories(includeArchived = true) {
  const rows = await db.categories.toArray();
  return rows
    .filter((c) => includeArchived || !c.archived)
    .sort((a, b) => Number(a.name === 'Other') - Number(b.name === 'Other') || a.name.localeCompare(b.name));
}

/** Cards and accounts A–Z with Cash last. */
export async function listPaymentMethods(includeArchived = true) {
  const rows = await db.paymentMethods.toArray();
  return rows
    .filter((m) => includeArchived || !m.archived)
    .sort((a, b) => Number(a.kind === 'cash') - Number(b.kind === 'cash') || a.name.localeCompare(b.name));
}
