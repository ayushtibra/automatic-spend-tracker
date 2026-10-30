import { describe, expect, it } from 'vitest';
import { looksLikeBankSms, parseQuickAdd, type QuickAddContext } from './quickAdd';
import type { Category, PaymentMethod } from '../types';

const pm = (id: string, name: string, kind: PaymentMethod['kind'], bank?: string, last4?: string): PaymentMethod => ({
  id, name, kind, bank, last4, createdAt: '', updatedAt: '',
});
const cat = (id: string, name: string): Category => ({ id, name, icon: '', createdAt: '', updatedAt: '' });

const ctx: QuickAddContext = {
  methods: [
    pm('cash', 'Cash', 'cash'),
    pm('hsbc', 'HSBC Credit card', 'credit_card', 'HSBC', '4983'),
    pm('hdfc-cc', 'HDFC Regalia', 'credit_card', 'HDFC', '3348'),
    pm('hdfc-ac', 'HDFC Savings', 'bank_account', 'HDFC', '1201'),
    pm('axis', 'Axis Credit card', 'credit_card', 'Axis', '5105'),
    pm('au', 'AU Bank account', 'bank_account', 'AU', '1102'),
  ],
  categories: ['Groceries', 'Food & Dining', 'Shopping', 'Transport', 'Fuel', 'Travel', 'Bills & Utilities', 'Rent', 'Entertainment', 'Health', 'Other'].map((n) =>
    cat(n.toLowerCase().split(' ')[0], n),
  ),
  merchants: ['Blinkit', 'Chai Point', 'Shell'],
  now: new Date(2026, 9, 23, 18, 30), // Fri 23 Oct 2026, 6:30 pm
};
const q = (text: string) => parseQuickAdd(text, ctx);

describe('parseQuickAdd', () => {
  it('handles the full sentence from the example', () => {
    expect(q('220 spent on groceries at zepto using hsbc credit card for ordering 5 items')).toEqual({
      type: 'debit',
      amount: 22000,
      categoryId: 'groceries',
      merchant: 'Zepto',
      paymentMethodId: 'hsbc',
      channel: 'card',
      notes: 'ordering 5 items',
    });
  });

  it('handles short, any-order phrasing', () => {
    expect(q('zepto 220 groceries hsbc')).toMatchObject({ amount: 22000, merchant: 'Zepto', categoryId: 'groceries', paymentMethodId: 'hsbc' });
    expect(q('₹450 swiggy dinner')).toMatchObject({ amount: 45000, merchant: 'Swiggy', categoryId: 'food' });
    expect(q('Paid 1,250 rupees at Shell for petrol')).toMatchObject({ amount: 125000, merchant: 'Shell', categoryId: 'fuel' });
    expect(q('auto 80 cash')).toMatchObject({ amount: 8000, categoryId: 'transport', paymentMethodId: 'cash', channel: 'cash' });
  });

  it('understands amounts with units', () => {
    expect(q('1.5k on amazon')?.amount).toBe(150000);
    expect(q('rent 2 lakh hdfc account')).toMatchObject({ amount: 20000000, categoryId: 'rent', paymentMethodId: 'hdfc-ac' });
    expect(q('rs 99.50 chai')?.amount).toBe(9950);
    // item counts are not the amount
    expect(q('blinkit 12 items 640')).toMatchObject({ amount: 64000, merchant: 'Blinkit' });
  });

  it('picks the right card by bank, type, nickname or last 4', () => {
    expect(q('500 hdfc credit card')?.paymentMethodId).toBe('hdfc-cc');
    expect(q('500 regalia')?.paymentMethodId).toBe('hdfc-cc');
    expect(q('500 hdfc account')?.paymentMethodId).toBe('hdfc-ac');
    expect(q('500 card ending 5105')?.paymentMethodId).toBe('axis');
    expect(q('500 au bank account upi')).toMatchObject({ paymentMethodId: 'au', channel: 'upi' });
    expect(q('500 from my axis card')).toMatchObject({ paymentMethodId: 'axis', channel: 'card' });
  });

  it('offers to create a card that is not saved yet', () => {
    expect(q('300 icici credit card amazon')).not.toHaveProperty('paymentMethodId');
    expect(q('300 icici credit card amazon')).toMatchObject({
      amount: 30000,
      merchant: 'Amazon',
      newMethod: { bank: 'ICICI', kind: 'credit_card' },
    });
  });

  it('maps UPI apps to UPI payment mode', () => {
    expect(q('paid 60 via gpay for tea')).toMatchObject({ amount: 6000, channel: 'upi', categoryId: 'food' });
    expect(q('phonepe 200 to ramesh hdfc')).toMatchObject({ channel: 'upi', merchant: 'Ramesh', paymentMethodId: 'hdfc-ac' });
  });

  it('understands dates and times', () => {
    expect(q('200 lunch yesterday')?.occurredAt).toBe('2026-10-22T12:00');
    expect(q('200 lunch yesterday 1:30 pm')?.occurredAt).toBe('2026-10-22T13:30');
    expect(q('movie 600 on 18 oct at 9pm')).toMatchObject({ occurredAt: '2026-10-18T21:00', categoryId: 'entertainment', amount: 60000 });
    expect(q('400 dinner last wednesday')?.occurredAt).toBe('2026-10-21T12:00');
    expect(q('100 chai at 8am')).toMatchObject({ occurredAt: '2026-10-23T08:00', amount: 10000 });
    expect(q('flight 5400 on 25 dec')?.occurredAt).toBe('2025-12-25T12:00'); // no future dates
    expect(q('electricity bill 1800')?.occurredAt).toBeUndefined(); // "now" is filled by the form
  });

  it('treats refunds / cashback as credits, not cash', () => {
    expect(q('refund 499 from amazon axis card')).toMatchObject({ type: 'credit', amount: 49900, merchant: 'Amazon', paymentMethodId: 'axis' });
    expect(q('cashback 50 hsbc')).toMatchObject({ type: 'credit', paymentMethodId: 'hsbc' });
  });

  it('keeps notes and multi-word categories clean', () => {
    expect(q('electricity bill 1800 hdfc account')).toEqual({ type: 'debit', categoryId: 'bills', amount: 180000, paymentMethodId: 'hdfc-ac' });
    expect(q('spent 300 for zepto order')).toEqual({ type: 'debit', amount: 30000, merchant: 'Zepto' });
    expect(q('250 at dmart note: monthly stock')).toMatchObject({ merchant: 'Dmart', notes: 'monthly stock' });
  });

  it('returns no amount when none was said', () => {
    expect(q('lunch at chai point')).toEqual({ type: 'debit', merchant: 'Chai Point', categoryId: 'food' });
  });
});

describe('looksLikeBankSms', () => {
  it('tells pasted bank alerts from short notes', () => {
    expect(looksLikeBankSms('HSBC Credit Card xx4983 used at WHITE VENTURES ONLINE PR for INR 126.81 on 14/10/26. Avl limit INR 828439.21')).toBe(true);
    expect(looksLikeBankSms('220 spent on groceries at zepto using hsbc credit card for ordering 5 items')).toBe(false);
  });
});
