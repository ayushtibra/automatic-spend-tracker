import { useLiveQuery } from 'dexie-react-hooks';
import type { Transaction } from '../types';
import { KIND_LABELS } from '../types';
import { getMeta, listCategories, listPaymentMethods, transactionsFor } from '../db';
import { formatINR } from '../lib/money';
import { daysInMonth, monthKey, nowLocal } from '../lib/dates';
import { dailySpend, spendBy, totalSpent } from '../lib/stats';
import MonthPicker from '../components/MonthPicker';
import TxnRow from '../components/TxnRow';
import QuickAddBar from '../components/QuickAddBar';

interface Props {
  month: string;
  setMonth: (m: string) => void;
  onEdit: (t: Transaction) => void;
  onSeeAll: () => void;
  /** Typed / spoken quick add from the bar at the top. */
  onQuickAdd: (text: string) => void;
}

export default function Dashboard({ month, setMonth, onEdit, onSeeAll, onQuickAdd }: Props) {
  const txns = useLiveQuery(() => transactionsFor(month), [month]);
  const methods = useLiveQuery(() => listPaymentMethods(), []);
  const categories = useLiveQuery(() => listCategories(), []);
  const overallBudget = useLiveQuery(() => getMeta<number>('monthlyBudget'), []);

  if (!txns || !methods || !categories) return null;

  const total = totalSpent(txns);
  const days = daysInMonth(month);
  const isCurrent = month === monthKey();
  const elapsed = isCurrent ? Number(nowLocal().slice(8, 10)) : days;
  const daily = dailySpend(txns, days);
  const maxDaily = Math.max(...daily, 1);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const pmById = new Map(methods.map((m) => [m.id, m]));
  const byCategory = spendBy(txns, (t) => t.categoryId);
  const byMethod = spendBy(txns, (t) => t.paymentMethodId);

  // Budgeted categories first (even with zero spend), then the rest by spend.
  const spentByCat = new Map(byCategory);
  const categoryRows = [
    ...categories.filter((c) => c.budget && !c.archived).map((c) => [c.id, spentByCat.get(c.id) ?? 0] as const),
    ...byCategory.filter(([id]) => !catById.get(id)?.budget),
  ].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <header className="page-head">
        <MonthPicker month={month} setMonth={setMonth} />
      </header>

      <QuickAddBar onSubmit={onQuickAdd} />

      <section className="card hero">
        <div className="hero-label">Spent</div>
        <div className="hero-amount">{formatINR(total)}</div>
        {overallBudget ? (
          <>
            <Bar value={total} max={overallBudget} />
            <div className="hero-sub">
              {total <= overallBudget
                ? `${formatINR(overallBudget - total)} left of ${formatINR(overallBudget)}`
                : `${formatINR(total - overallBudget)} over budget of ${formatINR(overallBudget)}`}
            </div>
          </>
        ) : (
          <div className="hero-sub">Set a monthly budget in Settings</div>
        )}
        <div className="hero-sub">
          {txns.length} {txns.length === 1 ? 'entry' : 'entries'} · avg {formatINR(Math.round(total / Math.max(elapsed, 1)))}/day
        </div>
        <div className="sparkbars" aria-hidden>
          {daily.map((v, i) => (
            <span key={i} style={{ height: `${Math.max(0, (v / maxDaily) * 100)}%` }} className={i + 1 > elapsed ? 'future' : ''} />
          ))}
        </div>
      </section>

      <section className="card">
        <h3>By category</h3>
        {categoryRows.length === 0 && <p className="empty">No spends yet this month.</p>}
        {categoryRows.map(([id, spent]) => {
          const c = catById.get(id);
          return (
            <div className="stat-row" key={id}>
              <div className="stat-line">
                <span>
                  {c?.icon} {c?.name ?? 'Unknown'}
                </span>
                <span className="num">
                  {formatINR(spent)}
                  {c?.budget ? <small> / {formatINR(c.budget)}</small> : null}
                </span>
              </div>
              {c?.budget ? <Bar value={spent} max={c.budget} /> : <Bar value={spent} max={total} muted />}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3>By card / account</h3>
        {byMethod.length === 0 && <p className="empty">Nothing yet.</p>}
        {byMethod.map(([id, spent]) => {
          const m = pmById.get(id);
          return (
            <div className="stat-row" key={id}>
              <div className="stat-line">
                <span>
                  {m?.name ?? 'Unknown'}
                  {m?.last4 ? ` ••${m.last4}` : ''} <small className="muted">{m && !m.name.toLowerCase().includes(KIND_LABELS[m.kind].toLowerCase()) ? KIND_LABELS[m.kind] : ''}</small>
                </span>
                <span className="num">{formatINR(spent)}</span>
              </div>
              <Bar value={spent} max={total} muted />
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Recent</h3>
          {txns.length > 5 && (
            <button className="link" onClick={onSeeAll}>
              See all
            </button>
          )}
        </div>
        {txns.length === 0 && <p className="empty">Tap + to add your first spend.</p>}
        {txns.slice(0, 5).map((t) => (
          <TxnRow key={t.id} txn={t} category={catById.get(t.categoryId)} method={pmById.get(t.paymentMethodId)} onClick={() => onEdit(t)} />
        ))}
      </section>
    </>
  );
}

function Bar({ value, max, muted }: { value: number; max: number; muted?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const level = muted ? 'muted' : value > max ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="bar">
      <span className={level} style={{ width: `${pct}%` }} />
    </div>
  );
}
