import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Transaction } from '../types';
import { listCategories, listPaymentMethods, transactionsFor } from '../db';
import { formatINR } from '../lib/money';
import { dayLabel } from '../lib/dates';
import { groupByDay, totalSpent } from '../lib/stats';
import MonthPicker from '../components/MonthPicker';
import TxnRow from '../components/TxnRow';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  onEdit: (t: Transaction) => void;
}

export default function Transactions({ month, setMonth, onEdit }: Props) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [methodId, setMethodId] = useState('');

  const txns = useLiveQuery(() => transactionsFor(month), [month]);
  const methods = useLiveQuery(() => listPaymentMethods(), []);
  const categories = useLiveQuery(() => listCategories(), []);

  if (!txns || !methods || !categories) return null;

  const catById = new Map(categories.map((c) => [c.id, c]));
  const pmById = new Map(methods.map((m) => [m.id, m]));
  const q = query.trim().toLowerCase();
  const filtered = txns.filter(
    (t) =>
      (!categoryId || t.categoryId === categoryId) &&
      (!methodId || t.paymentMethodId === methodId) &&
      (!q || t.merchant.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q)),
  );
  const filtering = q || categoryId || methodId;

  return (
    <>
      <header className="page-head">
        <MonthPicker month={month} setMonth={setMonth} />
      </header>

      <div className="filters">
        <input type="search" placeholder="Search merchant or notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="filter-selects">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} aria-label="Filter by payment method">
            <option value="">All cards / accounts</option>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="summary-line">
        {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'} · {formatINR(totalSpent(filtered))}
        {filtering ? ' (filtered)' : ''}
      </div>

      {filtered.length === 0 && <p className="empty card">No entries.</p>}

      {groupByDay(filtered).map((g) => (
        <section className="card day-group" key={g.day}>
          <div className="day-head">
            <span>{dayLabel(g.day)}</span>
            <span className="num">{formatINR(g.total)}</span>
          </div>
          {g.items.map((t) => (
            <TxnRow key={t.id} txn={t} category={catById.get(t.categoryId)} method={pmById.get(t.paymentMethodId)} onClick={() => onEdit(t)} />
          ))}
        </section>
      ))}
    </>
  );
}
