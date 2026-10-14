import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Channel, Transaction, TxnType } from '../types';
import { CHANNEL_LABELS } from '../types';
import { addTransaction, deleteTransaction, listCategories, listPaymentMethods, getMeta, knownMerchants, lastCategoryForMerchant, updateTransaction } from '../db';
import { paiseToInput, parseToPaise } from '../lib/money';
import { nowLocal } from '../lib/dates';

interface Props {
  initial?: Transaction;
  onClose: () => void;
}

/** Sensible default channel for a funding source. */
const defaultChannel = (kind?: string): Channel | undefined =>
  kind === 'cash' ? 'cash' : kind === 'credit_card' || kind === 'debit_card' ? 'card' : kind === 'bank_account' ? 'upi' : undefined;

export default function TransactionForm({ initial, onClose }: Props) {
  const methods = useLiveQuery(() => listPaymentMethods(false), []);
  const categories = useLiveQuery(() => listCategories(false), []);
  const merchants = useLiveQuery(knownMerchants, []);

  const [amount, setAmount] = useState(initial ? paiseToInput(initial.amount) : '');
  const [type, setType] = useState<TxnType>(initial?.type ?? 'debit');
  const [occurredAt, setOccurredAt] = useState(initial?.occurredAt ?? nowLocal());
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [channel, setChannel] = useState<Channel | undefined>(initial?.channel);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const categoryTouched = useRef(!!initial);

  // New entry: pre-select the last used payment method.
  useEffect(() => {
    if (initial || !methods) return;
    getMeta<string>('lastPaymentMethodId').then((id) => {
      const pm = methods.find((m) => m.id === id) ?? methods[0];
      if (pm) {
        setPaymentMethodId((cur) => cur || pm.id);
        setChannel((cur) => cur ?? defaultChannel(pm.kind));
      }
    });
  }, [initial, methods]);

  useEffect(() => amountRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const onMerchantChange = async (value: string) => {
    setMerchant(value);
    if (categoryTouched.current) return;
    const cat = await lastCategoryForMerchant(value);
    if (cat) setCategoryId(cat);
  };

  const pickMethod = (id: string) => {
    setPaymentMethodId(id);
    const kind = methods?.find((m) => m.id === id)?.kind;
    if (kind === 'cash') setChannel('cash');
    else if (channel === 'cash' || !channel) setChannel(defaultChannel(kind));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = parseToPaise(amount);
    if (!paise) return setError('Enter a valid amount');
    if (!paymentMethodId) return setError('Choose a payment method');
    if (!categoryId) return setError('Choose a category');
    const data = {
      amount: paise,
      type,
      occurredAt,
      merchant: merchant.trim(),
      paymentMethodId,
      categoryId,
      channel,
      notes: notes.trim() || undefined,
    };
    if (initial) await updateTransaction(initial.id, data);
    else await addTransaction({ ...data, source: 'manual' });
    onClose();
  };

  const remove = async () => {
    if (initial && confirm('Delete this entry?')) {
      await deleteTransaction(initial.id);
      onClose();
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <header className="sheet-head">
          <h2>{initial ? 'Edit entry' : 'Add spend'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="segmented">
          <button type="button" className={type === 'debit' ? 'on' : ''} onClick={() => setType('debit')}>
            Spend
          </button>
          <button type="button" className={type === 'credit' ? 'on' : ''} onClick={() => setType('credit')}>
            Refund / Cashback
          </button>
        </div>

        <label className="amount-input">
          <span>₹</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
          />
        </label>

        <label className="field">
          <span>Where spent</span>
          <input
            list="merchant-list"
            placeholder="e.g. Blinkit, Amazon, Shell petrol pump"
            value={merchant}
            onChange={(e) => onMerchantChange(e.target.value)}
          />
          <datalist id="merchant-list">
            {merchants?.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>

        <div className="field">
          <span>Paid with</span>
          <div className="chips">
            {methods?.map((m) => (
              <button type="button" key={m.id} className={`chip ${paymentMethodId === m.id ? 'on' : ''}`} onClick={() => pickMethod(m.id)}>
                {m.name}
                {m.last4 ? ` ••${m.last4}` : ''}
              </button>
            ))}
          </div>
          {methods?.length === 1 && <small className="hint">Add your cards and bank accounts in Settings.</small>}
        </div>

        <div className="field">
          <span>Via</span>
          <div className="chips">
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
              <button
                type="button"
                key={c}
                className={`chip small ${channel === c ? 'on' : ''}`}
                onClick={() => setChannel(channel === c ? undefined : c)}
              >
                {CHANNEL_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Category</span>
          <div className="chips">
            {categories?.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`chip ${categoryId === c.id ? 'on' : ''}`}
                onClick={() => {
                  categoryTouched.current = true;
                  setCategoryId(c.id);
                }}
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Date &amp; time</span>
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        </label>

        <label className="field">
          <span>Notes</span>
          <textarea rows={2} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="sheet-actions">
          {initial && (
            <button type="button" className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
          <button type="submit" className="btn primary">
            {initial ? 'Save changes' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}
