import type { Category, PaymentMethod, Transaction } from '../types';
import { formatINR } from '../lib/money';
import { timeLabel } from '../lib/dates';

interface Props {
  txn: Transaction;
  category?: Category;
  method?: PaymentMethod;
  onClick: () => void;
}

export default function TxnRow({ txn, category, method, onClick }: Props) {
  const credit = txn.type === 'credit';
  return (
    <button className="txn-row" onClick={onClick}>
      <span className="txn-icon" aria-hidden>
        {category?.icon ?? '📦'}
      </span>
      <span className="txn-main">
        <span className="txn-merchant">{txn.merchant || category?.name || 'Spend'}</span>
        <span className="txn-sub">
          {category?.name ?? 'Uncategorised'} · {method?.name ?? 'Unknown'} · {timeLabel(txn.occurredAt)}
          {txn.notes ? ` · ${txn.notes}` : ''}
        </span>
      </span>
      <span className={`txn-amount ${credit ? 'credit' : ''}`}>
        {credit ? '+' : '−'}
        {formatINR(txn.amount)}
      </span>
    </button>
  );
}
