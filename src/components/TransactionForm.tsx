import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Channel, PaymentMethodKind, Transaction, TxnSource, TxnType } from '../types';
import { CHANNEL_LABELS, KIND_LABELS } from '../types';
import {
  addTransaction,
  deleteTransaction,
  findPaymentMethodByLast4,
  findPossibleDuplicate,
  getMeta,
  knownMerchants,
  listCategories,
  listPaymentMethods,
  savePaymentMethod,
  suggestCategoryId,
  updateTransaction,
} from '../db';
import { formatINR, paiseToInput, parseToPaise } from '../lib/money';
import { dayLabel, nowLocal, timeLabel } from '../lib/dates';
import { parseSms } from '../lib/sms';
import { looksLikeBankSms, parseQuickAdd } from '../lib/quickAdd';
import QuickAddBar from './QuickAddBar';

interface Props {
  initial?: Transaction;
  /** Text to pre-fill a new entry from: a bank SMS (Inbox, share) or a typed / spoken quick add. */
  initialText?: string;
  /** When the SMS was received (epoch ms); used for alerts that carry no date or time. */
  smsReceivedAt?: number;
  /** Called with the transaction id after a successful save. */
  onSaved?: (id: string) => void;
  onClose: () => void;
}

type MissingMethod = { bank?: string; last4?: string; kind: PaymentMethodKind };

/** Sensible default channel for a funding source. */
const defaultChannel = (kind?: string): Channel | undefined =>
  kind === 'cash' ? 'cash' : kind === 'credit_card' || kind === 'debit_card' ? 'card' : kind === 'bank_account' ? 'upi' : undefined;

export default function TransactionForm({ initial, initialText, smsReceivedAt, onSaved, onClose }: Props) {
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
  const [source, setSource] = useState<TxnSource>(initial?.source ?? 'manual');
  const [sourceRef, setSourceRef] = useState(initial?.sourceRef);
  const [fillInfo, setFillInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const [missingMethod, setMissingMethod] = useState<MissingMethod | null>(null);
  const [duplicate, setDuplicate] = useState<Transaction>();
  const amountRef = useRef<HTMLInputElement>(null);
  const categoryTouched = useRef(!!initial);
  /** Once an SMS / quick add chose the card, never fall back to the last-used one. */
  const fromSms = useRef(false);

  // New entry: pre-select the last used payment method.
  useEffect(() => {
    if (initial || fromSms.current || !methods) return;
    getMeta<string>('lastPaymentMethodId').then((id) => {
      if (fromSms.current) return;
      const pm = methods.find((m) => m.id === id) ?? methods[0];
      if (pm) {
        setPaymentMethodId((cur) => cur || pm.id);
        setChannel((cur) => cur ?? defaultChannel(pm.kind));
      }
    });
  }, [initial, methods]);

  useEffect(() => {
    if (initialText) applyText(initialText);
    else amountRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn when the same amount on the same card/account was already logged that day.
  useEffect(() => {
    const paise = parseToPaise(amount);
    if (!paise || !paymentMethodId) return setDuplicate(undefined);
    let live = true;
    findPossibleDuplicate(paise, paymentMethodId, occurredAt, initial?.id).then((d) => live && setDuplicate(d));
    return () => {
      live = false;
    };
  }, [amount, paymentMethodId, occurredAt, initial?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const onMerchantChange = async (value: string) => {
    setMerchant(value);
    if (categoryTouched.current) return;
    const cat = await suggestCategoryId(value);
    if (cat) setCategoryId(cat);
  };

  const applySms = async (text: string) => {
    const parsed = parseSms(text, smsReceivedAt ? new Date(smsReceivedAt) : undefined);
    if (!parsed) {
      setFillInfo({ ok: false, text: "Couldn't find a completed transaction in this message. Fill in the details manually." });
      return;
    }
    setAmount(paiseToInput(parsed.amount));
    setType(parsed.type);
    if (parsed.occurredAt) setOccurredAt(parsed.occurredAt);
    if (parsed.merchant) setMerchant(parsed.merchant);
    if (parsed.channel) setChannel(parsed.channel);
    fromSms.current = true;
    setSource('sms');
    setSourceRef(text.trim());

    const pm = await findPaymentMethodByLast4(parsed.last4, parsed.bank);
    setMissingMethod(null);
    if (pm) setPaymentMethodId(pm.id);
    else if (parsed.last4) {
      setPaymentMethodId('');
      setMissingMethod({ bank: parsed.bank, last4: parsed.last4, kind: parsed.accountKind ?? 'credit_card' });
    }

    if (parsed.merchant && !categoryTouched.current) {
      const cat = await suggestCategoryId(parsed.merchant);
      if (cat) setCategoryId(cat);
    }

    const what = [parsed.bank, parsed.last4 && `••${parsed.last4}`].filter(Boolean).join(' ') || 'SMS';
    setFillInfo({
      ok: true,
      text: parsed.likelyTransfer
        ? `Filled from ${what}. This looks like a bank transfer (RTGS/NEFT/IMPS), not a spend. Save only if it really was one.`
        : `Filled from ${what}. Check the details and the category.`,
    });
  };

  /** Typed or spoken: "220 spent on groceries at zepto using hsbc credit card". */
  const applyQuick = async (text: string) => {
    const [pms, cats, known] = await Promise.all([listPaymentMethods(false), listCategories(false), knownMerchants()]);
    const r = parseQuickAdd(text, { methods: pms, categories: cats, merchants: known });
    if (r.amount) setAmount(paiseToInput(r.amount));
    setType(r.type);
    if (r.occurredAt) setOccurredAt(r.occurredAt);
    if (r.merchant) setMerchant(r.merchant);
    if (r.notes) setNotes(r.notes);

    setMissingMethod(null);
    if (r.paymentMethodId || r.newMethod) {
      fromSms.current = true;
      setPaymentMethodId(r.paymentMethodId ?? '');
      if (r.newMethod) setMissingMethod(r.newMethod);
    }
    const kind = pms.find((p) => p.id === r.paymentMethodId)?.kind ?? r.newMethod?.kind;
    const mode = r.channel ?? defaultChannel(kind);
    if (mode) setChannel(mode);

    // A category you said beats one guessed from the merchant.
    let cat = r.categoryId;
    if (cat) categoryTouched.current = true;
    else if (r.merchant && !categoryTouched.current) cat = await suggestCategoryId(r.merchant);
    if (cat) setCategoryId(cat);

    const missing = [!r.amount && 'amount', !cat && 'category'].filter(Boolean);
    setFillInfo({
      ok: missing.length === 0,
      text:
        `Filled from “${text}”. ` +
        (missing.length ? `Didn't catch the ${missing.join(' or ')}; please fill it in.` : 'Check the details and tap Add.') +
        (!r.paymentMethodId && !r.newMethod ? ' No card mentioned, so your last-used one is selected.' : ''),
    });
    if (!r.amount) amountRef.current?.focus();
  };

  /** A pasted / shared bank alert goes to the SMS parser; anything else is a quick add. */
  const applyText = (text: string) =>
    smsReceivedAt !== undefined || (looksLikeBankSms(text) && parseSms(text)) ? applySms(text) : applyQuick(text);

  const newMethodName = (m: MissingMethod) => [m.bank, KIND_LABELS[m.kind]].filter(Boolean).join(' ');

  /** Save the card/account named in the SMS / quick add (selected by default) to the user's list. */
  const createMissingMethod = async (m: MissingMethod) => {
    const id = await savePaymentMethod({ name: newMethodName(m), kind: m.kind, bank: m.bank, last4: m.last4 });
    setPaymentMethodId(id);
    setMissingMethod(null);
    return id;
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
    if (!paymentMethodId && !missingMethod) return setError('Choose which card or account you paid from');
    if (!categoryId) return setError('Choose a category');
    // The new card from the SMS is selected by default: add it to the list now.
    const pmId = paymentMethodId || (await createMissingMethod(missingMethod!));
    const data = {
      amount: paise,
      type,
      occurredAt,
      merchant: merchant.trim(),
      paymentMethodId: pmId,
      categoryId,
      channel,
      notes: notes.trim() || undefined,
    };
    let id = initial?.id;
    if (initial) await updateTransaction(initial.id, data);
    else id = await addTransaction({ ...data, source, sourceRef });
    if (id) onSaved?.(id);
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

        {!initial && !initialText && <QuickAddBar onSubmit={applyText} />}
        {fillInfo && <p className={`notice ${fillInfo.ok ? '' : 'warn'}`}>{fillInfo.text}</p>}

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
          <span>Card / account</span>
          <div className="chips">
            {missingMethod && (
              <button type="button" className={`chip new ${!paymentMethodId ? 'on' : ''}`} onClick={() => setPaymentMethodId('')}>
                ＋ {newMethodName(missingMethod)}
                {missingMethod.last4 ? ` ••${missingMethod.last4}` : ''}
              </button>
            )}
            {methods?.map((m) => (
              <button type="button" key={m.id} className={`chip ${paymentMethodId === m.id ? 'on' : ''}`} onClick={() => pickMethod(m.id)}>
                {m.name}
                {m.last4 ? ` ••${m.last4}` : ''}
              </button>
            ))}
          </div>
          {missingMethod && !paymentMethodId && (
            <small className="hint">New card. It's added to Cards &amp; accounts when you save.</small>
          )}
          {methods?.length === 1 && !missingMethod && <small className="hint">Add your cards and bank accounts in Settings.</small>}
        </div>

        <div className="field">
          <span>Payment mode</span>
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

        {sourceRef && (
          <details className="raw-sms">
            <summary>Original SMS</summary>
            <pre>{sourceRef}</pre>
          </details>
        )}

        {duplicate && (
          <p className="notice warn">
            Possible duplicate: {duplicate.merchant || 'an entry'} {formatINR(duplicate.amount)} on {dayLabel(duplicate.occurredAt.slice(0, 10))},{' '}
            {timeLabel(duplicate.occurredAt)} is already logged with the same card / account.
          </p>
        )}

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
