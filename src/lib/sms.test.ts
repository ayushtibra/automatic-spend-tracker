import { describe, expect, it } from 'vitest';
import { parseSms } from './sms';

const received = new Date(2026, 9, 14, 18, 30); // 14 Oct 2026, 6:30 pm

describe('parseSms – real bank alerts', () => {
  it('ICICI credit card via UPI', () => {
    const p = parseSms(
      'ICICI Bank Credit Card XX6003 debited for INR 881.60 on 28-Jun-26 for UPI-654530294458-Bookmysh. To dispute call 18001080/SMS BLOCK 6003 to 9215676766',
      received,
    );
    expect(p).toMatchObject({
      type: 'debit',
      amount: 88160,
      bank: 'ICICI',
      last4: '6003',
      accountKind: 'credit_card',
      merchant: 'BookMyShow',
      occurredAt: '2026-06-28T12:00',
      channel: 'upi',
      ref: '654530294458',
      likelyTransfer: false,
    });
  });

  it('HDFC card via UPI, multi-line, date without year', () => {
    const p = parseSms(
      `Txn Rs.70.00
On HDFC Bank Card 3348
At rapido522347.rzp@rxaxis
by UPI 193534679133
On 02-10
Not You?
Call 18002586161/SMS BLOCK CC 3348 to 7308080808`,
      received,
    );
    expect(p).toMatchObject({
      type: 'debit',
      amount: 7000,
      bank: 'HDFC',
      last4: '3348',
      accountKind: 'credit_card',
      merchant: 'Rapido',
      occurredAt: '2026-10-02T12:00',
      channel: 'upi',
      ref: '193534679133',
    });
  });

  it('Axis card, merchant on its own line, ignores available limit', () => {
    const p = parseSms(
      `Spent INR 919
Axis Bank Card no. XX5105
12-10-26 13:29:25 IST
FLIPKART GR
Avl Limit: INR 49174
Not you? SMS BLOCK 5105 to 919951860002`,
      received,
    );
    expect(p).toMatchObject({
      type: 'debit',
      amount: 91900,
      bank: 'Axis',
      last4: '5105',
      accountKind: 'credit_card',
      merchant: 'Flipkart Grocery',
      occurredAt: '2026-10-12T13:29',
      channel: 'card',
    });
  });

  it('HSBC credit card, ignores limit and due amounts', () => {
    const p = parseSms(
      'HSBC Credit Card xx4983 used at WHITE VENTURES ONLINE PR for INR 126.81 on 14/10/26. Avl limit INR 828439.21; due INR 11560.79. Call +914065118002 to report fraud.',
      received,
    );
    expect(p).toMatchObject({
      type: 'debit',
      amount: 12681,
      bank: 'HSBC',
      last4: '4983',
      merchant: 'White Ventures Online Pr',
      occurredAt: '2026-10-14T18:30',
      channel: 'card',
    });
  });

  it('AU account RTGS debit is flagged as a likely transfer', () => {
    const p = parseSms(
      `Dr INR 20,00,000.00 - AU A/c X1102 14-OCT-2026
RTGS DR-AUBLR62026101428481923 -ayush un
Bal INR 15,00,130.58
Fraud? Call 180012001200/SMS BLOCK <CUSTID> to 5676767`,
      received,
    );
    expect(p).toMatchObject({
      type: 'debit',
      amount: 200000000,
      bank: 'AU',
      last4: '1102',
      accountKind: 'bank_account',
      merchant: 'Ayush Un',
      occurredAt: '2026-10-14T18:30',
      channel: 'netbanking',
      ref: 'AUBLR62026101428481923',
      likelyTransfer: true,
    });
  });
});

describe('parseSms – non-transactions and edge cases', () => {
  it('ignores OTPs, reminders and bill payment acknowledgements', () => {
    expect(parseSms('123456 is your OTP for txn of INR 500 at Amazon on HDFC Card 3348')).toBeNull();
    expect(parseSms('Your HSBC Credit Card xx4983 payment of INR 11560.79 is due on 20/10/26')).toBeNull();
    expect(parseSms('Payment of Rs 5,000 has been received towards your ICICI Credit Card XX6003')).toBeNull();
    expect(parseSms('Hi! Your Swiggy order is on the way')).toBeNull();
  });

  it('parses refunds as credits', () => {
    const p = parseSms('INR 499.00 refunded to your Axis Bank Card XX5105 by AMAZON on 13-10-26');
    expect(p).toMatchObject({ type: 'credit', amount: 49900, last4: '5105' });
  });

  it('puts a no-year date that is in the future into last year', () => {
    const p = parseSms('Txn Rs.100.00 On HDFC Bank Card 3348 At swiggy@icici by UPI 123456789012 On 31-12', new Date(2027, 0, 1, 9, 0));
    expect(p?.occurredAt).toBe('2026-12-31T12:00');
    expect(p?.merchant).toBe('Swiggy');
  });
});

describe('categorize', () => {
  it('maps merchants to default categories', async () => {
    const { suggestCategoryName } = await import('./categorize');
    expect(suggestCategoryName('Flipkart Grocery')).toBe('Groceries');
    expect(suggestCategoryName('Flipkart')).toBe('Shopping');
    expect(suggestCategoryName('BookMyShow')).toBe('Entertainment');
    expect(suggestCategoryName('Rapido')).toBe('Transport');
    expect(suggestCategoryName('White Ventures Online Pr')).toBeUndefined();
  });
});

describe('parseSms – single-line delivery', () => {
  it('finds the Axis merchant when the SMS arrives flattened to one line', () => {
    const p = parseSms(
      'Spent INR 919 Axis Bank Card no. XX5105 12-10-26 13:29:25 IST FLIPKART GR Avl Limit: INR 49174 Not you? SMS BLOCK 5105 to 919951860002',
      received,
    );
    expect(p).toMatchObject({ amount: 91900, last4: '5105', merchant: 'Flipkart Grocery', occurredAt: '2026-10-12T13:29' });
  });
});
