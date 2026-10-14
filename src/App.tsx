import { useEffect, useState } from 'react';
import type { Transaction } from './types';
import { monthKey } from './lib/dates';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Settings from './pages/Settings';
import TransactionForm from './components/TransactionForm';

type Tab = 'home' | 'txns' | 'settings';

const tabFromHash = (): Tab => {
  const h = location.hash.replace('#/', '');
  return h === 'txns' || h === 'settings' ? h : 'home';
};

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [month, setMonth] = useState(monthKey());
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const go = (t: Tab) => (location.hash = t === 'home' ? '/' : `/${t}`);

  return (
    <div className="app">
      <main className="content">
        {tab === 'home' && <Dashboard month={month} setMonth={setMonth} onEdit={setEditing} onSeeAll={() => go('txns')} />}
        {tab === 'txns' && <Transactions month={month} setMonth={setMonth} onEdit={setEditing} />}
        {tab === 'settings' && <Settings />}
      </main>

      {tab !== 'settings' && (
        <button className="fab" aria-label="Add spend" onClick={() => setEditing('new')}>
          +
        </button>
      )}

      <nav className="tabbar">
        {([
          ['home', '🏠', 'Home'],
          ['txns', '📋', 'Spends'],
          ['settings', '⚙️', 'Settings'],
        ] as const).map(([key, icon, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => go(key)}>
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {editing && <TransactionForm initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
