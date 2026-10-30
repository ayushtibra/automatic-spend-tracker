import Dexie, { type EntityTable } from 'dexie';
import type { Category, InboxItem, PaymentMethod, Transaction } from './types';
import { KIND_LABELS } from './types';
import { isoNow, newId } from './lib/id';
import { suggestCategoryName } from './lib/categorize';
import { parseSms, type ParsedSms } from './lib/sms';
import { nowLocal } from './lib/dates';

interface Meta {
  key: string;
  value: unknown;
}

export class SpendDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  paymentMethods!: EntityTable<PaymentMethod, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  meta!: EntityTable<Meta, 'key'>;
  inbox!: EntityTable<InboxItem, 'id'>;

  constructor(name = 'spend-tracker') {
    super(name);
    this.version(1).stores({
      transactions: 'id, occurredAt, categoryId, paymentMethodId, merchant, updatedAt',
      paymentMethods: 'id, kind',
      categories: 'id, name',
      meta: 'key',
    });
    this.version(2).stores({ inbox: 'id, status, receivedAt' });
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

export async function savePaymentMethod(pm: Omit<PaymentMethod, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<string> {
  const now = isoNow();
  if (pm.id) {
    await db.paymentMethods.update(pm.id, { ...pm, updatedAt: now });
    return pm.id;
  }
  const id = newId();
  await db.paymentMethods.add({ ...pm, id, createdAt: now, updatedAt: now });
  return id;
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

// ---------- SMS helpers ----------

/** Find the card/account an alert refers to: by last 4 digits, preferring the same bank. */
export async function findPaymentMethodByLast4(last4?: string, bank?: string) {
  if (!last4) return undefined;
  const matches = (await db.paymentMethods.toArray()).filter((m) => m.last4 === last4 && !m.archived);
  return matches.find((m) => bank && m.bank?.toLowerCase().includes(bank.toLowerCase())) ?? matches[0];
}

/** An existing entry with the same amount, card/account and day — likely the same spend logged twice. */
export async function findPossibleDuplicate(amount: number, paymentMethodId: string, occurredAt: string, excludeId?: string) {
  const day = occurredAt.slice(0, 10);
  const rows = await db.transactions.where('occurredAt').startsWith(day).toArray();
  return rows.find((t) => !t.deletedAt && t.id !== excludeId && t.amount === amount && t.paymentMethodId === paymentMethodId);
}

/** Category for a merchant: what you used last time, else a keyword-based guess. */
export async function suggestCategoryId(merchant: string) {
  const fromHistory = await lastCategoryForMerchant(merchant);
  if (fromHistory) return fromHistory;
  const name = suggestCategoryName(merchant);
  if (!name) return undefined;
  return (await db.categories.toArray()).find((c) => c.name === name && !c.archived)?.id;
}

// ---------- SMS inbox ----------

export interface SmsResolution {
  parsed: ParsedSms;
  occurredAt: string;
  paymentMethodId?: string;
  categoryId?: string;
  duplicate?: Transaction;
  /** Card/account known (or new, identified by last 4 digits), category found, not a duplicate or transfer: safe to add in one tap. */
  ready: boolean;
}

/** Parse an SMS and match it against your cards, category history and existing entries. */
export async function resolveSms(body: string, receivedAt: number): Promise<SmsResolution | null> {
  const parsed = parseSms(body, new Date(receivedAt));
  if (!parsed) return null;
  const occurredAt = parsed.occurredAt ?? nowLocal(new Date(receivedAt));
  const pm = await findPaymentMethodByLast4(parsed.last4, parsed.bank);
  const categoryId = parsed.merchant ? await suggestCategoryId(parsed.merchant) : undefined;
  const duplicate = pm ? await findPossibleDuplicate(parsed.amount, pm.id, occurredAt) : undefined;
  return {
    parsed,
    occurredAt,
    paymentMethodId: pm?.id,
    categoryId,
    duplicate,
    ready: (!!pm || !!parsed.last4) && !!categoryId && !duplicate && !parsed.likelyTransfer,
  };
}

/** One-tap add of an inbox item whose card and category are known. */
export async function addFromInbox(item: InboxItem): Promise<boolean> {
  const r = await resolveSms(item.body, item.receivedAt);
  if (!r?.categoryId || (!r.paymentMethodId && !r.parsed.last4)) return false;
  // A card/account seen for the first time is added to the list, like "Add it" in the form.
  const paymentMethodId =
    r.paymentMethodId ??
    (await savePaymentMethod({
      name: [r.parsed.bank, KIND_LABELS[r.parsed.accountKind ?? 'credit_card']].filter(Boolean).join(' '),
      kind: r.parsed.accountKind ?? 'credit_card',
      bank: r.parsed.bank,
      last4: r.parsed.last4,
    }));
  const id = await addTransaction({
    amount: r.parsed.amount,
    type: r.parsed.type,
    occurredAt: r.occurredAt,
    merchant: r.parsed.merchant ?? '',
    paymentMethodId,
    categoryId: r.categoryId,
    channel: r.parsed.channel,
    source: 'sms',
    sourceRef: item.body.trim(),
  });
  await setInboxStatus(item.id, 'added', id);
  return true;
}

export async function setInboxStatus(id: string, status: InboxItem['status'], txnId?: string) {
  await db.inbox.update(id, { status, txnId });
}

export async function pendingInbox(): Promise<InboxItem[]> {
  const rows = await db.inbox.where('status').equals('pending').toArray();
  return rows.sort((a, b) => b.receivedAt - a.receivedAt);
}
