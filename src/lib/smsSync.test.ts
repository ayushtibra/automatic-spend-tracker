import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addTransaction, db, pendingInbox, resolveSms, savePaymentMethod, addFromInbox, setInboxStatusBulk } from '../db';
import { ingestSms, smsId } from './smsSync';

const AXIS = `Spent INR 919
Axis Bank Card no. XX5105
12-10-26 13:29:25 IST
FLIPKART GR
Avl Limit: INR 49174
Not you? SMS BLOCK 5105 to 919951860002`;
const at = new Date(2026, 9, 12, 13, 30).getTime();

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('sms inbox', () => {
  it('stores each bank SMS once, ignoring sender prefix and non-transactions', async () => {
    expect(smsId('AX-AXISBK', AXIS)).toBe(smsId('JD-AXISBK', AXIS));
    const added = await ingestSms([
      { id: 'live-1', address: 'AX-AXISBK', body: AXIS, date: at },
      { id: '42', address: 'JD-AXISBK', body: AXIS, date: at + 500 },
      { id: '43', address: 'VM-HDFCBK', body: '123456 is your OTP for txn of INR 500', date: at },
    ]);
    expect(added).toBe(1);
    expect(await pendingInbox()).toHaveLength(1);
  });

  it('skips SMS that were already logged by pasting', async () => {
    const pm = await savePaymentMethod({ name: 'Axis CC', kind: 'credit_card', bank: 'Axis', last4: '5105' });
    const cat = (await db.categories.toArray())[0];
    await addTransaction({ amount: 91900, type: 'debit', occurredAt: '2026-10-12T13:29', merchant: 'Flipkart', paymentMethodId: pm, categoryId: cat.id, source: 'sms', sourceRef: AXIS });
    expect(await ingestSms([{ id: '1', address: 'AX-AXISBK', body: AXIS, date: at }])).toBe(0);
  });

  it('resolves card + category and adds in one tap; then flags the duplicate', async () => {
    await savePaymentMethod({ name: 'Axis CC', kind: 'credit_card', bank: 'Axis', last4: '5105' });
    await ingestSms([{ id: '1', address: 'AX-AXISBK', body: AXIS, date: at }]);
    const [item] = await pendingInbox();
    const r = await resolveSms(item.body, item.receivedAt);
    expect(r?.ready).toBe(true);
    expect(await addFromInbox(item)).toBe(true);
    expect(await pendingInbox()).toHaveLength(0);
    const txns = await db.transactions.toArray();
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ amount: 91900, merchant: 'Flipkart Grocery', source: 'sms', occurredAt: '2026-10-12T13:29' });
    // The same spend arriving again (e.g. from another alert) is now a duplicate, not "ready".
    expect((await resolveSms(AXIS.replace('FLIPKART GR', 'FLIPKART'), at))?.duplicate).toBeTruthy();
  });

  it('adds an SMS from a new card in one tap, creating the card once', async () => {
    const r = await resolveSms(AXIS, at);
    expect(r).toMatchObject({ ready: true, paymentMethodId: undefined });
    await ingestSms([
      { id: '1', address: 'AX-AXISBK', body: AXIS, date: at },
      { id: '2', address: 'AX-AXISBK', body: AXIS.replace('919', '250').replace('FLIPKART GR', 'ZEPTO'), date: at },
    ]);
    for (const item of await pendingInbox()) expect(await addFromInbox(item)).toBe(true);
    const cards = (await db.paymentMethods.toArray()).filter((m) => m.last4 === '5105');
    expect(cards).toMatchObject([{ name: 'Axis Credit card', kind: 'credit_card', bank: 'Axis' }]);
    expect((await db.transactions.toArray()).every((t) => t.paymentMethodId === cards[0].id)).toBe(true);
  });

  it('is not ready without a category or for a likely transfer', async () => {
    expect((await resolveSms(AXIS.replace('FLIPKART GR', 'WHITE VENTURES'), at))?.ready).toBe(false);
    const au = 'Dr INR 5,000.00 - AU A/c X1102 14-OCT-2026\nRTGS DR-AUBLR62026101428481923 -ayush un\nBal INR 1,000.00';
    expect((await resolveSms(au, at))?.ready).toBe(false);
  });
});

describe('dismiss all', () => {
  it('dismisses every pending item and can undo it', async () => {
    await ingestSms([
      { id: '1', address: 'AX-AXISBK', body: AXIS, date: at },
      { id: '2', address: 'AX-AXISBK', body: AXIS.replace('919', '250'), date: at },
      { id: '3', address: 'AX-AXISBK', body: AXIS.replace('919', '75'), date: at },
    ]);
    const ids = (await pendingInbox()).map((i) => i.id);
    expect(ids).toHaveLength(3);
    await setInboxStatusBulk(ids, 'dismissed');
    expect(await pendingInbox()).toHaveLength(0);
    // Dismissed SMS are remembered, so a later inbox scan doesn't bring them back.
    expect(await ingestSms([{ id: '1', address: 'AX-AXISBK', body: AXIS, date: at }])).toBe(0);
    await setInboxStatusBulk(ids, 'pending');
    expect(await pendingInbox()).toHaveLength(3);
  });
});
