import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category, PaymentMethod, PaymentMethodKind } from '../types';
import { KIND_LABELS } from '../types';
import { db, getMeta, listCategories, listPaymentMethods, saveCategory, savePaymentMethod, setMeta, transactionsFor } from '../db';
import { formatINR, paiseToInput, parseToPaise } from '../lib/money';
import { monthKey } from '../lib/dates';
import { downloadFile, parseBackup, toCSV, type Backup } from '../lib/export';

export default function Settings() {
  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <BudgetSection />
      <PaymentMethodsSection />
      <CategoriesSection />
      <DataSection />
    </>
  );
}

function BudgetSection() {
  const budget = useLiveQuery(() => getMeta<number>('monthlyBudget'), []);
  const [value, setValue] = useState('');
  useEffect(() => setValue(budget ? paiseToInput(budget) : ''), [budget]);

  const save = () => {
    const paise = value.trim() ? parseToPaise(value) : 0;
    if (paise === null) return alert('Enter a valid amount');
    setMeta('monthlyBudget', paise || undefined);
  };

  return (
    <section className="card">
      <h3>Overall monthly budget</h3>
      <div className="inline-form">
        <input inputMode="decimal" placeholder="e.g. 50000" value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} />
        <button className="btn" onClick={save}>
          Save
        </button>
      </div>
    </section>
  );
}

// ---------- Payment methods ----------

type PMDraft = { id?: string; name: string; kind: PaymentMethodKind; bank: string; last4: string };
const emptyPM: PMDraft = { name: '', kind: 'credit_card', bank: '', last4: '' };

function PaymentMethodsSection() {
  const methods = useLiveQuery(() => listPaymentMethods(), []);
  const [draft, setDraft] = useState<PMDraft | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (draft.last4 && !/^\d{4}$/.test(draft.last4)) return alert('Last 4 digits must be 4 numbers');
    const name = draft.name.trim() || [draft.bank.trim(), KIND_LABELS[draft.kind]].filter(Boolean).join(' ');
    await savePaymentMethod({ id: draft.id, name, kind: draft.kind, bank: draft.bank.trim() || undefined, last4: draft.last4 || undefined });
    setDraft(null);
  };

  const edit = (m: PaymentMethod) => setDraft({ id: m.id, name: m.name, kind: m.kind, bank: m.bank ?? '', last4: m.last4 ?? '' });
  const visible = methods?.filter((m) => showArchived || !m.archived) ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <h3>Cards &amp; accounts</h3>
        <button className="link" onClick={() => setDraft({ ...emptyPM })}>
          + Add
        </button>
      </div>
      <p className="hint">
        Add each credit card, debit card and bank account (UPI payments come from a bank account or RuPay credit card). Last 4 digits will be used
        later to match bank SMS automatically.
      </p>

      {draft && (
        <form className="edit-box" onSubmit={save}>
          <div className="grid2">
            <label className="field">
              <span>Type</span>
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PaymentMethodKind })}>
                {Object.entries(KIND_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Bank / issuer</span>
              <input placeholder="HDFC, Axis, AU…" value={draft.bank} onChange={(e) => setDraft({ ...draft, bank: e.target.value })} />
            </label>
            <label className="field">
              <span>Name</span>
              <input placeholder="e.g. HDFC Regalia" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Last 4 digits</span>
              <input
                inputMode="numeric"
                maxLength={4}
                placeholder="1234"
                value={draft.last4}
                onChange={(e) => setDraft({ ...draft, last4: e.target.value.replace(/\D/g, '') })}
              />
            </label>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn primary">{draft.id ? 'Save' : 'Add'}</button>
          </div>
        </form>
      )}

      <ul className="list">
        {visible.map((m) => (
          <li key={m.id} className={m.archived ? 'archived' : ''}>
            <div>
              <div>
                {m.name}
                {m.last4 ? ` ••${m.last4}` : ''}
              </div>
              <small className="muted">
                {KIND_LABELS[m.kind]}
                {m.bank ? ` · ${m.bank}` : ''}
              </small>
            </div>
            <div className="row-actions">
              <button className="link" onClick={() => edit(m)}>
                Edit
              </button>
              <button className="link" onClick={() => savePaymentMethod({ ...m, archived: !m.archived })}>
                {m.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {methods?.some((m) => m.archived) && (
        <button className="link" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      )}
    </section>
  );
}

// ---------- Categories ----------

type CatDraft = { id?: string; name: string; icon: string; budget: string };

function CategoriesSection() {
  const categories = useLiveQuery(() => listCategories(), []);
  const [draft, setDraft] = useState<CatDraft | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim()) return;
    const budget = draft.budget.trim() ? parseToPaise(draft.budget) : undefined;
    if (budget === null) return alert('Enter a valid budget');
    await saveCategory({ id: draft.id, name: draft.name.trim(), icon: draft.icon.trim() || '📦', budget: budget || undefined });
    setDraft(null);
  };

  const edit = (c: Category) => setDraft({ id: c.id, name: c.name, icon: c.icon, budget: c.budget ? paiseToInput(c.budget) : '' });
  const visible = categories?.filter((c) => showArchived || !c.archived) ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <h3>Categories &amp; budgets</h3>
        <button className="link" onClick={() => setDraft({ name: '', icon: '', budget: '' })}>
          + Add
        </button>
      </div>

      {draft && (
        <form className="edit-box" onSubmit={save}>
          <div className="grid2">
            <label className="field">
              <span>Icon (emoji)</span>
              <input value={draft.icon} placeholder="🛒" onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
            </label>
            <label className="field">
              <span>Name</span>
              <input value={draft.name} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              <span>Monthly budget (₹)</span>
              <input inputMode="decimal" placeholder="Optional" value={draft.budget} onChange={(e) => setDraft({ ...draft, budget: e.target.value })} />
            </label>
          </div>
          <div className="sheet-actions">
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="btn primary">{draft.id ? 'Save' : 'Add'}</button>
          </div>
        </form>
      )}

      <ul className="list">
        {visible.map((c) => (
          <li key={c.id} className={c.archived ? 'archived' : ''}>
            <div>
              <div>
                {c.icon} {c.name}
              </div>
              <small className="muted">{c.budget ? `Budget ${formatINR(c.budget)}/month` : 'No budget'}</small>
            </div>
            <div className="row-actions">
              <button className="link" onClick={() => edit(c)}>
                Edit
              </button>
              <button className="link" onClick={() => saveCategory({ ...c, archived: !c.archived })}>
                {c.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {categories?.some((c) => c.archived) && (
        <button className="link" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      )}
    </section>
  );
}

// ---------- Export / backup ----------

function DataSection() {
  const [status, setStatus] = useState('');

  const exportCSV = async (scope: 'month' | 'all') => {
    const month = monthKey();
    const txns = await transactionsFor(scope === 'month' ? month : '');
    const csv = toCSV(txns, await db.paymentMethods.toArray(), await db.categories.toArray());
    downloadFile(`spends-${scope === 'month' ? month : 'all'}.csv`, csv, 'text/csv');
  };

  const exportBackup = async () => {
    const backup: Backup = {
      app: 'spend-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: await db.transactions.toArray(),
      paymentMethods: await db.paymentMethods.toArray(),
      categories: await db.categories.toArray(),
    };
    downloadFile(`spend-tracker-backup-${monthKey()}.json`, JSON.stringify(backup), 'application/json');
  };

  const importBackup = async (file: File) => {
    try {
      const backup = parseBackup(await file.text());
      await db.transaction('rw', db.transactions, db.paymentMethods, db.categories, async () => {
        await db.paymentMethods.bulkPut(backup.paymentMethods);
        await db.categories.bulkPut(backup.categories);
        await db.transactions.bulkPut(backup.transactions);
      });
      setStatus(`Restored ${backup.transactions.length} entries.`);
    } catch (err) {
      setStatus(`Import failed: ${(err as Error).message}`);
    }
  };

  return (
    <section className="card">
      <h3>Export &amp; backup</h3>
      <p className="hint">CSV opens directly in Google Sheets (File → Import). All data is stored on this device only, so keep a backup.</p>
      <div className="btn-col">
        <button className="btn" onClick={() => exportCSV('month')}>
          Export this month (CSV)
        </button>
        <button className="btn" onClick={() => exportCSV('all')}>
          Export everything (CSV)
        </button>
        <button className="btn" onClick={exportBackup}>
          Download backup (JSON)
        </button>
        <label className="btn file-btn">
          Restore from backup
          <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </label>
      </div>
      {status && <p className="hint">{status}</p>}
    </section>
  );
}
