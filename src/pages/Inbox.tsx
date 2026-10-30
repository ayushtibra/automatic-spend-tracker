import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { InboxItem } from '../types';
import { KIND_LABELS } from '../types';
import { addFromInbox, listCategories, listPaymentMethods, pendingInbox, resolveSms, setInboxStatus, setInboxStatusBulk } from '../db';
import { formatINR } from '../lib/money';
import { dayLabel, timeLabel } from '../lib/dates';
import { isSmsCaptureEnabled, syncSms } from '../lib/smsSync';
import { isNative, SmsInbox } from '../native/smsInbox';

interface Props {
  onReview: (item: InboxItem) => void;
  onOpenSettings: () => void;
}

export default function Inbox({ onReview, onOpenSettings }: Props) {
  const enabled = useLiveQuery(isSmsCaptureEnabled, []);
  const methods = useLiveQuery(() => listPaymentMethods(), []);
  const categories = useLiveQuery(() => listCategories(), []);
  // Re-resolves whenever inbox, transactions, cards or categories change.
  const rows = useLiveQuery(async () => {
    const items = await pendingInbox();
    return Promise.all(items.map(async (item) => ({ item, r: await resolveSms(item.body, item.receivedAt) })));
  }, []);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  /** Ids from the last "Dismiss all", kept so it can be undone. */
  const [undo, setUndo] = useState<string[] | null>(null);

  // Opening the Inbox means the "new spend" notifications have been seen: clear them from the shade.
  useEffect(() => {
    if (isNative) SmsInbox.clearNotifications().catch(() => {});
  }, []);

  if (!rows || !methods || !categories || enabled === undefined) return null;

  const pmById = new Map(methods.map((m) => [m.id, m]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const ready = rows.filter((x) => x.r?.ready);

  const checkNow = async () => {
    setBusy(true);
    const added = await syncSms();
    setStatus(added ? `${added} new` : 'No new bank SMS');
    setBusy(false);
  };

  const addAllReady = async () => {
    setBusy(true);
    for (const { item } of ready) await addFromInbox(item);
    setBusy(false);
  };

  const dismissAll = async () => {
    const ids = rows.map((x) => x.item.id);
    if (!confirm(`Dismiss all ${ids.length} items? They won't be added as spends.`)) return;
    await setInboxStatusBulk(ids, 'dismissed');
    setUndo(ids);
  };

  const undoDismiss = async () => {
    if (undo) await setInboxStatusBulk(undo, 'pending');
    setUndo(null);
  };

  return (
    <>
      <header className="page-head spread">
        <h1>Inbox</h1>
        {enabled && (
          <button className="btn small" disabled={busy} onClick={checkNow}>
            {busy ? 'Checking…' : 'Check SMS'}
          </button>
        )}
      </header>
      {status && <p className="hint">{status}</p>}

      {!enabled && (
        <section className="card">
          <h3>Automatic SMS capture is off</h3>
          <p className="hint">Turn it on and every bank / card alert SMS shows up here, ready to add with one tap.</p>
          <button className="btn primary" onClick={onOpenSettings}>
            Set up in Settings
          </button>
        </section>
      )}

      {undo && (
        <p className="notice undo-bar">
          Dismissed {undo.length} item{undo.length === 1 ? '' : 's'}.
          <button className="link" onClick={undoDismiss}>
            Undo
          </button>
        </p>
      )}

      {enabled && rows.length === 0 && !undo && <p className="empty card">All caught up. New bank SMS will appear here.</p>}

      {rows.length > 1 && (
        <div className="bulk-actions">
          <button className="btn" disabled={busy} onClick={dismissAll}>
            Dismiss all {rows.length}
          </button>
          {ready.length > 0 && (
            <button className="btn primary" disabled={busy} onClick={addAllReady}>
              Add all {ready.length} ready
            </button>
          )}
        </div>
      )}

      {rows.map(({ item, r }) => {
        if (!r) {
          return (
            <section className="card inbox-item" key={item.id}>
              <p className="hint">Couldn't read this SMS.</p>
              <div className="row-actions">
                <button className="link" onClick={() => onReview(item)}>
                  Review
                </button>
                <button className="link muted" onClick={() => setInboxStatus(item.id, 'dismissed')}>
                  Dismiss
                </button>
              </div>
            </section>
          );
        }
        const { parsed } = r;
        const pm = r.paymentMethodId ? pmById.get(r.paymentMethodId) : undefined;
        const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
        return (
          <section className="card inbox-item" key={item.id}>
            <div className="inbox-top">
              <span className="txn-icon" aria-hidden>
                {cat?.icon ?? '📩'}
              </span>
              <div className="txn-main">
                <span className="txn-merchant">{parsed.merchant || parsed.bank || 'Bank transaction'}</span>
                <span className="txn-sub">
                  {pm
                    ? `${pm.name}${pm.last4 ? ` ••${pm.last4}` : ''}`
                    : `New: ${parsed.bank ?? ''} ${KIND_LABELS[parsed.accountKind ?? 'credit_card'].toLowerCase()} ••${parsed.last4 ?? '????'}`}{' '}
                  · {dayLabel(r.occurredAt.slice(0, 10))}, {timeLabel(r.occurredAt)}
                </span>
                <span className="txn-sub">{cat ? `${cat.icon} ${cat.name}` : 'Category needed'}</span>
              </div>
              <span className={`txn-amount ${parsed.type === 'credit' ? 'credit' : ''}`}>
                {parsed.type === 'credit' ? '+' : '−'}
                {formatINR(parsed.amount)}
              </span>
            </div>

            {(r.duplicate || parsed.likelyTransfer) && (
              <p className="notice warn">
                {r.duplicate
                  ? `Possible duplicate of ${r.duplicate.merchant || 'an entry'} ${formatINR(r.duplicate.amount)} already logged.`
                  : 'Looks like a bank transfer (RTGS/NEFT/IMPS), not a spend.'}
              </p>
            )}

            <div className="inbox-actions">
              <button className="btn" onClick={() => setInboxStatus(item.id, 'dismissed')}>
                Dismiss
              </button>
              <button className="btn" onClick={() => onReview(item)}>
                Review
              </button>
              {r.ready && (
                <button className="btn primary" onClick={() => addFromInbox(item)}>
                  Add
                </button>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
