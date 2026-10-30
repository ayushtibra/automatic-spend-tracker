import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { App as NativeApp } from '@capacitor/app';
import type { InboxItem, Transaction } from './types';
import { db, setInboxStatus } from './db';
import { monthKey } from './lib/dates';
import { ingestSms, syncSms } from './lib/smsSync';
import { isNative, SmsInbox } from './native/smsInbox';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import TransactionForm from './components/TransactionForm';

type Tab = 'home' | 'txns' | 'inbox' | 'settings';

const tabFromHash = (): Tab => {
  const h = location.hash.replace('#/', '');
  return h === 'txns' || h === 'inbox' || h === 'settings' ? h : 'home';
};

/** Text shared into the installed app (Android share sheet → Web Share Target), consumed once. */
function takeSharedText(): string | undefined {
  const params = new URLSearchParams(location.search);
  const text = [params.get('text'), params.get('title')].find((t) => t?.trim());
  if (params.has('text') || params.has('title')) history.replaceState(null, '', location.pathname + location.hash);
  return text ?? undefined;
}

/** Text to pre-fill the add form with: a quick add from Home, shared text, or an Inbox SMS being reviewed. */
interface SmsDraft {
  text: string;
  receivedAt?: number;
  inboxId?: string;
}

const sharedOnLaunch = takeSharedText();

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [month, setMonth] = useState(monthKey());
  const [smsDraft, setSmsDraft] = useState<SmsDraft | undefined>(sharedOnLaunch ? { text: sharedOnLaunch } : undefined);
  const [editing, setEditing] = useState<Transaction | 'new' | null>(sharedOnLaunch ? 'new' : null);
  const pendingCount = useLiveQuery(() => db.inbox.where('status').equals('pending').count(), []) ?? 0;

  const go = (t: Tab) => (location.hash = t === 'home' ? '/' : `/${t}`);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Android app: pull new bank SMS on launch / resume, take live ones as they arrive.
  useEffect(() => {
    if (!isNative) return;
    syncSms();
    SmsInbox.takeLaunchAction().then(({ openInbox }) => openInbox && go('inbox'));
    const subs = [
      NativeApp.addListener('resume', () => syncSms()),
      SmsInbox.addListener('smsReceived', (sms) => ingestSms([sms])),
      SmsInbox.addListener('openInbox', () => go('inbox')),
    ];
    return () => subs.forEach((s) => s.then((h) => h.remove()));
  }, []);

  // Android back button: close the sheet, then go Home, then leave the app.
  const backState = useRef({ editing, tab });
  backState.current = { editing, tab };
  useEffect(() => {
    if (!isNative) return;
    const sub = NativeApp.addListener('backButton', () => {
      const { editing, tab } = backState.current;
      if (editing) closeForm();
      else if (tab !== 'home') go('home');
      else NativeApp.exitApp();
    });
    return () => {
      sub.then((h) => h.remove());
    };
  }, []);

  const closeForm = () => {
    setEditing(null);
    setSmsDraft(undefined);
  };

  const review = (item: InboxItem) => {
    setSmsDraft({ text: item.body, receivedAt: item.receivedAt, inboxId: item.id });
    setEditing('new');
  };

  const tabs: [Tab, string, string][] = [
    ['home', '🏠', 'Home'],
    ['txns', '📋', 'Spends'],
    ...(isNative || pendingCount > 0 ? ([['inbox', '📩', 'Inbox']] as [Tab, string, string][]) : []),
    ['settings', '⚙️', 'Settings'],
  ];

  return (
    <div className="app">
      <main className="content">
        {tab === 'home' && (
          <Dashboard
            month={month}
            setMonth={setMonth}
            onEdit={setEditing}
            onSeeAll={() => go('txns')}
            onQuickAdd={(text) => {
              setSmsDraft({ text });
              setEditing('new');
            }}
          />
        )}
        {tab === 'txns' && <Transactions month={month} setMonth={setMonth} onEdit={setEditing} />}
        {tab === 'inbox' && <Inbox onReview={review} onOpenSettings={() => go('settings')} />}
        {tab === 'settings' && <Settings />}
      </main>

      {tab !== 'settings' && (
        <button className="fab" aria-label="Add spend" onClick={() => setEditing('new')}>
          +
        </button>
      )}

      <nav className="tabbar">
        {tabs.map(([key, icon, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => go(key)}>
            <span aria-hidden className="tab-icon">
              {icon}
              {key === 'inbox' && pendingCount > 0 && <b className="badge">{pendingCount > 99 ? '99+' : pendingCount}</b>}
            </span>
            {label}
          </button>
        ))}
      </nav>

      {editing && (
        <TransactionForm
          initial={editing === 'new' ? undefined : editing}
          initialText={editing === 'new' ? smsDraft?.text : undefined}
          smsReceivedAt={smsDraft?.receivedAt}
          onSaved={(id) => smsDraft?.inboxId && setInboxStatus(smsDraft.inboxId, 'added', id)}
          onClose={closeForm}
        />
      )}
    </div>
  );
}
